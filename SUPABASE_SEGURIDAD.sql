-- ═══════════════════════════════════════════════════════════════════════════════
--  SUPABASE_SEGURIDAD.sql — Endurecimiento de la base de datos del Portal PIPRO
--
--  ⚠️  EJECUTAR UNA SOLA VEZ, en Supabase → SQL Editor → New query.
--
--  QUÉ HACE
--   1. Crea las tablas `usuarios` y `bitacora`.
--   2. REVOCA todo acceso del rol `anon` (el que usaba el navegador).
--      A partir de aquí la única vía de entrada es /api/db con la llave de
--      servicio, que vive en las variables de entorno de Vercel.
--   3. Deja RLS activo en todas las tablas SIN políticas permisivas.
--      El rol `service_role` omite RLS por diseño, así que el portal sigue
--      funcionando; cualquier otro no ve absolutamente nada.
--
--  ⚠️  ANTES DE EJECUTARLO: despliega primero el código nuevo en Vercel y
--      configura las variables de entorno. Si ejecutas esto con el portal
--      viejo en producción, el portal dejará de leer datos.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── 1. TABLA DE USUARIOS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  usuario                TEXT        PRIMARY KEY,
  nombre                 TEXT,
  rol                    TEXT        NOT NULL DEFAULT 'usuario'
                                     CHECK (rol IN ('admin', 'usuario')),
  password_hash          TEXT        NOT NULL,
  activo                 BOOLEAN     NOT NULL DEFAULT TRUE,
  debe_cambiar_password  BOOLEAN     NOT NULL DEFAULT TRUE,
  intentos_fallidos      INT         NOT NULL DEFAULT 0,
  bloqueado_hasta        TIMESTAMPTZ,
  ultimo_acceso          TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);


-- ── 2. BITÁCORA DE AUDITORÍA ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bitacora (
  id          BIGSERIAL   PRIMARY KEY,
  usuario     TEXT,
  accion      TEXT        NOT NULL,
  tabla       TEXT,
  detalle     TEXT,
  ip          TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bitacora_fecha_idx   ON bitacora (created_at DESC);
CREATE INDEX IF NOT EXISTS bitacora_usuario_idx ON bitacora (usuario);


-- ── 3. CERRAR EL ACCESO ANÓNIMO ──────────────────────────────────────────────
--  Éste es el corazón de la corrección: las políticas antiguas permitían a
--  cualquiera con la llave pública leer, escribir y BORRAR todo, incluidos los
--  datos personales de clientes (nombre, teléfono, email, RFC).

DROP POLICY IF EXISTS "acceso_publico" ON materiales;
DROP POLICY IF EXISTS "acceso_publico" ON clientes;
DROP POLICY IF EXISTS "acceso_publico" ON requisiciones;
DROP POLICY IF EXISTS "acceso_publico" ON meta;

ALTER TABLE materiales    ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisiciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta          ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bitacora      ENABLE ROW LEVEL SECURITY;

-- Sin políticas = nadie pasa. `service_role` omite RLS, que es como entra /api.
REVOKE ALL ON materiales,    clientes, requisiciones, meta, usuarios, bitacora FROM anon;
REVOKE ALL ON materiales,    clientes, requisiciones, meta, usuarios, bitacora FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;


-- ── 4. LA BITÁCORA ES INMUTABLE ──────────────────────────────────────────────
--  Un registro de auditoría que se puede editar no sirve como evidencia.
CREATE OR REPLACE FUNCTION bitacora_solo_insercion()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'La bitácora es de sólo inserción.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bitacora_inmutable ON bitacora;
CREATE TRIGGER bitacora_inmutable
  BEFORE UPDATE OR DELETE ON bitacora
  FOR EACH ROW EXECUTE FUNCTION bitacora_solo_insercion();


-- ── 5. RETENCIÓN: purga automática a los 24 meses ────────────────────────────
--  Minimización de datos (principio de proporcionalidad, LFPDPPP art. 11).
CREATE OR REPLACE FUNCTION purgar_bitacora()
RETURNS void AS $$
BEGIN
  ALTER TABLE bitacora DISABLE TRIGGER bitacora_inmutable;
  DELETE FROM bitacora WHERE created_at < NOW() - INTERVAL '24 months';
  ALTER TABLE bitacora ENABLE TRIGGER bitacora_inmutable;
END;
$$ LANGUAGE plpgsql;


-- ── 6. VERIFICACIÓN ──────────────────────────────────────────────────────────
--  Debe devolver 0 filas. Si aparece alguna, esa tabla sigue expuesta.
SELECT tablename, policyname, roles
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  'anon' = ANY (roles);
