// ═══════════════════════════════════════════════════════════════════════════════
//  api/_lib/auth.js — Sesiones firmadas y hashing de contraseñas
//
//  Sin dependencias externas: sólo node:crypto.
//  - Contraseñas: scrypt (N=16384) con sal aleatoria de 16 bytes.
//  - Sesión: token HMAC-SHA256 en cookie HttpOnly + Secure + SameSite=Strict.
//    El payload va en claro (base64url) pero firmado: el cliente puede leerlo
//    con las herramientas de desarrollo, no puede falsificarlo.
// ═══════════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';

export const COOKIE_NAME = 'gdp_session';
const TTL_MS = 1000 * 60 * 60 * 10;   // 10 horas — una jornada laboral

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET no está configurado en Vercel (mínimo 32 caracteres).');
  }
  return s;
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');

// ── Sesiones ─────────────────────────────────────────────────────────────────

/** Firma un payload de sesión. Devuelve "<body>.<hmac>". */
export function signSession({ usuario, rol, nombre }) {
  const payload = { u: usuario, r: rol, n: nombre || usuario, exp: Date.now() + TTL_MS };
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/** Verifica firma y expiración. Devuelve el payload o null. */
export function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i < 1) return null;

  const body = token.slice(0, i);
  const given = Buffer.from(token.slice(i + 1));
  const expect = Buffer.from(
    crypto.createHmac('sha256', secret()).update(body).digest('base64url')
  );
  // Comparación en tiempo constante — evita ataques de temporización
  if (given.length !== expect.length || !crypto.timingSafeEqual(given, expect)) return null;

  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
  catch { return null; }

  if (!p || !p.exp || Date.now() > p.exp) return null;
  return p;
}

// ── Contraseñas ──────────────────────────────────────────────────────────────

const SCRYPT = { N: 16384, r: 8, p: 1, len: 64 };

/** Deriva el hash almacenable de una contraseña en claro. */
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(plain, salt, SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

/** Compara una contraseña en claro contra el hash almacenado. */
export function verifyPassword(plain, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const dk = crypto.scryptSync(plain, Buffer.from(saltB64, 'base64'),
      SCRYPT.len, { N: +N, r: +r, p: +p });
    const h = Buffer.from(hashB64, 'base64');
    return dk.length === h.length && crypto.timingSafeEqual(dk, h);
  } catch { return false; }
}

/** Reglas mínimas de contraseña para el portal. */
export function validarPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (!/[a-zA-Z]/.test(pw)) return 'La contraseña debe incluir al menos una letra.';
  if (!/[0-9]/.test(pw))    return 'La contraseña debe incluir al menos un número.';
  return null;
}

// ── Cookies ──────────────────────────────────────────────────────────────────

export function parseCookies(req) {
  const out = {};
  const raw = req.headers?.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setSessionCookie(res, token) {
  const secure = process.env.VERCEL ? ' Secure;' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${TTL_MS / 1000}`);
}

export function clearSessionCookie(res) {
  const secure = process.env.VERCEL ? ' Secure;' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=0`);
}

/** Devuelve la sesión válida de la petición, o null. */
export function getSession(req) {
  return verifySession(parseCookies(req)[COOKIE_NAME]);
}
