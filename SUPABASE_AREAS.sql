-- ═══════════════════════════════════════════════════════════════════════════
--  SUPABASE_AREAS.sql — Áreas independientes dentro del mismo portal
--
--  CORRER ANTES DE DESPLEGAR. Es idempotente: se puede repetir sin daño.
--
--  Qué resuelve
--  ────────────
--  El control de incidencias lo estrena una segunda área (Servicio) con su
--  propio administrador, su propio personal, sus propias empresas y sus
--  propias horas. Ingeniería y Servicio comparten el programa, NO los datos.
--
--  Cómo se separa
--  ──────────────
--  Una columna `area` en `usuarios`, `proyectos` e `incidencias`. Todo lo que
--  ya existe queda en 'ingenieria', que es el valor por omisión, así que la
--  migración no mueve ni un renglón de lo actual.
--
--  La separación de verdad la impone `api/db.js`, que añade el filtro de área
--  a cada lectura y la estampa en cada escritura a partir de la sesión. Esto
--  de aquí es el cimiento: columnas, rol nuevo e índices por área.
--
--  Para abrir una tercera área (p. ej. 'refacciones') basta con sumarla a los
--  dos CHECK de abajo y a ÁREAS en api/_lib/areas.js.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. La columna `area` en las tres tablas ────────────────────────────────
ALTER TABLE usuarios    ADD COLUMN IF NOT EXISTS area text NOT NULL DEFAULT 'ingenieria';
ALTER TABLE proyectos   ADD COLUMN IF NOT EXISTS area text NOT NULL DEFAULT 'ingenieria';
ALTER TABLE incidencias ADD COLUMN IF NOT EXISTS area text NOT NULL DEFAULT 'ingenieria';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios', 'proyectos', 'incidencias'] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_area_chk');
    EXECUTE format($f$ALTER TABLE %I ADD CONSTRAINT %I
                       CHECK (area IN ('ingenieria', 'servicio'))$f$, t, t || '_area_chk');
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS usuarios_area_idx    ON usuarios (area);
CREATE INDEX IF NOT EXISTS proyectos_area_idx   ON proyectos (area);
CREATE INDEX IF NOT EXISTS incidencias_area_idx ON incidencias (area, fecha);


-- ── 2. El rol `admin_servicio` ─────────────────────────────────────────────
-- Administra incidencias y personal, pero SÓLO de su área. No ve el catálogo,
-- ni las utilidades, ni la bitácora, ni al personal de ingeniería.
DO $$
DECLARE r text;
BEGIN
  SELECT conname INTO r FROM pg_constraint
   WHERE conrelid = 'usuarios'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%rol%IN%';
  IF r IS NOT NULL THEN EXECUTE format('ALTER TABLE usuarios DROP CONSTRAINT %I', r); END IF;
END $$;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_chk
  CHECK (rol IN ('admin', 'usuario', 'tecnico', 'admin_servicio'));


-- ── 3. Los folios se vuelven únicos POR ÁREA ───────────────────────────────
/* Antes el folio era único en toda la tabla. Con dos áreas eso haría que
   Servicio no pudiera registrar un proyecto porque Ingeniería ya usó ese
   folio —y ni siquiera podría saber por qué, porque no ve esa fila—. La
   unicidad pasa a ser (area, folio).

   NONPROJECT sigue siendo la excepción: no es un folio sino la falta de uno,
   así que se repite entre empresas; lo que no se admite es la misma empresa
   dos veces sin proyecto dentro de la misma área. */
DROP INDEX IF EXISTS proyectos_folio_uniq;
DROP INDEX IF EXISTS proyectos_nonproject_uniq;
CREATE UNIQUE INDEX proyectos_folio_uniq
  ON proyectos (area, folio) WHERE folio <> 'NONPROJECT';
CREATE UNIQUE INDEX proyectos_nonproject_uniq
  ON proyectos (area, empresa) WHERE folio = 'NONPROJECT';


-- ── 4. Cuenta de prueba del nuevo rol ──────────────────────────────────────
/* Para que puedas ver el perfil funcionando antes de dárselo a nadie.
   Entra con:
      usuario:    admin.servicio
      contraseña: Servicio2026
   Le pedirá cambiarla al entrar. Cuando termines de revisar, bórrala:
      DELETE FROM incidencias WHERE usuario = 'admin.servicio';
      DELETE FROM usuarios    WHERE usuario = 'admin.servicio';
   El hash es scrypt N=16384 r=8 p=1, el mismo formato que usa el portal. */
INSERT INTO usuarios (usuario, nombre, rol, area, codigo_recurso, password_hash, activo, debe_cambiar_password)
VALUES ('admin.servicio', 'Administrador de Servicio (prueba)', 'admin_servicio', 'servicio', NULL,
        'scrypt$16384$8$1$VN4Myhwp6T305WCoxqXjvw==$Qvq0RIZyicZFPlRLRlIpUpeJM2sOrToOjf00ACnxLYQPk8dzu9OmK9IUS/qWe5A2z8pUA1oKr5u728RCI9Z11w==',
        true, true)
ON CONFLICT (usuario) DO UPDATE
  SET rol = EXCLUDED.rol, area = EXCLUDED.area, activo = true;


-- ── 5. Comprobación ────────────────────────────────────────────────────────
SELECT 'columna area' AS objeto, table_name AS detalle
  FROM information_schema.columns
 WHERE column_name = 'area' AND table_name IN ('usuarios', 'proyectos', 'incidencias')
UNION ALL
SELECT 'índice', indexname FROM pg_indexes
 WHERE tablename = 'proyectos' AND indexname LIKE 'proyectos_%uniq'
UNION ALL
SELECT 'cuenta de prueba', usuario || ' · ' || rol || ' · ' || area
  FROM usuarios WHERE usuario = 'admin.servicio'
UNION ALL
SELECT 'filas por área', area || ': ' || count(*)::text
  FROM incidencias GROUP BY area;
