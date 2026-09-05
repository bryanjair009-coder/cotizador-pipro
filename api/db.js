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

// ── Lista blanca: tabla → operación → rol mínimo ──────────────────────────────
const PERMISOS = {
  materiales:    { select: 'todos', upsert: 'admin', delete: 'admin' },
  clientes:      { select: 'todos', upsert: 'todos', delete: 'admin' },
  requisiciones: { select: 'todos', upsert: 'todos', delete: 'todos' },
  meta:          { select: 'todos', upsert: 'mixto', delete: 'admin' },
  bitacora:      { select: 'admin' },
};

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

function permitido(rol, exigido) {
  return exigido === 'todos' || (exigido === 'admin' && rol === 'admin');
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
    } else if (!permitido(s.r, exigido)) {
      return res.status(403).json({ error: 'No tienes permisos para esta operación.', code: 'SIN_PERMISO' });
    }

    switch (op) {
      case 'select': {
        const out = await sb.select(table, sanearQuery(query));
        return res.status(200).json(out);
      }

      case 'upsert': {
        if (!data) return res.status(400).json({ error: 'Faltan datos' });
        const filas = Array.isArray(data) ? data : [data];
        if (filas.length > 1000) return res.status(413).json({ error: 'Máximo 1000 registros por petición' });
        if (onConflict && !IDENT.test(onConflict)) return res.status(400).json({ error: 'on_conflict no válido' });

        const out = await sb.upsert(table, filas, onConflict);
        await bitacora(s, 'ESCRITURA', table,
          `${filas.length} registro(s): ${filas.slice(0, 5).map(f => f.numero_parte || f.nombre || f.folio || f.key || '?').join(', ')}`, req);
        return res.status(200).json(out);
      }

      case 'delete': {
        const f = sanearQuery(filter).replace(/^\?/, '');
        if (!f) return res.status(400).json({ error: 'Un borrado siempre requiere filtro' });
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
