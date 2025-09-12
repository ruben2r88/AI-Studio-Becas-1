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
        alert("Error al iniciar sesión: " + (error?.message || error));
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
        alert("¡Registro exitoso! Inicia sesión.");
        if (showLoginBtn) showLoginBtn.click();
      } catch (error) {
        alert("Error al registrarse: " + (error?.message || error));
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
1) Este archivo ya NO hace initializeApp: evita el error "Firebase App named '[DEFAULT]' already exists".
2) La ruta de import es relativa al proyecto actual: './services/auth.js'.
3) login.html ya carga <script type="module" src="login.js">, así que los imports funcionan.
4) Si cambiamos a backend REST, solo tocaríamos services/auth.js y esto seguiría igual.
5) Si ves errores de CORS o de reglas, revisa Firestore Rules y el dominio local.
*/
