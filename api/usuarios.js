// ═══════════════════════════════════════════════════════════════════════════════
//  api/usuarios.js — Administración de cuentas y cambio de contraseña
//
//  Los hashes NUNCA salen de aquí: la lista de usuarios se devuelve con
//  `select` explícito de columnas seguras.
// ═══════════════════════════════════════════════════════════════════════════════

import { hashPassword, verifyPassword, validarPassword } from './_lib/auth.js';
import { sb, bitacora } from './_lib/sb.js';
import { proteger, rateLimit, leerJSON } from './_lib/guard.js';

const COLUMNAS_SEGURAS = 'usuario,nombre,rol,activo,ultimo_acceso,debe_cambiar_password,created_at';

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
    if (s.r !== 'admin') {
      return res.status(403).json({ error: 'Sólo un administrador puede gestionar cuentas.', code: 'SIN_PERMISO' });
    }

    switch (accion) {
      case 'listar': {
        const filas = await sb.select('usuarios', `?select=${COLUMNAS_SEGURAS}&order=usuario.asc`);
        return res.status(200).json(filas || []);
      }

      case 'crear': {
        const usuario = String(body.usuario || '').trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,32}$/.test(usuario)) {
          return res.status(400).json({ error: 'El usuario debe tener de 3 a 32 caracteres: letras, números, punto, guion o guion bajo.' });
        }
        const err = validarPassword(body.password);
        if (err) return res.status(400).json({ error: err });
        if (!['admin', 'usuario'].includes(body.rol)) {
          return res.status(400).json({ error: 'Rol no válido' });
        }
        const existe = await sb.select('usuarios', `?usuario=eq.${encodeURIComponent(usuario)}&select=usuario&limit=1`);
        if (existe?.length) return res.status(409).json({ error: 'Ese usuario ya existe.' });

        await sb.upsert('usuarios', {
          usuario,
          nombre: String(body.nombre || usuario).slice(0, 120),
          rol: body.rol,
          password_hash: hashPassword(body.password),
          activo: true,
          debe_cambiar_password: true,
        }, 'usuario');
        await bitacora(s, 'ALTA_USUARIO', 'usuarios', `${usuario} (${body.rol})`, req);
        return res.status(200).json({ ok: true });
      }

      case 'actualizar': {
        const usuario = String(body.usuario || '').trim().toLowerCase();
        if (!usuario) return res.status(400).json({ error: 'Falta el usuario' });

        const cambios = {};
        if (body.nombre !== undefined) cambios.nombre = String(body.nombre).slice(0, 120);
        if (body.rol !== undefined) {
          if (!['admin', 'usuario'].includes(body.rol)) return res.status(400).json({ error: 'Rol no válido' });
          if (usuario === s.u && body.rol !== 'admin') {
            return res.status(400).json({ error: 'No puedes quitarte a ti mismo el rol de administrador.' });
          }
          cambios.rol = body.rol;
        }
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
        await sb.del('usuarios', `usuario=eq.${encodeURIComponent(usuario)}`);
        await bitacora(s, 'BAJA_USUARIO', 'usuarios', usuario, req);
        return res.status(200).json({ ok: true });
      }

      case 'bitacora': {
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
