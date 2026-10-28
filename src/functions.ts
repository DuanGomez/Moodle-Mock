import { MoodleException, invalidParameter } from "./errors.js";
import { ROLES, type Moodle } from "./moodle.js";
import { S, type Param } from "./params.js";
import type { Category, Course, GradeItem, User } from "./store.js";

export interface Ctx {
  moodle: Moodle;
  siteurl: string;
  /** Usuario dueño del token (admin, id 2) */
  tokenUserId: number;
}

interface WsFunction {
  params: Record<string, Param>;
  handler: (p: any, ctx: Ctx) => unknown;
}

// Versión simulada: Moodle 4.5
export const RELEASE = "4.5+ (Build: 20241122)";
export const VERSION = "2024100700";

// ---------------------------------------------------------------- formatting
/** Formato de las notas: 2 decimales con punto ("4.32", "86.46 %"). */
const fmt = (n: number) => n.toFixed(2);

/** Ícono que Moodle antepone a la nota cuando el ítem tiene "Calificación para aprobar" */
const passIcon = (passed: boolean) => passed
  ? '<i class="icon fa fa-check text-success fa-fw inline"  title="Aprobado" role="img" aria-label="Aprobado"></i>'
  : '<i class="icon fa fa-times text-danger fa-fw inline"  title="Reprobado" role="img" aria-label="Reprobado"></i>';
const rawString = (n: number | null) => (n === null ? null : n.toFixed(5));

function userOut(u: User, siteurl: string) {
  return {
    id: u.id,
    username: u.username,
    firstname: u.firstname,
    lastname: u.lastname,
    fullname: `${u.firstname} ${u.lastname}`,
    email: u.email,
    department: String(u.extra?.department ?? ""),
    idnumber: u.idnumber,
    firstaccess: 0,
    lastaccess: 0,
    auth: u.auth,
    suspended: Boolean(u.suspended),
    confirmed: true,
    lang: "es",
    theme: "",
    timezone: "99",
    mailformat: 1,
    description: "",
    descriptionformat: 1,
    profileimageurlsmall: `${siteurl}/theme/image.php/boost/core/1/u/f2`,
    profileimageurl: `${siteurl}/theme/image.php/boost/core/1/u/f1`,
  };
}

function categoryOut(c: Category, ctx: Ctx) {
  const path = ctx.moodle.categoryPath(c.id);
  const siblings = ctx.moodle.db.categories.filter((x) => x.parent === c.parent).map((x) => x.id);
  return {
    id: c.id,
    name: c.name,
    idnumber: c.idnumber,
    description: c.description,
    descriptionformat: 1,
    parent: c.parent,
    sortorder: (siblings.indexOf(c.id) + 1) * 10000,
    coursecount: ctx.moodle.db.courses.filter((x) => x.categoryid === c.id).length,
    visible: c.visible,
    visibleold: c.visible,
    timemodified: c.timemodified,
    depth: path.length,
    path: "/" + path.join("/"),
    theme: "",
  };
}

function courseOut(c: Course, ctx: Ctx) {
  return {
    id: c.id,
    fullname: c.fullname,
    displayname: c.fullname,
    shortname: c.shortname,
    showactivitydates: true,
    showcompletionconditions: null,
    categoryid: c.categoryid,
    categoryname: ctx.moodle.category(c.categoryid)?.name ?? "",
    sortorder: 10000 + c.id,
    summary: c.summary,
    summaryformat: 1,
    summaryfiles: [],
    overviewfiles: [],
    contacts: [],
    enrollmentmethods: ["manual"],
    idnumber: c.idnumber,
    format: c.format,
    showgrades: 1,
    newsitems: 5,
    startdate: c.startdate,
    enddate: c.enddate,
    maxbytes: 0,
    showreports: 0,
    visible: c.visible,
    groupmode: 0,
    groupmodeforce: 0,
    defaultgroupingid: 0,
    enablecompletion: 1,
    completionnotify: 0,
    lang: "",
    theme: "",
    marker: 0,
    legacyfiles: 0,
    calendartype: "",
    timecreated: c.timecreated,
    timemodified: c.timemodified,
    requested: 0,
    cacherev: c.timemodified,
    filters: [],
    courseformatoptions: [],
  };
}

function gradeItemOut(item: GradeItem, graderaw: number | null, overridden: boolean, weight?: number) {
  const pct = graderaw === null ? null : ((graderaw - item.grademin) / (item.grademax - item.grademin)) * 100;
  const formatted = graderaw === null
    ? "-"
    : (item.gradepass ? passIcon(graderaw >= item.gradepass) : "") + fmt(graderaw);
  return {
    id: item.id,
    itemname: item.itemname,
    itemtype: item.itemtype,
    itemmodule: item.itemmodule,
    iteminstance: item.iteminstance,
    itemnumber: 0,
    idnumber: item.idnumber,
    categoryid: null,
    outcomeid: null,
    scaleid: null,
    locked: false,
    cmid: item.itemtype === "mod" ? item.id + 100 : undefined,
    graderaw,
    gradedatesubmitted: null,
    gradedategraded: graderaw === null ? null : Math.floor(Date.now() / 1000),
    gradehiddenbydate: false,
    gradeneedsupdate: false,
    gradeishidden: !!item.hidden,
    gradeislocked: false,
    gradeisoverridden: overridden,
    gradeformatted: formatted,
    grademin: item.grademin,
    grademax: item.grademax,
    rangeformatted: `${fmt(item.grademin)}&ndash;${fmt(item.grademax)}`,
    percentageformatted: pct === null ? "-" : `${fmt(pct)} %`,
    // Peso en el total (solo ítems de actividad), como weightraw de Moodle
    ...(item.itemtype === "mod" ? { weightraw: weight ?? 0 } : {}),
    feedback: "",
    feedbackformat: 0,
  };
}

// ---------------------------------------------------------------- functions
const keyValue = S.struct({ name: S.text(), value: S.text() });
const typeValue = S.struct({ type: S.text(), value: S.text() });

export const FUNCTIONS: Record<string, WsFunction> = {
  core_webservice_get_site_info: {
    params: { serviceshortnames: S.list(S.text(), { def: [] }) },
    handler: (_p, ctx) => {
      const u = ctx.moodle.requireUser(ctx.tokenUserId);
      return {
        sitename: "Moodle Mock",
        username: u.username,
        firstname: u.firstname,
        lastname: u.lastname,
        fullname: `${u.firstname} ${u.lastname}`,
        lang: "es",
        userid: u.id,
        siteurl: ctx.siteurl,
        userpictureurl: `${ctx.siteurl}/theme/image.php/boost/core/1/u/f1`,
        functions: Object.keys(FUNCTIONS).map((name) => ({ name, version: VERSION })),
        downloadfiles: 1,
        uploadfiles: 1,
        release: RELEASE,
        version: VERSION,
        mobilecssurl: "",
        advancedfeatures: [],
        usercanmanageownfiles: true,
        userquota: 0,
        usermaxuploadfilesize: -1,
        userhomepage: 1,
        userprivateaccesskey: "mock",
        siteid: 1,
        sitecalendartype: "gregorian",
        usercalendartype: "gregorian",
        userissiteadmin: true,
        theme: "boost",
      };
    },
  },

  core_user_get_users_by_field: {
    params: { field: S.text(), values: S.list(S.text()) },
    handler: (p: { field: string; values: string[] }, ctx) => {
      if (!["id", "idnumber", "username", "email"].includes(p.field)) {
        throw invalidParameter(`The search field '${p.field}' is not supported, look at the web service documentation`);
      }
      const values = p.values.map((v) => (p.field === "email" || p.field === "username" ? v.trim().toLowerCase() : v.trim()));
      return ctx.moodle.db.users
        .filter((u) => {
          if (p.field === "id") return values.includes(String(u.id));
          if (p.field === "email") return values.includes(u.email.toLowerCase());
          if (p.field === "idnumber") return u.idnumber !== "" && values.includes(u.idnumber);
          return values.includes(u.username);
        })
        .map((u) => userOut(u, ctx.siteurl));
    },
  },

  core_user_create_users: {
    params: {
      users: S.list(
        S.struct({
          createpassword: S.bool({ opt: true }),
          username: S.text(),
          auth: S.text({ def: "manual" }),
          password: S.text({ opt: true }),
          firstname: S.text(),
          lastname: S.text(),
          email: S.text(),
          maildisplay: S.int({ opt: true }),
          city: S.text({ opt: true }),
          country: S.text({ opt: true }),
          timezone: S.text({ opt: true }),
          description: S.text({ opt: true }),
          firstnamephonetic: S.text({ opt: true }),
          lastnamephonetic: S.text({ opt: true }),
          middlename: S.text({ opt: true }),
          alternatename: S.text({ opt: true }),
          interests: S.text({ opt: true }),
          idnumber: S.text({ def: "" }),
          institution: S.text({ opt: true }),
          department: S.text({ opt: true }),
          phone1: S.text({ opt: true }),
          phone2: S.text({ opt: true }),
          address: S.text({ opt: true }),
          lang: S.text({ opt: true }),
          calendartype: S.text({ opt: true }),
          theme: S.text({ opt: true }),
          mailformat: S.int({ opt: true }),
          customfields: S.list(typeValue, { opt: true }),
          preferences: S.list(typeValue, { opt: true }),
        }),
      ),
    },
    handler: (p: { users: any[] }, ctx) => {
      const core = ["createpassword", "username", "auth", "password", "firstname", "lastname", "email", "idnumber"];
      const created = ctx.moodle.createUsers(
        p.users.map((u) => ({
          ...u,
          extra: Object.fromEntries(Object.entries(u).filter(([k]) => !core.includes(k))),
        })),
      );
      return created.map((u) => ({ id: u.id, username: u.username }));
    },
  },

  core_course_get_categories: {
    params: {
      criteria: S.list(S.struct({ key: S.text(), value: S.text() }), { def: [] }),
      addsubcategories: S.bool({ def: true }),
    },
    handler: (p: { criteria: { key: string; value: string }[]; addsubcategories: boolean }, ctx) => {
      const { moodle } = ctx;
      let cats = [...moodle.db.categories];
      for (const { key, value } of p.criteria) {
        switch (key) {
          case "id":
          case "parent":
          case "visible":
            cats = cats.filter((c) => String(c[key]) === String(Number(value)));
            break;
          case "ids": {
            const ids = value.split(",").map((v) => Number(v.trim()));
            cats = cats.filter((c) => ids.includes(c.id));
            break;
          }
          case "name":
          case "idnumber":
            cats = cats.filter((c) => c[key] === value);
            break;
          case "theme":
            cats = [];
            break;
          default:
            throw invalidParameter(`The search key '${key}' is not supported, look at the web service documentation`);
        }
      }
      if (p.addsubcategories && p.criteria.length) {
        const ids = new Set(cats.map((c) => c.id));
        for (const c of [...cats]) for (const d of moodle.categoryDescendants(c.id)) ids.add(d);
        cats = moodle.db.categories.filter((c) => ids.has(c.id));
      }
      return cats.map((c) => categoryOut(c, ctx));
    },
  },

  core_course_create_categories: {
    params: {
      categories: S.list(
        S.struct({
          name: S.text(),
          parent: S.int({ def: 0 }),
          idnumber: S.text({ opt: true }),
          description: S.text({ opt: true }),
          descriptionformat: S.int({ def: 1 }),
          theme: S.text({ opt: true }),
        }),
      ),
    },
    handler: (p: { categories: any[] }, ctx) => ctx.moodle.createCategories(p.categories).map((c) => ({ id: c.id, name: c.name })),
  },

  core_course_get_courses_by_field: {
    params: { field: S.text({ def: "" }), value: S.text({ def: "" }) },
    handler: (p: { field: string; value: string }, ctx) => {
      const all = ctx.moodle.db.courses;
      let courses: Course[];
      switch (p.field) {
        case "":
          courses = [...all];
          break;
        case "id":
          courses = all.filter((c) => c.id === Number(p.value));
          break;
        case "ids": {
          const ids = p.value.split(",").map((v) => Number(v.trim()));
          courses = all.filter((c) => ids.includes(c.id));
          break;
        }
        case "shortname":
          courses = all.filter((c) => c.shortname === p.value);
          break;
        case "idnumber":
          courses = all.filter((c) => c.idnumber !== "" && c.idnumber === p.value);
          break;
        case "category":
          courses = all.filter((c) => c.categoryid === Number(p.value));
          break;
        default:
          throw invalidParameter("Invalid field name");
      }
      if (p.field && p.value === "") throw invalidParameter("When using a field you must specify a value");
      return { courses: courses.sort((a, b) => a.id - b.id).map((c) => courseOut(c, ctx)), warnings: [] };
    },
  },

  core_course_create_courses: {
    params: {
      courses: S.list(
        S.struct({
          fullname: S.text(),
          shortname: S.text(),
          categoryid: S.int(),
          idnumber: S.text({ opt: true }),
          summary: S.text({ opt: true }),
          summaryformat: S.int({ def: 1 }),
          format: S.text({ def: "topics" }),
          showgrades: S.int({ def: 1 }),
          newsitems: S.int({ def: 5 }),
          startdate: S.int({ opt: true }),
          enddate: S.int({ opt: true }),
          numsections: S.int({ opt: true }),
          maxbytes: S.int({ def: 0 }),
          showreports: S.int({ def: 0 }),
          visible: S.int({ opt: true }),
          hiddensections: S.int({ opt: true }),
          groupmode: S.int({ def: 0 }),
          groupmodeforce: S.int({ def: 0 }),
          defaultgroupingid: S.int({ def: 0 }),
          enablecompletion: S.int({ opt: true }),
          completionnotify: S.int({ opt: true }),
          lang: S.text({ opt: true }),
          forcetheme: S.text({ opt: true }),
          courseformatoptions: S.list(keyValue, { opt: true }),
          customfields: S.list(S.struct({ shortname: S.text(), value: S.text() }), { opt: true }),
        }),
      ),
    },
    handler: (p: { courses: any[] }, ctx) => ctx.moodle.createCourses(p.courses).map((c) => ({ id: c.id, shortname: c.shortname })),
  },

  core_course_update_courses: {
    params: {
      courses: S.list(
        S.struct({
          id: S.int(),
          fullname: S.text({ opt: true }),
          shortname: S.text({ opt: true }),
          categoryid: S.int({ opt: true }),
          idnumber: S.text({ opt: true }),
          summary: S.text({ opt: true }),
          summaryformat: S.int({ opt: true }),
          format: S.text({ opt: true }),
          showgrades: S.int({ opt: true }),
          newsitems: S.int({ opt: true }),
          startdate: S.int({ opt: true }),
          enddate: S.int({ opt: true }),
          numsections: S.int({ opt: true }),
          maxbytes: S.int({ opt: true }),
          showreports: S.int({ opt: true }),
          visible: S.int({ opt: true }),
          groupmode: S.int({ opt: true }),
          groupmodeforce: S.int({ opt: true }),
          defaultgroupingid: S.int({ opt: true }),
          enablecompletion: S.int({ opt: true }),
          completionnotify: S.int({ opt: true }),
          lang: S.text({ opt: true }),
          forcetheme: S.text({ opt: true }),
          courseformatoptions: S.list(keyValue, { opt: true }),
          customfields: S.list(S.struct({ shortname: S.text(), value: S.text() }), { opt: true }),
        }),
      ),
    },
    handler: (p: { courses: any[] }, ctx) => {
      const warnings: { item: string; itemid: number; warningcode: string; message: string }[] = [];
      for (const c of p.courses) {
        try {
          ctx.moodle.updateCourse(c.id, c);
        } catch (e) {
          if (!(e instanceof MoodleException)) throw e;
          warnings.push({ item: "course", itemid: c.id, warningcode: "errorcourseupdate", message: e.message });
        }
      }
      return { warnings };
    },
  },

  enrol_manual_enrol_users: {
    params: {
      enrolments: S.list(
        S.struct({
          roleid: S.int(),
          userid: S.int(),
          courseid: S.int(),
          timestart: S.int({ opt: true }),
          timeend: S.int({ opt: true }),
          suspend: S.int({ opt: true }),
        }),
      ),
    },
    handler: (p: { enrolments: any[] }, ctx) => {
      ctx.moodle.enrolUsers(p.enrolments);
      return null;
    },
  },

  enrol_manual_unenrol_users: {
    params: {
      enrolments: S.list(S.struct({ userid: S.int(), courseid: S.int(), roleid: S.int({ opt: true }) })),
    },
    handler: (p: { enrolments: any[] }, ctx) => {
      ctx.moodle.unenrolUsers(p.enrolments);
      return null;
    },
  },

  core_enrol_get_enrolled_users: {
    params: { courseid: S.int(), options: S.list(keyValue, { def: [] }) },
    handler: (p: { courseid: number }, ctx) => {
      const { moodle } = ctx;
      moodle.requireCourse(p.courseid);
      return moodle.enrolledUsers(p.courseid).map((u) => {
        const role = ROLES[u.enrolment.roleid];
        return {
          ...userOut(u, ctx.siteurl),
          roles: role ? [{ roleid: u.enrolment.roleid, name: role.name, shortname: role.shortname, sortorder: role.sortorder }] : [],
          enrolledcourses: moodle.userCourses(u.id).map((c) => ({ id: c.id, fullname: c.fullname, shortname: c.shortname })),
        };
      });
    },
  },

  core_enrol_get_users_courses: {
    params: { userid: S.int(), returnusercount: S.bool({ def: true }) },
    handler: (p: { userid: number; returnusercount: boolean }, ctx) => {
      const { moodle } = ctx;
      moodle.requireUser(p.userid);
      return moodle.userCourses(p.userid).map((c) => ({
        id: c.id,
        shortname: c.shortname,
        fullname: c.fullname,
        displayname: c.fullname,
        ...(p.returnusercount ? { enrolledusercount: moodle.enrolledUsers(c.id).length } : {}),
        idnumber: c.idnumber,
        visible: c.visible,
        summary: c.summary,
        summaryformat: 1,
        format: c.format,
        showgrades: true,
        lang: "",
        enablecompletion: true,
        completionhascriteria: false,
        completionusertracked: true,
        category: c.categoryid,
        progress: null,
        completed: false,
        startdate: c.startdate,
        enddate: c.enddate,
        marker: 0,
        lastaccess: null,
        isfavourite: false,
        hidden: false,
        overviewfiles: [],
        showactivitydates: true,
        showcompletionconditions: null,
        timemodified: c.timemodified,
      }));
    },
  },

  gradereport_user_get_grade_items: {
    params: { courseid: S.int(), userid: S.int({ def: 0 }), groupid: S.int({ def: 0 }) },
    handler: (p: { courseid: number; userid: number }, ctx) => {
      const { moodle } = ctx;
      const course = moodle.requireCourse(p.courseid);
      let users: User[];
      if (p.userid) {
        const user = moodle.requireUser(p.userid);
        if (!moodle.enrolment(user.id, course.id)) {
          throw new MoodleException("notenrolled", "The user is not enrolled in this course");
        }
        users = [user];
      } else {
        users = moodle.enrolledUsers(course.id).filter((u) => u.enrolment.roleid === 5);
      }
      const courseItem = moodle.courseItem(course.id);
      return {
        usergrades: users.map((u) => {
          const total = moodle.courseTotal(course.id, u.id);
          return {
            courseid: course.id,
            courseidnumber: course.idnumber,
            userid: u.id,
            userfullname: `${u.firstname} ${u.lastname}`,
            useridnumber: u.idnumber,
            maxdepth: 2,
            gradeitems: [
              ...moodle.modItems(course.id).map((it) => gradeItemOut(it, moodle.rawGrade(it.id, u.id), false, moodle.itemWeight(it))),
              gradeItemOut(courseItem, total.graderaw, total.overridden),
            ],
          };
        }),
        warnings: [],
      };
    },
  },

  gradereport_overview_get_course_grades: {
    params: { userid: S.int({ def: 0 }) },
    handler: (p: { userid: number }, ctx) => {
      const { moodle } = ctx;
      const userid = p.userid || ctx.tokenUserId;
      moodle.requireUser(userid);
      return {
        grades: moodle.userCourses(userid).map((c) => {
          const total = moodle.courseTotal(c.id, userid).graderaw;
          const rank = moodle.rank(c.id, userid);
          return {
            courseid: c.id,
            grade: total === null ? "-" : fmt(total),
            rawgrade: rawString(total),
            ...(rank ? { rank: rank.rank } : {}),
          };
        }),
        warnings: [],
      };
    },
  },
};
