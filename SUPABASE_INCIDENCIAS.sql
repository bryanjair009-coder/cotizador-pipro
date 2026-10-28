-- ═══════════════════════════════════════════════════════════════════════════
--  SUPABASE_INCIDENCIAS.sql — Control de incidencias de técnicos
--
--  CORRER ANTES DE DESPLEGAR. Si no, el módulo de incidencias manda columnas
--  que no existen y PostgREST rechaza la escritura.
--
--  Crea:
--    · usuarios.codigo_recurso  → el «Codigo Recurso» de iScala (columna A del
--      archivo de carga). Va por técnico, no por proyecto.
--    · proyectos   → empresa + folio de proyecto. El folio NO se le muestra al
--      técnico: sale sólo en el panel de administrador y en el archivo.
--    · incidencias → un renglón por actividad registrada.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El código de recurso del técnico ─────────────────────────────────────
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS codigo_recurso text;

-- El rol 'tecnico' se suma a los que ya existían. Si la columna tiene un CHECK
-- viejo con sólo ('admin','usuario'), hay que reemplazarlo.
DO $$
DECLARE r text;
BEGIN
  SELECT conname INTO r FROM pg_constraint
   WHERE conrelid = 'usuarios'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%rol%';
  IF r IS NOT NULL THEN EXECUTE format('ALTER TABLE usuarios DROP CONSTRAINT %I', r); END IF;
END $$;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_chk
  CHECK (rol IN ('admin', 'usuario', 'tecnico'));


-- ── 2. Empresas con proyecto activo ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proyectos (
  id         bigserial PRIMARY KEY,
  empresa    text NOT NULL,
  folio      text NOT NULL,
  activo     boolean NOT NULL DEFAULT true,
  nota       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Una empresa puede tener varios proyectos, pero no dos veces el mismo folio
CREATE UNIQUE INDEX IF NOT EXISTS proyectos_folio_uniq ON proyectos (folio);
CREATE INDEX IF NOT EXISTS proyectos_activo_idx ON proyectos (activo) WHERE activo;


-- ── 3. Incidencias ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incidencias (
  id            bigserial PRIMARY KEY,
  usuario       text NOT NULL REFERENCES usuarios(usuario) ON UPDATE CASCADE,
  fecha         date NOT NULL,
  hora_entrada  text NOT NULL,          -- 'HH:MM' en 24 h
  hora_salida   text NOT NULL,
  horas         numeric(5,2) NOT NULL,  -- calculado de entrada/salida
  proyecto_id   bigint REFERENCES proyectos(id),
  /* El folio y la empresa se copian al registrar. Si mañana el proyecto se
     corrige o se da de baja, lo ya reportado no cambia: un archivo de carga
     entregado en marzo tiene que seguir diciendo lo mismo en diciembre. */
  empresa       text NOT NULL,
  folio         text NOT NULL,
  actividad_cod text NOT NULL,          -- 'AP007'  → columna D
  actividad_txt text NOT NULL,          -- 'Servicio con Cliente (FR)' → columna H
  extemporanea  boolean NOT NULL DEFAULT false,
  nota          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incidencias_fecha_idx   ON incidencias (fecha);
CREATE INDEX IF NOT EXISTS incidencias_usuario_idx ON incidencias (usuario, fecha);

/* Un técnico no puede registrar dos veces el mismo horario el mismo día en la
   misma empresa: así un doble clic en «Enviar» no duplica el renglón. */
CREATE UNIQUE INDEX IF NOT EXISTS incidencias_sin_duplicado
  ON incidencias (usuario, fecha, hora_entrada, hora_salida, folio, actividad_cod);


-- ── 4. Seguridad: igual que el resto, nadie entra sin pasar por /api ────────
ALTER TABLE proyectos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidencias ENABLE ROW LEVEL SECURITY;
-- Sin políticas = nadie pasa. `service_role` omite RLS, que es como entra /api.
REVOKE ALL ON proyectos, incidencias FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;


-- ── 5. Perfil de prueba ─────────────────────────────────────────────────────
--  Técnico de prueba para ver el panel funcionando.
--    usuario:    tecnico.prueba
--    contraseña: Tecnico2026!
--  El hash es scrypt con la misma receta que api/_lib/auth.js, así que el
--  login lo acepta tal cual. `debe_cambiar_password` queda en true: al entrar
--  la primera vez el portal pide cambiarla.
--
--  BÓRRALO cuando termines de probar:
--    DELETE FROM incidencias WHERE usuario = 'tecnico.prueba';
--    DELETE FROM usuarios    WHERE usuario = 'tecnico.prueba';
INSERT INTO usuarios (usuario, nombre, rol, codigo_recurso, password_hash, activo, debe_cambiar_password)
VALUES ('tecnico.prueba', 'Técnico de Prueba', 'tecnico', '2011',
        'scrypt$16384$8$1$+u3N0d0lsGHL79fvpTklzw==$QX8gy8hUo6SPLCebBfFrdwQEF0Tk4bqHiz6ew3su7fTJHhwLbz87swhLY/OeP4/JNzOCZlUuCkA1MKQshYhihg==',
        true, true)
ON CONFLICT (usuario) DO UPDATE
   SET rol = 'tecnico', codigo_recurso = '2011', activo = true;

-- Un par de proyectos para que el desplegable del técnico no salga vacío.
-- Cámbialos por los tuyos; el folio es el que va al archivo de carga.
INSERT INTO proyectos (empresa, folio, nota, activo) VALUES
  ('Empresa de prueba A', 'QS00000001', 'Borrar después de probar', true),
  ('Empresa de prueba B', 'QS00000002', 'Borrar después de probar', true)
ON CONFLICT (folio) DO NOTHING;


-- ── 6. Comprobación ─────────────────────────────────────────────────────────
SELECT 'usuarios.codigo_recurso' AS objeto,
       count(*) FILTER (WHERE column_name = 'codigo_recurso') AS existe
  FROM information_schema.columns WHERE table_name = 'usuarios'
UNION ALL
SELECT 'tabla proyectos',   count(*) FROM information_schema.tables WHERE table_name = 'proyectos'
UNION ALL
SELECT 'tabla incidencias', count(*) FROM information_schema.tables WHERE table_name = 'incidencias';
