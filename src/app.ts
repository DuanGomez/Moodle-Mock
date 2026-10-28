import { existsSync } from "node:fs";
import express, { type NextFunction, type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { MoodleException, invalidToken, unknownFunction } from "./errors.js";
import { FUNCTIONS, type Ctx } from "./functions.js";
import { Moodle } from "./moodle.js";
import { parseMoodleParams, validate, S } from "./params.js";
import { Store } from "./store.js";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

export interface AppOptions {
  token?: string;
  /** null → estado solo en memoria (tests) */
  dbPath?: string | null;
  seedPath?: string;
  siteUrl?: string;
}

export interface LogEntry {
  id: number;
  time: string;
  method: string;
  wsfunction: string;
  params: Record<string, unknown>;
  durationMs: number;
  error: { exception: string; errorcode: string; message: string; debuginfo?: string } | null;
  summary: string;
  response: string;
}

const LOG_SIZE = 200;
const MAX_RESPONSE_CHARS = 20000;

function summarize(result: unknown): string {
  if (result === null) return "null";
  if (Array.isArray(result)) return `array(${result.length}) ${JSON.stringify(result).slice(0, 160)}`;
  const s = JSON.stringify(result);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

function redact(params: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(params, (k, v) => (k === "password" && typeof v === "string" ? "***" : k === "wstoken" ? `${String(v).slice(0, 4)}…` : v)),
  );
}

export function createApp(opts: AppOptions = {}) {
  const token = opts.token ?? "test-token";
  // Datos iniciales: seed.local.json (datos privados de tu entorno, no versionado) si existe; si no, seed.json
  const defaultSeed = existsSync(join(ROOT, "seed.local.json")) ? join(ROOT, "seed.local.json") : join(ROOT, "seed.json");
  const store = new Store(opts.seedPath ?? process.env.SEED_PATH ?? defaultSeed, opts.dbPath === undefined ? join(ROOT, "data", "db.json") : opts.dbPath);
  const moodle = new Moodle(store);
  const log: LogEntry[] = [];
  let logSeq = 0;

  const app = express();
  app.disable("x-powered-by");
  app.set("query parser", "simple");
  app.use(express.urlencoded({ extended: false, limit: "5mb" }));
  app.use(express.json({ limit: "5mb" }));

  // ------------------------------------------------------------ web service
  app.all("/webservice/rest/server.php", (req: Request, res: Response) => {
    const started = Date.now();
    const flat = { ...(req.query as Record<string, unknown>), ...(req.is("application/x-www-form-urlencoded") ? req.body : {}) };
    const params = parseMoodleParams(flat);
    const wsfunction = String(params.wsfunction ?? "");
    let result: unknown;
    let error: LogEntry["error"] = null;

    try {
      if (params.wstoken !== token) throw invalidToken();
      const fn = FUNCTIONS[wsfunction];
      if (!fn) throw unknownFunction();
      const fnParams = Object.fromEntries(
        Object.entries(params).filter(([k]) => !["wstoken", "wsfunction", "moodlewsrestformat"].includes(k) && !k.startsWith("moodlewssetting")),
      );
      const clean = validate(S.struct(fn.params), fnParams);
      const ctx: Ctx = { moodle, siteurl: opts.siteUrl ?? `${req.protocol}://${req.get("host")}`, tokenUserId: 2 };
      result = fn.handler(clean, ctx);
    } catch (e) {
      const ex =
        e instanceof MoodleException
          ? e
          : new MoodleException("generalexceptionmessage", `Error general: ${(e as Error).message}`, "coding_exception");
      if (!(e instanceof MoodleException)) console.error(e);
      error = ex.toJSON() as LogEntry["error"];
      result = error;
    }

    const body = JSON.stringify(result === undefined ? null : result);
    log.unshift({
      id: ++logSeq,
      time: new Date().toISOString(),
      method: req.method,
      wsfunction: wsfunction || "(vacío)",
      params: redact(params),
      durationMs: Date.now() - started,
      error,
      summary: error ? `${error.errorcode}: ${error.message}` : summarize(result),
      response: body.length > MAX_RESPONSE_CHARS ? `${body.slice(0, MAX_RESPONSE_CHARS)}…` : body,
    });
    if (log.length > LOG_SIZE) log.length = LOG_SIZE;

    // Moodle responde siempre 200, también con errores
    res.status(200).type("application/json").send(body);
  });

  // ------------------------------------------------------------------ admin
  const admin = express.Router();
  const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
  const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      next(e);
    }
  };

  admin.get("/state", wrap(() => store.db));
  admin.post("/reset", wrap(() => {
    store.reset();
    return { ok: true };
  }));
  admin.get("/log", wrap(() => log));
  admin.delete("/log", wrap(() => {
    log.length = 0;
    return { ok: true };
  }));

  admin.put("/grades", wrap((req) => {
    const { courseid, userid, itemid, graderaw } = req.body ?? {};
    const value = graderaw === null || graderaw === "" || graderaw === undefined ? null : Number(graderaw);
    moodle.setGrade(Number(courseid), Number(userid), num(itemid), value);
    return { ok: true, total: moodle.courseTotal(Number(courseid), Number(userid)) };
  }));

  admin.get("/gradebook/:courseid", wrap((req) => {
    const courseid = Number(req.params.courseid);
    const course = moodle.requireCourse(courseid);
    const items = moodle.modItems(courseid);
    const courseItem = moodle.courseItem(courseid);
    return {
      course,
      items,
      courseItem,
      students: moodle
        .enrolledUsers(courseid)
        .filter((u) => u.enrolment.roleid === 5)
        .map((u) => {
          const { enrolment: _e, password: _p, ...user } = u;
          return {
            user,
            grades: Object.fromEntries(items.map((it) => [it.id, moodle.rawGrade(it.id, u.id)])),
            total: moodle.courseTotal(courseid, u.id),
          };
        }),
    };
  }));

  admin.post("/categories", wrap((req) => moodle.createCategories([{ ...req.body, parent: num(req.body.parent) ?? 0 }])[0]));
  admin.put("/categories/:id", wrap((req) => moodle.updateCategory(Number(req.params.id), { ...req.body, parent: num(req.body.parent) })));
  admin.delete("/categories/:id", wrap((req) => moodle.deleteCategory(Number(req.params.id))));

  const courseBody = (b: Record<string, unknown>) => ({
    ...b,
    categoryid: num(b.categoryid),
    visible: num(b.visible),
  });
  admin.post("/courses", wrap((req) => moodle.createCourses([courseBody(req.body) as any])[0]));
  admin.put("/courses/:id", wrap((req) => moodle.updateCourse(Number(req.params.id), courseBody(req.body))));
  admin.delete("/courses/:id", wrap((req) => moodle.deleteCourse(Number(req.params.id))));

  admin.post("/courses/:id/gradeitems", wrap((req) =>
    moodle.addGradeItem(Number(req.params.id), { ...req.body, grademin: num(req.body.grademin), grademax: num(req.body.grademax) }),
  ));
  admin.put("/gradeitems/:id", wrap((req) =>
    moodle.updateGradeItem(Number(req.params.id), { ...req.body, grademin: num(req.body.grademin), grademax: num(req.body.grademax) }),
  ));
  admin.delete("/gradeitems/:id", wrap((req) => moodle.deleteGradeItem(Number(req.params.id))));

  admin.post("/users", wrap((req) => {
    const { password: _p, ...u } = moodle.createUsers([{ ...req.body, password: req.body.password || "Test1234!" }])[0];
    return u;
  }));
  admin.put("/users/:id", wrap((req) => {
    const body = { ...req.body };
    if (!body.password) delete body.password;
    const { password: _p, ...u } = moodle.updateUser(Number(req.params.id), body);
    return u;
  }));
  admin.delete("/users/:id", wrap((req) => moodle.deleteUser(Number(req.params.id))));

  admin.post("/enrolments", wrap((req) => {
    const { userid, courseid, roleid } = req.body ?? {};
    moodle.enrolUsers([{ userid: Number(userid), courseid: Number(courseid), roleid: num(roleid) ?? 5 }]);
  }));
  admin.delete("/enrolments", wrap((req) => {
    const src = { ...req.query, ...(req.body ?? {}) };
    moodle.unenrolUsers([{ userid: Number(src.userid), courseid: Number(src.courseid) }]);
  }));

  admin.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof MoodleException) {
      res.status(400).json({ error: err.debuginfo ? `${err.message}: ${err.debuginfo}` : err.message, ...err.toJSON() });
    } else {
      console.error(err);
      res.status(500).json({ error: (err as Error).message });
    }
  });
  app.use("/admin", admin);

  // ------------------------------------------------------------------ panel
  app.use(express.static(join(ROOT, "public")));

  return { app, store, moodle, log };
}
