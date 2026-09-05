# Cotizador PIPRO — Contexto del Proyecto

> Archivo leído automáticamente al abrir este proyecto en Claude Code.
> Ver también la memoria global en `~/.claude/CLAUDE.md`.

## Descripción

Herramienta web interna de Gardner Denver México para cotizar tubería neumática PIPRO/Airwyn.
Sin framework — HTML/CSS/JS puro + CDNs. Deploy en Vercel.

## Archivos principales

| Archivo | Propósito |
|---|---|
| `cotizador.html` | Cotizaciones (IP = con MO, IT = sin MO) |
| `presiones.html` | Estudio de caídas de presión + PDF ejecutivo |
| `requisiciones.html` | Requisiciones de material (React via Babel CDN) |
| `materiales.js` | Catálogo bundled 254+ items (fuente de siembra) |
| `supabase-client.js` | Cliente REST de Supabase (sin SDK) |
| `api/parse-table.js` | Serverless — Claude Vision para OCR de tablas |

## Supabase

- **Tablas:** `materiales` (catálogo), `clientes`, `requisiciones`, `meta`
- **Fuente de verdad:** Supabase — localStorage solo respaldo offline
- **Siembra:** Solo una vez (flag `meta.materiales_seed_done = true`)
- **Upsert key:** `numero_parte` para materiales

## PDF / Word

- `jsPDF` + `autoTable` en cotizador y presiones
- **CRÍTICO:** Helvetica builtin usa WinAnsi/Latin-1. Aplicar `sanitizePDF()` en presiones.html (monkey-patch de `doc.text` y `splitTextToSize`)
- Word: HTML con namespace MS Word exportado como `.doc` via Blob

## Panel admin (cotizador.html)

- Contraseña: `pipro2026`
- Tabla de materiales con edición inline (descripción, No. Parte, precio)
- Cambios sincronizan automáticamente a Supabase
- Cambio de `numero_parte` = DELETE viejo + INSERT nuevo (es PK)

## Carrito / Cotización

- `state.carrito` = objeto keyed por `numero_parte||descripcion.substr(0,20)`
- Cada item tiene: `descripcion, numero_parte, precio, cantidad, disponibilidad, fechaEntrega`
- `disponibilidad < cantidad` → fila amarilla en UI y en PDF/Word
- Columna "Disp." es INTERNA — no aparece en PDF ni Word del cliente
- `fechaEntrega` es texto libre ("3 a 7 días", "2 a 4 semanas")

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

- `ANTHROPIC_API_KEY` — para `api/parse-table.js`
