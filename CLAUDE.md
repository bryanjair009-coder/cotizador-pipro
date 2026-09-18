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

## Categorías y costo de compra (2026-09)

- `materiales` tiene `categoria` (`pipro`, `electrico`, `galvanizado`,
  `acero_carbon`, `inoxidable`, `pvc`, `consumible`, `otros`). **Migración:
  `SUPABASE_CATEGORIAS.sql`, que debe correrse ANTES de desplegar** — si no, el
  panel manda columnas inexistentes y PostgREST rechaza la escritura.
- `CATEGORIAS` en cotizador.html y el `CHECK` del SQL tienen que coincidir.
- `detectarPipro()` ya NO adivina por descripción: lee `categoriaDe(m)`.
  `clasificarMaterial()` sólo se usa cuando el material aún no tiene categoría,
  y replica las reglas del SQL.
- **`filaMaterial(m)` es obligatoria en todo upsert de materiales.** Un upsert de
  PostgREST reescribe con valores por defecto las columnas que no se mandan:
  omitir `categoria` o `costo_compra` las borraría en cada edición en línea.
- **Costo de compra** (`costo_compra`, `costo_origen`, `costo_fuentes`,
  `costo_fecha`). Tres orígenes:
  - `lista` → Excel de precios de compra (admin → Catálogo), cruzado por
    `numero_parte`. Es la vía para PIPRO.
  - `internet` → `api/precio-mercado.js`: **Haiku 4.5** (`claude-haiku-4-5`) +
    `web_search_20250305` busca distribuidores mexicanos y el **servidor**
    promedia los **3 más caros** (criterio de la casa, conservador). El modelo
    no calcula el promedio; su salida se sanea (duplicados por distribuidor,
    precios no finitos, URLs no http) antes de usarse.
  - `manual` → capturado a mano; siempre gana.

### Estado actual (2026-09-18): búsqueda con IA APAGADA

- Por decisión del departamento, para no gastar tokens. El precio al cliente se
  captura **a mano, ya con la utilidad incluida** — el portal no le suma nada.
- Doble candado, ambos necesarios para encenderla:
  1. `BUSQUEDA_PRECIOS = true` en cotizador.html (muestra los botones).
  2. `PRECIO_MERCADO_ACTIVO=1` en Vercel. **El endpoint responde 503 antes de
     crear el cliente de Anthropic** si falta; ocultar el botón no bastaría,
     porque el endpoint se puede llamar directo.
- Botón `$` de cada partida → **Precio al cliente** (principal) y costo de
  compra (opcional, dentro de un `<details>`, sólo para el margen).
- Un precio cambiado a mano es **de esa cotización**: no toca el catálogo.
  `item.precioManual = true` y `item.precioCatalogo` guarda el original para
  «Volver al del catálogo». La celda se marca en rojo con ✎.
- Fuentes gratuitas evaluadas: la API pública de Mercado Libre (MLM) ya exige
  OAuth (responde 403 sin token, verificado el 2026-09-18).

### Precio de venta desde el costo de mercado (cuando se encienda)

- `precioDesdeCosto(costo) = costo × (1 + UTIL_MERCADO_PCT)`, por omisión +50 %.
  Configurable en **Administrador → Utilidades** y guardado en `meta.utilidades`.
- Ojo con la aritmética: **+50 % sobre el costo = 33.3 % de margen sobre el
  precio de venta**. No son lo mismo.
- En **Material Rápido** la descripción hace de buscador: llena el precio de
  venta ya con la utilidad y deja el costo registrado en la partida.

### Costo de las consultas (no es gratis)

- Modelo barato a propósito: **Haiku 4.5** ($1 / $5 por millón). No existe modelo
  gratuito de Anthropic.
- **Lo caro es la búsqueda web: $10 por millar ($0.01 cada una)**, más de la
  mitad del gasto. Por eso `MAX_BUSQUEDAS = 4`; subirlo encarece proporcional.
- Consulta típica (3 búsquedas, ~19 k entrada + ~900 salida): **≈ $0.054 USD**.
- **Caché en `localStorage` (`pipro_precios_mercado`, 30 días)**, con clave doble
  por descripción **y** número de parte: un material rápido recibe su número de
  parte DESPUÉS de la búsqueda, así que guardar sólo por parte dejaba la caché
  inservible. Es el mayor ahorro del sistema.
- El endpoint devuelve `gasto` (tokens, búsquedas, `costoUSD`) y lo escribe en la
  bitácora: para el gasto real, consultar ahí en vez de estimar.
- El costo **no sale nunca** al PDF ni al Word del cliente. El PDF de requisición
  lleva sólo parte, descripción y cantidad.

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
- `esPipro`: decide si la partida entra sola a la requisición

## Requisición automática (cotizador.html)

Toda partida con `disponibilidad < cantidad` entra sola a la sección **5b**.

- **PIPRO queda FUERA** salvo solicitud especial: botón + `confirm()` explícito.
  `state.incluirPipro` guarda esa decisión y se serializa con la cotización.
- Clasificación PIPRO: `detectarPipro()` — descripción con pipro/airwyn/aluminio
  azul, o pertenecer a `state.materiales`. Lo capturado a mano (`TEMP-*`) es
  externo. Es sólo el valor inicial: `item.esPipro` (clic en la pastilla) manda.
- `generateAll()` agrega 2 pasos cuando `getReqItems().length > 0`, y el botón
  pasa a decir "los 5 archivos".

### Quién ve qué — NO revertir

**Quien cotiza no tiene acceso a costos ni a proveedores.** La aplicación no los
pide en ningún lado y el carrito no los guarda.

- **PDF** (`generateRequisicionPDF`): sólo `#, No. de Parte, Descripción,
  Cantidad` + total de piezas. Se manda por correo al equipo de compras. Nunca
  lleva precio de venta, costo ni margen. Marca "NO ENVIAR AL CLIENTE".
- **Excel** (`generateRequisicionExcel`): las columnas **Proveedor** y **Costo
  unitario** salen **vacías**, en amarillo (`capFill`), para llenarlas fuera de
  la aplicación. Las fórmulas ya están puestas: al capturar un costo ahí dentro,
  costo total, utilidad, margen y el balance de la hoja 2 se calculan solos.
- `xlFormula(valor, formula, …)` escribe valor calculado + fórmula. Los totales
  usan `SUMIF(rango,">0",…)`, nunca `"<>"`: una celda con cadena vacía cuenta
  como no-vacía y ensuciaría la suma.
- Importes **siempre en MXN** (`fmtMXN`) aunque la cotización se entregue en USD:
  es la moneda en que se le paga al proveedor.
- El bloque B del balance NO calcula utilidad global — el material en almacén
  tampoco tiene costo aquí; sólo ubica el peso de la requisición sobre el total.

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
