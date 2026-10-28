// Genera los datos iniciales del Moodle simulado.
//
//   node scripts/build-seed.mjs
//
// - seed.json: catálogo y estudiantes FICTICIOS (es el que se versiona).
// - seed.local.json: si existe seed.private.json, se aplican sus datos (ids externos de los cursos y
//   usuarios reales de tu entorno) sobre el catálogo ficticio. seed.private.json y seed.local.json no se
//   versionan (.gitignore). El servidor usa seed.local.json si existe; si no, seed.json.
//
// Formato de seed.private.json (todo opcional):
//   {
//     "courseIdnumbers": { "19": "id-externo-del-curso-19", ... },
//     "courseNames":     { "34": "Nombre real del curso 34", ... },
//     "users": [ { "id": 8, "username": "...", "firstname": "...", "lastname": "...", "email": "..." }, ... ]
//   }
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = 1727000000;
const fakeId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ------------------------------------------------------------------ categorías
const categories = [
  { id: 1, name: 'Miscellaneous', parent: 0, idnumber: '', description: '' },
  { id: 2, name: 'Programa de Entrenadores (demo)', parent: 0, idnumber: 'EXT-PROG-01', description: 'Un curso por módulo.' },
  { id: 3, name: 'Fútbol Sala (demo)', parent: 0, idnumber: '', description: '' },
  { id: 4, name: 'Recuperaciones', parent: 0, idnumber: '', description: 'Cursos de recuperación de los módulos.' },
  { id: 5, name: 'Cursos obligatorios', parent: 0, idnumber: '', description: '' },
  { id: 6, name: 'Pruebas de integración', parent: 0, idnumber: '', description: 'Cursos para pruebas de la plataforma externa.' }
].map(c => ({ ...c, visible: 1, timemodified: T }));

// ---------------------------------------------------------------------- cursos
const MODULES = ['PREPARACIÓN TÉCNICA', 'PREPARACIÓN FÍSICA', 'PREPARACIÓN TÁCTICA', 'PREPARACIÓN ESPECÍFICA', 'PREPARACIÓN ESTRATÉGICA', 'PREPARACIÓN PSICOLÓGICA', 'PREPARACIÓN INTEGRAL'];
const courses = [];
const course = (id, fullname, shortname, categoryid, idnumber, kind) => courses.push({
  id, fullname, shortname, categoryid, idnumber, summary: '', visible: 1, format: 'topics',
  startdate: T, enddate: 0, timecreated: T, timemodified: T, gradetotal: 'scale5', kind
});

// Cohorte anterior (idnumber 0001…, sin vínculo con la plataforma externa)
course(5, 'MÓDULO 1 - PREPARACIÓN TÉCNICA', 'MOD1-ANT', 2, '0001', 'module');
course(7, 'CURSO - MANEJO DE EMOCIONES EN EL DEPORTE', 'EMOCIONES-ANT', 5, '0003', 'simple');
course(8, 'MÓDULO 2 - PREPARACIÓN FÍSICA', 'MOD2-ANT', 2, '0002', 'module');
[3, 4, 5, 6, 7].forEach((n, i) => course(9 + i, `MÓDULO ${n} - ${MODULES[n - 1]}`, `MOD${n}-ANT`, 2, `000${n + 1}`, 'module'));
course(14, 'CURSO PREPARACIÓN TÉCNICA EN EL FÚTBOL SALA', 'C-PTFS', 3, '0009', 'simple');
course(15, 'CURSO PREPARACIÓN FÍSICA EN EL FÚTBOL SALA', 'C-PFFS', 3, 'C-PFFS', 'simple');
course(16, 'EVALUACIÓN DE CRECIMIENTO FORMATIVO', 'EVAL-CF', 1, '', 'simple');
// Programa vigente: idnumber = id del módulo en la plataforma externa
MODULES.forEach((name, i) => course(19 + i, `MODULO ${i + 1}. ${name}`, `PE-M${i + 1}`, 2, fakeId(101 + i), 'module'));
// Fútbol Sala (sin vínculo)
MODULES.forEach((name, i) => course(27 + i, `MODULO ${i + 1}. ${name} - FS`, `FS-M${i + 1}`, 3, `M0${i + 1}FS`, 'module'));
// Curso obligatorio (curso completo vinculado con el id del curso en la plataforma externa)
course(34, 'CURSO OBLIGATORIO DE CONVIVENCIA EN EL DEPORTE', 'OBLIGATORIO', 5, fakeId(201), 'simple');
// Recuperaciones: solo la del módulo 1 está vinculada
course(36, 'RECUPERACIÓN MÓDULO 1 PREPARACIÓN TÉCNICA', 'REC-M1', 4, fakeId(301), 'recovery');
course(37, 'EVALUACIÓN DE CRECIMIENTO FORMATIVO (2)', 'EVAL-CF-2', 1, '', 'simple');
[2, 3, 4, 5, 6].forEach((n, i) => course(39 + i, `RECUPERACIÓN MÓDULO ${n} ${MODULES[n - 1]}`, `REC-M${n}`, 4, '', 'recovery'));
// Cursos para pruebas de integración
[1, 2, 3, 4].forEach((n, i) => course(50 + i, `[PRUEBA] Modulo ${n}`, `PRUEBA-M${n}`, 6, fakeId(401 + i), 'simple'));
course(54, 'Prueba Modulo Moodle', 'PRUEBA-MOODLE', 6, fakeId(405), 'simple');

// ------------------------------------------------------------- ítems de notas
const gradeitems = [];
let itemId = 0;
const items = new Map(); // courseid → [{ id, key }]
const addItem = (courseid, itemname, itemmodule, opts = {}) => {
  const id = ++itemId;
  const sortorder = (items.get(courseid)?.length ?? 0) + 2;
  gradeitems.push({
    id, courseid, itemname, itemtype: 'mod', itemmodule, iteminstance: id, idnumber: '',
    grademin: 0, grademax: 5, sortorder,
    ...(opts.hidden ? { hidden: true } : { gradepass: 3 })
  });
  items.set(courseid, [...(items.get(courseid) ?? []), { id, key: opts.key ?? itemname }]);
};

for (const c of courses) {
  // Ítem del total (su máximo lo recalcula el mock en modo "scale5")
  gradeitems.push({ id: ++itemId, courseid: c.id, itemname: null, itemtype: 'course', itemmodule: null, iteminstance: c.id, idnumber: '', grademin: 0, grademax: 100, sortorder: 1 });
  const n = c.shortname.match(/M(\d)/)?.[1] ?? '';
  if (c.kind === 'module') {
    for (let u = 1; u <= 4; u++) {
      addItem(c.id, `TALLER UNIDAD ${u} MODULO ${n}`, 'assign', { key: `taller${u}` });
      addItem(c.id, `EVALUACIÓN UNIDAD ${u} MODULO ${n}`, 'quiz', { key: `eval${u}` });
    }
    addItem(c.id, `EXAMEN FINAL MODULO ${n}`, 'quiz', { key: 'final' });
    for (let u = 1; u <= 4; u++) addItem(c.id, `PARTICIPACIÓN UNIDAD ${u}`, 'forum', { hidden: true, key: `part${u}` });
  } else if (c.kind === 'recovery') {
    addItem(c.id, 'TALLER DE RECUPERACIÓN', 'assign', { key: 'taller' });
    addItem(c.id, 'EXAMEN DE RECUPERACIÓN', 'quiz', { key: 'final' });
  } else {
    addItem(c.id, 'TALLER 1', 'assign', { key: 'taller1' });
    addItem(c.id, 'TALLER 2', 'assign', { key: 'taller2' });
    addItem(c.id, 'EVALUACIÓN FINAL', 'quiz', { key: 'final' });
  }
}

// -------------------------------------------------------------------- usuarios
const user = (id, username, firstname, lastname, email, auth = 'oauth2') => ({
  id, username, password: auth === 'manual' ? 'Test1234!' : '', firstname, lastname, email, idnumber: '', auth,
  suspended: 0, timecreated: T, extra: {}
});
const users = [
  // Dueño del token (usuario de servicio)
  user(2, 'ws_service', 'Servicio', 'Web Services', 'ws.service@example.com', 'manual'),
  user(3, 'est1', 'Ana', 'Gómez', 'est1@example.com', 'manual'),
  user(4, 'est2', 'Bruno', 'Martínez', 'est2@example.com', 'manual'),
  user(5, 'est3', 'Carla', 'Rodríguez', 'est3@example.com', 'manual'),
  user(6, 'est4', 'Diego', 'López', 'est4@example.com', 'manual'),
  user(7, 'est5', 'Elena', 'Pérez', 'est5@example.com', 'manual'),
  // Estudiantes con ids altos, como en un sitio con muchos usuarios (seed.private.json puede reemplazarlos)
  user(8, 'estudiante8@example.com', 'Laura', 'Ramírez', 'estudiante8@example.com'),
  user(1297, 'estudiante1297@example.com', 'Mateo', 'Restrepo', 'estudiante1297@example.com'),
  user(1320, 'estudiante1320@example.com', 'Sofía', 'Castaño', 'estudiante1320@example.com'),
  user(1321, 'estudiante1321@example.com', 'Samuel', 'Arango', 'estudiante1321@example.com'),
  // Caso "4,32": total mostrado sobre 5, con máximo = suma de ítems (porcentaje de Moodle ~5-7 %)
  user(1460, 'caso.nota432@example.com', 'Caso', 'Nota 4,32', 'caso.nota432@example.com')
];

// --------------------------------------------------- matrículas y calificaciones
const enrolments = [];
const grades = [];
const enrol = (userid, courseid) => enrolments.push({ userid, courseid, roleid: 5, timestart: 0, timeend: 0, suspend: 0, timecreated: T });
const grade = (userid, courseid, fn) => {
  for (const it of items.get(courseid) ?? []) {
    if (it.key.startsWith('part')) continue;
    const value = fn(it.key);
    if (value !== null && value !== undefined) grades.push({ itemid: it.id, userid, graderaw: value, overridden: false, timemodified: T });
  }
};
const totalItemId = (courseid) => gradeitems.find(g => g.courseid === courseid && g.itemtype === 'course').id;
const PROGRAM = [19, 20, 21, 22, 23, 24, 25];

// est1: aprueba todo (≈4.5) y el curso obligatorio
PROGRAM.forEach(c => { enrol(3, c); grade(3, c, k => (k.startsWith('eval') ? 4.6 : 4.4)); });
enrol(3, 34); grade(3, 34, () => 4.5);
// est2: pierde el módulo 3 (1.75) y presenta su recuperación (4.0)
PROGRAM.forEach(c => { enrol(4, c); grade(4, c, () => (c === 21 ? 1.75 : 4.0)); });
enrol(4, 40); grade(4, 40, () => 4.0);
// est3: el módulo 5 sin calificar
PROGRAM.forEach(c => { enrol(5, c); grade(5, c, () => (c === 23 ? null : 3.8)); });
// est4: aprueba solo los módulos 1 y 2
PROGRAM.forEach(c => { enrol(6, c); grade(6, c, () => (c <= 20 ? 4.0 : 2.2)); });
// est5: no matriculada en el módulo 6; matriculada sin nota en el curso obligatorio
PROGRAM.filter(c => c !== 24).forEach(c => { enrol(7, c); grade(7, c, () => 4.2); });
enrol(7, 34);
// 1320 (≈4.375 = 87.5%) y 1297 (≈3.95 = 79%) en los módulos 1-6
PROGRAM.slice(0, 6).forEach(c => { enrol(1320, c); grade(1320, c, k => (k.startsWith('eval') ? 4.5 : 4.25)); });
PROGRAM.slice(0, 6).forEach(c => { enrol(1297, c); grade(1297, c, k => (k.startsWith('eval') ? 4.0 : 3.9)); });
// 8: cursos de prueba 1-4; 1321: "Prueba Modulo Moodle"
[50, 51, 52, 53].forEach((c, i) => { enrol(8, c); grade(8, c, () => (i % 2 === 0 ? 4.0 : 3.5)); });
enrol(1321, 54); grade(1321, 54, () => 3.5);
// Caso 4,32 en el módulo 2: total del curso fijado en 4.32321 (el porcentaje de Moodle sale bajísimo)
enrol(1460, 20);
const caso = { taller1: 4, taller2: 5, taller3: 5, taller4: 4.64286, eval1: 4.5, eval2: 4.5, eval3: 5, eval4: 5, final: 5 };
grade(1460, 20, k => caso[k]);
grades.push({ itemid: totalItemId(20), userid: 1460, graderaw: 4.32321, overridden: true, timemodified: T });

// ------------------------------------------------------------------------ seed
const seed = {
  seq: { user: 1500, category: Math.max(...categories.map(c => c.id)), course: 60, gradeitem: itemId },
  settings: { defaultGradeTotal: 'scale5' },
  users,
  categories,
  courses: courses.map(({ kind, ...c }) => c),
  enrolments,
  gradeitems,
  grades
};
const write = (file, data) => writeFileSync(join(ROOT, file), JSON.stringify(data, null, 2) + '\n');
write('seed.json', seed);
console.log(`seed.json: ${courses.length} cursos, ${users.length} usuarios, ${gradeitems.length} ítems, ${enrolments.length} matrículas, ${grades.length} notas`);

// Datos privados de tu entorno (no versionados) → seed.local.json
const privatePath = join(ROOT, 'seed.private.json');
if (existsSync(privatePath)) {
  const priv = JSON.parse(readFileSync(privatePath, 'utf8'));
  const local = structuredClone(seed);
  for (const [id, idnumber] of Object.entries(priv.courseIdnumbers ?? {})) {
    const c = local.courses.find(x => x.id === Number(id));
    if (c) c.idnumber = idnumber;
  }
  for (const [id, fullname] of Object.entries(priv.courseNames ?? {})) {
    const c = local.courses.find(x => x.id === Number(id));
    if (c) c.fullname = fullname;
  }
  for (const u of priv.users ?? []) {
    const existing = local.users.find(x => x.id === u.id);
    if (existing) Object.assign(existing, u);
    else local.users.push(user(u.id, u.username, u.firstname, u.lastname, u.email));
  }
  write('seed.local.json', local);
  console.log('seed.local.json: con los datos de seed.private.json (no versionado)');
}
