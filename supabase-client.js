// ═══════════════════════════════════════════════════════════════════════════════
//  supabase-client.js  –  Acceso a datos del Portal PIPRO
//
//  ⚠️  Desde la auditoría de seguridad, este archivo YA NO contiene ninguna
//      credencial. El navegador no habla con Supabase: habla con /api/db, que
//      valida la sesión, aplica permisos por rol y registra en bitácora.
//
//      La llave de servicio vive únicamente en las variables de entorno de
//      Vercel (SUPABASE_SERVICE_ROLE_KEY) y nunca se envía al cliente.
//
//  La interfaz pública (window.SB) es idéntica a la anterior, por lo que los
//  módulos que la consumen no requieren cambios.
// ═══════════════════════════════════════════════════════════════════════════════

window.SB = (() => {

  /** Envía la operación al proxy autenticado. */
  async function llamar(payload) {
    const res = await fetch('/api/db', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      // Sesión caducada: avisar al portal para que muestre el acceso de nuevo
      window.dispatchEvent(new CustomEvent('gd-sesion-expirada'));
      try { window.top.postMessage({ type: 'gd-sesion-expirada' }, window.location.origin); } catch (e) {}
      throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    }

    const txt = await res.text();
    const data = txt ? JSON.parse(txt) : null;
    if (!res.ok) throw Object.assign(new Error(data?.error || `Error ${res.status}`), { code: data?.code, status: res.status });
    return data;
  }

  const filtroDesde = (filters) => Object.entries(filters)
    .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
    .join('&');

  return {
    configured: true,

    /** Lee registros de una tabla. queryStr ej: '?order=nombre.asc' */
    getAll: (table, query = '') => llamar({ op: 'select', table, query }),

    /** Inserta o actualiza según onConflict (nombre de columna) */
    upsert: (table, data, onConflict = '') => llamar({ op: 'upsert', table, data, onConflict }),

    /** Elimina registros que cumplan los filtros { columna: valor } */
    delete: (table, filters) => llamar({ op: 'delete', table, filter: filtroDesde(filters) }),

    /** Elimina usando un filtro PostgREST literal */
    deleteWhere: (table, rawFilter) => llamar({ op: 'delete', table, filter: rawFilter }),

    /** Lee un valor de la tabla `meta` */
    async getMeta(key, fallback = null) {
      try {
        const rows = await llamar({ op: 'select', table: 'meta', query: `?key=eq.${encodeURIComponent(key)}` });
        if (rows && rows.length) {
          const val = rows[0].value;
          try { return JSON.parse(val); } catch { return val; }
        }
      } catch (e) { /* sin conexión o sin sesión → fallback */ }
      return fallback;
    },

    /** Guarda un valor en la tabla `meta` */
    async setMeta(key, value) {
      const strVal = typeof value === 'string' ? value : JSON.stringify(value);
      await llamar({ op: 'upsert', table: 'meta', data: { key, value: strVal }, onConflict: 'key' });
    },
  };
})();
