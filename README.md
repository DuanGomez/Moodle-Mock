# Moodle Mock

Servidor Node pequeño que imita la **API REST de web services de Moodle 4.5** para probar integraciones
sin un Moodle real: usuarios, categorías, cursos, matrículas y notas. El estado vive en un archivo JSON
(`data/db.json`) y se administra desde un panel web.

Útil para desarrollar y probar plataformas que leen notas de Moodle, crean usuarios y cursos, o
matriculan estudiantes, incluyendo los casos raros que aparecen en instalaciones reales (ítems ocultos,
totales con máximos inconsistentes, estudiantes no matriculados, notas sin calificar...).

## Arranque

Requiere Node 20 o superior.

```bash
npm install
npm run dev          # http://localhost:8085 (se recarga al editar src/)
```

| Variable          | Por defecto        | Uso                                                          |
|-------------------|--------------------|--------------------------------------------------------------|
| `PORT`            | `8085`             | Puerto HTTP                                                  |
| `MOODLE_WS_TOKEN` | `test-token`       | Único token aceptado (pertenece al usuario de servicio, id 2) |
| `DB_PATH`         | `data/db.json`     | Archivo de estado. Si no existe se crea copiando el seed      |
| `SEED_PATH`       | `seed.local.json` si existe, si no `seed.json` | Datos iniciales                      |
| `SITE_URL`        | host de la petición | `siteurl` que devuelve `core_webservice_get_site_info`      |

- Panel de administración: <http://localhost:8085/>
- Web service: `http://localhost:8085/webservice/rest/server.php`

Para volver a los datos iniciales: botón **Reset al seed** en el panel, `curl -X POST localhost:8085/admin/reset`,
o borrar `data/db.json`.

Para conectar tu aplicación, usa `http://localhost:8085` como URL de Moodle y `test-token` como token. Mientras
pruebas, deja abierta la pestaña **Log de llamadas** del panel para ver qué funciones llama tu aplicación, con qué
parámetros y qué recibe.

## Contrato

Endpoint único `/webservice/rest/server.php`. Acepta **GET con query params** y **POST `application/x-www-form-urlencoded`**
con `wstoken`, `wsfunction`, `moodlewsrestformat=json` y los parámetros de la función. Los arrays usan la notación de
Moodle/PHP: `values[0]=...`, `users[0][email]=...`, `enrolments[0][userid]=...`.

Los parámetros se validan como en Moodle: faltantes, tipos incorrectos o **claves inesperadas** dan error
(útil para detectar parámetros mal escritos en tu cliente).

### Errores

Siempre **HTTP 200** con cuerpo `{"exception", "errorcode", "message", "debuginfo"?}`. Como en Moodle 4.4+, las
excepciones del core llevan namespace:

| Caso                                  | exception                                     | errorcode         |
|---------------------------------------|-----------------------------------------------|-------------------|
| Token inválido                        | `core\exception\moodle_exception`             | `invalidtoken` (`Invalid token - token not found`) |
| Función no implementada               | `dml_missing_record_exception`                | `invalidrecord`   |
| Parámetro faltante / tipo / clave de más | `core\exception\invalid_parameter_exception` | `invalidparameter` (detalle en `debuginfo`) |
| Username o email de usuario duplicado | `core\exception\invalid_parameter_exception`  | `invalidparameter` (`Username already exists: x` / `Email address already exists: x`) |
| Shortname de curso duplicado          | `core\exception\moodle_exception`             | `shortnametaken`  |
| Idnumber de curso duplicado           | `core\exception\moodle_exception`             | `idnumbertaken`   |
| Idnumber de categoría duplicado       | `core\exception\moodle_exception`             | `categoryidnumbertaken` |
| Usuario/curso/categoría inexistente   | `dml_missing_record_exception`                | `invalidrecord`   |
| Notas de un usuario no matriculado    | `core\exception\moodle_exception`             | `notenrolled`     |

Igual que en Moodle, `core_course_update_courses` no lanza excepción por curso: devuelve el problema en `warnings`.

### Funciones implementadas

| wsfunction | Parámetros | Respuesta |
|---|---|---|
| `core_webservice_get_site_info` | — | `{ sitename, username, userid, siteurl, release, version, functions: [{name, version}], … }` |
| `core_user_get_users_by_field` | `field` = id \| idnumber \| username \| email, `values[i]` (varios a la vez) | `[{ id, username, firstname, lastname, fullname, email, idnumber, … }]` (vacío si no hay) |
| `core_user_create_users` | `users[i][username\|password\|firstname\|lastname\|email\|idnumber\|auth\|createpassword]` | `[{ id, username }]` |
| `core_course_get_categories` | `criteria[i][key\|value]` (id, ids, name, parent, idnumber, visible), `addsubcategories` | `[{ id, name, idnumber, parent, path, coursecount, … }]` |
| `core_course_create_categories` | `categories[i][name\|parent\|idnumber\|description]` | `[{ id, name }]` |
| `core_course_get_courses_by_field` | `field` = id \| ids \| shortname \| idnumber \| category (vacío = todos), `value` | `{ courses: [{ id, fullname, displayname, shortname, idnumber, categoryid, summary, visible, … }], warnings: [] }` |
| `core_course_create_courses` | `courses[i][fullname\|shortname\|categoryid\|idnumber\|summary\|visible]` | `[{ id, shortname }]` — crea también el ítem de total del curso |
| `core_course_update_courses` | `courses[i][id]` + campos | `{ warnings: [] }` |
| `enrol_manual_enrol_users` | `enrolments[i][roleid\|userid\|courseid]` (roleid 5 = estudiante) | `null` (idempotente) |
| `enrol_manual_unenrol_users` | `enrolments[i][userid\|courseid]` | `null` |
| `core_enrol_get_enrolled_users` | `courseid` | `[{ id, username, fullname, email, roles, … }]` |
| `core_enrol_get_users_courses` | `userid` | `[{ id, shortname, fullname, idnumber, … }]` |
| `gradereport_user_get_grade_items` | `courseid`, `userid` (0 = todos los estudiantes del curso) | `{ usergrades: [{ courseid, userid, userfullname, gradeitems: [...] }], warnings: [] }` |
| `gradereport_overview_get_course_grades` | `userid` | `{ grades: [{ courseid, grade, rawgrade, rank }], warnings: [] }` |

### Notas

En `gradereport_user_get_grade_items` los ítems `mod` van primero (en orden) y el total del curso
(`itemtype: "course"`, `itemname: null`) al final. Formato: `gradeformatted: "4.32"`, `percentageformatted: "86.46 %"`.
Sin nota: `graderaw: null`, `gradeformatted: "-"`.

- **Calificación para aprobar** (`gradepass`): si el ítem la tiene, `gradeformatted` lleva antes el ícono de
  Aprobado/Reprobado de Moodle (`<i class="icon fa fa-check text-success …" title="Aprobado">…</i>4.50`).
- **Ítems ocultos** (`hidden`, p.ej. participaciones): salen con `gradeishidden: true`, `weightraw: 0` y no cuentan
  en el total.
- **`weightraw`**: peso de cada ítem en el total (0–1).

Cada curso calcula el total según `gradetotal`:

| Modo | Total del curso |
|---|---|
| `standard` | Suma ponderada de los ítems visibles calificados (cada uno pesa su rango), llevada a la escala del total (0–100). |
| `scale5` | Calificación sobre 5. La nota del total es el **promedio de los ítems visibles calificados en escala 0–5**, pero el **máximo del total es la suma de los máximos de los ítems visibles** (p.ej. 9 ítems de 5 → 45). Así, Moodle muestra `4.32` y su `percentageformatted` sale `9.61 %`: la misma inconsistencia que tienen algunas instalaciones reales, útil para probar que tu cliente interpreta bien la nota. |

Si ningún ítem tiene nota, el total es `null`. Si en el panel se escribe el total a mano, queda como *override*
(`gradeisoverridden: true`) hasta que se borre. Los cursos nuevos usan el modo de `settings.defaultGradeTotal` del seed.

IDs autoincrementales por entidad como en Moodle: el curso 1 es la portada del sitio (no se expone), el usuario 1 es
`guest` y el 2 es el usuario de servicio dueño del token.

## Datos iniciales

`seed.json` se genera con `node scripts/build-seed.mjs` y trae un catálogo **ficticio** en modo `scale5`:

- **Programa de Entrenadores (demo)**: módulos 1–7 (cursos 19–25) con `idnumber` = id externo del módulo. Cada uno
  tiene taller y evaluación por unidad (1–4), examen final (sobre 5, aprueba con 3) y participaciones ocultas.
- Cohorte anterior (cursos 5, 8–13, `idnumber` `0001`…), Fútbol Sala (27–33, `M01FS`…), recuperaciones (36 vinculada,
  39–43 sin `idnumber`), un curso obligatorio (34) y cursos de prueba (50–54).
- Usuarios (contraseña `Test1234!` para los de autenticación manual):

| id | usuario | escenario |
|---|---|---|
| 2 | ws_service | dueño del token |
| 3 | est1 · Ana Gómez | aprueba los 7 módulos (≈4.5) y el curso obligatorio |
| 4 | est2 · Bruno Martínez | pierde el módulo 3 (1.75) y presenta su recuperación (4.0) |
| 5 | est3 · Carla Rodríguez | módulo 5 sin calificar |
| 6 | est4 · Diego López | aprueba solo los módulos 1 y 2 |
| 7 | est5 · Elena Pérez | no matriculada en el módulo 6; sin nota en el curso obligatorio |
| 8, 1297, 1320, 1321 | estudiantes ficticios | ids altos, como en un sitio con muchos usuarios |
| 1460 | Caso Nota 4,32 | total del módulo 2 fijado en 4.32 (el porcentaje de Moodle sale bajísimo) |

### Datos privados de tu entorno

Si tu aplicación necesita ids reales (el `idnumber` de los cursos) o usuarios reales para probar, ponlos en
`seed.private.json` y vuelve a correr `node scripts/build-seed.mjs`: se genera `seed.local.json`, que el servidor usa
en lugar de `seed.json`. **Ninguno de los dos se versiona** (están en `.gitignore`), igual que `data/`.

```json
{
  "courseIdnumbers": { "19": "id-externo-del-modulo-1" },
  "courseNames": { "34": "Nombre del curso" },
  "users": [{ "id": 8, "username": "ana@ejemplo.com", "firstname": "Ana", "lastname": "Pérez", "email": "ana@ejemplo.com" }]
}
```

## Panel de administración

`http://localhost:8085/` (HTML + JS sin framework):

- **Categorías / Cursos / Usuarios**: crear, editar y borrar. En Cursos se edita el `idnumber`.
- **Inscripciones**: matriz usuarios × cursos; marcar = matricular como estudiante.
- **Notas**: elige un curso → tabla estudiantes × ítems editable. El total se muestra calculado (en gris); si lo escribes
  queda como override. Se pueden agregar y quitar ítems de calificación.
- **Log de llamadas**: últimas 200 llamadas al web service (hora, método, wsfunction, parámetros, respuesta resumida,
  error). Clic en una fila para ver parámetros y respuesta completos. Las contraseñas y el token se enmascaran.

### API del panel (sin token)

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/admin/reset` | Vuelve al seed |
| `GET` | `/admin/state` | Estado completo |
| `PUT` | `/admin/grades` | `{ courseid, userid, itemid?, graderaw }` — sin `itemid` fija el total (override); `graderaw: null` borra |
| `GET` / `DELETE` | `/admin/log` | Ver / vaciar el log |
| `GET` | `/admin/gradebook/:courseid` | Libro de notas de un curso |
| `POST` / `PUT /:id` / `DELETE /:id` | `/admin/categories`, `/admin/courses`, `/admin/users` | CRUD (los cursos aceptan `gradetotal`) |
| `POST` / `DELETE` | `/admin/enrolments` | `{ userid, courseid, roleid? }` |
| `POST` | `/admin/courses/:id/gradeitems` | `{ itemname, itemmodule, grademax, hidden?, gradepass? }` |
| `PUT` / `DELETE` | `/admin/gradeitems/:id` | Editar (incluye `hidden`, `gradepass`) / quitar ítem |

Ejemplo para preparar un escenario desde un script:

```bash
curl -X PUT localhost:8085/admin/grades -H 'Content-Type: application/json' \
  -d '{"courseid":19,"userid":3,"graderaw":2.5}'
```

## Tests y smoke test

```bash
npm test             # vitest: errores, usuarios, cursos, matrículas, forma de las notas, cálculo del total
npm run smoke        # curl a cada función (bash; en Windows usar Git Bash)
```

Las pruebas usan datos fijos (`test/fixtures/seed-basic.json`), independientes de `seed.json`. El smoke test levanta su
propio servidor temporal en el puerto 8095, así no toca el estado del mock que tengas corriendo.
# Moodle-Mock
