// ═══════════════════════════════════════════════════════════════════════════════
//  api/session.js — Estado de la sesión actual (GET) y cierre de sesión (DELETE)
// ═══════════════════════════════════════════════════════════════════════════════

import { getSession, clearSessionCookie } from './_lib/auth.js';
import { baseHeaders } from './_lib/guard.js';
import { bitacora } from './_lib/sb.js';

export default async function handler(req, res) {
  baseHeaders(res);

  if (req.method === 'DELETE' || req.method === 'POST') {
    const s = getSession(req);
    clearSessionCookie(res);
    if (s) await bitacora(s, 'LOGOUT', 'usuarios', 'Cierre de sesión', req);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  const s = getSession(req);
  if (!s) return res.status(401).json({ autenticado: false });

  return res.status(200).json({
    autenticado: true,
    usuario: s.u,
    nombre: s.n,
    rol: s.r,
    expira: s.exp,
  });
}
