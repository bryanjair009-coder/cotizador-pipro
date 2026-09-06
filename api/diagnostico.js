// ═══════════════════════════════════════════════════════════════════════════════
//  api/diagnostico.js — Comprobación de la instalación
//
//  Responde qué falta para que el portal funcione, SIN revelar ningún valor:
//  sólo dice si cada pieza está en su sitio.
//
//  Abierto mientras no exista ningún usuario (durante la puesta en marcha no hay
//  nada que proteger todavía). En cuanto se crea la primera cuenta exige sesión
//  de administrador.
// ═══════════════════════════════════════════════════════════════════════════════

import { getSession } from './_lib/auth.js';
import { baseHeaders } from './_lib/guard.js';

const URL_BASE = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');

/** Consulta una tabla con la llave de servicio y devuelve su estado. */
async function probarTabla(tabla) {
  const url = `${URL_BASE()}/rest/v1/${tabla}?select=*&limit=1`;
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await fetch(url, {
      headers: { apikey: k, Authorization: `Bearer ${k}`, Prefer: 'count=exact' },
    });
    if (r.ok) {
      const rango = r.headers.get('content-range') || '';
      const total = rango.split('/')[1];
      return { existe: true, registros: total === '*' ? null : Number(total) };
    }
    if (r.status === 404) return { existe: false, motivo: 'La tabla no existe' };
    return { existe: false, motivo: `HTTP ${r.status}` };
  } catch (e) {
    return { existe: false, motivo: 'Sin conexión con Supabase' };
  }
}

export default async function handler(req, res) {
  baseHeaders(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  const secret = process.env.SESSION_SECRET || '';
  const variables = {
    SUPABASE_URL:              !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    SESSION_SECRET:            secret.length >= 32,
    ANTHROPIC_API_KEY:         !!process.env.ANTHROPIC_API_KEY,
    ADMIN_BOOTSTRAP_PASSWORD:  !!process.env.ADMIN_BOOTSTRAP_PASSWORD,
  };

  const pistas = [];
  if (!variables.SUPABASE_URL)              pistas.push('Falta la variable SUPABASE_URL en Vercel.');
  if (!variables.SUPABASE_SERVICE_ROLE_KEY) pistas.push('Falta la variable SUPABASE_SERVICE_ROLE_KEY en Vercel.');
  if (!variables.SESSION_SECRET) {
    pistas.push(secret
      ? `SESSION_SECRET tiene ${secret.length} caracteres; necesita al menos 32.`
      : 'Falta la variable SESSION_SECRET en Vercel.');
  }

  // Sin las dos llaves de base de datos no tiene sentido seguir probando
  if (!variables.SUPABASE_URL || !variables.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(200).json({ listo: false, variables, pistas });
  }

  const tablas = {};
  for (const t of ['usuarios', 'bitacora', 'materiales', 'clientes', 'requisiciones', 'meta']) {
    tablas[t] = await probarTabla(t);
  }

  const hayUsuarios = tablas.usuarios.existe && tablas.usuarios.registros > 0;

  // Una vez existe la primera cuenta, esto deja de ser público
  if (hayUsuarios) {
    const s = getSession(req);
    if (!s || s.r !== 'admin') {
      return res.status(403).json({
        error: 'El diagnóstico detallado requiere sesión de administrador.',
        instalado: true,
      });
    }
  }

  if (!tablas.usuarios.existe || !tablas.bitacora.existe) {
    pistas.push('Faltan las tablas de seguridad: ejecuta SUPABASE_SEGURIDAD.sql en el editor SQL de Supabase.');
  } else if (!hayUsuarios) {
    pistas.push(variables.ADMIN_BOOTSTRAP_PASSWORD
      ? 'Todo listo. Entra con el usuario que quieras y, como contraseña, el valor EXACTO de ADMIN_BOOTSTRAP_PASSWORD para crear el primer administrador.'
      : 'No hay ningún usuario y no está configurada ADMIN_BOOTSTRAP_PASSWORD: no hay forma de crear el primer administrador.');
  }

  // «Listo» = el portal puede autenticar. ANTHROPIC_API_KEY sólo afecta al OCR
  // y ADMIN_BOOTSTRAP_PASSWORD debe borrarse una vez creado el administrador.
  const listo = variables.SUPABASE_URL && variables.SUPABASE_SERVICE_ROLE_KEY
    && variables.SESSION_SECRET && tablas.usuarios.existe && tablas.bitacora.existe;

  return res.status(200).json({
    listo: !!listo,
    variables,
    tablas,
    usuarios_registrados: tablas.usuarios.registros,
    pistas: pistas.length ? pistas : ['Sin problemas detectados.'],
  });
}
