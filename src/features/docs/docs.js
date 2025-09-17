// src/features/docs/docs.js
import { auth } from "../../../services/auth.js";
import { listUserFiles, uploadUserFile, deleteUserFile } from "../../../services/storage.js";

/** Renderiza la lista de archivos (fecha SÍ, tamaño NO) */
function renderDocsList(files = []) {
  const list = document.getElementById("docs-list");
  if (!list) return;

  if (!files.length) {
    list.innerHTML = `<div class="alert alert-info mb-0">Aún no has subido documentos.</div>`;
    return;
  }

  list.innerHTML = `
    <div class="list-group">
      ${files
        .map((f) => {
          const when = f?.updatedAt
            ? new Date(f.updatedAt)
            : (f?.timeCreated ? new Date(f.timeCreated) : new Date());
          const dateText = when.toLocaleString("es-ES");
          return `
            <div class="list-group-item d-flex align-items-center justify-content-between">
              <div class="me-3 text-truncate" style="max-width: 60%;">
                <a href="${f.url}" target="_blank"
                   class="text-decoration-none fw-bold text-truncate d-inline-block"
                   title="${f.name}">
                  ${f.name}
                </a>
              </div>
              <div class="small text-muted d-none d-md-block me-3">${dateText}</div>
              <button class="btn btn-sm btn-outline-danger doc-delete-btn" data-path="${f.fullPath}">
                Eliminar
              </button>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

/** Descarga y pinta la lista del usuario actual */
async function refreshDocsList() {
  const user = auth.currentUser;
  if (!user) {
    renderDocsList([]);
    return;
  }
  const rows = await listUserFiles(user.uid);
  renderDocsList(rows);
}

/** Sube el archivo seleccionado mostrando la barra de progreso */
async function handleUpload() {
  const user = auth.currentUser;
  if (!user) return alert("Debes estar autenticado.");
  const fileInput = document.getElementById("doc-file-input");
  const uploadBtn = document.getElementById("doc-upload-btn");
  const progressWrap = document.getElementById("doc-progress-wrap");
  const progressBar = document.getElementById("doc-upload-progress");

  const file = fileInput?.files?.[0];
  if (!file) return alert("Selecciona un archivo primero.");

  uploadBtn.disabled = true;
  fileInput.disabled = true;
  progressWrap.classList.remove("d-none");
  progressBar.style.width = "0%";
  progressBar.textContent = "0%";

  try {
    await uploadUserFile(user.uid, file, (pct) => {
      progressBar.style.width = pct + "%";
      progressBar.textContent = pct + "%";
    });
    fileInput.value = "";
    await refreshDocsList();
  } catch (e) {
    console.error(e);
    alert("No se pudo subir el archivo.");
  } finally {
    uploadBtn.disabled = false;
    fileInput.disabled = false;
    setTimeout(() => {
      progressWrap.classList.add("d-none");
      progressBar.style.width = "0%";
      progressBar.textContent = "0%";
    }, 400);
  }
}

/** Engancha eventos (idempotente) y hace la primera carga */
export async function initDocsFeature() {
  const card = document.getElementById("docs-card");
  if (!card) return;

  // Evitar enganchar dos veces
  if (!card.dataset.bound) {
    card.dataset.bound = "1";

    // Subir
    const uploadBtn = document.getElementById("doc-upload-btn");
    uploadBtn?.addEventListener("click", handleUpload);

    // Eliminar (delegación en la tarjeta)
    card.addEventListener("click", async (e) => {
      const btn = e.target.closest(".doc-delete-btn");
      if (!btn) return;

      const path = btn.dataset.path;
      if (!path) return;

      if (!confirm("¿Eliminar este archivo?")) return;

      try {
        await deleteUserFile(path);
        await refreshDocsList();
      } catch (err) {
        console.error(err);
        alert("No se pudo eliminar el archivo.");
      }
    });
  }

  // Primera carga
  await refreshDocsList();
}
