// services/auth.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Usa tu misma configuración actual (puede llevar storageBucket .appspot.com o .firebasestorage.app)
const firebaseConfig = {
  apiKey: "AIzaSyD1OGL0kTzNwK3X-zxQz7ODlE75UNhhJ2s",
  authDomain: "eture-app-dev.firebaseapp.com",
  projectId: "eture-app-dev",
  storageBucket: "eture-app-dev.appspot.com",
  messagingSenderId: "925977867912",
  appId: "1:925977867912:web:1f071c0915114fce8c113d",
  measurementId: "G-BE1D79XGR7"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Conectar al emulador de Auth en local
const USE_EMULATORS = location.hostname === "localhost" || location.hostname === "127.0.0.1";
if (USE_EMULATORS) {
  try {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    console.log("Auth → Emulator conectado en :9099");
  } catch (e) {
    console.warn("No se pudo conectar al emulador de Auth:", e);
  }
}

/**
 * Observa el estado de autenticación y navega si hace falta.
 * @param {(user: import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js').User) => void} onUserLoggedIn
 */
export function handleAuthState(onUserLoggedIn) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      console.log("Auth Service: Usuario autenticado.", user.uid);
      onUserLoggedIn(user);
    } else {
      console.log("Auth Service: Usuario no autenticado, redirigiendo al login.");
      if (!window.location.pathname.includes("login.html")) {
        window.location.href = "login.html";
      }
    }
  });
}
