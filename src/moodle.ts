import { MoodleException, invalidParameter, missingRecord } from "./errors.js";
import type { Category, Course, Enrolment, GradeItem, Store, User } from "./store.js";

export const ROLES: Record<number, { shortname: string; name: string; sortorder: number }> = {
  1: { shortname: "manager", name: "Gestor", sortorder: 1 },
  3: { shortname: "editingteacher", name: "Profesor", sortorder: 3 },
  4: { shortname: "teacher", name: "Profesor sin permiso de edición", sortorder: 4 },
  5: { shortname: "student", name: "Estudiante", sortorder: 5 },
};
export const STUDENT_ROLE = 5;

const now = () => Math.floor(Date.now() / 1000);
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

export interface NewUser {
  username: string;
  password?: string;
  createpassword?: boolean;
  firstname: string;
  lastname: string;
  email: string;
  idnumber?: string;
  auth?: string;
  extra?: Record<string, unknown>;
}

export interface NewCategory {
  name: string;
  parent?: number;
  idnumber?: string;
  description?: string;
}

export interface CourseFields {
  fullname?: string;
  shortname?: string;
  categoryid?: number;
  idnumber?: string;
  summary?: string;
  visible?: number;
  format?: string;
  startdate?: number;
  enddate?: number;
  gradetotal?: "standard" | "scale5";
}

/** Lógica de dominio compartida por el web service y el panel de administración. */
export class Moodle {
  constructor(readonly store: Store) {}

  get db() {
    return this.store.db;
  }

  // ------------------------------------------------------------------ lookups
  user(id: number) {
    return this.db.users.find((u) => u.id === id);
  }
  requireUser(id: number): User {
    const u = this.user(id);
    if (!u) throw missingRecord("user");
    return u;
  }
  category(id: number) {
    return this.db.categories.find((c) => c.id === id);
  }
  requireCategory(id: number): Category {
    const c = this.category(id);
    if (!c) throw missingRecord("course_categories");
    return c;
  }
  course(id: number) {
    return this.db.courses.find((c) => c.id === id);
  }
  requireCourse(id: number): Course {
    const c = this.course(id);
    if (!c) throw missingRecord("course");
    return c;
  }
  enrolment(userid: number, courseid: number) {
    return this.db.enrolments.find((e) => e.userid === userid && e.courseid === courseid);
  }

  // -------------------------------------------------------------------- users
  /** Valida y crea varios usuarios de forma transaccional (todo o nada), como core_user_create_users. */
  createUsers(inputs: NewUser[]): User[] {
    const usernames = new Set(this.db.users.map((u) => u.username));
    const emails = new Set(this.db.users.map((u) => u.email.toLowerCase()));
    for (const u of inputs) {
      if (u.username !== u.username.toLowerCase() || !/^[a-z0-9_.@-]+$/.test(u.username)) {
        throw invalidParameter(`Invalid external api parameter: the value is "${u.username}", the server was expecting "username" type`);
      }
      if (usernames.has(u.username)) throw invalidParameter(`Username already exists: ${u.username}`);
      if (!EMAIL_RE.test(u.email)) throw invalidParameter(`Email address is invalid: ${u.email}`);
      if (emails.has(u.email.toLowerCase())) throw invalidParameter(`Email address already exists: ${u.email}`);
      if (!u.createpassword && !u.password && (u.auth ?? "manual") === "manual") {
        throw invalidParameter("Invalid password: you must provide a password, or set createpassword.");
      }
      usernames.add(u.username);
      emails.add(u.email.toLowerCase());
    }
    const created = inputs.map((u) => {
      const user: User = {
        id: this.store.nextId("user"),
        username: u.username,
        password: u.password ?? "",
        firstname: u.firstname,
        lastname: u.lastname,
        email: u.email,
        idnumber: u.idnumber ?? "",
        auth: u.auth ?? "manual",
        suspended: 0,
        timecreated: now(),
        extra: u.extra ?? {},
      };
      this.db.users.push(user);
      return user;
    });
    this.store.save();
    return created;
  }

  updateUser(id: number, fields: Partial<NewUser>) {
    const user = this.requireUser(id);
    if (fields.username !== undefined && fields.username !== user.username) {
      if (this.db.users.some((u) => u.username === fields.username)) throw invalidParameter(`Username already exists: ${fields.username}`);
    }
    if (fields.email !== undefined && fields.email.toLowerCase() !== user.email.toLowerCase()) {
      if (!EMAIL_RE.test(fields.email)) throw invalidParameter(`Email address is invalid: ${fields.email}`);
      if (this.db.users.some((u) => u.email.toLowerCase() === fields.email!.toLowerCase())) {
        throw invalidParameter(`Email address already exists: ${fields.email}`);
      }
    }
    for (const k of ["username", "password", "firstname", "lastname", "email", "idnumber", "auth"] as const) {
      if (fields[k] !== undefined) user[k] = fields[k] as string;
    }
    this.store.save();
    return user;
  }

  deleteUser(id: number) {
    this.requireUser(id);
    this.db.users = this.db.users.filter((u) => u.id !== id);
    this.db.enrolments = this.db.enrolments.filter((e) => e.userid !== id);
    this.db.grades = this.db.grades.filter((g) => g.userid !== id);
    this.store.save();
  }

  // --------------------------------------------------------------- categories
  createCategories(inputs: NewCategory[]): Category[] {
    const idnumbers = new Set(this.db.categories.map((c) => c.idnumber).filter(Boolean));
    for (const c of inputs) {
      if (!c.name.trim()) throw new MoodleException("categorynamerequired", "A category name is required.");
      if (c.parent) this.requireCategory(c.parent);
      if (c.idnumber) {
        if (idnumbers.has(c.idnumber)) throw new MoodleException("categoryidnumbertaken", "ID number is already used for another category");
        idnumbers.add(c.idnumber);
      }
    }
    const created = inputs.map((c) => {
      const cat: Category = {
        id: this.store.nextId("category"),
        name: c.name,
        parent: c.parent ?? 0,
        idnumber: c.idnumber ?? "",
        description: c.description ?? "",
        visible: 1,
        timemodified: now(),
      };
      this.db.categories.push(cat);
      return cat;
    });
    this.store.save();
    return created;
  }

  updateCategory(id: number, fields: Partial<NewCategory>) {
    const cat = this.requireCategory(id);
    if (fields.idnumber && fields.idnumber !== cat.idnumber && this.db.categories.some((c) => c.idnumber === fields.idnumber)) {
      throw new MoodleException("categoryidnumbertaken", "ID number is already used for another category");
    }
    if (fields.parent !== undefined && fields.parent !== 0) {
      this.requireCategory(fields.parent);
      if (this.categoryDescendants(id).includes(fields.parent) || fields.parent === id) {
        throw new MoodleException("cannotmovecategory", "You cannot move this category into itself or a subcategory");
      }
    }
    if (fields.name !== undefined) cat.name = fields.name;
    if (fields.parent !== undefined) cat.parent = fields.parent;
    if (fields.idnumber !== undefined) cat.idnumber = fields.idnumber;
    if (fields.description !== undefined) cat.description = fields.description;
    cat.timemodified = now();
    this.store.save();
    return cat;
  }

  deleteCategory(id: number) {
    this.requireCategory(id);
    if (this.db.courses.some((c) => c.categoryid === id) || this.db.categories.some((c) => c.parent === id)) {
      throw new MoodleException("categorynotempty", "La categoría tiene cursos o subcategorías");
    }
    this.db.categories = this.db.categories.filter((c) => c.id !== id);
    this.store.save();
  }

  categoryDescendants(id: number): number[] {
    const children = this.db.categories.filter((c) => c.parent === id).map((c) => c.id);
    return children.flatMap((c) => [c, ...this.categoryDescendants(c)]);
  }

  categoryPath(id: number): number[] {
    const path: number[] = [];
    let cat = this.category(id);
    while (cat) {
      path.unshift(cat.id);
      cat = cat.parent ? this.category(cat.parent) : undefined;
    }
    return path;
  }

  // ------------------------------------------------------------------ courses
  private checkCourseUnique(fields: CourseFields, excludeId?: number) {
    const others = this.db.courses.filter((c) => c.id !== excludeId);
    if (fields.shortname !== undefined && others.some((c) => c.shortname === fields.shortname)) {
      throw new MoodleException("shortnametaken", `Short name is already used for another course (${fields.shortname})`);
    }
    if (fields.idnumber && others.some((c) => c.idnumber === fields.idnumber)) {
      throw new MoodleException("idnumbertaken", `ID number is already used for another course (${fields.idnumber})`);
    }
  }

  /** Crea varios cursos de forma transaccional; cada curso nace con su ítem de total (grademax 100). */
  createCourses(inputs: (CourseFields & { fullname: string; shortname: string; categoryid: number })[]): Course[] {
    const snapshot = structuredClone(this.db);
    try {
      const created = inputs.map((input) => {
        this.requireCategory(input.categoryid);
        if (!input.fullname.trim()) throw invalidParameter("Invalid fullname");
        if (!input.shortname.trim()) throw invalidParameter("Invalid shortname");
        this.checkCourseUnique(input);
        const course: Course = {
          id: this.store.nextId("course"),
          fullname: input.fullname,
          shortname: input.shortname,
          categoryid: input.categoryid,
          idnumber: input.idnumber ?? "",
          summary: input.summary ?? "",
          visible: input.visible ?? 1,
          format: input.format ?? "topics",
          startdate: input.startdate ?? now(),
          enddate: input.enddate ?? 0,
          timecreated: now(),
          timemodified: now(),
          // Los cursos nuevos usan el cálculo de notas que defina el seed (settings.defaultGradeTotal)
          gradetotal: input.gradetotal ?? this.db.settings?.defaultGradeTotal ?? "standard",
        };
        this.db.courses.push(course);
        this.db.gradeitems.push({
          id: this.store.nextId("gradeitem"),
          courseid: course.id,
          itemname: null,
          itemtype: "course",
          itemmodule: null,
          iteminstance: course.id,
          idnumber: "",
          grademin: 0,
          grademax: 100,
          sortorder: 1,
        });
        return course;
      });
      this.store.save();
      return created;
    } catch (e) {
      this.store.db = snapshot;
      throw e;
    }
  }

  updateCourse(id: number, fields: CourseFields): Course {
    const course = this.requireCourse(id);
    if (fields.categoryid !== undefined) this.requireCategory(fields.categoryid);
    if (fields.fullname !== undefined && !fields.fullname.trim()) throw invalidParameter("Invalid fullname");
    if (fields.shortname !== undefined && !fields.shortname.trim()) throw invalidParameter("Invalid shortname");
    this.checkCourseUnique(fields, id);
    for (const k of ["fullname", "shortname", "categoryid", "idnumber", "summary", "visible", "format", "startdate", "enddate", "gradetotal"] as const) {
      if (fields[k] !== undefined) (course as unknown as Record<string, unknown>)[k] = fields[k];
    }
    course.timemodified = now();
    this.store.save();
    return course;
  }

  deleteCourse(id: number) {
    this.requireCourse(id);
    const itemIds = new Set(this.db.gradeitems.filter((g) => g.courseid === id).map((g) => g.id));
    this.db.courses = this.db.courses.filter((c) => c.id !== id);
    this.db.enrolments = this.db.enrolments.filter((e) => e.courseid !== id);
    this.db.gradeitems = this.db.gradeitems.filter((g) => g.courseid !== id);
    this.db.grades = this.db.grades.filter((g) => !itemIds.has(g.itemid));
    this.store.save();
  }

  // --------------------------------------------------------------- enrolments
  enrolUsers(inputs: { roleid: number; userid: number; courseid: number; timestart?: number; timeend?: number; suspend?: number }[]) {
    for (const e of inputs) {
      if (!ROLES[e.roleid]) {
        throw new MoodleException(
          "wsusercannotassign",
          `You don't have the permission to assign this role (${e.roleid}) to this user (${e.userid}) in this course(${e.courseid}).`,
        );
      }
      this.requireCourse(e.courseid);
      this.requireUser(e.userid);
    }
    for (const e of inputs) {
      const existing = this.enrolment(e.userid, e.courseid);
      const fields = { roleid: e.roleid, timestart: e.timestart ?? 0, timeend: e.timeend ?? 0, suspend: e.suspend ?? 0 };
      if (existing) Object.assign(existing, fields);
      else this.db.enrolments.push({ userid: e.userid, courseid: e.courseid, ...fields, timecreated: now() });
    }
    this.store.save();
  }

  unenrolUsers(inputs: { userid: number; courseid: number }[]) {
    for (const e of inputs) {
      this.requireCourse(e.courseid);
      this.requireUser(e.userid);
    }
    this.db.enrolments = this.db.enrolments.filter((e) => !inputs.some((i) => i.userid === e.userid && i.courseid === e.courseid));
    this.store.save();
  }

  enrolledUsers(courseid: number): (User & { enrolment: Enrolment })[] {
    return this.db.enrolments
      .filter((e) => e.courseid === courseid)
      .map((e) => ({ ...this.user(e.userid)!, enrolment: e }))
      .filter((u) => u.id !== undefined)
      .sort((a, b) => a.id - b.id);
  }

  userCourses(userid: number): Course[] {
    return this.db.enrolments
      .filter((e) => e.userid === userid)
      .map((e) => this.course(e.courseid)!)
      .filter(Boolean)
      .sort((a, b) => a.id - b.id);
  }

  // ------------------------------------------------------------------- grades
  courseItem(courseid: number): GradeItem {
    let item = this.db.gradeitems.find((g) => g.courseid === courseid && g.itemtype === "course");
    if (!item) {
      item = { id: this.store.nextId("gradeitem"), courseid, itemname: null, itemtype: "course", itemmodule: null, iteminstance: courseid, idnumber: "", grademin: 0, grademax: 100, sortorder: 1 };
      this.db.gradeitems.push(item);
      this.store.save();
    }
    // Modo "scale5": el máximo del total es la suma de los máximos de los ítems visibles
    // (p.ej. 9 ítems de 5 → 45), aunque la nota del total se muestre sobre 5
    if (this.isScale5Course(courseid)) {
      const sum = this.modItems(courseid).filter((it) => !it.hidden).reduce((acc, it) => acc + (it.grademax - it.grademin), 0);
      if (sum > 0) item.grademax = sum;
    }
    return item;
  }

  /** Curso calificado sobre 5 con total "suma" (ver Course.gradetotal) */
  isScale5Course(courseid: number): boolean {
    return this.course(courseid)?.gradetotal === "scale5";
  }

  /**
   * Peso del ítem en el total (weightraw de Moodle, 0-1). Los ocultos no cuentan. En modo "scale5" todos los
   * visibles pesan igual; en el estándar, según su rango.
   */
  itemWeight(item: GradeItem): number {
    if (item.itemtype !== "mod" || item.hidden) return 0;
    const visible = this.modItems(item.courseid).filter((it) => !it.hidden);
    if (this.isScale5Course(item.courseid)) return visible.length ? 1 / visible.length : 0;
    const total = visible.reduce((acc, it) => acc + (it.grademax - it.grademin), 0);
    return total ? (item.grademax - item.grademin) / total : 0;
  }

  modItems(courseid: number): GradeItem[] {
    return this.db.gradeitems.filter((g) => g.courseid === courseid && g.itemtype === "mod").sort((a, b) => a.sortorder - b.sortorder || a.id - b.id);
  }

  addGradeItem(courseid: number, input: { itemname: string; itemmodule?: string; grademin?: number; grademax?: number; idnumber?: string; hidden?: boolean; gradepass?: number }) {
    this.requireCourse(courseid);
    this.courseItem(courseid);
    const grademin = input.grademin ?? 0;
    // En los cursos "scale5" se califica sobre 5
    const grademax = input.grademax ?? (this.isScale5Course(courseid) ? 5 : 100);
    if (!(grademax > grademin)) throw invalidParameter("grademax debe ser mayor que grademin");
    const sortorder = Math.max(0, ...this.db.gradeitems.filter((g) => g.courseid === courseid).map((g) => g.sortorder)) + 1;
    const id = this.store.nextId("gradeitem");
    const item: GradeItem = {
      id,
      courseid,
      itemname: input.itemname,
      itemtype: "mod",
      itemmodule: input.itemmodule || "assign",
      iteminstance: id,
      idnumber: input.idnumber ?? "",
      grademin,
      grademax,
      sortorder,
      ...(input.hidden ? { hidden: true } : {}),
      ...(input.gradepass ? { gradepass: input.gradepass } : this.isScale5Course(courseid) ? { gradepass: 3 } : {}),
    };
    this.db.gradeitems.push(item);
    this.store.save();
    return item;
  }

  updateGradeItem(id: number, fields: { itemname?: string; itemmodule?: string; grademin?: number; grademax?: number; hidden?: boolean; gradepass?: number }) {
    const item = this.db.gradeitems.find((g) => g.id === id);
    if (!item) throw missingRecord("grade_items");
    if (fields.itemname !== undefined && item.itemtype === "mod") item.itemname = fields.itemname;
    if (fields.itemmodule !== undefined && item.itemtype === "mod") item.itemmodule = fields.itemmodule;
    if (fields.grademin !== undefined) item.grademin = fields.grademin;
    if (fields.grademax !== undefined) item.grademax = fields.grademax;
    if (fields.hidden !== undefined && item.itemtype === "mod") item.hidden = !!fields.hidden;
    if (fields.gradepass !== undefined) item.gradepass = fields.gradepass || undefined;
    this.store.save();
    return item;
  }

  deleteGradeItem(id: number) {
    const item = this.db.gradeitems.find((g) => g.id === id);
    if (!item) throw missingRecord("grade_items");
    if (item.itemtype === "course") throw new MoodleException("cannotdeletecourseitem", "No se puede borrar el total del curso");
    this.db.gradeitems = this.db.gradeitems.filter((g) => g.id !== id);
    this.db.grades = this.db.grades.filter((g) => g.itemid !== id);
    this.store.save();
  }

  rawGrade(itemid: number, userid: number): number | null {
    return this.db.grades.find((g) => g.itemid === itemid && g.userid === userid)?.graderaw ?? null;
  }

  /**
   * Total del curso: suma ponderada simple de los ítems `mod` calificados
   * (cada ítem pesa su rango grademax - grademin; los ítems sin nota no cuentan),
   * escalada al rango del ítem de total. Si hay override manual, manda el override.
   */
  courseTotal(courseid: number, userid: number): { graderaw: number | null; overridden: boolean } {
    const item = this.courseItem(courseid);
    const override = this.db.grades.find((g) => g.itemid === item.id && g.userid === userid && g.overridden);
    if (override) return { graderaw: override.graderaw, overridden: true };

    // Modo "scale5": promedio de los ítems visibles calificados, en escala 0-5 (aunque el máximo del total sea la suma)
    if (this.isScale5Course(courseid)) {
      const normalized = this.modItems(courseid)
        .filter((it) => !it.hidden)
        .map((it) => ({ it, g: this.rawGrade(it.id, userid) }))
        .filter((x): x is { it: GradeItem; g: number } => x.g !== null)
        .map(({ it, g }) => (g - it.grademin) / (it.grademax - it.grademin));
      if (normalized.length === 0) return { graderaw: null, overridden: false };
      const value = (normalized.reduce((a, b) => a + b, 0) / normalized.length) * 5;
      return { graderaw: Math.round(value * 100000) / 100000, overridden: false };
    }

    let sum = 0;
    let range = 0;
    for (const it of this.modItems(courseid)) {
      if (it.hidden) continue;
      const g = this.rawGrade(it.id, userid);
      if (g === null) continue;
      sum += g - it.grademin;
      range += it.grademax - it.grademin;
    }
    if (range === 0) return { graderaw: null, overridden: false };
    const value = item.grademin + (sum / range) * (item.grademax - item.grademin);
    return { graderaw: Math.round(value * 100000) / 100000, overridden: false };
  }

  /** Fija una nota. Sin itemid → override del total del curso. graderaw null → borra la nota/override. */
  setGrade(courseid: number, userid: number, itemid: number | undefined, graderaw: number | null) {
    this.requireCourse(courseid);
    this.requireUser(userid);
    if (!this.enrolment(userid, courseid)) throw new MoodleException("notenrolled", "El usuario no está matriculado en este curso");
    const item = itemid === undefined ? this.courseItem(courseid) : this.db.gradeitems.find((g) => g.id === itemid && g.courseid === courseid);
    if (!item) throw missingRecord("grade_items");
    if (graderaw !== null && (Number.isNaN(graderaw) || graderaw < item.grademin || graderaw > item.grademax)) {
      throw invalidParameter(`La nota debe estar entre ${item.grademin} y ${item.grademax}`);
    }
    this.db.grades = this.db.grades.filter((g) => !(g.itemid === item.id && g.userid === userid));
    if (graderaw !== null) {
      this.db.grades.push({ itemid: item.id, userid, graderaw, overridden: item.itemtype === "course", timemodified: now() });
    }
    this.store.save();
  }

  /** Posición del usuario en el curso según el total (1 = mejor). */
  rank(courseid: number, userid: number): { rank: number; count: number } | null {
    const mine = this.courseTotal(courseid, userid).graderaw;
    if (mine === null) return null;
    const totals = this.enrolledUsers(courseid)
      .filter((u) => u.enrolment.roleid === STUDENT_ROLE)
      .map((u) => this.courseTotal(courseid, u.id).graderaw)
      .filter((g): g is number => g !== null);
    return { rank: totals.filter((t) => t > mine).length + 1, count: totals.length };
  }
}
