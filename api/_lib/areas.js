// ═══════════════════════════════════════════════════════════════════════════════
//  api/_lib/areas.js — Áreas y roles, en un solo lugar
//
//  Dos áreas comparten el portal sin compartir datos: Ingeniería y Servicio.
//  Cada una tiene su personal, sus empresas con proyecto y sus incidencias.
//
//  Todo lo que decide «de quién es este renglón» vive aquí para que db.js y
//  usuarios.js no puedan contradecirse. Si alguna vez se abre una tercera
//  área, se agrega a AREAS y a los dos CHECK de SUPABASE_AREAS.sql.
// ═══════════════════════════════════════════════════════════════════════════════

export const AREAS = ['ingenieria', 'servicio'];
export const AREA_POR_DEFECTO = 'ingenieria';

export const ETIQUETA_AREA = {
  ingenieria: 'Ingeniería',
  servicio:   'Servicio',
};

export const ROLES = ['admin', 'usuario', 'tecnico', 'admin_servicio'];

/* Un administrador lo es DENTRO DE SU ÁREA. `admin` gobierna Ingeniería y
   además el portal entero (catálogo, utilidades, bitácora); `admin_servicio`
   sólo gobierna las incidencias y el personal de Servicio. Lo que comparten
   —y lo único que significa esta función— es que mandan sobre los renglones
   de su área: ven los de todos los suyos y pueden corregirlos. */
export function esAdminDeArea(rol) {
  return rol === 'admin' || rol === 'admin_servicio';
}

/** `admin` a secas: el del portal completo. No confundir con el de arriba. */
export const esAdminPortal = rol => rol === 'admin';

/* El área de una sesión. Las cookies firmadas antes de esta versión no la
   traen; se toman como de Ingeniería, que es donde estaba todo. */
export function areaDe(s) {
  const a = s && s.a;
  return AREAS.includes(a) ? a : AREA_POR_DEFECTO;
}

export const areaValida = a => AREAS.includes(a);

/* Tablas con columna `area`: se filtran al leer y se estampan al escribir.
   `usuarios` también la tiene, pero no pasa por db.js — la gobierna
   usuarios.js, que necesita reglas propias. */
export const TABLAS_POR_AREA = new Set(['proyectos', 'incidencias']);

/* Qué cuentas puede crear cada administrador.
   El de Servicio no puede fabricar un `admin` ni un `usuario`: el primero
   mandaría sobre todo el portal y el segundo abre el cotizador, que no es
   de su área. Se queda con su propio personal de campo y con un relevo de
   su mismo rol. */
const PUEDE_CREAR = {
  admin:          ['admin', 'usuario', 'tecnico', 'admin_servicio'],
  admin_servicio: ['tecnico', 'admin_servicio'],
};
export const rolesQuePuedeCrear = rol => PUEDE_CREAR[rol] || [];
