import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface User {
  id: number;
  username: string;
  password: string;
  firstname: string;
  lastname: string;
  email: string;
  idnumber: string;
  auth: string;
  suspended: number;
  timecreated: number;
  extra: Record<string, unknown>;
}

export interface Category {
  id: number;
  name: string;
  parent: number;
  idnumber: string;
  description: string;
  visible: number;
  timemodified: number;
}

export interface Course {
  id: number;
  fullname: string;
  shortname: string;
  categoryid: number;
  idnumber: string;
  summary: string;
  visible: number;
  format: string;
  startdate: number;
  enddate: number;
  timecreated: number;
  timemodified: number;
  /**
   * Cómo se calcula el total del curso:
   * - "standard" (por defecto): suma ponderada de los ítems llevada a la escala del total.
   * - "scale5": calificación sobre 5, como en instalaciones que muestran el total en escala 0-5. La nota
   *   del total es el promedio de los ítems visibles calificados, en escala 0-5, pero el máximo del total es
   *   la SUMA de los máximos de los ítems visibles (p.ej. 45 o 85). Por eso Moodle muestra "4.32" y su
   *   porcentaje sale "5.09 %" (inconsistencia real que conviene poder reproducir).
   */
  gradetotal?: "standard" | "scale5";
}

export interface Enrolment {
  userid: number;
  courseid: number;
  roleid: number;
  timestart: number;
  timeend: number;
  suspend: number;
  timecreated: number;
}

export interface GradeItem {
  id: number;
  courseid: number;
  itemname: string | null;
  itemtype: "mod" | "course";
  itemmodule: string | null;
  iteminstance: number;
  idnumber: string;
  grademin: number;
  grademax: number;
  sortorder: number;
  /** Oculto en el libro de calificaciones (p.ej. participaciones): no cuenta en el total */
  hidden?: boolean;
  /** Nota para aprobar: si se define, la nota formateada lleva el ícono de Aprobado/Reprobado */
  gradepass?: number;
}

export interface Grade {
  itemid: number;
  userid: number;
  graderaw: number | null;
  /** Solo aplica al ítem de total del curso: nota fijada a mano desde el panel */
  overridden: boolean;
  timemodified: number;
}

export interface Db {
  seq: { user: number; category: number; course: number; gradeitem: number };
  /** Configuración del sitio simulado (p.ej. cómo calculan el total los cursos nuevos) */
  settings?: { defaultGradeTotal?: "standard" | "scale5" };
  users: User[];
  categories: Category[];
  courses: Course[];
  enrolments: Enrolment[];
  gradeitems: GradeItem[];
  grades: Grade[];
}

/** Estado en memoria, persistido en un archivo JSON (dbPath = null → solo memoria, para tests). */
export class Store {
  db: Db;
  private readonly seed: Db;

  constructor(seedPath: string, private readonly dbPath: string | null) {
    this.seed = JSON.parse(readFileSync(seedPath, "utf8")) as Db;
    if (dbPath && existsSync(dbPath)) {
      this.db = JSON.parse(readFileSync(dbPath, "utf8")) as Db;
    } else {
      this.db = structuredClone(this.seed);
      this.save();
    }
  }

  reset() {
    this.db = structuredClone(this.seed);
    this.save();
  }

  nextId(entity: keyof Db["seq"]): number {
    return ++this.db.seq[entity];
  }

  save() {
    if (!this.dbPath) return;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const tmp = `${this.dbPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    renameSync(tmp, this.dbPath);
  }
}
