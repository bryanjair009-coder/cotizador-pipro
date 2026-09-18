-- ═══════════════════════════════════════════════════════════════════════════════
--  SUPABASE_CATEGORIAS.sql — Categorías y costo de compra en el catálogo
--
--  Ejecutar UNA VEZ en el SQL Editor de Supabase, después de
--  SUPABASE_SEGURIDAD.sql. Es idempotente: se puede correr de nuevo sin daño.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Categoría del material ────────────────────────────────────────────────
--  Sustituye a la adivinanza por descripción que hacía el cotizador. De aquí
--  sale, entre otras cosas, si una partida entra sola a la requisición: el
--  material PIPRO se surte por otro canal y queda fuera salvo solicitud especial.
ALTER TABLE materiales ADD COLUMN IF NOT EXISTS categoria text;

-- Valores admitidos. Si mañana aparece una familia nueva, se agrega aquí y en
-- CATEGORIAS de cotizador.html — los dos lados tienen que coincidir.
ALTER TABLE materiales DROP CONSTRAINT IF EXISTS materiales_categoria_chk;
ALTER TABLE materiales ADD CONSTRAINT materiales_categoria_chk
  CHECK (categoria IS NULL OR categoria IN
    ('pipro','electrico','galvanizado','acero_carbon','inoxidable','pvc','consumible','otros'));

CREATE INDEX IF NOT EXISTS materiales_categoria_idx ON materiales (categoria);

-- ── 2. Costo de compra ───────────────────────────────────────────────────────
--  Lo que NOS cuesta la pieza. Nunca sale al PDF ni al Word del cliente.
--   · PIPRO        → se carga de la lista del fabricante (origen 'lista')
--   · No PIPRO     → promedio de los 3 distribuidores más caros de internet
--                    (origen 'internet'), o capturado a mano (origen 'manual')
ALTER TABLE materiales ADD COLUMN IF NOT EXISTS costo_compra  numeric;
ALTER TABLE materiales ADD COLUMN IF NOT EXISTS costo_origen  text;
ALTER TABLE materiales ADD COLUMN IF NOT EXISTS costo_fuentes jsonb;
ALTER TABLE materiales ADD COLUMN IF NOT EXISTS costo_fecha   timestamptz;

ALTER TABLE materiales DROP CONSTRAINT IF EXISTS materiales_costo_origen_chk;
ALTER TABLE materiales ADD CONSTRAINT materiales_costo_origen_chk
  CHECK (costo_origen IS NULL OR costo_origen IN ('lista','internet','manual'));

ALTER TABLE materiales DROP CONSTRAINT IF EXISTS materiales_costo_compra_chk;
ALTER TABLE materiales ADD CONSTRAINT materiales_costo_compra_chk
  CHECK (costo_compra IS NULL OR costo_compra >= 0);

-- ── 3. Siembra inicial de categorías ─────────────────────────────────────────
--  Clasificación de arranque por descripción. Es sólo un punto de partida:
--  el administrador la corrige desde el panel y su decisión queda guardada.
--  El orden importa — la primera coincidencia gana.
UPDATE materiales SET categoria =
  CASE
    WHEN descripcion ILIKE '%galvaniz%'                                   THEN 'galvanizado'
    WHEN descripcion ILIKE '%inoxidable%' OR descripcion ILIKE '%acero inox%' THEN 'inoxidable'
    WHEN descripcion ILIKE '%pvc%' OR descripcion ILIKE '%cpvc%'          THEN 'pvc'
    WHEN descripcion ILIKE '%cable%'    OR descripcion ILIKE '%condulet%'
      OR descripcion ILIKE '%breaker%'  OR descripcion ILIKE '%contactor%'
      OR descripcion ILIKE '%solenoid%' OR descripcion ILIKE '%tablero%'
      OR descripcion ILIKE '%conduit%'                                    THEN 'electrico'
    WHEN descripcion ILIKE '%aluminio%' OR descripcion ILIKE '%pipro%'
      OR descripcion ILIKE '%airwyn%'                                     THEN 'pipro'
    WHEN descripcion ILIKE '%acero al carb%' OR descripcion ILIKE '%cedula 40%'
      OR descripcion ILIKE '%ced. 40%'   OR descripcion ILIKE '%brida%'    THEN 'acero_carbon'
    WHEN descripcion ILIKE '%teflon%'   OR descripcion ILIKE '%silic%'
      OR descripcion ILIKE '%lija%'     OR descripcion ILIKE '%pintura%'   THEN 'consumible'
    ELSE 'pipro'   -- el catálogo es, en su mayoría, la línea PIPRO de aluminio
  END
WHERE categoria IS NULL;

-- ── Comprobación ─────────────────────────────────────────────────────────────
-- SELECT categoria, count(*), count(costo_compra) AS con_costo
--   FROM materiales GROUP BY categoria ORDER BY 2 DESC;
