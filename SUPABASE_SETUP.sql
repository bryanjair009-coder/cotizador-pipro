-- ═══════════════════════════════════════════════════════════════════════════════
--  SUPABASE_SETUP.sql  –  Configuración de base de datos para PIPRO
--  Versión con DROP IF EXISTS para evitar errores si ya existía algo antes.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── 1. LIMPIAR POLÍTICAS Y TRIGGERS EXISTENTES ──────────────────────────────
-- (Evita el error "already exists" si el script se corre más de una vez)

DROP POLICY IF EXISTS "acceso_publico" ON materiales;
DROP POLICY IF EXISTS "acceso_publico" ON requisiciones;
DROP POLICY IF EXISTS "acceso_publico" ON clientes;
DROP POLICY IF EXISTS "acceso_publico" ON meta;

DROP TRIGGER IF EXISTS materiales_updated_at ON materiales;
DROP TRIGGER IF EXISTS clientes_updated_at   ON clientes;
DROP TRIGGER IF EXISTS meta_updated_at       ON meta;


-- ── 2. TABLAS ────────────────────────────────────────────────────────────────

-- Catálogo de materiales / lista de precios
CREATE TABLE IF NOT EXISTS materiales (
  id            BIGSERIAL     PRIMARY KEY,
  numero_parte  TEXT          UNIQUE NOT NULL,
  descripcion   TEXT          NOT NULL,
  precio        NUMERIC(14,4) NOT NULL DEFAULT 0,
  unidad        TEXT          DEFAULT 'PZA',
  created_at    TIMESTAMPTZ   DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   DEFAULT NOW()
);
-- Agregar columna unidad si la tabla ya existía sin ella
ALTER TABLE materiales ADD COLUMN IF NOT EXISTS unidad TEXT DEFAULT 'PZA';

-- Catálogo de clientes (empresas)
CREATE TABLE IF NOT EXISTS clientes (
  id            BIGSERIAL   PRIMARY KEY,
  nombre        TEXT        UNIQUE NOT NULL,
  contacto      TEXT,
  telefono      TEXT,
  email         TEXT,
  rfc           TEXT,
  ciudad        TEXT,
  notas         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Requisiciones del departamento de Ingeniería
CREATE TABLE IF NOT EXISTS requisiciones (
  folio         TEXT        PRIMARY KEY,
  requester     TEXT,
  company       TEXT,
  is_internal   BOOLEAN     DEFAULT FALSE,
  approver      TEXT,
  delivery      TEXT,
  observations  TEXT,
  date          TEXT,
  items         JSONB       NOT NULL DEFAULT '[]'::JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Metadatos generales (contador de folios, etc.)
CREATE TABLE IF NOT EXISTS meta (
  key           TEXT        PRIMARY KEY,
  value         TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);


-- ── 3. DATOS INICIALES ───────────────────────────────────────────────────────

INSERT INTO meta (key, value) VALUES ('req_counter', '0')
  ON CONFLICT (key) DO NOTHING;

INSERT INTO clientes (nombre, contacto, ciudad, notas) VALUES
  ('Constructora del Norte', 'Ing. Roberto García', 'Monterrey, N.L.',   'Cliente frecuente'),
  ('Inmobiliaria Pacífico',  'Lic. Ana Martínez',   'Guadalajara, Jal.', '')
ON CONFLICT (nombre) DO NOTHING;


-- ── 4. SEGURIDAD (Row Level Security) ───────────────────────────────────────

ALTER TABLE materiales    ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisiciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acceso_publico" ON materiales    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acceso_publico" ON clientes      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acceso_publico" ON requisiciones FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acceso_publico" ON meta          FOR ALL TO anon USING (true) WITH CHECK (true);


-- ── 5. FUNCIÓN Y TRIGGERS updated_at ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER materiales_updated_at
  BEFORE UPDATE ON materiales
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER clientes_updated_at
  BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER meta_updated_at
  BEFORE UPDATE ON meta
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 6. VERIFICACIÓN ──────────────────────────────────────────────────────────
SELECT 'materiales'   AS tabla, count(*) AS registros FROM materiales
UNION ALL
SELECT 'clientes',               count(*)              FROM clientes
UNION ALL
SELECT 'requisiciones',          count(*)              FROM requisiciones
UNION ALL
SELECT 'meta',                   count(*)              FROM meta;
