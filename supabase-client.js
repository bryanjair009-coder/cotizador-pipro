// ═══════════════════════════════════════════════════════════════════════════════
//  supabase-client.js  –  Cliente REST para PIPRO Portal
//
//  ⚠️  CONFIGURACIÓN REQUERIDA:
//  1. Ve a https://supabase.com → tu proyecto → Settings → API
//  2. Copia "Project URL"  →  pégalo en SUPABASE_URL
//  3. Copia "anon public"  →  pégalo en SUPABASE_KEY
// ═══════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://TU_PROYECTO.supabase.co'; // ← reemplazar
const SUPABASE_KEY = 'TU_ANON_KEY_AQUI';                // ← reemplazar

window.SB = (() => {
  const configured = !SUPABASE_URL.includes('TU_PROYECTO');

  function headers(extra = {}) {
    return {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...extra
    };
  }

  async function req(url, opts = {}) {
    const res = await fetch(url, opts);
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      throw new Error(`Supabase ${res.status}: ${txt}`);
    }
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  return {
    configured,

    /** Lee todos los registros de una tabla. queryStr ej: '?order=nombre.asc' */
    async getAll(table, queryStr = '') {
      if (!configured) throw new Error('Supabase no configurado');
      return req(`${SUPABASE_URL}/rest/v1/${table}${queryStr}`, {
        headers: headers()
      });
    },

    /** Upsert: inserta o actualiza según onConflict (nombre de columna) */
    async upsert(table, data, onConflict = '') {
      if (!configured) throw new Error('Supabase no configurado');
      const qs = onConflict ? `?on_conflict=${onConflict}` : '';
      return req(`${SUPABASE_URL}/rest/v1/${table}${qs}`, {
        method: 'POST',
        headers: headers({ 'Prefer': 'return=representation,resolution=merge-duplicates' }),
        body: JSON.stringify(data)
      });
    },

    /** Elimina registros que cumplan los filtros { columna: valor } */
    async delete(table, filters) {
      if (!configured) throw new Error('Supabase no configurado');
      const qs = Object.entries(filters)
        .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
        .join('&');
      return req(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
        method: 'DELETE',
        headers: headers()
      });
    },

    /** Elimina todos los registros de una tabla usando un filtro raw */
    async deleteWhere(table, rawFilter) {
      if (!configured) throw new Error('Supabase no configurado');
      return req(`${SUPABASE_URL}/rest/v1/${table}?${rawFilter}`, {
        method: 'DELETE',
        headers: headers()
      });
    },

    /** Lee un valor de la tabla `meta` */
    async getMeta(key, fallback = null) {
      if (!configured) return fallback;
      try {
        const rows = await this.getAll('meta', `?key=eq.${encodeURIComponent(key)}`);
        if (rows && rows.length) {
          const val = rows[0].value;
          // Intentar parsear JSON (para arrays/objetos)
          try { return JSON.parse(val); } catch { return val; }
        }
      } catch (e) { /* sin conexión → fallback */ }
      return fallback;
    },

    /** Guarda un valor en la tabla `meta` */
    async setMeta(key, value) {
      if (!configured) return;
      const strVal = typeof value === 'string' ? value : JSON.stringify(value);
      await this.upsert('meta', { key, value: strVal }, 'key');
    }
  };
})();
