-- ═══════════════════════════════════════════════════════════════════════════════
--  SUPABASE_SETUP.sql  –  Configuración inicial de base de datos para PIPRO
--
--  INSTRUCCIONES:
--  1. Ve a https://supabase.com y crea un proyecto (gratis)
--  2. En tu proyecto → SQL Editor → New Query
--  3. Pega TODO este archivo y haz clic en "Run"
--  4. Luego ve a Settings → API y copia:
--       • Project URL  →  SUPABASE_URL  en supabase-client.js
--       • anon public  →  SUPABASE_KEY  en supabase-client.js
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── 1. TABLAS ────────────────────────────────────────────────────────────────

-- Catálogo de materiales / lista de precios
CREATE TABLE IF NOT EXISTS materiales (
  id            BIGSERIAL PRIMARY KEY,
  numero_parte  TEXT        UNIQUE NOT NULL,
  descripcion   TEXT        NOT NULL,
  precio        NUMERIC(14,4) NOT NULL DEFAULT 0,
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

-- Catálogo de empresas clientes
CREATE TABLE IF NOT EXISTS empresas (
  nombre        TEXT        PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Metadatos generales (contador de folios, etc.)
CREATE TABLE IF NOT EXISTS meta (
  key           TEXT        PRIMARY KEY,
  value         TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);


-- ── 2. DATOS INICIALES ───────────────────────────────────────────────────────

-- Contador de requisiciones (comienza en 0)
INSERT INTO meta (key, value) VALUES ('req_counter', '0')
  ON CONFLICT (key) DO NOTHING;

-- Empresas de ejemplo (puedes borrar o agregar las que necesites)
INSERT INTO empresas (nombre) VALUES
  ('Constructora del Norte'),
  ('Inmobiliaria Pacífico')
ON CONFLICT (nombre) DO NOTHING;


-- ── 3. SEGURIDAD (Row Level Security) ───────────────────────────────────────
-- Permite acceso público total (apropiado para sistema interno sin autenticación)
-- Si en el futuro agregas autenticación, actualiza estas políticas.

ALTER TABLE materiales  ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisiciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta        ENABLE ROW LEVEL SECURITY;

-- Política: acceso completo para el rol anon (clave pública)
CREATE POLICY "acceso_publico" ON materiales   FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acceso_publico" ON requisiciones FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acceso_publico" ON empresas      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "acceso_publico" ON meta          FOR ALL TO anon USING (true) WITH CHECK (true);


-- ── 4. TRIGGER: actualizar updated_at automáticamente en materiales ──────────
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

CREATE TRIGGER meta_updated_at
  BEFORE UPDATE ON meta
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 5. VERIFICACIÓN ──────────────────────────────────────────────────────────
-- Ejecuta esto para verificar que todo quedó correcto:
SELECT 'materiales'   AS tabla, count(*) AS registros FROM materiales
UNION ALL
SELECT 'requisiciones',          count(*)              FROM requisiciones
UNION ALL
SELECT 'empresas',               count(*)              FROM empresas
UNION ALL
SELECT 'meta',                   count(*)              FROM meta;
