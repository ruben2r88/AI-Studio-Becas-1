// services/storage.js
// Compatible con tu app.js: uploadUserFile(uid, file, ...)
// Oculta "0 B", conserva fecha y borra por fullPath.
// Emulador de Storage en :9199 cuando corres en localhost.

import { app } from "./auth.js";
import {
  getStorage,
  connectStorageEmulator,
  ref,
  listAll,
  getDownloadURL,
  uploadBytesResumable,
  deleteObject,
  getMetadata,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

/* =========================
   Instancia + Emulador local
   ========================= */
export const storage = getStorage(app);

const USE_EMULATORS =
  typeof location !== "undefined" &&
  (location.hostname === "localhost" || location.hostname === "127.0.0.1");

if (USE_EMULATORS) {
  try {
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    console.log("Storage → Emulador conectado en :9199");
  } catch (e) {
    console.warn("No se pudo conectar al emulador de Storage:", e);
  }
}

/* ==============  Utilidades  ============== */
function safeSegment(v) {
  if (v == null || typeof v === "function") return "";
  let s = String(v);
  s = s.replace(/[\\\/]+/g, " ");             // sin barras
  s = s.replace(/[\0-\x1F\x7F]+/g, "");       // sin controles
  s = s.replace(/[?#[\]{}<>|`^%~]+/g, "");    // chars problemáticos
  s = s.trim();
  return s || "";
}
function joinPath(...segs) {
  return segs.map(safeSegment).filter(Boolean).join("/");
}
function userDocsPath(uid, subpath = "") {
  return joinPath("users", uid, "docs", subpath);
}

/* ===========================
   Listar archivos del usuario
   =========================== */
export async function listUserFiles(uid, subpath = "") {
  const rootRef = ref(storage, userDocsPath(uid, subpath));
  const res = await listAll(rootRef);

  const folders = res.prefixes.map((p) => ({ name: p.name, fullPath: p.fullPath }));

  const files = await Promise.all(
    res.items.map(async (itemRef) => {
      const [url, meta] = await Promise.all([
        getDownloadURL(itemRef).catch(() => null),
        getMetadata(itemRef).catch(() => null),
      ]);
      const updatedAt = meta?.updated ? new Date(meta.updated) : null;

      return {
        name: itemRef.name,
        fullPath: itemRef.fullPath,
        url,
        // guardamos el tamaño por si mañana lo quieres usar,
        // pero para la UI actual devolvemos cadena vacía (no "0 B")
        sizeBytes: meta?.size ?? null,
        sizeText: "",
        updatedAt: updatedAt ? updatedAt.toISOString() : null,
      };
    })
  );

  const out = files.slice();
  out.files = files;
  out.folders = folders;
  return out;
}

/* ===============  Subir un archivo  =============== */
/**
 * Sube a users/{uid}/docs[/carpeta]/<nombre-archivo>
 * Firmas soportadas:
 *   uploadUserFile(uid, file)
 *   uploadUserFile(uid, file, "carpeta")
 *   uploadUserFile(uid, file, onProgressFn)
 *   uploadUserFile(uid, file, { folder: "carpeta", onProgress })
 */
export function uploadUserFile(uid, file, folderOrOpts, maybeOnProgress) {
  let folder = "";
  let onProgress = undefined;

  if (typeof folderOrOpts === "string") {
    folder = folderOrOpts;
    onProgress = maybeOnProgress;
  } else if (typeof folderOrOpts === "function") {
    onProgress = folderOrOpts;
  } else if (folderOrOpts && typeof folderOrOpts === "object") {
    folder = folderOrOpts.folder || "";
    onProgress = folderOrOpts.onProgress;
  }

  const cleanFolder = safeSegment(folder);
  const cleanName = safeSegment(file?.name || "archivo");

  const objectPath = joinPath("users", uid, "docs", cleanFolder, cleanName);
  const fileRef = ref(storage, objectPath);
  const task = uploadBytesResumable(fileRef, file);

  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        if (typeof onProgress === "function") {
          const pct = snap.totalBytes
            ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100)
            : 0;
          onProgress(pct, snap);
        }
      },
      reject,
      async () => {
        const result = {
          name: fileRef.name,
          fullPath: fileRef.fullPath,
          url: await getDownloadURL(fileRef).catch(() => null),
        };

        // 👇 NUEVO: avisamos a toda la app de que cambió "Mis Documentos"
        document.dispatchEvent(new CustomEvent('docs:changed', {
          detail: { action: 'upload', path: result.fullPath }
        }));

        resolve(result);
      }
    );
  });
}

/* ==========================  Borrar por ruta  ========================== */
export async function deleteUserFile(target) {
  // target puede ser: string (fullPath), {fullPath}, {path}, o el item del listado
  const fullPath =
    typeof target === "string"
      ? target
      : (target && (target.fullPath || target.path)) || null;

  if (!fullPath) throw new Error("Ruta de archivo no válida para eliminar.");

  await deleteObject(ref(storage, fullPath));

  // 👇 NUEVO: avisamos a toda la app de que cambió "Mis Documentos"
  document.dispatchEvent(new CustomEvent('docs:changed', {
    detail: { action: 'delete', path: fullPath }
  }));

  return true;
}

export async function getFileURLByPath(fullPath) {
  return await getDownloadURL(ref(storage, fullPath));
}
