/* ═══════════════════════════════════════════════════════════════════════════
   gd-ui.js — Runtime de interfaz compartido del Portal PIPRO

   Expone window.GD con:
     GD.esc(txt)              escape de HTML — usar SIEMPRE antes de innerHTML
     GD.info                  popovers de "más información"
     GD.fields                dimensionado de campos según el dato esperado
     GD.picker                buscador de materiales
     GD.sesion                estado de la sesión y menú de usuario
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
'use strict';

const GD = window.GD = window.GD || {};
const $ = (s, r) => (r || document).querySelector(s);

/* ── Escape de HTML ─────────────────────────────────────────────────────────
   Todo lo que provenga de la base de datos o del usuario pasa por aquí antes
   de tocar innerHTML. Sin esto, una descripción de material con etiquetas se
   ejecuta como código en el navegador de quien abra la cotización.          */
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
GD.esc = function (v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"'`]/g, c => ENT[c]);
};
/** Escape para valores dentro de atributos JS: onclick="f('...')" */
GD.escAttr = function (v) {
  return GD.esc(v).replace(/\\/g, '\\\\').replace(/\n/g, ' ');
};


/* ── 1. POPOVERS DE INFORMACIÓN ─────────────────────────────────────────────*/

const info = GD.info = (function () {
  let pop = null, activo = null;

  function crear() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'gd-pop';
    pop.setAttribute('role', 'tooltip');
    document.body.appendChild(pop);
    return pop;
  }

  function contenido(btn) {
    const titulo  = btn.dataset.infoTitle || '';
    const cuerpo  = btn.dataset.info || '';
    const formula = btn.dataset.formula || '';
    const fuente  = btn.dataset.fuente || '';
    const ref     = btn.dataset.infoRef ? document.getElementById(btn.dataset.infoRef) : null;

    let html = '';
    if (titulo) html += `<div class="gd-pop-title">${GD.esc(titulo)}</div>`;
    if (ref)          html += ref.innerHTML;          // plantilla del propio módulo
    else if (cuerpo)  html += `<p>${cuerpo}</p>`;     // texto redactado por nosotros
    if (formula) html += `<div class="gd-formula">${GD.esc(formula)}</div>`;
    if (fuente)  html += `<span class="gd-pop-src">${GD.esc(fuente)}</span>`;
    return html;
  }

  function colocar(btn) {
    const r = btn.getBoundingClientRect();
    const p = pop.getBoundingClientRect();
    const m = 10;
    let left = r.left + r.width / 2 - p.width / 2;
    left = Math.max(m, Math.min(left, window.innerWidth - p.width - m));
    let top = r.bottom + 8;
    if (top + p.height > window.innerHeight - m) {
      const arriba = r.top - p.height - 8;
      top = arriba > m ? arriba : Math.max(m, window.innerHeight - p.height - m);
    }
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function abrir(btn) {
    cerrar();
    crear();
    pop.innerHTML = contenido(btn);
    pop.style.left = '-9999px'; pop.style.top = '0';
    pop.classList.add('visible');
    colocar(btn);
    btn.setAttribute('aria-expanded', 'true');
    activo = btn;
  }

  function cerrar() {
    if (!activo) return;
    activo.setAttribute('aria-expanded', 'false');
    activo = null;
    if (pop) pop.classList.remove('visible');
  }

  document.addEventListener('mouseover', e => {
    const b = e.target.closest && e.target.closest('.gd-i');
    if (b && b !== activo) abrir(b);
  });
  document.addEventListener('mouseout', e => {
    const b = e.target.closest && e.target.closest('.gd-i');
    if (b && b === activo && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.gd-pop'))) {
      setTimeout(() => { if (pop && !pop.matches(':hover') && activo === b) cerrar(); }, 120);
    }
  });
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.gd-i');
    if (b) { e.preventDefault(); e.stopPropagation(); (activo === b) ? cerrar() : abrir(b); return; }
    if (!(e.target.closest && e.target.closest('.gd-pop'))) cerrar();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });
  // Al desplazar la página el popover se reubica sobre su icono; sólo se
  // cierra si el icono salió de la vista. Desplazarse DENTRO del propio
  // popover no lo cierra.
  window.addEventListener('scroll', e => {
    if (!activo) return;
    if (e.target && e.target.closest && e.target.closest('.gd-pop')) return;
    const r = activo.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) { cerrar(); return; }
    colocar(activo);
  }, true);
  window.addEventListener('resize', cerrar);

  return {
    cerrar,
    /** Marca los botones creados dinámicamente con los atributos ARIA. */
    preparar(raiz) {
      (raiz || document).querySelectorAll('.gd-i:not([aria-expanded])').forEach(b => {
        b.setAttribute('aria-expanded', 'false');
        b.setAttribute('type', 'button');
        if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', 'Más información');
      });
    },
  };
})();


/* ── 2. DIMENSIONADO DE CAMPOS ──────────────────────────────────────────────
   El ancho se deriva del número de caracteres que el campo puede recibir:
     data-chars="4"   → explícito
     maxlength="8"    → se respeta
     type=number+max  → dígitos de `max` (+2 si admite decimales)
     type=date        → 10 (dd/mm/aaaa)
   Se suma el relleno horizontal y, en numéricos, el ancho de los controles.  */

const fields = GD.fields = (function () {
  const MIN = 2.5, MAX = 46;

  function caracteres(inp) {
    if (inp.dataset.chars) return parseFloat(inp.dataset.chars);
    const tipo = (inp.type || '').toLowerCase();
    if (tipo === 'date')  return 10;
    if (tipo === 'month') return 8;
    if (tipo === 'time')  return 6;
    if (inp.maxLength > 0 && inp.maxLength < 500) return inp.maxLength;
    if (tipo === 'number') {
      const max = inp.getAttribute('max');
      let n = max ? String(Math.abs(parseFloat(max) || 0)).length : 6;
      const paso = inp.getAttribute('step');
      if (paso && paso !== 'any' && String(paso).includes('.')) n += String(paso).split('.')[1].length + 1;
      else if (paso === 'any') n += 3;
      if ((inp.getAttribute('min') || '').startsWith('-')) n += 1;
      return Math.max(n, 3);
    }
    return 0;   // sin pista fiable: no tocar
  }

  function aplicar(inp) {
    if (inp.dataset.gdSized === '1' || inp.classList.contains('gd-no-size')) return;
    const n = caracteres(inp);
    if (!n) return;
    const ch = Math.min(MAX, Math.max(MIN, n));
    // 1.9em cubre el relleno; los numéricos añaden sitio para las flechas
    const extra = (inp.type || '').toLowerCase() === 'number' ? 3.0 : 1.9;
    inp.style.width = `calc(${ch}ch + ${extra}em)`;
    inp.style.maxWidth = '100%';
    inp.dataset.gdSized = '1';
  }

  return {
    aplicar,
    /**
     * Recorre el árbol y dimensiona todo lo dimensionable.
     * Con <body data-gd-autosize> se procesan además todos los campos
     * numéricos y de fecha del módulo, salvo los que viven dentro de una
     * tabla o de una rejilla que ya controla su propio ancho.
     */
    escanear(raiz) {
      const r = raiz || document;
      r.querySelectorAll('input[data-chars], .gd-field input, .gd-fields input, input.gd-size')
        .forEach(aplicar);

      if (document.body && document.body.hasAttribute('data-gd-autosize')) {
        r.querySelectorAll('input[type="number"], input[type="date"]').forEach(inp => {
          if (inp.closest('table, .gd-no-size, [data-gd-no-size]')) return;
          const ancho = inp.style.width || '';
          if (ancho.includes('%')) return;              // el módulo ya lo controla
          aplicar(inp);
        });
      }
    },
  };
})();


/* ── 3. BUSCADOR DE MATERIALES ──────────────────────────────────────────────*/

const picker = GD.picker = (function () {
  let cfg = null, filtrados = [], sel = 0, chip = '', bk = null, ultimoFoco = null;

  const norm = s => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');   // ignora acentos

  /** Puntúa una coincidencia: número de parte exacto pesa más que descripción. */
  function puntuar(m, tokens) {
    const parte = norm(m.numero_parte), desc = norm(m.descripcion);
    let total = 0;
    for (const t of tokens) {
      if (parte === t)               total += 100;
      else if (parte.startsWith(t))  total += 60;
      else if (parte.includes(t))    total += 35;
      else if (desc.startsWith(t))   total += 25;
      else if (desc.includes(t))     total += 12;
      else return -1;                              // todos los términos deben estar
    }
    return total;
  }

  function resaltar(texto, tokens) {
    let html = GD.esc(texto);
    if (!tokens.length) return html;
    const patron = tokens
      .filter(t => t.length > 1)
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .sort((a, b) => b.length - a.length);
    if (!patron.length) return html;
    return html.replace(new RegExp('(' + patron.join('|') + ')', 'gi'), '<span class="gdm-hit">$1</span>');
  }

  function construir() {
    if (bk) return;
    bk = document.createElement('div');
    bk.className = 'gdm-backdrop';
    bk.innerHTML = `
      <div class="gdm-panel" role="dialog" aria-modal="true" aria-label="Buscar materiales">
        <div class="gdm-searchbar">
          <span class="gdm-ico">🔍</span>
          <input type="text" id="gdm-q" autocomplete="off" spellcheck="false"
                 placeholder="Busca por número de parte o descripción…">
          <span class="gdm-kbd">Esc</span>
        </div>
        <div class="gdm-chips" id="gdm-chips"></div>
        <div class="gdm-list" id="gdm-list"></div>
        <div class="gdm-foot">
          <span><span class="gdm-kbd">↑</span> <span class="gdm-kbd">↓</span> navegar</span>
          <span><span class="gdm-kbd">Enter</span> agregar</span>
          <span><span class="gdm-kbd">Shift</span>+<span class="gdm-kbd">Enter</span> agregar y cerrar</span>
          <span class="gdm-qty">
            <label for="gdm-qty">Cantidad</label>
            <input type="number" id="gdm-qty" value="1" min="1" max="99999" data-chars="5">
          </span>
        </div>
      </div>`;
    document.body.appendChild(bk);

    bk.addEventListener('click', e => { if (e.target === bk) cerrar(); });
    $('#gdm-q', bk).addEventListener('input', () => { sel = 0; filtrar(); });
    $('#gdm-q', bk).addEventListener('keydown', teclado);
    $('#gdm-qty', bk).addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); agregar(e.shiftKey); }
      if (e.key === 'Escape') { e.preventDefault(); cerrar(); }
    });
    fields.aplicar($('#gdm-qty', bk));
  }

  function teclado(e) {
    if (e.key === 'ArrowDown')      { e.preventDefault(); mover(1); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); mover(-1); }
    else if (e.key === 'Enter')     { e.preventDefault(); agregar(e.shiftKey); }
    else if (e.key === 'Escape')    { e.preventDefault(); cerrar(); }
    else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); $('#gdm-qty', bk).select(); }
  }

  function mover(d) {
    if (!filtrados.length) return;
    sel = Math.max(0, Math.min(filtrados.length - 1, sel + d));
    pintarSeleccion();
  }

  function pintarSeleccion() {
    const filas = bk.querySelectorAll('.gdm-row');
    filas.forEach((f, i) => f.classList.toggle('sel', i === sel));
    const activa = filas[sel];
    if (activa) activa.scrollIntoView({ block: 'nearest' });
  }

  function chips() {
    const cont = $('#gdm-chips', bk);
    const cats = cfg.categorias ? cfg.categorias() : [];
    if (!cats.length) { cont.style.display = 'none'; return; }
    cont.style.display = '';
    cont.innerHTML = `<button type="button" class="gdm-chip${chip === '' ? ' on' : ''}" data-c="">Todos</button>` +
      cats.map(c => `<button type="button" class="gdm-chip${chip === c.valor ? ' on' : ''}" data-c="${GD.esc(c.valor)}">${GD.esc(c.etiqueta)}</button>`).join('');
    cont.querySelectorAll('.gdm-chip').forEach(b => {
      b.onclick = () => { chip = b.dataset.c; sel = 0; chips(); filtrar(); $('#gdm-q', bk).focus(); };
    });
  }

  function filtrar() {
    const q = $('#gdm-q', bk).value.trim();
    const tokens = norm(q).split(/\s+/).filter(Boolean);
    let base = cfg.materiales() || [];
    if (chip && cfg.categoriaDe) base = base.filter(m => cfg.categoriaDe(m) === chip);

    if (tokens.length) {
      filtrados = base
        .map(m => ({ m, p: puntuar(m, tokens) }))
        .filter(x => x.p >= 0)
        .sort((a, b) => b.p - a.p)
        .slice(0, 120)
        .map(x => x.m);
    } else {
      filtrados = base.slice(0, 120);
    }
    pintar(tokens);
  }

  function pintar(tokens) {
    const lista = $('#gdm-list', bk);
    if (!filtrados.length) {
      lista.innerHTML = `<div class="gdm-empty">Sin coincidencias.<br>Prueba con parte del número de parte o una palabra de la descripción.</div>`;
      return;
    }
    const carrito = cfg.carrito ? cfg.carrito() : {};
    lista.innerHTML = filtrados.map((m, i) => {
      const k = cfg.claveDe ? cfg.claveDe(m) : m.numero_parte;
      const enCarrito = carrito && carrito[k];
      return `<div class="gdm-row${i === sel ? ' sel' : ''}" data-i="${i}">
        <div>
          <div class="gdm-desc">${resaltar(m.descripcion, tokens)}</div>
          <div class="gdm-part">${resaltar(m.numero_parte, tokens)}</div>
        </div>
        ${enCarrito ? `<span class="gdm-incart">✓ ${enCarrito.cantidad} en carrito</span>` : '<span></span>'}
        <span class="gdm-price">${GD.esc(cfg.precio(m))}</span>
      </div>`;
    }).join('');

    lista.querySelectorAll('.gdm-row').forEach(f => {
      f.onclick = e => { sel = +f.dataset.i; pintarSeleccion(); agregar(e.shiftKey); };
    });
  }

  function agregar(cerrarDespues) {
    const m = filtrados[sel];
    if (!m) return;
    const qty = Math.max(1, parseInt($('#gdm-qty', bk).value) || 1);
    cfg.onAgregar(m, qty);
    if (cerrarDespues) { cerrar(); return; }
    filtrar();                                    // refresca el distintivo "en carrito"
    const q = $('#gdm-q', bk);
    q.select(); q.focus();
  }

  function abrir(textoInicial) {
    if (!cfg) return;
    construir();
    bk.classList.add('open');
    ultimoFoco = document.activeElement;
    chip = ''; sel = 0;
    $('#gdm-qty', bk).value = 1;
    const q = $('#gdm-q', bk);
    q.value = textoInicial || '';
    chips();
    filtrar();
    setTimeout(() => { q.focus(); q.select(); }, 30);
  }

  function cerrar() {
    if (!bk) return;
    bk.classList.remove('open');
    if (ultimoFoco && ultimoFoco.focus) ultimoFoco.focus();
  }

  return {
    /**
     * cfg = {
     *   materiales()      → array de materiales
     *   carrito()         → objeto del carrito (opcional, para el distintivo)
     *   claveDe(m)        → clave del carrito (opcional)
     *   precio(m)         → precio ya formateado
     *   categorias()      → [{valor, etiqueta}] (opcional)
     *   categoriaDe(m)    → valor de categoría (opcional)
     *   onAgregar(m, qty) → alta en el carrito
     * }
     */
    configurar(c) { cfg = c; },
    abrir, cerrar,
    get abierto() { return !!bk && bk.classList.contains('open'); },
  };
})();


/* ── 4. SESIÓN ──────────────────────────────────────────────────────────────*/

GD.sesion = {
  actual: null,

  async cargar() {
    try {
      const r = await fetch('/api/session', { credentials: 'same-origin' });
      this.actual = r.ok ? await r.json() : null;
    } catch (e) { this.actual = null; }
    return this.actual;
  },

  get esAdmin() { return this.actual && this.actual.rol === 'admin'; },

  async salir() {
    try { await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' }); } catch (e) {}
    location.reload();
  },
};

/* Un módulo cargado dentro del portal avisa hacia arriba cuando expira la
   sesión, para que el portal muestre de nuevo la pantalla de acceso. */
window.addEventListener('gd-sesion-expirada', () => {
  try {
    if (window.top !== window) window.top.postMessage({ type: 'gd-sesion-expirada' }, location.origin);
    else location.reload();
  } catch (e) {}
});


/* ── Arranque ───────────────────────────────────────────────────────────────*/

function iniciar() {
  info.preparar();
  fields.escanear();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();

GD.refrescar = function (raiz) { info.preparar(raiz); fields.escanear(raiz); };

})();
