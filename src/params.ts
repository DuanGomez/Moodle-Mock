import { invalidParameter } from "./errors.js";

/**
 * Convierte parámetros planos con notación PHP (`users[0][email]=x`, `values[]=y`)
 * en objetos/arrays anidados, como hace PHP antes de que Moodle los valide.
 */
export function parseMoodleParams(flat: Record<string, unknown>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(flat)) {
    // Con claves repetidas PHP se queda con la última
    const value = Array.isArray(rawValue) ? rawValue[rawValue.length - 1] : rawValue;
    const m = /^([^[\]]+)((?:\[[^\]]*\])*)$/.exec(rawKey);
    if (!m) {
      root[rawKey] = value;
      continue;
    }
    const path = [m[1], ...[...m[2].matchAll(/\[([^\]]*)\]/g)].map((x) => x[1])];
    let node: Record<string, unknown> = root;
    path.forEach((segment, i) => {
      const last = i === path.length - 1;
      let key = segment;
      if (key === "") key = String(Object.keys(node).length);
      if (last) {
        node[key] = value;
      } else {
        if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
        node = node[key] as Record<string, unknown>;
      }
    });
  }
  return toArrays(root) as Record<string, unknown>;
}

function toArrays(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  for (const k of keys) obj[k] = toArrays(obj[k]);
  if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
    return keys.sort((a, b) => Number(a) - Number(b)).map((k) => obj[k]);
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Validación estilo external_api::validate_parameters
// ---------------------------------------------------------------------------

type Scalar = "int" | "float" | "text" | "bool";
interface Common {
  req: boolean;
  def?: unknown;
}
export type Param =
  | (Common & { t: Scalar })
  | (Common & { t: "struct"; fields: Record<string, Param> })
  | (Common & { t: "list"; of: Param });

type Opts = { def?: unknown; opt?: boolean };
const common = (o: Opts = {}): Common => ({ req: o.def === undefined && !o.opt, def: o.def });

export const S = {
  int: (o?: Opts): Param => ({ t: "int", ...common(o) }),
  float: (o?: Opts): Param => ({ t: "float", ...common(o) }),
  text: (o?: Opts): Param => ({ t: "text", ...common(o) }),
  bool: (o?: Opts): Param => ({ t: "bool", ...common(o) }),
  struct: (fields: Record<string, Param>, o?: Opts): Param => ({ t: "struct", fields, ...common(o) }),
  list: (of: Param, o?: Opts): Param => ({ t: "list", of, ...common(o) }),
};

export function validate(schema: Param, value: unknown, path = ""): unknown {
  const where = path ? `${path} => ` : "";
  switch (schema.t) {
    case "struct": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw invalidParameter(`${where}Only arrays accepted. The bad value is: '${String(value)}'`);
      }
      const input = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(schema.fields)) {
        if (input[key] === undefined) {
          if (sub.req) throw invalidParameter(`${where}Missing required key in single structure: ${key}`);
          if (sub.def !== undefined) out[key] = structuredClone(sub.def);
          continue;
        }
        out[key] = validate(sub, input[key], path ? `${path} => ${key}` : key);
      }
      const unexpected = Object.keys(input).filter((k) => !(k in schema.fields));
      if (unexpected.length) {
        throw invalidParameter(`${where}Unexpected keys (${unexpected.join(", ")}) detected in parameter array.`);
      }
      return out;
    }
    case "list": {
      if (value === "" ) return [];
      if (!Array.isArray(value)) {
        throw invalidParameter(`${where}Only arrays accepted. The bad value is: '${String(value)}'`);
      }
      return value.map((v, i) => validate(schema.of, v, path ? `${path} => ${i}` : String(i)));
    }
    default: {
      if (typeof value === "object" && value !== null) {
        throw invalidParameter(`${where}Invalid external api parameter: the value is an array, the server was expecting "${schema.t}" type`);
      }
      const s = String(value).trim();
      const bad = () =>
        invalidParameter(`${where}Invalid external api parameter: the value is "${s}", the server was expecting "${schema.t === "text" ? "raw" : schema.t}" type`);
      if (schema.t === "int") {
        if (!/^-?\d+$/.test(s)) throw bad();
        return Number(s);
      }
      if (schema.t === "float") {
        if (s === "" || Number.isNaN(Number(s))) throw bad();
        return Number(s);
      }
      if (schema.t === "bool") {
        if (["1", "true"].includes(s.toLowerCase())) return true;
        if (["0", "false", ""].includes(s.toLowerCase())) return false;
        throw bad();
      }
      return String(value);
    }
  }
}
