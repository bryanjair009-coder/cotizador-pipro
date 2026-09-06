// ═══════════════════════════════════════════════════════════════════════════════
//  api/login.js — Autenticación del portal
//
//  Bloqueo progresivo: 5 intentos fallidos → cuenta bloqueada 15 minutos.
//  El mensaje de error es deliberadamente genérico para no revelar qué usuarios
//  existen.
// ═══════════════════════════════════════════════════════════════════════════════

import { verifyPassword, hashPassword, signSession, setSessionCookie } from './_lib/auth.js';
import { sb, bitacora } from './_lib/sb.js';
import { proteger, rateLimit, leerJSON } from './_lib/guard.js';

const MAX_INTENTOS = 5;
const BLOQUEO_MIN  = 15;
const GENERICO     = 'Usuario o contraseña incorrectos.';

export default async function handler(req, res) {
  if (!proteger(req, res, { requiereSesion: false })) return;

  if (!rateLimit(req, { max: 12, windowMs: 60_000, key: 'login' })) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera un minuto.' });
  }

  try {
    const { usuario, password } = await leerJSON(req, 8_000);
    const user = String(usuario || '').trim().toLowerCase();
    if (!user || !password) return res.status(400).json({ error: GENERICO });

    let filas = await sb.select('usuarios', `?usuario=eq.${encodeURIComponent(user)}&limit=1`);

    // ── Arranque inicial: si no existe ningún usuario, se crea el primer
    //    administrador con ADMIN_BOOTSTRAP_PASSWORD.
    if (!filas?.length) {
      const total = await sb.select('usuarios', '?select=usuario&limit=1');
      const boot = process.env.ADMIN_BOOTSTRAP_PASSWORD;
      if (!total?.length && boot && password === boot) {
        await sb.upsert('usuarios', {
          usuario: user,
          nombre: 'Administrador',
          rol: 'admin',
          password_hash: hashPassword(boot),
          activo: true,
        }, 'usuario');
        filas = await sb.select('usuarios', `?usuario=eq.${encodeURIComponent(user)}&limit=1`);
        await bitacora({ u: user }, 'ALTA_INICIAL', 'usuarios', 'Primer administrador creado', req);
      } else {
        return res.status(401).json({ error: GENERICO });
      }
    }

    const u = filas[0];

    if (u.activo === false) {
      return res.status(403).json({ error: 'Esta cuenta está desactivada. Contacta al administrador.' });
    }

    if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
      const min = Math.ceil((new Date(u.bloqueado_hasta) - Date.now()) / 60000);
      return res.status(429).json({ error: `Cuenta bloqueada temporalmente. Intenta en ${min} min.` });
    }

    const filtro = `usuario=eq.${encodeURIComponent(u.usuario)}`;

    if (!verifyPassword(password, u.password_hash)) {
      const intentos = (u.intentos_fallidos || 0) + 1;
      const bloqueo = intentos >= MAX_INTENTOS
        ? new Date(Date.now() + BLOQUEO_MIN * 60_000).toISOString()
        : null;
      await sb.update('usuarios', filtro,
        { intentos_fallidos: intentos, bloqueado_hasta: bloqueo });
      await bitacora({ u: user }, 'LOGIN_FALLIDO', 'usuarios', `Intento ${intentos}`, req);
      return res.status(401).json({ error: GENERICO });
    }

    // Éxito: limpiar contadores y emitir sesión
    await sb.update('usuarios', filtro, {
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_acceso: new Date().toISOString(),
    });

    setSessionCookie(res, signSession({ usuario: u.usuario, rol: u.rol, nombre: u.nombre }));
    await bitacora({ u: u.usuario }, 'LOGIN', 'usuarios', 'Acceso concedido', req);

    return res.status(200).json({
      ok: true,
      usuario: u.usuario,
      nombre: u.nombre || u.usuario,
      rol: u.rol,
      debe_cambiar_password: !!u.debe_cambiar_password,
    });

  } catch (err) {
    console.error('login:', err);

    // Errores de instalación: decir exactamente qué falta en vez de un
    // «no se pudo procesar» que obliga a adivinar.
    const m = String(err.message || '');
    if (/relation .*usuarios.* does not exist|PGRST205|42P01/i.test(m)) {
      return res.status(503).json({
        error: 'Falta crear las tablas: ejecuta SUPABASE_SEGURIDAD.sql en Supabase.',
        code: 'SIN_TABLAS',
      });
    }
    if (/SESSION_SECRET/.test(m) || /SUPABASE_(URL|SERVICE_ROLE_KEY)/.test(m)) {
      return res.status(503).json({ error: m, code: 'SIN_CONFIG' });
    }
    return res.status(500).json({ error: 'No se pudo procesar el acceso. Revisa /api/diagnostico.' });
  }
}
