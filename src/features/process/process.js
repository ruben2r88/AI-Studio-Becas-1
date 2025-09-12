// src/features/process/process.js
// KPIs + Pasos dinámicos para la pestaña "Mi Proceso > Overview"

import { auth } from "../../../services/auth.js";
import { listUserFiles } from "../../../services/storage.js";
import { getTasksData } from "../tasks/tasks.js";
import { profileState } from "../../state/profileState.js";

let docsCount = 0; // nº de documentos subidos del usuario (en /users/{uid}/docs)
let __processListenersBound = false; // 👈 evita duplicar listeners

// ----------------- Helpers de UI -----------------
function $(sel, root = document) { return root.querySelector(sel); }
function pctBar(p) {
  const v = Math.max(0, Math.min(100, Number(p) || 0));
  return `
    <div class="progress" style="height: 24px;">
      <div class="progress-bar bg-eture-red fw-bold" role="progressbar"
           style="width:${v}%;" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100">
        ${v}%
      </div>
    </div>`;
}

// ----------------- Cálculos -----------------
function calcTasksProgress() {
  const tasks = getTasksData();
  if (!tasks.length) return 0;
  const done = tasks.filter(t => t.status === "Completado").length;
  return Math.round((done / tasks.length) * 100);
}

function calcProfileCompleteness(p) {
  const checks = [
    !!p?.personal?.name,
    !!p?.personal?.surname,
    !!p?.personal?.birthDate,
    !!p?.personal?.nationality,
    !!p?.contact?.country,
    !!p?.athletic?.mainPosition,
    !!p?.athletic?.currentTeam,
    (Array.isArray(p?.media?.highlights) && p.media.highlights.length > 0)
  ];
  const ok = checks.filter(Boolean).length;
  return Math.round((ok / checks.length) * 100);
}

// ----------------- Render -----------------
function renderKPIs() {
  const wrap = $("#proceso-kpis");
  if (!wrap) return;

  const tasksPct   = calcTasksProgress();
  const profilePct = calcProfileCompleteness(profileState.data || {});
  const docsText   = docsCount === 0 ? "Sin documentos" :
                     docsCount === 1 ? "1 documento" : `${docsCount} documentos`;

  wrap.innerHTML = `
    <div class="col-md-6">
      <div class="card h-100 shadow-sm">
        <div class="card-body">
          <h5 class="fw-bold mb-2">Progreso de Tareas</h5>
          ${pctBar(tasksPct)}
          <small class="text-muted d-block mt-2">Basado en tus tareas de "TaskList".</small>
        </div>
      </div>
    </div>

    <div class="col-md-6">
      <div class="card h-100 shadow-sm">
        <div class="card-body">
          <h5 class="fw-bold mb-2">Completitud de Perfil</h5>
          ${pctBar(profilePct)}
          <small class="text-muted d-block mt-2">${docsText} en "Mis Documentos".</small>
        </div>
      </div>
    </div>
  `;
}

function renderSteps() {
  const list = $("#proceso-steps-list");
  if (!list) return;

  const tasksPct   = calcTasksProgress();
  const profilePct = calcProfileCompleteness(profileState.data || {});

  const steps = [
    {
      title: "1) Completar Mi Perfil",
      desc:  "Rellena datos personales, académicos y deportivos, y añade al menos 1 highlight.",
      status: profilePct >= 80 ? "Completado" : (profilePct >= 30 ? "En curso" : "Pendiente")
    },
    {
      title: "2) Subir Documentos Clave",
      desc:  "Expedientes, notas oficiales y cualquier material que apoye tu candidatura.",
      status: docsCount > 0 ? "En curso" : "Pendiente"
    },
    {
      title: "3) Preparar Promoción",
      desc:  "Define prioridades (tipo de uni, ubicación, presupuesto) en la pestaña “Mi Promoción”.",
      status: "Pendiente"
    },
    {
      title: "4) Avance de Tareas",
      desc:  "Usa TaskList para seguir cada paso y marcar progreso.",
      status: tasksPct >= 80 ? "En curso" : (tasksPct > 0 ? "En curso" : "Pendiente")
    }
  ];

  const color = s => s === "Completado" ? "success" :
                      s === "En curso"  ? "warning" : "secondary";

  list.innerHTML = steps.map(s => `
    <div class="list-group-item d-flex justify-content-between align-items-start">
      <div class="me-3">
        <div class="fw-bold">${s.title}</div>
        <small class="text-muted">${s.desc}</small>
      </div>
      <span class="badge bg-${color(s.status)}">${s.status}</span>
    </div>
  `).join("");
}

async function refreshDocsCount() {
  try {
    const uid = auth.currentUser?.uid;
    if (!uid) { docsCount = 0; renderKPIs(); renderSteps(); return; }
    const rows = await listUserFiles(uid);
    docsCount = Array.isArray(rows) ? rows.length : 0;
    renderKPIs();
    renderSteps();
  } catch {
    docsCount = 0;
    renderKPIs();
    renderSteps();
  }
}

// ----------------- Init + Suscripciones -----------------
export function initProcessFeature() {
  renderKPIs();
  renderSteps();
  refreshDocsCount(); // cuenta docs al cargar

  // Bind de listeners una sola vez
  if (!__processListenersBound) {
    __processListenersBound = true;

    // Tareas -> refrescar tarjetas/pasos
    document.addEventListener("tasks:changed", () => {
      renderKPIs();
      renderSteps();
    });

    // Perfil -> refrescar tarjetas/pasos
    document.addEventListener("profile:changed", () => {
      renderKPIs();
      renderSteps();
    });

    // Documentos -> recuento de docs y refresco
    document.addEventListener("docs:changed", () => {
      refreshDocsCount();
    });
  }
}