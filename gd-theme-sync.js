/* ════════════════════════════════════════════════════════════════════════
   GARDNER DENVER · Sincronización de tema entre el portal y sus módulos
   Incluir con: <script src="gd-theme-sync.js?v=20260905"></script>

   Auditoría 2026-09: se valida el origen de cada mensaje. Antes se aceptaba
   cualquier postMessage, lo que permitía a una página incrustada de otro
   dominio alterar el estado del módulo.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  // Tema guardado, por si el módulo se abre fuera del portal
  try {
    var guardado = localStorage.getItem('gd-theme');
    if (guardado === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  } catch (e) {}

  window.addEventListener('message', function (ev) {
    if (!ev || ev.origin !== window.location.origin) return;   // sólo el propio portal
    if (!ev.data || typeof ev.data !== 'object') return;

    if (ev.data.type === 'gd-theme') {
      var t = ev.data.theme === 'dark' ? 'dark' : 'light';
      if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else document.documentElement.removeAttribute('data-theme');
      try { localStorage.setItem('gd-theme', t); } catch (e) {}
      return;
    }

    // El portal pide abrir el panel de administración (menú de cuenta)
    if (ev.data.type === 'gd-abrir-admin' && typeof window.gdAbrirAdmin === 'function') {
      window.gdAbrirAdmin();
    }
  });
})();
