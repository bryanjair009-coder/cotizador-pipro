// ═══════════════════════════════════════════════════════════════════════════════
//  api/usuarios.js — Administración de cuentas y cambio de contraseña
//
//  Los hashes NUNCA salen de aquí: la lista de usuarios se devuelve con
//  `select` explícito de columnas seguras.
// ═══════════════════════════════════════════════════════════════════════════════

import { hashPassword, verifyPassword, validarPassword } from './_lib/auth.js';
import { sb, bitacora } from './_lib/sb.js';
import { proteger, rateLimit, leerJSON } from './_lib/guard.js';
import { areaDe, areaValida, esAdminDeArea, esAdminPortal, rolesQuePuedeCrear } from './_lib/areas.js';

const COLUMNAS_SEGURAS = 'usuario,nombre,rol,activo,ultimo_acceso,debe_cambiar_password,created_at,codigo_recurso,area';

/* «Codigo Recurso» de iScala: va en la columna A del archivo de carga y sólo
   lo tienen los técnicos. Se guarda como texto —hay códigos con ceros a la
   izquierda— y vacío significa «todavía no se lo asignan». */
function codigoRecurso(v) {
  const t = String(v ?? '').trim().toUpperCase().slice(0, 20);
  return t || null;
}

export default async function handler(req, res) {
  const s = proteger(req, res);
  if (!s) return;

  if (!rateLimit(req, { max: 40, windowMs: 60_000, key: 'usuarios' })) {
    return res.status(429).json({ error: 'Demasiadas peticiones.' });
  }

  try {
    const body = await leerJSON(req, 16_000);
    const accion = body.accion;

    // ── Cambio de contraseña propia: cualquier usuario autenticado ───────────
    if (accion === 'cambiar_password') {
      const { actual, nueva } = body;
      const err = validarPassword(nueva);
      if (err) return res.status(400).json({ error: err });

      const filas = await sb.select('usuarios', `?usuario=eq.${encodeURIComponent(s.u)}&limit=1`);
      if (!filas?.length) return res.status(404).json({ error: 'Usuario no encontrado' });
      if (!verifyPassword(actual, filas[0].password_hash)) {
        await bitacora(s, 'CAMBIO_PASSWORD_FALLIDO', 'usuarios', s.u, req);
        return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
      }

      await sb.update('usuarios', `usuario=eq.${encodeURIComponent(s.u)}`, {
        password_hash: hashPassword(nueva),
        debe_cambiar_password: false,
      });
      await bitacora(s, 'CAMBIO_PASSWORD', 'usuarios', s.u, req);
      return res.status(200).json({ ok: true });
    }

    // ── De aquí en adelante, sólo administradores ───────────────────────────
    if (!esAdminDeArea(s.r)) {
      return res.status(403).json({ error: 'Sólo un administrador puede gestionar cuentas.', code: 'SIN_PERMISO' });
    }

    /* El administrador del portal gobierna las cuentas de todas las áreas —es
       quien da de alta al administrador de Servicio—. El de Servicio sólo ve
       y toca a los suyos: ni siquiera sabe que existe el personal de
       Ingeniería. `alcance()` es ese límite, y se aplica a listar, actualizar
       y eliminar por igual. */
    const miArea = areaDe(s);
    const todasLasAreas = esAdminPortal(s.r);
    const alcance = () => todasLasAreas ? '' : `&area=eq.${encodeURIComponent(miArea)}`;

    /** Comprueba que la cuenta sobre la que se va a actuar está a mi alcance. */
    async function aMiAlcance(usuario) {
      const f = await sb.select('usuarios',
        `?usuario=eq.${encodeURIComponent(usuario)}&select=usuario,area,rol&limit=1${alcance()}`);
      return f?.length ? f[0] : null;
    }

    switch (accion) {
      case 'listar': {
        const filas = await sb.select('usuarios',
          `?select=${COLUMNAS_SEGURAS}&order=usuario.asc${alcance()}`);
        return res.status(200).json(filas || []);
      }

      case 'crear': {
        const usuario = String(body.usuario || '').trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,32}$/.test(usuario)) {
          return res.status(400).json({ error: 'El usuario debe tener de 3 a 32 caracteres: letras, números, punto, guion o guion bajo.' });
        }
        const err = validarPassword(body.password);
        if (err) return res.status(400).json({ error: err });
        /* Qué roles puede repartir cada quien. El de Servicio no puede
           fabricarse un `admin` (mandaría sobre el portal entero) ni un
           `usuario` (eso abre el cotizador, que no es de su área). */
        if (!rolesQuePuedeCrear(s.r).includes(body.rol)) {
          return res.status(400).json({ error: 'Rol no válido para tu perfil.' });
        }
        /* El área de la cuenta nueva: el de Servicio sólo da de alta en la
           suya; el del portal elige, y si no dice nada queda en la propia. */
        const areaNueva = todasLasAreas && areaValida(body.area) ? body.area : miArea;
        /* Un técnico sin código de recurso deja la columna A del archivo de
           carga vacía e iScala rechaza todos sus renglones. Se exige aquí y no
           sólo en la pantalla, para que la cuenta no pueda nacer incompleta. */
        const codigo = codigoRecurso(body.codigo_recurso);
        if (body.rol === 'tecnico' && !codigo) {
          return res.status(400).json({ error: 'Un técnico necesita su código de recurso de iScala.' });
        }
        const existe = await sb.select('usuarios', `?usuario=eq.${encodeURIComponent(usuario)}&select=usuario&limit=1`);
        if (existe?.length) return res.status(409).json({ error: 'Ese usuario ya existe.' });

        await sb.upsert('usuarios', {
          usuario,
          nombre: String(body.nombre || usuario).slice(0, 120),
          rol: body.rol,
          area: areaNueva,
          codigo_recurso: codigo,
          password_hash: hashPassword(body.password),
          activo: true,
          debe_cambiar_password: true,
        }, 'usuario');
        await bitacora(s, 'ALTA_USUARIO', 'usuarios', `${usuario} (${body.rol}, ${areaNueva})`, req);
        return res.status(200).json({ ok: true });
      }

      case 'actualizar': {
        const usuario = String(body.usuario || '').trim().toLowerCase();
        if (!usuario) return res.status(400).json({ error: 'Falta el usuario' });
        if (!await aMiAlcance(usuario)) {
          return res.status(403).json({ error: 'Esa cuenta no es de tu área.', code: 'OTRA_AREA' });
        }

        const cambios = {};
        if (body.nombre !== undefined) cambios.nombre = String(body.nombre).slice(0, 120);
        if (body.rol !== undefined) {
          if (!rolesQuePuedeCrear(s.r).includes(body.rol)) {
            return res.status(400).json({ error: 'Rol no válido para tu perfil.' });
          }
          if (usuario === s.u && !esAdminDeArea(body.rol)) {
            return res.status(400).json({ error: 'No puedes quitarte a ti mismo el rol de administrador.' });
          }
          cambios.rol = body.rol;
        }
        if (body.codigo_recurso !== undefined) cambios.codigo_recurso = codigoRecurso(body.codigo_recurso);
        if (body.activo !== undefined) {
          if (usuario === s.u && body.activo === false) {
            return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta.' });
          }
          cambios.activo = !!body.activo;
        }
        if (body.password) {
          const err = validarPassword(body.password);
          if (err) return res.status(400).json({ error: err });
          cambios.password_hash = hashPassword(body.password);
          cambios.debe_cambiar_password = true;
          cambios.intentos_fallidos = 0;
          cambios.bloqueado_hasta = null;
        }
        if (body.desbloquear) { cambios.intentos_fallidos = 0; cambios.bloqueado_hasta = null; }
        if (!Object.keys(cambios).length) return res.status(400).json({ error: 'No hay nada que cambiar' });

        await sb.update('usuarios', `usuario=eq.${encodeURIComponent(usuario)}`, cambios);
        await bitacora(s, 'MODIFICA_USUARIO', 'usuarios',
          `${usuario}: ${Object.keys(cambios).filter(k => k !== 'password_hash').join(', ')}${body.password ? ', contraseña' : ''}`, req);
        return res.status(200).json({ ok: true });
      }

      case 'eliminar': {
        const usuario = String(body.usuario || '').trim().toLowerCase();
        if (usuario === s.u) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
        if (!await aMiAlcance(usuario)) {
          return res.status(403).json({ error: 'Esa cuenta no es de tu área.', code: 'OTRA_AREA' });
        }
        await sb.del('usuarios', `usuario=eq.${encodeURIComponent(usuario)}`);
        await bitacora(s, 'BAJA_USUARIO', 'usuarios', usuario, req);
        return res.status(200).json({ ok: true });
      }

      case 'bitacora': {
        /* La bitácora es del portal entero —incluye catálogo, utilidades y
           cuentas de todas las áreas—, así que la lee sólo su administrador. */
        if (!esAdminPortal(s.r)) {
          return res.status(403).json({ error: 'La bitácora es del administrador del portal.', code: 'SIN_PERMISO' });
        }
        const limite = Math.min(parseInt(body.limite) || 200, 1000);
        const filas = await sb.select('bitacora', `?order=created_at.desc&limit=${limite}`);
        return res.status(200).json(filas || []);
      }

      default:
        return res.status(400).json({ error: `Acción desconocida: ${accion}` });
    }

  } catch (err) {
    console.error('usuarios:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Error interno' });
  }
}
