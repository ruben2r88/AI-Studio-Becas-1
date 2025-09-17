// services/firestore.js
import { app } from "./auth.js";
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const db = getFirestore(app);
const USE_EMULATORS = location.hostname === "localhost" || location.hostname === "127.0.0.1";
if (USE_EMULATORS) {
  try {
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    console.log("Firestore → Emulator conectado en :8080");
  } catch (e) {
    console.warn("No se pudo conectar al emulador de Firestore:", e);
  }
}

export { db };

/* ==================== PERFILES ==================== */
export async function getProfile(userId) {
  const ref = doc(db, "profiles", userId);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export async function ensureProfile(userId, defaultData) {
  const ref = doc(db, "profiles", userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      ...defaultData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return { id: userId, ...defaultData };
  }
  return { id: userId, ...snap.data() };
}

export async function saveProfile(userId, data) {
  const ref = doc(db, "profiles", userId);
  await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

/* ==================== TAREAS ==================== */
// /users/{uid}/tasks/{taskId}
function tasksCol(userId) {
  return collection(db, "users", userId, "tasks");
}

export async function listTasks(userId) {
  const q = query(tasksCol(userId), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addTask(userId, data) {
  const ref = await addDoc(tasksCol(userId), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return { id: ref.id, ...data };
}

export async function updateTask(userId, id, patch) {
  const ref = doc(db, "users", userId, "tasks", id);
  await updateDoc(ref, { ...patch, updatedAt: serverTimestamp() });
}

export async function deleteTask(userId, id) {
  const ref = doc(db, "users", userId, "tasks", id);
  await deleteDoc(ref);
}
