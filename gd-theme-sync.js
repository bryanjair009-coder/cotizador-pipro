/* ════════════════════════════════════════════════════════════════════════
   GARDNER DENVER · Theme Sync
   Permite que cada módulo (cargado en un iframe del portal) reciba el
   cambio de tema dark/light desde el portal padre vía postMessage.
   Incluir con: <script src="gd-theme-sync.js?v=20260619"></script>
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  // Aplicar tema desde localStorage al cargar (por si se abre el módulo solo)
  try {
    var saved = localStorage.getItem('gd-theme');
    if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  } catch (e) {}

  // Escuchar mensajes del portal
  window.addEventListener('message', function (ev) {
    if (!ev || !ev.data || ev.data.type !== 'gd-theme') return;
    var t = ev.data.theme === 'dark' ? 'dark' : 'light';
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('gd-theme', t); } catch (e) {}
  });
})();
