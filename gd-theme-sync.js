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

  /* Atajos del portal (2026-11): Alt+0 Inicio, Alt+1…9 módulos, Alt+K buscar.
     Dentro de un marco el teclado no llega al portal, así que se reenvían.
     Sólo la fila de números (code «Digit»): Alt + teclado numérico escribe
     caracteres como la ñ (Alt+164) y no se toca. */
  if (window.top !== window) {
    window.addEventListener('keydown', function (e) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      var t = e.code && e.code.indexOf('Digit') === 0 ? e.code.slice(5) : (e.code === 'KeyK' ? 'k' : null);
      if (!t) return;
      e.preventDefault();
      try { window.top.postMessage({ type: 'gd-atajo', tecla: t }, window.location.origin); } catch (err) {}
    }, true);
  }

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
      // La sección es sólo una pista: el módulo la contrasta con su propia lista
      window.gdAbrirAdmin(typeof ev.data.sec === 'string' ? ev.data.sec.slice(0, 24) : undefined);
      return;
    }

    /* Material que llega de otro módulo (hoy, la lista del isométrico). Las
       partidas vienen de la propia aplicación, pero el módulo que las recibe
       las valida igual antes de usarlas: aquí sólo se comprueba la forma. */
    if (ev.data.type === 'gd-material-externo' &&
        Array.isArray(ev.data.items) &&
        typeof window.gdMaterialExterno === 'function') {
      window.gdMaterialExterno(ev.data.items.slice(0, 500));
    }
  });
})();
