#!/usr/bin/env bash
# Smoke test: llama a cada función del web service con curl.
# Uso: bash scripts/smoke.sh
# Levanta su propio servidor temporal (puerto 8095, datos fijos de test/fixtures, base temporal), así no
# toca el estado del mock que tengas corriendo. Con BASE=... prueba contra un servidor ya levantado
# (ojo: en ese caso lo reinicia al seed antes y después).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "${BASE:-}" ]; then
  SMOKE_PORT=8095
  SMOKE_DB="$(mktemp -d)/smoke-db.json"
  (cd "$ROOT" && PORT=$SMOKE_PORT SEED_PATH="$ROOT/test/fixtures/seed-basic.json" DB_PATH="$SMOKE_DB" exec node --import tsx src/server.ts) > /dev/null 2>&1 &
  SMOKE_PID=$!
  trap 'kill $SMOKE_PID 2>/dev/null' EXIT
  BASE="http://localhost:$SMOKE_PORT"
  for _ in $(seq 1 40); do curl -s -o /dev/null "$BASE/" && break; sleep 0.5; done
fi
BASE="${BASE:-http://localhost:8085}"
TOKEN="${TOKEN:-${MOODLE_WS_TOKEN:-test-token}}"
WS="$BASE/webservice/rest/server.php"
PASS=0
FAIL=0

# call <nombre> <patrón esperado en la respuesta> <wsfunction> [params...]
call() {
  local name="$1" expect="$2" fn="$3"
  shift 3
  local args=(-s -X POST "$WS" --data-urlencode "wstoken=$TOKEN" --data-urlencode "wsfunction=$fn" --data-urlencode "moodlewsrestformat=json")
  for p in "$@"; do args+=(--data-urlencode "$p"); done
  local out
  out=$(curl "${args[@]}")
  if printf '%s' "$out" | grep -qE -- "$expect"; then
    PASS=$((PASS + 1)); printf '  \033[32mOK\033[0m   %-58s %.110s\n' "$name" "$out"
  else
    FAIL=$((FAIL + 1)); printf '  \033[31mFAIL\033[0m %-58s esperaba /%s/\n       %.400s\n' "$name" "$expect" "$out"
  fi
}

echo "Moodle mock en $BASE"
curl -s -X POST "$BASE/admin/reset" > /dev/null || { echo "No se pudo conectar a $BASE (¿está levantado? npm run dev)"; exit 1; }

echo "== Errores"
call "token inválido"                    '"errorcode":"invalidtoken"'   core_webservice_get_site_info wstoken=malo
curl -s "$WS?wstoken=malo&wsfunction=core_webservice_get_site_info&moodlewsrestformat=json" | grep -q invalidtoken \
  && { PASS=$((PASS + 1)); echo "  OK   token inválido (GET)"; } || { FAIL=$((FAIL + 1)); echo "  FAIL token inválido (GET)"; }
call "función inexistente"               '"errorcode":"invalidrecord"'  core_no_existe
call "parámetro faltante"                '"errorcode":"invalidparameter"' gradereport_user_get_grade_items userid=3

echo "== Sitio"
call "core_webservice_get_site_info"     '"userid":2'                   core_webservice_get_site_info

echo "== Usuarios"
call "get_users_by_field email (existe)" '"email":"est1@test.local"'    core_user_get_users_by_field field=email 'values[0]=est1@test.local'
call "get_users_by_field email (no)"     '^\[\]$'                       core_user_get_users_by_field field=email 'values[0]=nadie@test.local'
call "core_user_create_users"            '"username":"smoke1"'          core_user_create_users \
  'users[0][username]=smoke1' 'users[0][password]=Smoke123!' 'users[0][firstname]=Smoke' 'users[0][lastname]=Test' \
  'users[0][email]=smoke1@test.local' 'users[0][idnumber]=EXT-SMOKE-1'
call "create_users duplicado"            'Username already exists'      core_user_create_users \
  'users[0][username]=smoke1' 'users[0][password]=x' 'users[0][firstname]=A' 'users[0][lastname]=B' 'users[0][email]=otro@test.local'

echo "== Categorías y cursos"
call "core_course_get_categories"        '"name":"Programa de Entrenadores \(demo\)"' core_course_get_categories 'criteria[0][key]=idnumber' 'criteria[0][value]=EXT-PROG-FE'
call "core_course_create_categories"     '"name":"Programa Smoke"'      core_course_create_categories 'categories[0][name]=Programa Smoke' 'categories[0][idnumber]=EXT-SMOKE-PROG'
call "core_course_create_courses"        '"shortname":"SMOKE-M1"'       core_course_create_courses \
  'courses[0][fullname]=Smoke Modulo 1' 'courses[0][shortname]=SMOKE-M1' 'courses[0][categoryid]=3' 'courses[0][idnumber]=EXT-SMOKE-M1'
call "create_courses shortname duplicado" '"errorcode":"shortnametaken"' core_course_create_courses \
  'courses[0][fullname]=X' 'courses[0][shortname]=SMOKE-M1' 'courses[0][categoryid]=3'
call "get_courses_by_field idnumber"     '"idnumber":"EXT-SMOKE-M1"'     core_course_get_courses_by_field field=idnumber value=EXT-SMOKE-M1
call "get_courses_by_field category"     '"courses":\[\{"id":2'         core_course_get_courses_by_field field=category value=2
call "core_course_update_courses"        '^\{"warnings":\[\]\}$'        core_course_update_courses 'courses[0][id]=9' 'courses[0][summary]=Actualizado por smoke'

echo "== Matrículas"
call "enrol_manual_enrol_users"          '^null$'                       enrol_manual_enrol_users 'enrolments[0][roleid]=5' 'enrolments[0][userid]=8' 'enrolments[0][courseid]=9'
call "enrol_manual_enrol_users (otra vez)" '^null$'                     enrol_manual_enrol_users 'enrolments[0][roleid]=5' 'enrolments[0][userid]=8' 'enrolments[0][courseid]=9'
call "core_enrol_get_enrolled_users"     '"username":"smoke1"'          core_enrol_get_enrolled_users courseid=9
call "core_enrol_get_users_courses"      '"shortname":"SMOKE-M1"'       core_enrol_get_users_courses userid=8

echo "== Notas"
call "grade_items con nota (est1, M1)"   '"gradeformatted":"87.50"'     gradereport_user_get_grade_items userid=3 courseid=2
call "grade_items sin nota (est3, M5)"   '"graderaw":null,.*"gradeformatted":"-"' gradereport_user_get_grade_items userid=5 courseid=6
call "grade_items no matriculado"        '"errorcode":"notenrolled"'    gradereport_user_get_grade_items userid=7 courseid=7
curl -s -X PUT "$BASE/admin/grades" -H 'Content-Type: application/json' -d '{"courseid":9,"userid":8,"graderaw":72.25}' > /dev/null
call "total con override (panel)"        '"graderaw":72.25'             gradereport_user_get_grade_items userid=8 courseid=9
call "gradereport_overview_get_course_grades" '"grades":\[\{"courseid":2' gradereport_overview_get_course_grades userid=3

echo "== Desmatricular"
call "enrol_manual_unenrol_users"        '^null$'                       enrol_manual_unenrol_users 'enrolments[0][userid]=8' 'enrolments[0][courseid]=9'
call "ya no aparece matriculado"         '^\[\]$'                       core_enrol_get_users_courses userid=8

curl -s -X POST "$BASE/admin/reset" > /dev/null
echo
echo "Resultado: $PASS OK, $FAIL fallos (estado reiniciado al seed)"
[ "$FAIL" -eq 0 ]
