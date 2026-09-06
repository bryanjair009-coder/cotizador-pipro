// ═══════════════════════════════════════════════════════════════════════════════
//  api/_lib/sb.js — Cliente Supabase del lado servidor (service_role)
//
//  ⚠️  Esta llave NUNCA debe llegar al navegador. Vive sólo en las variables de
//      entorno de Vercel y se usa exclusivamente dentro de /api.
// ═══════════════════════════════════════════════════════════════════════════════

const URL = () => {
  const u = process.env.SUPABASE_URL;
  if (!u) throw new Error('SUPABASE_URL no está configurado en Vercel.');
  return u.replace(/\/+$/, '');
};

const KEY = () => {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY no está configurado en Vercel.');
  return k;
};

function headers(extra = {}) {
  const k = KEY();
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', ...extra };
}

async function req(path, opts = {}) {
  const res = await fetch(`${URL()}/rest/v1/${path}`, opts);
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    const err = new Error(`Supabase ${res.status}: ${txt}`);
    err.status = res.status;
    throw err;
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

export const sb = {
  select: (table, query = '') => req(`${table}${query}`, { headers: headers() }),

  upsert: (table, data, onConflict = '') =>
    req(`${table}${onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : ''}`, {
      method: 'POST',
      headers: headers({ Prefer: 'return=representation,resolution=merge-duplicates' }),
      body: JSON.stringify(data),
    }),

  insert: (table, data) =>
    req(table, {
      method: 'POST',
      headers: headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify(data),
    }),

  /**
   * Actualización PARCIAL de las filas que cumplan el filtro.
   *
   * ⚠️  No usar `upsert` para esto. Un upsert de PostgREST ejecuta
   *     INSERT ... ON CONFLICT, y PostgreSQL valida las restricciones NOT NULL
   *     ANTES de resolver el conflicto: omitir `password_hash` aborta la
   *     operación aunque la fila ya exista. Y cuando no aborta, el DO UPDATE
   *     reescribe con valores por defecto las columnas que no enviaste
   *     (degradaría el rol a «usuario» y borraría el nombre).
   */
  update: (table, rawFilter, data) =>
    req(`${table}?${rawFilter}`, {
      method: 'PATCH',
      headers: headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify(data),
    }),

  del: (table, rawFilter) =>
    req(`${table}?${rawFilter}`, { method: 'DELETE', headers: headers() }),
};

/**
 * Registra una acción en la bitácora. Nunca lanza: una falla de auditoría no
 * debe tumbar la operación del usuario, pero sí queda en los logs de Vercel.
 */
export async function bitacora(session, accion, tabla, detalle, req_) {
  try {
    await sb.insert('bitacora', {
      usuario: session?.u || '(anónimo)',
      accion,
      tabla: tabla || null,
      detalle: typeof detalle === 'string' ? detalle.slice(0, 2000) : JSON.stringify(detalle || {}).slice(0, 2000),
      ip: (req_?.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || null,
    });
  } catch (e) {
    console.error('bitacora:', e.message);
  }
}
