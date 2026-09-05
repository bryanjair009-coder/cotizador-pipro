# Puesta en marcha tras la auditoría de seguridad

> **Orden importante.** Primero las variables de entorno, luego el despliegue y
> al final el script SQL. Si ejecutas el SQL antes de desplegar, el portal se
> queda sin acceso a datos hasta que termines.

---

## 1. Variables de entorno en Vercel

Panel de Vercel → tu proyecto → **Settings → Environment Variables**.
Agrégalas en los tres entornos (Production, Preview, Development).

| Variable | Dónde se obtiene | Notas |
|---|---|---|
| `SUPABASE_URL` | Supabase → Settings → API → *Project URL* | La misma de siempre |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → **service_role** | ⚠️ Secreta. Nunca en el repositorio ni en el navegador |
| `SESSION_SECRET` | La generas tú | Mínimo 32 caracteres aleatorios |
| `ADMIN_BOOTSTRAP_PASSWORD` | La eliges tú | Sólo para crear la primera cuenta; después bórrala |
| `ANTHROPIC_API_KEY` | Ya la tenías | Para la lectura de tablas por OCR |

Para generar el `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> Si algún día cambias `SESSION_SECRET`, todas las sesiones abiertas se
> invalidan y el personal tendrá que volver a entrar. Eso es justamente lo que
> se hace si sospechas que alguien copió la llave.

---

## 2. Desplegar el código

```bash
git push origin main
```

Espera a que Vercel termine. Comprueba que `https://<tu-dominio>/api/session`
responde `{"autenticado":false}` — si devuelve 404, las funciones no se
publicaron y **no debes continuar con el paso 3**.

---

## 3. Cerrar la base de datos

Supabase → **SQL Editor → New query** → pega el contenido de
[`SUPABASE_SEGURIDAD.sql`](SUPABASE_SEGURIDAD.sql) → **Run**.

La última consulta del script debe devolver **cero filas**. Si aparece alguna,
esa tabla sigue expuesta al público.

---

## 4. Crear el primer administrador

1. Abre el portal. Verás la pantalla de acceso.
2. Escribe el usuario que quieras (por ejemplo `bryan`) y, como contraseña,
   el valor exacto de `ADMIN_BOOTSTRAP_PASSWORD`.
3. El sistema crea esa cuenta con rol de administrador y te deja entrar.
4. **Cambia la contraseña** desde el menú de tu usuario (esquina superior derecha).
5. **Borra `ADMIN_BOOTSTRAP_PASSWORD`** de las variables de Vercel y vuelve a
   desplegar. El arranque inicial sólo funciona mientras no exista ningún
   usuario, pero conviene no dejar la puerta puesta.

---

## 5. Dar de alta al personal

Cotizador → pestaña **Administrador** → sección **Usuarios del portal**.

- **Usuario**: rol de trabajo normal. Cotiza, genera reportes y captura
  requisiciones.
- **Administrador**: además edita el catálogo de materiales, los porcentajes de
  utilidad y las cuentas.

Reglas de contraseña: mínimo 10 caracteres, con al menos una letra y un número.
Toda cuenta nueva debe cambiar su contraseña la primera vez que entra.

Si alguien falla 5 veces seguidas, su cuenta se bloquea 15 minutos. Un
administrador puede desbloquearla al restablecer la contraseña con 🔑.

---

## Qué cambió respecto de antes

| Antes | Ahora |
|---|---|
| La llave de Supabase viajaba en `supabase-client.js` | Vive sólo en Vercel; el navegador habla con `/api/db` |
| Cualquiera podía leer y borrar clientes, materiales y requisiciones | Hace falta sesión válida, y el borrado exige rol de administrador |
| Contraseña `pipro2026` escrita en el HTML | Cuentas individuales con hash scrypt en la base de datos |
| Sin registro de quién hizo qué | Bitácora inmutable de accesos y modificaciones |
| `/api/parse-table` abierto a internet | Exige sesión, mismo origen, tipo y tamaño de archivo |
| Sin cabeceras de seguridad, CORS abierto a todos | CSP, HSTS, X-Frame-Options, Permissions-Policy |

---

## Mantenimiento

**Revisar la bitácora**: Administrador → *Bitácora de auditoría*. Busca
`LOGIN_FALLIDO` repetidos desde una misma IP.

**Purgar registros viejos** (opcional, se conservan 24 meses):

```sql
SELECT purgar_bitacora();
```

**Rotar la llave de servicio**: si sospechas que se filtró, genérala de nuevo en
Supabase (Settings → API → *Reset service role key*), actualiza la variable en
Vercel y vuelve a desplegar.
