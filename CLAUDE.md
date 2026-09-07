# Cotizador PIPRO — Contexto del Proyecto

> Archivo leído automáticamente al abrir este proyecto en Claude Code.
> Ver también la memoria global en `~/.claude/CLAUDE.md`.

## Descripción

Herramienta web interna de Gardner Denver México para cotizar tubería neumática PIPRO/Airwyn.
Sin framework — HTML/CSS/JS puro + CDNs. Deploy en Vercel.

## Archivos principales

| Archivo | Propósito |
|---|---|
| `index.html` | Portal (6 iframes) + pantalla de acceso + menú de cuenta |
| `cotizador.html` | Cotizaciones (IP = con MO, IT = sin MO) + panel admin |
| `presiones.html` | Estudio de caídas de presión + PDF ejecutivo |
| `requisiciones.html` | Requisiciones de material (React via Babel CDN) |
| `electrico.html` | Selección eléctrica NOM-001-SEDE-2012 |
| `reportes.html` | Cartas de entrega de proyecto |
| `fugas.html` | Estudio ultrasónico de fugas |
| `materiales.js` | Catálogo bundled 254+ items (fuente de siembra) |
| `supabase-client.js` | Fachada de datos → llama a `/api/db` (sin credenciales) |
| `gd-theme.css` / `gd-ui.css` | Tema Gardner Denver + componentes compartidos |
| `gd-ui.js` | `GD.esc`, popovers de info, dimensionado de campos, buscador |
| `api/` | Funciones de Vercel: login, session, db, usuarios, parse-table |

> `gantt.html` se eliminó en la auditoría de 2026-09 (sin uso).

## Seguridad (auditoría 2026-09 — NO revertir)

- **El navegador nunca habla con Supabase.** Todo pasa por `/api/db`, que valida
  sesión, aplica lista blanca de tabla+operación por rol y registra en bitácora.
- **Credenciales sólo en variables de entorno de Vercel:** `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`.
- **Sesiones:** HMAC-SHA256 en cookie HttpOnly + Secure + SameSite=Strict, 10 h.
- **Contraseñas:** scrypt N=16384 con sal. Mínimo 10 caracteres con letra y número.
- **Roles:** `admin` (catálogo, utilidades, cuentas) y `usuario`. `GD.sesion.esAdmin`.
- **XSS:** usar SIEMPRE `GD.esc()` antes de meter datos en `innerHTML`.
- **Nunca** volver a poner una contraseña o llave en el HTML/JS del cliente.
- Puesta en marcha: ver `PUESTA_EN_MARCHA.md`; SQL en `SUPABASE_SEGURIDAD.sql`.

## Supabase

- **Tablas:** `materiales` (catálogo), `clientes`, `requisiciones`, `meta`,
  `usuarios` (hashes), `bitacora` (inmutable, purga a 24 meses)
- **RLS:** sin políticas permisivas. Sólo `service_role` (vía `/api`) entra.
- **Fuente de verdad:** Supabase — localStorage solo respaldo offline
- **Siembra:** Solo una vez (flag `meta.materiales_seed_done = true`)
- **Upsert key:** `numero_parte` para materiales
- `meta.utilidades` sólo la escribe un administrador (mueve dinero)

## Componentes de interfaz (gd-ui)

- **Icono de información:** `<button class="gd-i" data-info-title data-info
  data-formula data-fuente>`. Sustituye a las notas impresas bajo los campos.
- **Campos dimensionados:** `data-chars="N"`, o se deduce de `maxlength` / `max`.
  Con `<body data-gd-autosize>` se aplica a todo el módulo salvo dentro de tablas.
- **Buscador de materiales:** `GD.picker.configurar({...})` + `GD.picker.abrir()`.
  Ctrl+K lo abre. Enter agrega sin cerrar; Shift+Enter agrega y cierra.
- Tras pintar HTML nuevo, llamar `GD.refrescar(raiz)`.
- **Datos del perfil:** `<input data-perfil="nombre">` y `data-perfil="iniciales"`
  se rellenan solos con el nombre de la cuenta que inició sesión
  (`GD.perfil.aplicar()`). No se pisa lo que la persona escriba a mano.
  Las iniciales salen de `GD.iniciales()`: omite «Ing.» y partículas, máx. 4.

## PDF / Word

- `jsPDF` + `autoTable` en cotizador y presiones
- **CRÍTICO:** Helvetica builtin usa WinAnsi/Latin-1. Aplicar `sanitizePDF()` en presiones.html (monkey-patch de `doc.text` y `splitTextToSize`)
- Word: HTML con namespace MS Word exportado como `.doc` via Blob

## Panel admin (cotizador.html)

- Acceso por **rol `admin`** de la sesión (`aplicarPermisos()`), no por contraseña
- Secciones: utilidades, carga de Excel, catálogo, usuarios, bitácora
- Tabla de materiales con edición inline (descripción, No. Parte, precio)
- Cambios sincronizan automáticamente a Supabase
- Cambio de `numero_parte` = DELETE viejo + INSERT nuevo (es PK)

## Carrito / Cotización

- `state.carrito` = objeto keyed por `numero_parte||descripcion.substr(0,20)`
- Cada item tiene: `descripcion, numero_parte, precio, cantidad, disponibilidad, fechaEntrega`
- `disponibilidad < cantidad` → fila amarilla en UI y en PDF/Word
- Columna "Disp." es INTERNA — no aparece en PDF ni Word del cliente
- `fechaEntrega` es texto libre ("3 a 7 días", "2 a 4 semanas")

## Caídas de presión — criterios de cálculo (auditoría 2026-09)

- **Topología:** cabezal y bajada en SERIE; las bajadas entre sí en PARALELO.
  . **Nunca sumar las bajadas**: el aire
  recorre el cabezal y una sola bajada.
- **Porcentaje:** siempre sobre la presión de trabajo MANOMÉTRICA (),
  nunca sobre la absoluta. Convención CAGI/DOE.
- **Energía:**  usa la ley politrópica (k=1.4). Repartir la
  potencia de forma lineal contra P_abs sobrestima ~70%.
-  es la única fuente de verdad: pantalla y PDF leen de ahí, no
  del texto ya pintado.
- Avisos automáticos: descarga insuficiente (P_desc < P_red + ΔP) y ΔP > 10%
  (el modelo incompresible subestima a partir de ahí).
- Validez verificada contra la ecuación isoterma compresible: por debajo del 5%
  de caída el error es < 2%.

## Paleta de estado (presiones.html)

| Rango ΔP | Color | Hex |
|---|---|---|
| 0 – 2% | Verde fuerte | `#16a34a` |
| 2 – 5% | Verde lima | `#84cc16` |
| > 5% | Naranja | `#f97316` |

## Deploy

```bash
git add <archivos>
git commit -m "mensaje"
git push origin main
# Vercel detecta el push y despliega automáticamente
```

## Variables de entorno (Vercel)

| Variable | Uso |
|---|---|
| `SUPABASE_URL` | URL del proyecto de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Llave de servicio — **nunca** al cliente |
| `SESSION_SECRET` | Firma de las cookies de sesión (≥32 caracteres) |
| `ANTHROPIC_API_KEY` | `api/parse-table.js` (OCR de tablas) |
| `ADMIN_BOOTSTRAP_PASSWORD` | Sólo para crear el primer admin; borrar después |

## Trampa de PostgREST (no repetir)

`SB.upsert` / `sb.upsert` ejecutan `INSERT ... ON CONFLICT`, **no** una
actualización parcial:

- PostgreSQL valida `NOT NULL` **antes** de resolver el conflicto → omitir
  `password_hash` aborta la operación aunque la fila ya exista.
- El `DO UPDATE` reescribe con valores por defecto las columnas que no enviaste
  (degradaría `rol` a `usuario` y borraría `nombre`).

Para cambiar unos pocos campos de una fila existente usar `sb.update(tabla,
filtro, datos)` (PATCH). Los upserts del front-end sí mandan la fila completa.
