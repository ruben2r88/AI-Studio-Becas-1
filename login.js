// File: login.js — Build: 2025-09-05T12:45Z

// Importamos el 'auth' ya inicializado desde nuestro servicio central
import { auth } from './services/auth.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const showRegisterBtn = document.getElementById('show-register');
  const showLoginBtn = document.getElementById('show-login');
  const loginView = document.getElementById('login-view');
  const registerView = document.getElementById('register-view');
  const togglePassword = document.getElementById('toggle-password');
  const passwordInput = document.getElementById('login-password');

  if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', () => {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      const icon = togglePassword.querySelector('i');
      if (icon) { icon.classList.toggle('bi-eye'); icon.classList.toggle('bi-eye-slash'); }
    });
  }

  // INICIO DE SESIÓN
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = 'index.html';
      } catch (error) {
        alert("Error signing in: " + (error?.message || error));
        console.error(error);
      }
    });
  }

  // REGISTRO
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('register-email').value;
      const password = document.getElementById('register-password').value;
      try {
        await createUserWithEmailAndPassword(auth, email, password);
        alert("Registration successful! Please sign in.");
        if (showLoginBtn) showLoginBtn.click();
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

/* Integration notes:
1) Este archivo ya NO hace initializeApp: evita el error "Firebase App named '[DEFAULT]' already exists".
2) La ruta de import es relativa al proyecto actual: './services/auth.js'.
3) login.html already loads <script type="module" src="login.js">, so imports work.
4) If we switch to a REST backend, only services/auth.js needs updating; this stays the same.
5) If you see CORS or rules errors, review Firestore Rules and the local domain.
*/
