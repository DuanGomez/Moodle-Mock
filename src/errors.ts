/**
 * Excepciones con la misma forma que devuelve Moodle por REST:
 * HTTP 200 + {"exception": "...", "errorcode": "...", "message": "...", "debuginfo"?: "..."}
 * Desde Moodle 4.4 las clases del core tienen namespace: "core\exception\moodle_exception".
 */
export const MOODLE_EXCEPTION = "core\\exception\\moodle_exception";
export const INVALID_PARAMETER_EXCEPTION = "core\\exception\\invalid_parameter_exception";

export class MoodleException extends Error {
  constructor(
    public readonly errorcode: string,
    message: string,
    public readonly exception = MOODLE_EXCEPTION,
    public readonly debuginfo?: string,
  ) {
    super(message);
  }

  toJSON() {
    const out: Record<string, string> = { exception: this.exception, errorcode: this.errorcode, message: this.message };
    if (this.debuginfo) out.debuginfo = this.debuginfo;
    return out;
  }
}

export const invalidToken = () => new MoodleException("invalidtoken", "Invalid token - token not found");

export const unknownFunction = () =>
  new MoodleException(
    "invalidrecord",
    "Can't find data record in database table external_functions.",
    "dml_missing_record_exception",
  );

export const invalidParameter = (debuginfo: string) =>
  new MoodleException("invalidparameter", "Invalid parameter value detected", INVALID_PARAMETER_EXCEPTION, debuginfo);

export const missingRecord = (table: string) =>
  new MoodleException("invalidrecord", `Can't find data record in database table ${table}.`, "dml_missing_record_exception");
