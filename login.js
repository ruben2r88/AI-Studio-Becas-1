// File: login.js — Build: 2025-11-05T19:58Z
// Mantiene Firebase Auth y el selector de área, y añade redirección a index.*.html según rol.

import { auth } from './services/auth.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ------------------------------
// Área seleccionada (US | ES | COACHES | STAFF)
// ------------------------------
function setArea(area) {
  try {
    localStorage.setItem('eture_area', area);
    sessionStorage.setItem('eture_area', area);
    console.info('[Eture] Area set to:', area);
  } catch (e) {
    console.warn('[Eture] Cannot persist area in storage:', e);
  }
}
function getArea() {
  return localStorage.getItem('eture_area') || null;
}

// A qué index.*.html enviar según el área
function indexForArea(area) {
  switch ((area || '').toUpperCase()) {
    case 'US':       return 'index.us.html';
    case 'ES':       return 'index.es.html';
    case 'COACHES':  return 'index.coaches.html';
    case 'STAFF':    return 'index.staff.html';
    default:         return 'index.us.html'; // fallback
  }
}

// ------------------------------
// UI inicial
// ------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const loginForm       = document.getElementById('login-form');
  const registerForm    = document.getElementById('register-form');
  const showRegisterBtn = document.getElementById('show-register');
  const showLoginBtn    = document.getElementById('show-login');
  const loginView       = document.getElementById('login-view');
  const registerView    = document.getElementById('register-view');
  const togglePassword  = document.getElementById('toggle-password');
  const passwordInput   = document.getElementById('login-password');

  // --- Selector de área
  const roleButtons = document.querySelectorAll('.role-btn');
  const savedArea = getArea();
  roleButtons.forEach(btn => {
    // Que ninguno esté "oscuro" por defecto; lo pone JS
    btn.classList.remove('btn-dark');
    btn.classList.add('btn-outline-dark');

    const area = btn.getAttribute('data-area');
    if (savedArea && area === savedArea) {
      btn.classList.add('active', 'btn-dark');
      btn.classList.remove('btn-outline-dark');
    }
    btn.addEventListener('click', () => {
      // Solo uno activo visualmente
      roleButtons.forEach(b => {
        b.classList.remove('active', 'btn-dark');
        b.classList.add('btn-outline-dark');
      });
      btn.classList.add('active', 'btn-dark');
      btn.classList.remove('btn-outline-dark');
      setArea(area);
    });
  });

  // Mostrar/Ocultar password
  if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', () => {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      const icon = togglePassword.querySelector('i');
      if (icon) { icon.classList.toggle('bi-eye'); icon.classList.toggle('bi-eye-slash'); }
    });
  }

  // ------------------------------
  // LOGIN (redirige por área)
  // ------------------------------
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;

      // Si el usuario no eligió, ponemos US por defecto
      let area = getArea();
      if (!area) { area = 'US'; setArea(area); }

      try {
        await signInWithEmailAndPassword(auth, email, password);
        const target = indexForArea(area);
        window.location.href = target;
      } catch (error) {
        alert("Error signing in: " + (error?.message || error));
        console.error(error);
      }
    });
  }

  // ------------------------------
  // REGISTRO (redirige por área tras crear cuenta)
  // ------------------------------
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email    = document.getElementById('register-email').value;
      const password = document.getElementById('register-password').value;

      let area = getArea();
      if (!area) { area = 'US'; setArea(area); }

      try {
        await createUserWithEmailAndPassword(auth, email, password);
        // Puedes decidir llevar al login o entrar directo. Para demo: entrar directo.
        const target = indexForArea(area);
        window.location.href = target;
      } catch (error) {
        alert("Error signing up: " + (error?.message || error));
        console.error(error);
      }
    });
  }

  // Cambiar entre vistas Login/Registro
  if (showRegisterBtn) {
    showRegisterBtn.addEventListener('click', (e) => {
      e.preventDefault();
      loginView?.classList.add('d-none');
      registerView?.classList.remove('d-none');
    });
  }
  if (showLoginBtn) {
    showLoginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      registerView?.classList.add('d-none');
      loginView?.classList.remove('d-none');
    });
  }
});

/* Notas de integración:
  1) Redirección post-login/registro basada en localStorage.eture_area.
  2) Los 4 index.*.html siguen cargando el mismo app.js (no se cambia).
  3) Fallback a US si no hay área guardada.
  4) No se toca la lógica de Firebase Auth existente.
  5) Si más adelante usas custom claims, cambia indexForArea() para leer del token en vez de localStorage.
*/
