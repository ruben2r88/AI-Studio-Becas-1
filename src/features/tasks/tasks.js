/* src/features/tasks/tasks.js */
import { auth } from "../../../services/auth.js";
import {
  listTasks,
  addTask as addTaskSvc,
  updateTask as updateTaskSvc,
  deleteTask as deleteTaskSvc,
} from "../../../services/firestore.js";

// ---- Estado compartido hacia fuera (Inicio) ----
let tasksCache = [];
export function getTasksData() {
  // copia defensiva
  return Array.isArray(tasksCache) ? tasksCache.slice() : [];
}
function setTasksCache(next) {
  tasksCache = Array.isArray(next) ? next : [];
  // avisamos a toda la app
  document.dispatchEvent(new CustomEvent('tasks:changed', { detail: tasksCache }));
}

// 👇 NUEVO: precarga la caché de tareas al iniciar sesión
export async function preloadTasks(uid) {
  try {
    const rows = uid ? await listTasks(uid) : [];
    setTasksCache(rows);             // ← llena la caché y emite 'tasks:changed'
  } catch (err) {
    console.error('preloadTasks:', err);
    setTasksCache([]);               // ← deja la caché vacía pero coherente
  }
}

let state = {
  tasks: [],
  filter: { status: "All", keyword: "" },
};

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function calcProgress(tasks = []) {
  if (!tasks.length) return 0;
  const done = tasks.filter(t => t.status === "Completado").length;
  return Math.round((done / tasks.length) * 100);
}

function taskItemHTML(task) {
  const isCompleted = task.status === "Completado";
  const statusColors = { "Completado": "success", "En Progreso": "warning", "Pendiente": "secondary" };
  const statusLabels = { "Completado": "Completed", "En Progreso": "In Progress", "Pendiente": "Pending" };
  const statusColor = statusColors[task.status] || "secondary";
  const statusLabel = statusLabels[task.status] || task.status;

  return `
    <div class="accordion-item task-item" id="task-item-${task.id}">
      <h2 class="accordion-header" id="task-header-${task.id}">
        <button class="accordion-button collapsed d-flex gap-3" type="button"
                data-bs-toggle="collapse" data-bs-target="#task-collapse-${task.id}">
          <input class="form-check-input task-complete-checkbox" type="checkbox"
                 ${isCompleted ? "checked" : ""} data-task-id="${task.id}">
          <span class="fw-bold flex-grow-1 ${isCompleted ? "text-decoration-line-through text-muted" : ""}">
            ${task.title}
          </span>
          <span class="badge bg-${statusColor}">${statusLabel}</span>
        </button>
      </h2>
      <div id="task-collapse-${task.id}" class="accordion-collapse collapse" data-bs-parent="#task-list-accordion">
        <div class="accordion-body">
          ${task.description ? `<p>${task.description}</p>` : ""}
          <hr>
          <div class="mb-2">
            <label class="form-label small fw-bold">Notes</label>
            <textarea class="form-control form-control-sm task-notes" rows="2"
                      data-task-id="${task.id}" placeholder="Add your notes here...">${task.notes || ""}</textarea>
          </div>

          <div class="d-flex justify-content-between align-items-center">
            <div class="d-flex align-items-center gap-2">
              <label class="form-label small fw-bold mb-0">Status:</label>
              <select class="form-select form-select-sm d-inline-block task-status-select"
                      data-task-id="${task.id}">
                <option value="Pendiente" ${task.status === "Pendiente" ? "selected" : ""}>Pending</option>
                <option value="En Progreso" ${task.status === "En Progreso" ? "selected" : ""}>In Progress</option>
                <option value="Completado" ${task.status === "Completado" ? "selected" : ""}>Completed</option>
              </select>
            </div>

            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-primary save-task-btn" data-task-id="${task.id}">Save</button>
              <button class="btn btn-sm btn-outline-secondary edit-task-btn" data-task-id="${task.id}">Edit</button>
              <button class="btn btn-sm btn-outline-danger delete-task-btn" data-task-id="${task.id}">Delete</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function applyFilters(tasks) {
  let rows = tasks.slice();
  const { status, keyword } = state.filter;
  if (status && status !== "All") rows = rows.filter(t => t.status === status);
  if (keyword) {
    const k = keyword.toLowerCase();
    rows = rows.filter(t =>
      (t.title || "").toLowerCase().includes(k) ||
      (t.description || "").toLowerCase().includes(k) ||
      (t.notes || "").toLowerCase().includes(k)
    );
  }
  return rows;
}

function renderList() {
  const cont = $("#task-list-accordion");
  if (!cont) return;

  const filtered = applyFilters(state.tasks);

  if (filtered.length === 0) {
    cont.innerHTML = `<div class="alert alert-info">No tasks match the filters.</div>`;
  } else {
    cont.innerHTML = filtered.map(taskItemHTML).join("");
  }

  // progreso
  const pct = calcProgress(state.tasks);
  const bar = $("#task-progress-bar");
  if (bar) {
    bar.style.width = pct + "%";
    bar.textContent = pct + "%";
    bar.setAttribute("aria-valuenow", pct);
  }
}

function wireToolbar() {
  const filterGroup = $("#task-status-filter");
  if (filterGroup && !filterGroup.dataset.bound) {
    filterGroup.dataset.bound = "1";
    filterGroup.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-status]");
      if (!btn) return;
      filterGroup.querySelectorAll("button[data-status]").forEach(b => {
        b.classList.remove("btn-eture-red");
        b.classList.add("btn-outline-secondary");
      });
      btn.classList.add("btn-eture-red");
      btn.classList.remove("btn-outline-secondary");
      state.filter.status = btn.dataset.status || "All";
      renderList();
    });
  }

  const search = $("#task-keyword-filter");
  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    search.addEventListener("input", () => {
      state.filter.keyword = search.value || "";
      renderList();
    });
  }

  const addBtn = $("#add-task-btn");
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = "1";
    addBtn.addEventListener("click", () => openCreateModal());
  }
}

function wireListDelegation() {
  const wrap = $("#task-list-accordion");
  if (!wrap || wrap.dataset.bound) return;
  wrap.dataset.bound = "1";

  wrap.addEventListener("click", async (e) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const del = e.target.closest(".delete-task-btn");
    if (del) {
      const id = del.dataset.taskId;
      if (confirm("Are you sure you want to delete this task?")) {
        await deleteTaskSvc(uid, id);
        state.tasks = state.tasks.filter(t => String(t.id) !== String(id));
        setTasksCache(state.tasks);
        renderList();
      }
      return;
    }

    const edit = e.target.closest(".edit-task-btn");
    if (edit) {
      const id = edit.dataset.taskId;
      openEditModal(id);
      return;
    }

    const save = e.target.closest(".save-task-btn");
    if (save) {
      const id = save.dataset.taskId;
      const item = document.getElementById(`task-item-${id}`);
      const notes = item.querySelector(".task-notes")?.value || "";
      const status = item.querySelector(".task-status-select")?.value || "Pendiente";
      await updateTaskSvc(uid, id, { notes, status });
      // refrescamos la copia local
      const i = state.tasks.findIndex(t => String(t.id) === String(id));
      if (i !== -1) state.tasks[i] = { ...state.tasks[i], notes, status };
      setTasksCache(state.tasks);
      renderList(); // “Aceptar” guarda y cierra
    }

    const chk = e.target.closest(".task-complete-checkbox");
    if (chk) {
      const id = chk.dataset.taskId;
      const status = chk.checked ? "Completado" : "Pendiente";
      await updateTaskSvc(uid, id, { status });
      const i = state.tasks.findIndex(t => String(t.id) === String(id));
      if (i !== -1) state.tasks[i].status = status;
      setTasksCache(state.tasks);
      renderList();
      return;
    }
  });

  wrap.addEventListener("change", (e) => {
    const sel = e.target.closest(".task-status-select");
    if (!sel) return;
    const id = sel.dataset.taskId;
    const i = state.tasks.findIndex(t => String(t.id) === String(id));
    if (i !== -1) state.tasks[i].status = sel.value; // sólo memoria; se guarda con “Aceptar”
  });

  wrap.addEventListener("input", (e) => {
    const ta = e.target.closest(".task-notes");
    if (!ta) return;
    const id = ta.dataset.taskId;
    const i = state.tasks.findIndex(t => String(t.id) === String(id));
    if (i !== -1) state.tasks[i].notes = ta.value; // memoria
  });
}

function getModalRefs() {
  const modalEl = document.getElementById("task-modal");
  const form = modalEl?.querySelector("#task-form");
  return {
    modalEl,
    form,
    titleInput: modalEl?.querySelector("#task-title-input"),
    descInput:  modalEl?.querySelector("#task-desc-input"),
    notesInput: modalEl?.querySelector("#task-notes-input"),
    statusInput: modalEl?.querySelector("#task-status-input"),
    bs: modalEl ? bootstrap.Modal.getOrCreateInstance(modalEl) : null,
  };
}

function openCreateModal() {
  const { form, titleInput, descInput, notesInput, statusInput, bs } = getModalRefs();
  if (!form || !bs) return;
  form.dataset.mode = "create";
  form.dataset.taskId = "";
  if (titleInput) titleInput.value = "";
  if (descInput)  descInput.value = "";
  if (notesInput) notesInput.value = "";
  if (statusInput) statusInput.value = "Pendiente";
  const titleEl = form.querySelector(".modal-title");
  if (titleEl) titleEl.textContent = "New Task";
  bs.show();
}

function openEditModal(taskId) {
  const t = state.tasks.find(x => String(x.id) === String(taskId));
  const { form, titleInput, descInput, notesInput, statusInput, bs } = getModalRefs();
  if (!t || !form || !bs) return;
  form.dataset.mode = "edit";
  form.dataset.taskId = String(taskId);
  if (titleInput) titleInput.value = t.title || "";
  if (descInput)  descInput.value  = t.description || "";
  if (notesInput) notesInput.value = t.notes || "";
  if (statusInput) statusInput.value = t.status || "Pendiente";
  const titleEl = form.querySelector(".modal-title");
  if (titleEl) titleEl.textContent = "Edit Task";
  bs.show();
}

function wireModal() {
  const { form, titleInput, descInput, notesInput, statusInput, bs } = getModalRefs();
  if (!form || !bs) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const uid = auth.currentUser?.uid;
    if (!uid) return alert("You must sign in.");

    const payload = {
      title: (titleInput?.value || "").trim(),
      description: (descInput?.value || "").trim(),
      notes: (notesInput?.value || "").trim(),
      status: statusInput?.value || "Pendiente",
    };
    if (!payload.title) return alert("Title is required.");

    try {
      if (form.dataset.mode === "edit" && form.dataset.taskId) {
        const id = form.dataset.taskId;
        await updateTaskSvc(uid, id, payload);
        const i = state.tasks.findIndex(t => String(t.id) === String(id));
        if (i !== -1) state.tasks[i] = { ...state.tasks[i], ...payload };
        setTasksCache(state.tasks);
      } else {
        const created = await addTaskSvc(uid, payload);
        state.tasks.unshift(created);
        setTasksCache(state.tasks);
      }
      bs.hide();
      renderList();
    } catch (err) {
      console.error(err);
      alert("Could not save the task.");
    }
  });
}

export async function initTasksFeature() {
  // 1) Enlazar UI
  wireToolbar();
  wireListDelegation();
  wireModal();

  // 2) Cargar tareas del usuario
  const uid = auth.currentUser?.uid;
  state.tasks = uid ? await listTasks(uid) : [];
  setTasksCache(state.tasks);   // <- avisa a INICIO
  renderList();                 // <- pinta la lista actual
}
