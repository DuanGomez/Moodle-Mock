"use strict";

// ------------------------------------------------------------------ helpers
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let state = null;

async function api(method, path, body) {
  const res = await fetch(`/admin${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `show${isError ? " err" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), isError ? 5000 : 2000);
}

async function run(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    await refresh();
  } catch (e) {
    toast(e.message, true);
  }
}

const formData = (form) => Object.fromEntries(new FormData(form).entries());
const catName = (id) => state.categories.find((c) => c.id === id)?.name ?? (id === 0 ? "—" : `#${id}`);
const userName = (u) => `${u.firstname} ${u.lastname}`;

function fillForm(form, obj, title) {
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") el.checked = Boolean(obj[el.name]);
    else el.value = obj[el.name] ?? "";
  }
  form.querySelector("h3").textContent = title;
}

function resetForm(form, title) {
  form.reset();
  form.elements.id.value = "";
  form.querySelector("h3").textContent = title;
}

// --------------------------------------------------------------------- tabs
const TABS = ["categories", "courses", "users", "enrolments", "grades", "log"];
function showTab(name) {
  if (!TABS.includes(name)) name = "categories";
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("active", s.id === `tab-${name}`));
  try { localStorage.setItem("moodle-mock-tab", name); } catch {}
  if (name === "log") loadLog();
}
document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

$("#reset").addEventListener("click", () => {
  if (confirm("¿Volver a los datos semilla? Se pierden todos los cambios.")) run(() => api("POST", "/reset"), "Estado reiniciado");
});

// --------------------------------------------------------------- categories
function renderCategories() {
  $("#cat-rows").innerHTML = state.categories
    .map((c) => `<tr>
      <td>${c.id}</td><td>${esc(c.name)}</td><td>${esc(catName(c.parent))}</td><td><code>${esc(c.idnumber)}</code></td>
      <td>${state.courses.filter((x) => x.categoryid === c.id).length}</td>
      <td><button class="link" data-edit="${c.id}">Editar</button><button class="link del" data-del="${c.id}">Borrar</button></td>
    </tr>`)
    .join("");
  const sel = $("#cat-form").elements.parent;
  const cur = sel.value;
  sel.innerHTML = `<option value="0">— (raíz)</option>` + state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  sel.value = cur || "0";
}
$("#cat-rows").addEventListener("click", (e) => {
  const edit = e.target.dataset.edit, del = e.target.dataset.del;
  if (edit) fillForm($("#cat-form"), state.categories.find((c) => c.id == edit), `Editar categoría #${edit}`);
  if (del && confirm("¿Borrar categoría?")) run(() => api("DELETE", `/categories/${del}`), "Categoría borrada");
});
$("#cat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = formData(e.target);
  const { id, ...body } = f;
  run(async () => {
    await api(id ? "PUT" : "POST", id ? `/categories/${id}` : "/categories", body);
    resetForm(e.target, "Nueva categoría");
  }, "Categoría guardada");
});
$("#cat-form [data-cancel]").addEventListener("click", () => resetForm($("#cat-form"), "Nueva categoría"));

// ------------------------------------------------------------------ courses
function renderCourses() {
  $("#course-rows").innerHTML = state.courses
    .map((c) => `<tr>
      <td>${c.id}</td><td>${esc(c.fullname)}</td><td><code>${esc(c.shortname)}</code></td><td><code>${esc(c.idnumber)}</code></td>
      <td>${esc(catName(c.categoryid))}</td><td>${c.visible ? "Sí" : "No"}</td>
      <td><button class="link" data-edit="${c.id}">Editar</button><button class="link" data-grades="${c.id}">Notas</button><button class="link del" data-del="${c.id}">Borrar</button></td>
    </tr>`)
    .join("");
  const sel = $("#course-form").elements.categoryid;
  const cur = sel.value;
  sel.innerHTML = state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  if (cur) sel.value = cur;
}
$("#course-rows").addEventListener("click", (e) => {
  const { edit, del, grades } = e.target.dataset;
  if (edit) fillForm($("#course-form"), state.courses.find((c) => c.id == edit), `Editar curso #${edit}`);
  if (grades) { $("#grade-course").value = grades; loadGradebook(); showTab("grades"); }
  if (del && confirm("¿Borrar curso con sus inscripciones y notas?")) run(() => api("DELETE", `/courses/${del}`), "Curso borrado");
});
$("#course-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const { id, ...body } = formData(e.target);
  body.visible = e.target.elements.visible.checked ? 1 : 0;
  run(async () => {
    await api(id ? "PUT" : "POST", id ? `/courses/${id}` : "/courses", body);
    resetForm(e.target, "Nuevo curso");
  }, "Curso guardado");
});
$("#course-form [data-cancel]").addEventListener("click", () => resetForm($("#course-form"), "Nuevo curso"));

// -------------------------------------------------------------------- users
function renderUsers() {
  $("#user-rows").innerHTML = state.users
    .map((u) => `<tr>
      <td>${u.id}</td><td><code>${esc(u.username)}</code></td><td>${esc(userName(u))}</td><td>${esc(u.email)}</td><td><code>${esc(u.idnumber)}</code></td>
      <td>${state.enrolments.filter((e) => e.userid === u.id).length}</td>
      <td><button class="link" data-edit="${u.id}">Editar</button>${u.id > 2 ? `<button class="link del" data-del="${u.id}">Borrar</button>` : ""}</td>
    </tr>`)
    .join("");
}
$("#user-rows").addEventListener("click", (e) => {
  const { edit, del } = e.target.dataset;
  if (edit) fillForm($("#user-form"), { ...state.users.find((u) => u.id == edit), password: "" }, `Editar usuario #${edit}`);
  if (del && confirm("¿Borrar usuario con sus inscripciones y notas?")) run(() => api("DELETE", `/users/${del}`), "Usuario borrado");
});
$("#user-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const { id, ...body } = formData(e.target);
  run(async () => {
    await api(id ? "PUT" : "POST", id ? `/users/${id}` : "/users", body);
    resetForm(e.target, "Nuevo usuario");
  }, "Usuario guardado");
});
$("#user-form [data-cancel]").addEventListener("click", () => resetForm($("#user-form"), "Nuevo usuario"));

// --------------------------------------------------------------- enrolments
function renderEnrolments() {
  const catSel = $("#enrol-cat");
  const cur = catSel.value;
  catSel.innerHTML = `<option value="">Todas</option>` + state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  catSel.value = cur;
  const courses = state.courses.filter((c) => !catSel.value || c.categoryid == catSel.value);
  const users = state.users.filter((u) => u.id > 1);
  const roleOf = (u, c) => state.enrolments.find((e) => e.userid === u.id && e.courseid === c.id)?.roleid;
  $("#enrol-matrix").innerHTML =
    `<thead><tr><th>Usuario</th>${courses.map((c) => `<th class="rot" title="${esc(c.fullname)}">${esc(c.shortname)} · #${c.id}</th>`).join("")}</tr></thead><tbody>` +
    users
      .map((u) => `<tr><td>${esc(userName(u))} <span class="muted">#${u.id} · ${esc(u.email)}</span></td>${courses
        .map((c) => {
          const r = roleOf(u, c);
          return `<td><input type="checkbox" data-u="${u.id}" data-c="${c.id}" ${r ? "checked" : ""} title="${r && r !== 5 ? `rol ${r}` : ""}"></td>`;
        })
        .join("")}</tr>`)
      .join("") +
    "</tbody>";
}
$("#enrol-cat").addEventListener("change", renderEnrolments);
$("#enrol-matrix").addEventListener("change", (e) => {
  const { u, c } = e.target.dataset;
  if (!u) return;
  const body = { userid: Number(u), courseid: Number(c), roleid: 5 };
  run(() => (e.target.checked ? api("POST", "/enrolments", body) : api("DELETE", "/enrolments", body)), e.target.checked ? "Matriculado" : "Desmatriculado");
});

// ------------------------------------------------------------------- grades
function renderGradeCourseSelect() {
  const sel = $("#grade-course");
  const cur = sel.value;
  sel.innerHTML = state.courses.map((c) => `<option value="${c.id}">#${c.id} · ${esc(c.fullname)}</option>`).join("");
  if (cur && state.courses.some((c) => c.id == cur)) sel.value = cur;
}
const fmtNum = (n) => (n === null || n === undefined ? "" : String(Math.round(n * 100) / 100));

async function loadGradebook() {
  const courseid = $("#grade-course").value;
  if (!courseid) { $("#grade-table").innerHTML = ""; return; }
  try {
    const gb = await api("GET", `/gradebook/${courseid}`);
    const head = `<thead><tr><th>Estudiante</th>${gb.items
      .map((it) => `<th>${esc(it.itemname)} <button class="link del" data-delitem="${it.id}" title="Quitar ítem">✕</button><br><span class="meta">${esc(it.itemmodule)} · id ${it.id} · máx ${it.grademax}</span></th>`)
      .join("")}<th>Total del curso<br><span class="meta">id ${gb.courseItem.id} · máx ${gb.courseItem.grademax}</span></th><th></th></tr></thead>`;
    const rows = gb.students
      .map((s) => `<tr><td>${esc(userName(s.user))} <span class="muted">#${s.user.id}</span></td>${gb.items
        .map((it) => `<td><input type="number" step="any" min="${it.grademin}" max="${it.grademax}" value="${fmtNum(s.grades[it.id])}" data-u="${s.user.id}" data-item="${it.id}" data-orig="${fmtNum(s.grades[it.id])}"></td>`)
        .join("")}<td class="total"><input type="number" step="any" class="${s.total.overridden ? "override" : ""}" value="${s.total.overridden ? fmtNum(s.total.graderaw) : ""}" placeholder="${s.total.overridden ? "" : fmtNum(s.total.graderaw) || "-"}" data-u="${s.user.id}" data-total="1" data-orig="${s.total.overridden ? fmtNum(s.total.graderaw) : ""}" title="${s.total.overridden ? "Override manual" : "Calculado"}"></td>
        <td>${s.total.overridden ? `<button class="link" data-clear="${s.user.id}">Quitar override</button>` : `<span class="muted">calculado</span>`}</td></tr>`)
      .join("");
    $("#grade-table").innerHTML = head + `<tbody>${rows || `<tr><td colspan="99" class="muted">No hay estudiantes matriculados</td></tr>`}</tbody>`;
  } catch (e) {
    toast(e.message, true);
  }
}
$("#grade-course").addEventListener("change", loadGradebook);

async function saveGrade(input) {
  if (input.value === input.dataset.orig) return;
  const body = { courseid: Number($("#grade-course").value), userid: Number(input.dataset.u), graderaw: input.value === "" ? null : Number(input.value) };
  if (input.dataset.item) body.itemid = Number(input.dataset.item);
  try {
    await api("PUT", "/grades", body);
    toast("Nota guardada");
    await loadGradebook();
  } catch (e) {
    toast(e.message, true);
    input.value = input.dataset.orig;
  }
}
$("#grade-table").addEventListener("change", (e) => { if (e.target.matches("input")) saveGrade(e.target); });
$("#grade-table").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input")) e.target.blur(); });
$("#grade-table").addEventListener("click", (e) => {
  const { delitem, clear } = e.target.dataset;
  if (delitem && confirm("¿Quitar este ítem de calificación y sus notas?")) {
    api("DELETE", `/gradeitems/${delitem}`).then(() => { toast("Ítem eliminado"); loadGradebook(); }, (err) => toast(err.message, true));
  }
  if (clear) {
    api("PUT", "/grades", { courseid: Number($("#grade-course").value), userid: Number(clear), graderaw: null })
      .then(() => { toast("Override quitado"); loadGradebook(); }, (err) => toast(err.message, true));
  }
});
$("#item-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const body = formData(e.target);
  api("POST", `/courses/${$("#grade-course").value}/gradeitems`, body).then(
    () => { toast("Ítem agregado"); e.target.reset(); loadGradebook(); },
    (err) => toast(err.message, true),
  );
});

// ---------------------------------------------------------------------- log
let logTimer;
async function loadLog() {
  try {
    const entries = await api("GET", "/log");
    const onlyErr = $("#log-errors").checked;
    const open = new Set([...document.querySelectorAll("#log-rows tr.detail")].map((r) => r.dataset.id));
    $("#log-rows").innerHTML = entries
      .filter((e) => !onlyErr || e.error)
      .map((e) => {
        const t = new Date(e.time);
        const params = { ...e.params };
        delete params.wstoken; delete params.wsfunction; delete params.moodlewsrestformat;
        return `<tr class="${e.error ? "err" : ""}" data-id="${e.id}">
          <td title="${esc(e.time)}">${t.toLocaleTimeString()}</td><td>${e.method}</td>
          <td><code>${esc(e.wsfunction)}</code></td>
          <td class="clip" data-toggle="${e.id}">${esc(JSON.stringify(params))}</td>
          <td class="clip" data-toggle="${e.id}">${e.error ? `<span class="badge err">${esc(e.error.errorcode)}</span> ` : `<span class="badge ok">ok</span> `}${esc(e.summary)}</td>
          <td>${e.durationMs}</td></tr>
          <tr class="detail" data-id="${e.id}" ${open.has(String(e.id)) ? "" : "hidden"}><td colspan="6">
            <b>Parámetros</b><pre>${esc(JSON.stringify(e.params, null, 2))}</pre>
            <b>Respuesta</b><pre>${esc(prettyJson(e.response))}</pre></td></tr>`;
      })
      .join("") || `<tr><td colspan="6" class="muted">Sin llamadas todavía</td></tr>`;
  } catch (e) {
    toast(e.message, true);
  }
}
const prettyJson = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };
$("#log-rows").addEventListener("click", (e) => {
  const id = e.target.closest("[data-toggle]")?.dataset.toggle;
  if (!id) return;
  const row = $(`#log-rows tr.detail[data-id="${id}"]`);
  row.hidden = !row.hidden;
});
$("#log-refresh").addEventListener("click", loadLog);
$("#log-errors").addEventListener("change", loadLog);
$("#log-clear").addEventListener("click", () => api("DELETE", "/log").then(loadLog));
logTimer = setInterval(() => {
  if ($("#log-auto").checked && $("#tab-log").classList.contains("active")) loadLog();
}, 2000);

// -------------------------------------------------------------------- init
async function refresh() {
  state = await api("GET", "/state");
  renderCategories();
  renderCourses();
  renderUsers();
  renderEnrolments();
  renderGradeCourseSelect();
  await loadGradebook();
}

(async () => {
  let tab = "categories";
  try { tab = localStorage.getItem("moodle-mock-tab") || tab; } catch {}
  await refresh().catch((e) => toast(e.message, true));
  showTab(tab);
})();
