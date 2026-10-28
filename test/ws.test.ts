import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import { INVALID_PARAMETER_EXCEPTION, MOODLE_EXCEPTION } from "../src/errors.js";

const TOKEN = "test-token";
let server: Server;
let base: string;
let mock: ReturnType<typeof createApp>;

beforeAll(async () => {
  // Datos fijos de las pruebas (independientes del seed.json del lab)
  mock = createApp({ token: TOKEN, dbPath: null, seedPath: fileURLToPath(new URL("./fixtures/seed-basic.json", import.meta.url)) });
  server = mock.app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => mock.store.reset());

/** Llamada POST form-urlencoded, como un cliente real de Moodle. */
async function ws(wsfunction: string, params: Record<string, string | number> = {}, token = TOKEN) {
  const body = new URLSearchParams({ wstoken: token, wsfunction, moodlewsrestformat: "json" });
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));
  const res = await fetch(`${base}/webservice/rest/server.php`, { method: "POST", body });
  expect(res.status).toBe(200);
  return res.json();
}

/** Llamada GET con query params, como hacen muchos clientes de Moodle. */
async function wsGet(wsfunction: string, params: Record<string, string | number> = {}) {
  const url = new URL(`${base}/webservice/rest/server.php`);
  url.searchParams.set("wstoken", TOKEN);
  url.searchParams.set("wsfunction", wsfunction);
  url.searchParams.set("moodlewsrestformat", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url);
  expect(res.status).toBe(200);
  return res.json();
}

describe("errores estilo Moodle", () => {
  it("token inválido → invalidtoken con HTTP 200", async () => {
    expect(await ws("core_webservice_get_site_info", {}, "nope")).toEqual({
      exception: MOODLE_EXCEPTION,
      errorcode: "invalidtoken",
      message: "Invalid token - token not found",
    });
  });

  it("función no implementada → invalidrecord", async () => {
    const r = await ws("core_foo_bar");
    expect(r.errorcode).toBe("invalidrecord");
    expect(r.message).toBe("Can't find data record in database table external_functions.");
  });

  it("parámetro faltante → invalid_parameter_exception", async () => {
    const r = await ws("gradereport_user_get_grade_items", { userid: 3 });
    expect(r.exception).toBe(INVALID_PARAMETER_EXCEPTION);
    expect(r.errorcode).toBe("invalidparameter");
    expect(r.debuginfo).toContain("courseid");
  });

  it("clave inesperada → invalid_parameter_exception", async () => {
    const r = await ws("core_user_get_users_by_field", { field: "email", "values[0]": "x@y.z", foo: "1" });
    expect(r.errorcode).toBe("invalidparameter");
    expect(r.debuginfo).toContain("Unexpected keys (foo)");
  });
});

describe("site info", () => {
  it("devuelve admin id 2 y la lista de funciones", async () => {
    const r = await wsGet("core_webservice_get_site_info");
    expect(r).toMatchObject({ username: "admin", userid: 2, siteurl: base });
    expect(r.functions.map((f: { name: string }) => f.name)).toContain("gradereport_user_get_grade_items");
  });
});

describe("usuarios", () => {
  it("crea y busca por email, username, id e idnumber", async () => {
    const created = await ws("core_user_create_users", {
      "users[0][username]": "nuevo",
      "users[0][password]": "Secreta1!",
      "users[0][firstname]": "Nue",
      "users[0][lastname]": "Vo",
      "users[0][email]": "Nuevo@Test.local",
      "users[0][idnumber]": "EXT-USER-9",
    });
    expect(created).toEqual([{ id: 8, username: "nuevo" }]);

    for (const [field, value] of [["email", "nuevo@test.local"], ["username", "nuevo"], ["id", "8"], ["idnumber", "EXT-USER-9"]]) {
      const found = await wsGet("core_user_get_users_by_field", { field, "values[0]": value });
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ id: 8, username: "nuevo", firstname: "Nue", lastname: "Vo", fullname: "Nue Vo", email: "Nuevo@Test.local", idnumber: "EXT-USER-9" });
    }
  });

  it("devuelve array vacío si no existe", async () => {
    expect(await wsGet("core_user_get_users_by_field", { field: "email", "values[0]": "nadie@test.local" })).toEqual([]);
  });

  it("busca varios valores a la vez", async () => {
    const r = await ws("core_user_get_users_by_field", { field: "email", "values[0]": "est1@test.local", "values[1]": "est2@test.local" });
    expect(r.map((u: { id: number }) => u.id)).toEqual([3, 4]);
  });

  it("rechaza username y email duplicados (sin crear nada)", async () => {
    const base = { "users[0][password]": "x", "users[0][firstname]": "A", "users[0][lastname]": "B" };
    const dupUser = await ws("core_user_create_users", { ...base, "users[0][username]": "est1", "users[0][email]": "otro@test.local" });
    expect(dupUser).toMatchObject({ exception: INVALID_PARAMETER_EXCEPTION, errorcode: "invalidparameter" });
    expect(dupUser.debuginfo).toContain("Username already exists: est1");

    const dupMail = await ws("core_user_create_users", { ...base, "users[0][username]": "otro", "users[0][email]": "EST1@test.local" });
    expect(dupMail.debuginfo).toContain("Email address already exists");
    expect(mock.store.db.users).toHaveLength(7);
  });

  it("exige password o createpassword", async () => {
    const r = await ws("core_user_create_users", {
      "users[0][username]": "sinpass",
      "users[0][firstname]": "A",
      "users[0][lastname]": "B",
      "users[0][email]": "sinpass@test.local",
    });
    expect(r.errorcode).toBe("invalidparameter");
    const ok = await ws("core_user_create_users", {
      "users[0][username]": "sinpass",
      "users[0][firstname]": "A",
      "users[0][lastname]": "B",
      "users[0][email]": "sinpass@test.local",
      "users[0][createpassword]": 1,
    });
    expect(ok[0].username).toBe("sinpass");
  });
});

describe("categorías y cursos", () => {
  it("crea categoría, cursos y los busca por campo", async () => {
    const [cat] = await ws("core_course_create_categories", { "categories[0][name]": "Programa Nuevo", "categories[0][idnumber]": "EXT-PROG-2" });
    expect(cat).toEqual({ id: 3, name: "Programa Nuevo" });
    expect(await ws("core_course_get_categories", { "criteria[0][key]": "idnumber", "criteria[0][value]": "EXT-PROG-2" })).toMatchObject([{ id: 3, name: "Programa Nuevo", parent: 0 }]);

    const created = await ws("core_course_create_courses", {
      "courses[0][fullname]": "Módulo A",
      "courses[0][shortname]": "NEW-A",
      "courses[0][categoryid]": 3,
      "courses[0][idnumber]": "EXT-A",
      "courses[1][fullname]": "Módulo B",
      "courses[1][shortname]": "NEW-B",
      "courses[1][categoryid]": 3,
    });
    expect(created).toEqual([{ id: 9, shortname: "NEW-A" }, { id: 10, shortname: "NEW-B" }]);

    const byIdnumber = await wsGet("core_course_get_courses_by_field", { field: "idnumber", value: "EXT-A" });
    expect(byIdnumber.warnings).toEqual([]);
    expect(byIdnumber.courses).toHaveLength(1);
    expect(byIdnumber.courses[0]).toMatchObject({ id: 9, fullname: "Módulo A", displayname: "Módulo A", shortname: "NEW-A", idnumber: "EXT-A", categoryid: 3, summary: "", visible: 1 });

    const byCat = await wsGet("core_course_get_courses_by_field", { field: "category", value: 3 });
    expect(byCat.courses.map((c: { id: number }) => c.id)).toEqual([9, 10]);
    const byIds = await wsGet("core_course_get_courses_by_field", { field: "ids", value: "9,10,2" });
    expect(byIds.courses.map((c: { id: number }) => c.id)).toEqual([2, 9, 10]);

    // cada curso nace con su ítem de total
    const items = mock.store.db.gradeitems.filter((g) => g.courseid === 9);
    expect(items).toEqual([expect.objectContaining({ itemtype: "course", grademax: 100 })]);
  });

  it("rechaza shortname e idnumber duplicados", async () => {
    const dupShort = await ws("core_course_create_courses", { "courses[0][fullname]": "X", "courses[0][shortname]": "FE-M1", "courses[0][categoryid]": 2 });
    expect(dupShort).toMatchObject({ exception: MOODLE_EXCEPTION, errorcode: "shortnametaken" });
    const dupId = await ws("core_course_create_courses", { "courses[0][fullname]": "X", "courses[0][shortname]": "X1", "courses[0][categoryid]": 2, "courses[0][idnumber]": "EXT-MOD-01" });
    expect(dupId).toMatchObject({ errorcode: "idnumbertaken" });
    const dupCat = await ws("core_course_create_categories", { "categories[0][name]": "Y", "categories[0][idnumber]": "EXT-PROG-FE" });
    expect(dupCat.errorcode).toBe("categoryidnumbertaken");
  });

  it("update_courses actualiza y devuelve warnings en conflicto", async () => {
    expect(await ws("core_course_update_courses", { "courses[0][id]": 2, "courses[0][idnumber]": "MOD-GUID-1" })).toEqual({ warnings: [] });
    expect(mock.moodle.course(2)!.idnumber).toBe("MOD-GUID-1");
    const r = await ws("core_course_update_courses", { "courses[0][id]": 3, "courses[0][shortname]": "FE-M1" });
    expect(r.warnings).toEqual([expect.objectContaining({ item: "course", itemid: 3, warningcode: "errorcourseupdate" })]);
  });
});

describe("matrículas", () => {
  it("enrol es idempotente y unenrol desmatricula", async () => {
    const params = { "enrolments[0][roleid]": 5, "enrolments[0][userid]": 7, "enrolments[0][courseid]": 7 };
    expect(await ws("enrol_manual_enrol_users", params)).toBeNull();
    expect(await ws("enrol_manual_enrol_users", params)).toBeNull();
    expect(mock.store.db.enrolments.filter((e) => e.userid === 7 && e.courseid === 7)).toHaveLength(1);

    const enrolled = await ws("core_enrol_get_enrolled_users", { courseid: 7 });
    expect(enrolled.map((u: { id: number }) => u.id)).toContain(7);
    const courses = await ws("core_enrol_get_users_courses", { userid: 7 });
    expect(courses.map((c: { id: number }) => c.id)).toContain(7);
    expect(courses[0]).toEqual(expect.objectContaining({ id: expect.any(Number), shortname: expect.any(String), fullname: expect.any(String), idnumber: expect.any(String) }));

    expect(await ws("enrol_manual_unenrol_users", { "enrolments[0][userid]": 7, "enrolments[0][courseid]": 7 })).toBeNull();
    expect(mock.moodle.enrolment(7, 7)).toBeUndefined();
  });

  it("usuario inexistente → error", async () => {
    const r = await ws("enrol_manual_enrol_users", { "enrolments[0][roleid]": 5, "enrolments[0][userid]": 999, "enrolments[0][courseid]": 2 });
    expect(r.exception).toBe("dml_missing_record_exception");
  });
});

describe("gradereport_user_get_grade_items", () => {
  it("forma exacta con notas (est1, módulo 1)", async () => {
    const r = await wsGet("gradereport_user_get_grade_items", { userid: 3, courseid: 2 });
    expect(r.warnings).toEqual([]);
    expect(r.usergrades).toHaveLength(1);
    const ug = r.usergrades[0];
    expect(ug).toMatchObject({ courseid: 2, userid: 3, userfullname: "Ana Gómez" });
    expect(ug.gradeitems).toHaveLength(3);
    expect(ug.gradeitems[0]).toMatchObject({
      id: 2, itemname: "Cuestionario Módulo 1", itemtype: "mod", itemmodule: "quiz",
      graderaw: 90, grademin: 0, grademax: 100, gradeformatted: "90.00", percentageformatted: "90.00 %",
    });
    expect(ug.gradeitems[1]).toMatchObject({ itemtype: "mod", itemmodule: "assign", graderaw: 85, gradeformatted: "85.00" });
    expect(ug.gradeitems[2]).toMatchObject({
      id: 1, itemname: null, itemtype: "course", itemmodule: null,
      graderaw: 87.5, grademin: 0, grademax: 100, gradeformatted: "87.50", percentageformatted: "87.50 %",
    });
  });

  it("sin nota → graderaw null y gradeformatted '-' (est3, módulo 5)", async () => {
    const r = await ws("gradereport_user_get_grade_items", { userid: 5, courseid: 6 });
    for (const it of r.usergrades[0].gradeitems) {
      expect(it.graderaw).toBeNull();
      expect(it.gradeformatted).toBe("-");
    }
    expect(r.usergrades[0].gradeitems.at(-1).itemtype).toBe("course");
  });

  it("no matriculado → excepción notenrolled (est5, módulo 6)", async () => {
    const r = await ws("gradereport_user_get_grade_items", { userid: 7, courseid: 7 });
    expect(r).toMatchObject({ exception: MOODLE_EXCEPTION, errorcode: "notenrolled" });
  });

  it("total = suma ponderada de ítems calificados; override manda", async () => {
    // Nuevo ítem con grademax 50 en módulo 1 para est1: (90 + 85 + 40) / (100 + 100 + 50) * 100 = 86
    const item = mock.moodle.addGradeItem(2, { itemname: "Foro", itemmodule: "forum", grademax: 50 });
    let total = async () => (await ws("gradereport_user_get_grade_items", { userid: 3, courseid: 2 })).usergrades[0].gradeitems.at(-1);
    expect((await total()).graderaw).toBe(87.5); // el ítem sin nota no cuenta

    let res = await fetch(`${base}/admin/grades`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseid: 2, userid: 3, itemid: item.id, graderaw: 40 }) });
    expect(res.status).toBe(200);
    expect((await total()).graderaw).toBe(86);

    res = await fetch(`${base}/admin/grades`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseid: 2, userid: 3, graderaw: 55.5 }) });
    expect(res.status).toBe(200);
    expect(await total()).toMatchObject({ graderaw: 55.5, gradeformatted: "55.50", gradeisoverridden: true });

    // quitar override → vuelve al cálculo
    await fetch(`${base}/admin/grades`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseid: 2, userid: 3, graderaw: null }) });
    expect((await total()).graderaw).toBe(86);
  });
});

describe("gradereport_overview_get_course_grades", () => {
  it("devuelve una nota por curso matriculado", async () => {
    const r = await wsGet("gradereport_overview_get_course_grades", { userid: 4 });
    expect(r.warnings).toEqual([]);
    expect(r.grades).toHaveLength(6);
    expect(r.grades.find((g: { courseid: number }) => g.courseid === 4)).toMatchObject({ courseid: 4, grade: "35.00", rawgrade: "35.00000", rank: 5 });
  });

  it("curso sin nota → grade '-' y rawgrade null", async () => {
    const r = await wsGet("gradereport_overview_get_course_grades", { userid: 5 });
    expect(r.grades.find((g: { courseid: number }) => g.courseid === 6)).toEqual({ courseid: 6, grade: "-", rawgrade: null });
  });
});

describe("log", () => {
  it("registra las llamadas sin exponer el token completo", async () => {
    await fetch(`${base}/admin/log`, { method: "DELETE" });
    await ws("core_user_get_users_by_field", { field: "email", "values[0]": "est1@test.local" });
    const log = await (await fetch(`${base}/admin/log`)).json();
    expect(log[0]).toMatchObject({ wsfunction: "core_user_get_users_by_field", error: null });
    expect(log[0].params.values).toEqual(["est1@test.local"]);
    expect(log[0].params.wstoken).not.toBe(TOKEN);
  });
});
