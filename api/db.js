// ═══════════════════════════════════════════════════════════════════════════════
//  api/db.js — Único punto de acceso a la base de datos
//
//  El navegador ya no habla con Supabase: habla con este proxy, que
//   1. exige sesión válida,
//   2. valida la tabla y la operación contra una lista blanca,
//   3. sanea el filtro para impedir consultas cruzadas (embeddings PostgREST),
//   4. registra toda escritura en la bitácora.
// ═══════════════════════════════════════════════════════════════════════════════

import { sb, bitacora } from './_lib/sb.js';
import { proteger, rateLimit, leerJSON } from './_lib/guard.js';
import { areaDe, areaValida, esAdminDeArea, TABLAS_POR_AREA } from './_lib/areas.js';

// ── Lista blanca: tabla → operación → rol mínimo ──────────────────────────────
const PERMISOS = {
  materiales:    { select: 'todos', upsert: 'admin', delete: 'admin' },
  clientes:      { select: 'todos', upsert: 'todos', delete: 'admin' },
  requisiciones: { select: 'todos', upsert: 'todos', delete: 'todos' },
  meta:          { select: 'todos', upsert: 'mixto', delete: 'admin' },
  bitacora:      { select: 'admin' },
  /* Quién da de alta una empresa con proyecto activo: el administrador de su
     área (`admin` en Ingeniería, `admin_servicio` en Servicio). Leerlas sí
     puede cualquiera, porque el técnico necesita el desplegable — pero sólo
     las de su área, que eso lo impone el filtro de más abajo. */
  proyectos:     { select: 'todos', upsert: 'admin_area', delete: 'admin_area' },
  /* Incidencias: cada quien las suyas. `propio` no es un rol, es una marca que
     se resuelve más abajo acotando la consulta y forzando el `usuario` de cada
     renglón que se escribe. El administrador del área las ve y las corrige
     todas, las de su área. */
  incidencias:   { select: 'propio', upsert: 'propio', delete: 'admin_area' },
};

/* Tablas que llevan columna `usuario` y por tanto admiten que el servidor la
   rellene con la sesión. El resto no la tiene: escribirla las rompe. */
const TIENEN_USUARIO = new Set(['incidencias']);

// Claves de `meta` que mueven dinero: sólo administrador
const META_ADMIN = new Set(['utilidades']);

// Operadores PostgREST admitidos en los filtros
const OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
  'is', 'in', 'not.is', 'not.eq', 'cs', 'cd']);

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Valida una query string de PostgREST.
 * Rechaza cualquier `select` con paréntesis (que permitiría leer tablas
 * relacionadas, p. ej. `?select=*,usuarios(password_hash)`).
 */
export function sanearQuery(qs) {
  if (!qs) return '';
  const raw = String(qs).replace(/^\?/, '');
  if (!raw) return '';
  if (raw.length > 500) throw new Error('Filtro demasiado largo');

  const partes = [];
  for (const par of raw.split('&')) {
    if (!par) continue;
    const i = par.indexOf('=');
    if (i < 1) throw new Error(`Filtro no válido: ${par}`);
    const k = par.slice(0, i);
    const v = par.slice(i + 1);

    if (k === 'select') {
      if (/[()*]/.test(v)) throw new Error('El parámetro select no admite relaciones');
      if (!v.split(',').every(c => IDENT.test(c.trim()))) throw new Error('Columnas no válidas en select');
    } else if (k === 'order') {
      if (!v.split(',').every(c => /^[a-zA-Z_][a-zA-Z0-9_]*(\.(asc|desc))?(\.(nullsfirst|nullslast))?$/.test(c.trim())))
        throw new Error('Orden no válido');
    } else if (k === 'limit' || k === 'offset') {
      if (!/^\d{1,7}$/.test(v)) throw new Error('Límite no válido');
    } else if (k === 'on_conflict') {
      if (!IDENT.test(v)) throw new Error('on_conflict no válido');
    } else {
      // filtro de columna: columna=op.valor  (el valor puede contener puntos)
      if (!IDENT.test(k)) throw new Error(`Columna no válida: ${k}`);
      const val = decodeURIComponent(v);
      let corte = val.indexOf('.');
      if (corte < 1) throw new Error(`Operador no permitido en ${k}`);
      let operador = val.slice(0, corte);
      if (operador === 'not') {                       // operadores compuestos: not.is, not.eq
        corte = val.indexOf('.', corte + 1);
        if (corte < 0) throw new Error(`Operador no permitido en ${k}`);
        operador = val.slice(0, corte);
      }
      if (!OPS.has(operador)) throw new Error(`Operador no permitido en ${k}`);
    }
    partes.push(par);
  }
  return '?' + partes.join('&');
}

/* `admin` exige al administrador del portal (catálogo, utilidades, bitácora);
   `admin_area`, al que manda en su área, que puede ser el de Servicio. */
function permitido(rol, exigido) {
  if (exigido === 'todos') return true;
  if (exigido === 'admin') return rol === 'admin';
  if (exigido === 'admin_area') return esAdminDeArea(rol);
  return false;
}

/* Columnas que un no-administrador NO debe recibir, por tabla.
   El `select` lo arma el navegador, así que pedir «sólo estas columnas» desde
   el cliente no protege nada: un técnico podría mandar `select=*`. El folio de
   proyecto es dato reservado —se ve en el panel de administrador y en el
   archivo de carga, en ningún otro lado—, así que se quita aquí, al salir. */
const COLUMNAS_RESERVADAS = {
  proyectos:   ['folio', 'nota'],
  incidencias: ['folio'],
};
function quitarReservadas(tabla, filas) {
  const fuera = COLUMNAS_RESERVADAS[tabla];
  if (!fuera || !Array.isArray(filas)) return filas;
  return filas.map(f => {
    const copia = { ...f };
    fuera.forEach(c => delete copia[c]);
    return copia;
  });
}

/* Acota una consulta a los renglones del propio usuario.
   Se AÑADE el filtro en vez de confiar en el que venga del navegador: si el
   cliente ya mandó un `usuario=eq.otro`, PostgREST aplicaría los dos y no
   devolvería nada, que es justo lo que debe pasar. */
function acotarAlUsuario(qs, usuario) {
  return añadirFiltro(qs, 'usuario=eq.' + encodeURIComponent(usuario));
}

/* Acota una consulta al área de la sesión. Es la frontera entre Ingeniería y
   Servicio: cada una ve su personal, sus empresas y sus horas, y ninguna sabe
   que la otra existe. Se añade aquí, con el área que viene FIRMADA en la
   cookie, nunca con lo que mande el navegador. */
function acotarAlArea(qs, area) {
  return añadirFiltro(qs, 'area=eq.' + encodeURIComponent(area));
}

/* Ids de los renglones que YA existen y no son del área de quien escribe.
   Un upsert con `id` es un UPDATE encubierto: sin esta comprobación, mandar
   el id de un proyecto de Ingeniería desde Servicio lo reescribiría entero.
   Los renglones sin `id` son altas y no se consultan. */
async function idsDeOtraArea(tabla, filas, area) {
  const ids = [...new Set(filas.map(f => +f.id).filter(Number.isFinite))];
  if (!ids.length) return [];
  const existentes = await sb.select(tabla, `?select=id&id=in.(${ids.join(',')})&area=eq.${encodeURIComponent(area)}`);
  const mios = new Set((existentes || []).map(r => String(r.id)));
  // Lo que no aparece como propio es de otra área o no existe (y nacerá aquí).
  const ajenos = [];
  for (const id of ids) {
    if (mios.has(String(id))) continue;
    const todos = await sb.select(tabla, `?select=id&id=eq.${id}&limit=1`);
    if (todos?.length) ajenos.push(id);
  }
  return ajenos;
}

function añadirFiltro(qs, extra) {
  const base = sanearQuery(qs).replace(/^\?/, '');
  return '?' + (base ? base + '&' + extra : extra);
}

export default async function handler(req, res) {
  const s = proteger(req, res);
  if (!s) return;

  if (!rateLimit(req, { max: 240, windowMs: 60_000, key: 'db' })) {
    return res.status(429).json({ error: 'Demasiadas peticiones. Espera un momento.' });
  }

  try {
    const body = await leerJSON(req, 6_000_000);   // el catálogo completo cabe aquí
    const { op, table, query, data, onConflict, filter } = body;

    const reglas = PERMISOS[table];
    if (!reglas) return res.status(403).json({ error: `Tabla no permitida: ${table}` });

    const exigido = reglas[op];
    if (!exigido) return res.status(403).json({ error: `Operación no permitida: ${op} sobre ${table}` });

    // `meta` mixto: las claves de utilidades exigen administrador
    if (exigido === 'mixto') {
      const filas = Array.isArray(data) ? data : [data];
      const tocaAdmin = filas.some(f => META_ADMIN.has(f?.key));
      if (tocaAdmin && s.r !== 'admin') {
        return res.status(403).json({ error: 'Sólo un administrador puede modificar los porcentajes de utilidad.', code: 'SIN_PERMISO' });
      }
    } else if (exigido === 'propio') {
      // Lo resuelve cada operación más abajo; aquí basta con tener sesión.
    } else if (!permitido(s.r, exigido)) {
      return res.status(403).json({ error: 'No tienes permisos para esta operación.', code: 'SIN_PERMISO' });
    }

    // El administrador del área ve y corrige todo lo suyo; los demás, sólo
    // los renglones que ellos mismos registraron.
    const soloLoPropio = exigido === 'propio' && !esAdminDeArea(s.r);

    /* El área manda sobre todo lo anterior: aunque el rol alcance, sólo se
       toca lo de la propia área. `porArea` es verdadero para las tablas que
       llevan esa columna. */
    const porArea = TABLAS_POR_AREA.has(table);
    const area = areaDe(s);

    /* El administrador del portal puede ASOMARSE a otra área (`body.area`),
       porque es quien responde por todo el sistema. Sólo para leer: lo que
       escribe cae siempre en la suya, para que nadie acabe con renglones
       mezclados ni un archivo de carga con horas de dos áreas. El de Servicio
       no tiene esta llave: su `area` es la suya y punto. */
    const areaVista = (s.r === 'admin' && areaValida(body.area)) ? body.area : area;

    switch (op) {
      case 'select': {
        let q = soloLoPropio ? acotarAlUsuario(query, s.u) : sanearQuery(query);
        if (porArea) q = acotarAlArea(q, areaVista);
        const out = await sb.select(table, q);
        return res.status(200).json(esAdminDeArea(s.r) ? out : quitarReservadas(table, out));
      }

      case 'upsert': {
        if (!data) return res.status(400).json({ error: 'Faltan datos' });
        const filas = Array.isArray(data) ? data : [data];
        if (filas.length > 1000) return res.status(413).json({ error: 'Máximo 1000 registros por petición' });
        if (onConflict && !IDENT.test(onConflict)) return res.status(400).json({ error: 'on_conflict no válido' });

        /* El `usuario` lo pone el servidor a partir de la sesión, no el
           navegador: si no, un técnico podría registrarle horas a otro.
           Al administrador se le respeta el que mande (necesita corregir
           registros ajenos), pero si no manda ninguno es porque está
           registrando los suyos.
           OJO: sólo para las tablas que tienen esa columna. Aplicarlo a
           todas metía un `usuario` inexistente en `proyectos`, `materiales`
           o `clientes` y PostgREST respondía PGRST204. */
        if (TIENEN_USUARIO.has(table)) {
          if (soloLoPropio) filas.forEach(f => { f.usuario = s.u; });
          else filas.forEach(f => { if (!f.usuario) f.usuario = s.u; });
        }

        /* El área se estampa igual que el usuario: de la sesión, nunca de lo
           que mande el navegador. Y si el renglón trae `id`, se comprueba
           antes que ese id sea del área: un upsert con el id de otra área lo
           sobrescribiría y de paso se lo llevaría consigo. */
        if (porArea) {
          filas.forEach(f => { f.area = area; });
          const ajenos = await idsDeOtraArea(table, filas, area);
          if (ajenos.length) {
            return res.status(403).json({
              error: 'Ese registro pertenece a otra área.', code: 'OTRA_AREA' });
          }
        }

        /* La empresa y el folio se copian del proyecto aquí, no se aceptan del
           navegador. Dos razones: el técnico nunca recibe el folio (es dato
           reservado al administrador), y aunque lo recibiera no debe poder
           cargarle horas a un folio que no le corresponde. El proyecto se
           busca dentro del área, así que no se pueden cargar horas a un
           proyecto de la otra. */
        if (table === 'incidencias') {
          const ids = [...new Set(filas.map(f => +f.proyecto_id).filter(Boolean))];
          if (!ids.length) return res.status(400).json({ error: 'Falta el proyecto de la incidencia.' });
          const proys = await sb.select('proyectos',
            `?select=id,empresa,folio,activo&area=eq.${encodeURIComponent(area)}&id=in.(${ids.join(',')})`);
          const porId = new Map((proys || []).map(p => [String(p.id), p]));
          for (const f of filas) {
            const p = porId.get(String(f.proyecto_id));
            if (!p) return res.status(400).json({ error: 'El proyecto de la incidencia no existe.' });
            if (p.activo === false && !esAdminDeArea(s.r)) {
              return res.status(400).json({ error: `El proyecto de ${p.empresa} ya no está activo.` });
            }
            f.empresa = p.empresa;
            f.folio   = p.folio;
          }
        }

        const out = await sb.upsert(table, filas, onConflict);
        await bitacora(s, 'ESCRITURA', table,
          `${filas.length} registro(s): ${filas.slice(0, 5).map(f => f.numero_parte || f.nombre || f.folio || f.key || '?').join(', ')}`, req);
        return res.status(200).json(out);
      }

      case 'delete': {
        let f = sanearQuery(filter).replace(/^\?/, '');
        if (!f) return res.status(400).json({ error: 'Un borrado siempre requiere filtro' });
        // Borrar por id cruzaría la frontera; el área se añade al filtro.
        if (porArea) f += '&area=eq.' + encodeURIComponent(area);
        const out = await sb.del(table, f);
        await bitacora(s, 'BORRADO', table, f, req);
        return res.status(200).json(out);
      }

      default:
        return res.status(400).json({ error: `Operación desconocida: ${op}` });
    }

  } catch (err) {
    console.error('db:', err);
    return res.status(err.status || 400).json({ error: err.message || 'Error en la operación' });
  }
}
