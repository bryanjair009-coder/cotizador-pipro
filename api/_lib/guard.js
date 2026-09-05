// ═══════════════════════════════════════════════════════════════════════════════
//  api/_lib/guard.js — Controles transversales de las funciones /api
//
//  · Cabeceras de seguridad en todas las respuestas
//  · Bloqueo de peticiones de otros orígenes (defensa CSRF adicional a
//    SameSite=Strict)
//  · Límite de tasa best-effort por instancia
//  · Lectura del cuerpo con tope de tamaño
// ═══════════════════════════════════════════════════════════════════════════════

import { getSession } from './auth.js';

/** Cabeceras aplicadas a toda respuesta de API. Nunca cacheable. */
export function baseHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Vary', 'Cookie');
}

/**
 * Verifica que la petición venga del propio portal.
 * Peticiones sin Origin ni Referer (curl, Postman) se permiten sólo si no
 * mutan estado; para POST se exige coincidencia de host.
 */
export function mismoOrigen(req) {
  const host = req.headers.host;
  const src = req.headers.origin || req.headers.referer;
  if (!src) return false;
  try { return new URL(src).host === host; }
  catch { return false; }
}

// ── Límite de tasa (por instancia de función) ─────────────────────────────────
const buckets = new Map();

export function rateLimit(req, { max = 60, windowMs = 60_000, key = '' } = {}) {
  const ip = (req.headers['x-forwarded-for'] || 'local').split(',')[0].trim();
  const id = `${key}:${ip}`;
  const now = Date.now();
  const b = buckets.get(id);

  if (!b || now > b.reset) { buckets.set(id, { n: 1, reset: now + windowMs }); return true; }
  b.n++;
  if (b.n > max) return false;

  // Poda ocasional para que el mapa no crezca sin control
  if (buckets.size > 2000) {
    for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
  }
  return true;
}

/** Lee y parsea el cuerpo JSON con tope de tamaño. */
export async function leerJSON(req, maxBytes = 1_000_000) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      if (Buffer.byteLength(req.body) > maxBytes) throw Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 });
      return JSON.parse(req.body);
    }
    return req.body;
  }
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > maxBytes) throw Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/**
 * Envoltura estándar: cabeceras, método, origen, sesión.
 * Devuelve la sesión si todo está bien; si algo falla responde y devuelve null.
 */
export function proteger(req, res, { metodo = 'POST', requiereSesion = true, rol = null } = {}) {
  baseHeaders(res);

  if (req.method !== metodo) {
    res.status(405).json({ error: 'Método no permitido' });
    return null;
  }
  if (metodo === 'POST' && !mismoOrigen(req)) {
    res.status(403).json({ error: 'Origen no permitido' });
    return null;
  }
  if (!requiereSesion) return { anon: true };

  const s = getSession(req);
  if (!s) {
    res.status(401).json({ error: 'Sesión no válida o expirada', code: 'SIN_SESION' });
    return null;
  }
  if (rol && s.r !== rol) {
    res.status(403).json({ error: 'No tienes permisos para esta operación', code: 'SIN_PERMISO' });
    return null;
  }
  return s;
}
