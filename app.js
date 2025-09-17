// Este es el cerebro de tu aplicación. 
// Aquí están todas las variables, funciones y lógica que hacen que tu app funcione.
// app.js - NUEVAS LÍNEAS AL PRINCIPIO
// NUEVA LÍNEA AL PRINCIPIO
/* ===== IMPORTS (bloque único) ===== */
import { app, auth, handleAuthState } from './services/auth.js';
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  db,
  getProfile,
  ensureProfile,
  saveProfile,
  listTasks,
  addTask as addTaskSvc,
  updateTask as updateTaskSvc,
  deleteTask as deleteTaskSvc
} from './services/firestore.js';

import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { countries } from './src/constants/countries.js';
import { footballPositions } from './src/constants/footballPositions.js';
import { profileState, emptyProfileData } from './src/state/profileState.js';
import { uploadUserFile, listUserFiles, deleteUserFile } from './services/storage.js';
import { renderAcademicHistory, readAcademicHistoryFromUI } from './src/features/profile/academicHistory.js';
import { renderTeamHistory, readTeamHistoryFromUI } from './src/features/profile/athleticHistory.js';
import { initTasksFeature, getTasksData, preloadTasks } from "./src/features/tasks/tasks.js";
import { initProcessFeature } from "./src/features/process/process.js";
import { initDocsFeature } from "./src/features/docs/docs.js";
import { initProfileFeature } from "./src/features/profile/profile.js";


/* ===== FIN IMPORTS ===== */
      
let editingMultimediaElement = null;
let editingSocialLinkIndex = null;

// === Seguimiento de tareas completadas ya volcadas al timeline ===
const processedDoneTaskIds = new Set();

function isTaskDone(status) {
  const s = (status || '').toString().toLowerCase();
  return s === 'completado' || s === 'completed' || s === 'done' || s === 'hecho';
}

function inferActionType(task) {
  const inTitle = (task.title || '').toLowerCase();
  if ((task.meta && task.meta.actionType)) return task.meta.actionType; // si lo guardamos al crear
  if (inTitle.includes('llamada')) return 'Llamada';
  if (inTitle.includes('email') || inTitle.includes('correo')) return 'Email';
  if (inTitle.includes('reunión') || inTitle.includes('meeting')) return 'Reunión';
  if (inTitle.includes('mensaje') || inTitle.includes('dm')) return 'Mensaje';
  return 'Acción';
}

// --- HELPERS ---
function toISODate(dateString) { // DD/MM/YYYY -> YYYY-MM-DD
    if (!dateString || !/^\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4}$/.test(dateString)) return '';
    const parts = dateString.replace(/\s/g, '').split('/');
    return `${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`;
}
function toSpanishDate(dateString) { // YYYY-MM-DD -> DD/MM/YYYY
    if (!dateString) return '';
    const parts = dateString.split('-');
    if (parts.length !== 3) return '';
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// --- CENTRAL USER DATA (SINGLE SOURCE OF TRUTH) ---
let userProfileData = profileState.data;

const pages = {
  inicio: 'views/inicio.html',
  perfil: 'views/perfil.html',
  proceso: 'views/proceso.html',
  tareas: 'views/tareas.html',
  documentos: 'views/documentos.html',
  finanzas: 'views/finanzas.html',
  chat: 'views/chat.html',
  ayuda: 'views/ayuda.html'
};
const perfilSubPages = {
    personales: `
      <form class="card" id="form-personales"><div class="card-body">
          <h5 class="fw-bold">Credenciales</h5>
          <div class="mb-4"><label class="form-label">Correo electrónico principal *</label><input type="email" class="form-control" id="personal-email" readonly></div>
          
          <h5 class="fw-bold">Datos Personales</h5>
          <div class="row g-3 mb-4">
            <div class="col-md-6"><label class="form-label">Nombre *</label><input type="text" class="form-control" id="personal-name"></div>
            <div class="col-md-6"><label class="form-label">Apellidos *</label><input type="text" class="form-control" id="personal-surname"></div>
            <div class="col-md-6"><label class="form-label">Nacionalidad *</label><select class="form-select" id="personal-nationality"></select></div>
            <div class="col-md-6"><label class="form-label">Fecha de nacimiento *</label><input type="date" class="form-control" id="personal-birthDate"></div>
            <div class="col-md-6"><label class="form-label">Número de pasaporte *</label><input type="text" class="form-control" id="personal-passportNumber"></div>
            <div class="col-md-6"><label class="form-label">Fecha de caducidad del pasaporte *</label><input type="date" class="form-control" id="personal-passportExpiry"></div>
          </div>
          <h5 class="fw-bold">Información de Contacto (Para Contrato)</h5>
          <div class="row g-3 mb-4">
              <div class="col-md-6"><label class="form-label">Código País *</label><select class="form-select" id="contact-phoneCode"></select></div>
              <div class="col-md-6"><label class="form-label">Teléfono móvil *</label><input type="tel" class="form-control" id="contact-phoneNumber"></div>
              <div class="col-md-8"><label class="form-label">Calle y Número *</label><input type="text" class="form-control" id="contact-address1"></div>
              <div class="col-md-4"><label class="form-label">Línea 2 de dirección</label><input type="text" class="form-control" id="contact-address2"></div>
              <div class="col-md-6"><label class="form-label">Ciudad *</label><input type="text" class="form-control" id="contact-city"></div>
              <div class="col-md-6"><label class="form-label">Código Postal *</label><input type="text" class="form-control" id="contact-postalCode"></div>
              <div class="col-md-6"><label class="form-label">Provincia/Estado *</label><input type="text" class="form-control" id="contact-province"></div>
              <div class="col-md-6"><label class="form-label">País *</label><select class="form-select" id="contact-country"></select></div>
          </div>
          <h5 class="fw-bold">Información de Contacto (Padre, Madre o Tutor)</h5>
          <div class="row g-3 mb-4">
            <div class="col-md-6"><label class="form-label">Nombre del Contacto *</label><input type="text" class="form-control" id="parent-name"></div>
            <div class="col-md-6"><label class="form-label">Relación *</label><input type="text" class="form-control" id="parent-relation" placeholder="Ej: Padre, Madre"></div>
            <div class="col-md-6"><label class="form-label">Email del Contacto *</label><input type="email" class="form-control" id="parent-email"></div>
            <div class="col-md-6"><label class="form-label">Teléfono del Contacto *</label><input type="tel" class="form-control" id="parent-phone"></div>
          </div>
          <h5 class="fw-bold">Redes Sociales</h5>
          <div id="social-links-container" class="mb-3"></div>
          <button type="button" class="btn btn-outline-primary" id="add-social-link-btn">Añadir Red Social</button>
      
      </div>
      <div class="card-footer text-end bg-light">
          <span class="save-status me-3 text-success fw-bold"></span>
          <button type="button" class="btn btn-eture-red fw-bold save-profile-btn" data-form="form-personales">Guardar Cambios</button>
      </div>
      </form>`,
    academica: `
      <div class="card" id="form-academica">
          <div class="card-body">
              <h5 class="fw-bold">Estado Académico</h5>
              <div class="row g-3 mb-4 align-items-center">
                  <div class="col-md-auto">
                      <label class="form-label" for="academic-status">Estado actual *</label>
                      <select class="form-select" id="academic-status" style="width: auto;">
                          <option value="Freshman">Freshman</option>
                          <option value="Transfer">Transfer</option>
                          <option value="Graduate">Graduate</option>
                      </select>
                  </div>
                  <div class="col-md">
                      <small class="text-muted lh-sm">
                          <b>Freshman:</b> Vas a empezar tu carrera universitaria en Estados Unidos.
                          <br/>
                          <b>Transfer:</b> Ya estudias en una universidad y vas a transferir tus créditos.
                          <br/>
                          <b>Graduate:</b> Vas a realizar un máster o estudios de postgrado.
                      </small>
                  </div>
              </div>
              
              <hr class="my-4">
              
              <h5 class="fw-bold">Opciones de Carrera Universitaria en EEUU</h5>
              <p class="text-muted small">Añade hasta tres opciones de carrera que te gustaría estudiar. Tener varias alternativas aumenta tus posibilidades.</p>
              <div id="study-options-container" class="mb-2"></div>
              <button type="button" class="btn btn-sm btn-outline-primary" id="add-study-option-btn">Añadir otra opción</button>
              
              <hr class="my-4">
              <h5 class="fw-bold">Nivel de Inglés y Exámenes Estandarizados</h5>
              <div class="row g-3">
                  <div class="col-md-6">
                      <label class="form-label">Nivel de Inglés (Marco Común Europeo)</label>
                      <select class="form-select" id="academic-englishLevel"><option>A1 - Básico</option><option>A2 - Básico</option><option>B1 - Intermedio</option><option>B2 - Intermedio-Alto</option><option>C1 - Avanzado</option><option>C2 - Dominio</option></select>
                  </div>
                  <div class="col-md-6">
                      <label class="form-label">Exámenes Estandarizados</label>
                      <div id="exam-container"></div>
                      <button type="button" class="btn btn-sm btn-outline-primary mt-2" id="add-exam-btn">Añadir Examen</button>
                  </div>
              </div>
              <hr class="my-4">
              <h5 class="fw-bold">Historial Académico Detallado</h5>
              <p class="text-muted small">Asegúrate de que el historial se genere correctamente después de introducir tu fecha de nacimiento en la sección de Datos Personales.</p>
              <div id="academic-history-container" class="mb-4">
                  <div class="alert alert-info">Por favor, introduce tu fecha de nacimiento en "Datos Personales" para generar tu historial académico.</div>
              </div>
          </div>
          <div class="card-footer text-end bg-light">
              <span class="save-status me-3 text-success fw-bold"></span>
              <button type="button" class="btn btn-eture-red fw-bold save-profile-btn" data-form="form-academica">Guardar Cambios</button>
          </div>
      </div>`,
    deportiva: `
      <div class="card" id="form-deportiva">
          <div class="card-body">
              <div class="row g-4">
                  <div class="col-lg-7">
                      <h5 class="fw-bold">Datos Físicos</h5>
                      <div class="row g-3 mb-4">
                          <div class="col-md-6"><label class="form-label">Altura (cm) *</label><input type="number" class="form-control" id="athletic-height"></div>
                          <div class="col-md-6"><label class="form-label">Peso (kg) *</label><input type="number" class="form-control" id="athletic-weight"></div>
                      </div>
                      
                      <h5 class="fw-bold">Equipo Actual</h5>
                      <div class="row g-3 mb-4">
                          <div class="col-md-6"><label class="form-label">Nombre del Equipo Actual *</label><input type="text" class="form-control" id="athletic-currentTeam"></div>
                          <div class="col-md-6"><label class="form-label">División / Categoría Actual *</label><input type="text" class="form-control" id="athletic-currentDivision"></div>
                      </div>
                      <h5 class="fw-bold">Contenido Multimedia</h5>
                      <div class="mb-4">
                          <h6>Vídeos de Highlights *</h6>
                          <div id="highlights-container"></div>
                          <button type="button" class="btn btn-outline-primary" id="add-highlights-btn">Añadir Vídeo</button>
                      </div>
                      <div class="mb-4">
                          <h6>Partidos Completos</h6>
                          <div id="matches-container"></div>
                          <button type="button" class="btn btn-outline-primary" id="add-match-btn">Añadir Partido</button>
                      </div>
                      <h5 class="fw-bold">Historial de Equipos y Estadísticas</h5>
                      <p class="text-muted small">Por favor, añade TODOS los clubes en los que has jugado desde los 14 años (categoría Cadete) hasta la actualidad.</p>
                      <div id="team-history-container" class="mb-4">
                          <div class="alert alert-info">Por favor, introduce tu fecha de nacimiento en "Datos Personales" para generar tu historial de equipos.</div>
                      </div>
                      <h6>Estadísticas de la Última Temporada</h6>
                      <div id="stats-container" class="row g-3"></div>
                  </div>
                  <div class="col-lg-5">
                      <h5 class="fw-bold">Posición de Juego</h5>
                      <div class="mb-3"><label class="form-label">Posición principal *</label><select class="form-select" id="athletic-mainPosition"></select></div>
                      <div class="mb-3">
                          <label class="form-label">Posición secundaria</label>
                          <div id="secondary-positions-container"></div>
                          <button type="button" class="btn btn-sm btn-outline-primary mt-2" id="add-secondary-pos-btn">Añadir otra posición</button>
                      </div>
                       <div class="mb-4"><label class="form-label">Pie dominante *</label><select class="form-select" id="athletic-dominantFoot"><option>Derecho</option><option>Izquierdo</option><option>Ambos</option></select></div>
                      
                      <div class="football-pitch">
                          <div class="pitch-marking center-line"></div>
                          <div class="pitch-marking center-circle"></div>
                          <div class="pitch-marking penalty-area-top"></div>
                          <div class="pitch-marking penalty-area-bottom"></div>
                          <div class="pitch-marking goal-area-top"></div>
                          <div class="pitch-marking goal-area-bottom"></div>
                          <div id="pitch-markers-container"></div>
                      </div>
                  </div>
              </div>
          </div>
          <div class="card-footer text-end bg-light">
              <span class="save-status me-3 text-success fw-bold"></span>
              <button type="button" class="btn btn-eture-red fw-bold save-profile-btn" data-form="deportiva">Guardar Cambios</button>
          </div>
      </div>`
};
// ... aquí termina todo el bloque de datos de 'perfilSubPages' ...

// --- 4. FUNCIONES DE BASE DE DATOS (USANDO services/firestore.js) ---

async function saveProfileToFirestore(userId, data) {
  try {
    await saveProfile(userId, data);
    console.log("¡Perfil guardado con éxito en Firestore!");
  } catch (error) {
    console.error("Error al guardar el perfil: ", error);
    alert("Hubo un error al guardar tu perfil.");
  }
}

async function loadProfileFromFirestore(userId) {
  try {
    const profile = await getProfile(userId);
    if (profile) {
      console.log("Perfil cargado desde Firestore.");
      return profile;
    } else {
      console.log("No existe el perfil, creando uno nuevo con datos por defecto.");
      const defaultData = JSON.parse(JSON.stringify(emptyProfileData));
      return await ensureProfile(userId, defaultData);
    }
  } catch (error) {
    console.error("Error al cargar el perfil: ", error);
    return userProfileData;
  }
}

async function loadTasksFromFirestore(userId) {
  try {
    const tasks = await listTasks(userId);
    if (tasks.length > 0) {
      console.log("Tareas cargadas desde Firestore.");
      return tasks;
    } else {
      console.log("No existen tareas, devolviendo lista vacía.");
      return [];
    }
  } catch (error) {
    console.error("Error al cargar tareas: ", error);
    return [];
  }
}

// --- A PARTIR DE AQUÍ EMPIEZA EL CÓDIGO QUE YA TENÍAS ---

// REEMPLAZA TU FUNCIÓN saveProfileData ENTERA POR ESTA VERSIÓN FINAL Y COMPLETA
async function saveProfileData(formId) {
  console.log(`--- 🕵️‍♂️ INICIANDO GUARDADO para el formulario: ${formId} ---`);
  const user = auth.currentUser;

  if (!user) {
    console.error("¡ERROR CRÍTICO! No se encontró un usuario autenticado para guardar.");
    return;
  }

  const getDynamicValues = (containerId, valueSelector) => {
      const container = document.getElementById(containerId);
      if (!container) return [];
      return Array.from(container.querySelectorAll(valueSelector)).map(input => input.value).filter(value => value.trim() !== '');
  };
  const getDynamicObjects = (containerId, typeSelector, scoreSelector, otherNameSelector) => {
       const container = document.getElementById(containerId);
       if (!container) return [];
       const items = [];
       Array.from(container.children).forEach(node => {
          let type = node.querySelector(typeSelector)?.value;
          const score = node.querySelector(scoreSelector)?.value;
          if (type === 'Otro') {
              const otherName = node.querySelector(otherNameSelector)?.value.trim();
              if (otherName) { type = otherName; } else { type = ''; }
          }
          if (type && score) { items.push({ type, score }); }
       });
       return items;
  };

  switch(formId) {
      case 'form-personales':
          userProfileData.personal.name = document.getElementById('personal-name').value;
          userProfileData.personal.surname = document.getElementById('personal-surname').value;
          userProfileData.personal.nationality = document.getElementById('personal-nationality').value;
          userProfileData.personal.birthDate = toSpanishDate(document.getElementById('personal-birthDate').value);
          userProfileData.personal.passportNumber = document.getElementById('personal-passportNumber').value;
userProfileData.personal.passportExpiry = toSpanishDate(document.getElementById('personal-passportExpiry').value); 
          userProfileData.contact.phoneCode = document.getElementById('contact-phoneCode').value;
          userProfileData.contact.phoneNumber = document.getElementById('contact-phoneNumber').value;
          userProfileData.contact.address1 = document.getElementById('contact-address1').value;
          userProfileData.contact.address2 = document.getElementById('contact-address2').value;
          userProfileData.contact.city = document.getElementById('contact-city').value;
          userProfileData.contact.postalCode = document.getElementById('contact-postalCode').value;
          userProfileData.contact.province = document.getElementById('contact-province').value;
          userProfileData.contact.country = document.getElementById('contact-country').value;
          userProfileData.parent.name = document.getElementById('parent-name').value;
          userProfileData.parent.relation = document.getElementById('parent-relation').value;
          userProfileData.parent.email = document.getElementById('parent-email').value;
          userProfileData.parent.phone = document.getElementById('parent-phone').value;
          break;
      case 'form-academica': {
        userProfileData.academic.status = document.getElementById('academic-status').value;
        userProfileData.academic.englishLevel = document.getElementById('academic-englishLevel').value;
        userProfileData.academic.studyOptions = getDynamicValues('study-options-container', 'input.study-option-input');
        userProfileData.academic.exams = getDynamicObjects('exam-container', 'select.exam-type', 'input.exam-score', '.exam-name-other');

        // Leer del DOM el historial académico
        userProfileData.academic.history = readAcademicHistoryFromUI();
        break;
      }
      case 'deportiva': {
        userProfileData.athletic.height = parseInt(document.getElementById('athletic-height').value, 10) || 0;
        userProfileData.athletic.weight = parseInt(document.getElementById('athletic-weight').value, 10) || 0;
        userProfileData.athletic.dominantFoot = document.getElementById('athletic-dominantFoot').value;
        userProfileData.athletic.mainPosition = document.getElementById('athletic-mainPosition').value;
        userProfileData.athletic.secondaryPositions = getDynamicValues('secondary-positions-container', 'select.secondary-position-select');
        userProfileData.athletic.currentTeam = document.getElementById('athletic-currentTeam').value;
        userProfileData.athletic.currentDivision = document.getElementById('athletic-currentDivision').value;

        if (!userProfileData.athletic.stats) userProfileData.athletic.stats = {};
                  // --- guardar stats según posición principal ---
          const mainPosNow = document.getElementById('athletic-mainPosition')?.value || userProfileData.athletic.mainPosition || '';
          const isGKNow = /(^POR$|^GK$|portero|goalkeeper)/i.test(mainPosNow);

          userProfileData.athletic.stats.played = parseInt(document.getElementById('stat-played')?.value, 10) || 0;

          if (isGKNow) {
            userProfileData.athletic.stats.goalsConceded = parseInt(document.getElementById('stat-goalsConceded')?.value, 10) || 0;
            userProfileData.athletic.stats.saves = parseInt(document.getElementById('stat-saves')?.value, 10) || 0;
            // opcional: limpiamos campos de jugador de campo para evitar confusión
            delete userProfileData.athletic.stats.goals;
            delete userProfileData.athletic.stats.assists;
          } else {
            userProfileData.athletic.stats.goals = parseInt(document.getElementById('stat-goals')?.value, 10) || 0;
            userProfileData.athletic.stats.assists = parseInt(document.getElementById('stat-assists')?.value, 10) || 0;
            // opcional: limpiamos campos de portero
            delete userProfileData.athletic.stats.goalsConceded;
            delete userProfileData.athletic.stats.saves;
          }


        // Leer del DOM el historial de equipos
        userProfileData.athletic.teamHistory = readTeamHistoryFromUI();
        break;
      }
      case 'form-promocion':
          const getCheckedValues = (selector) => Array.from(document.querySelectorAll(selector + ':checked')).map(cb => cb.value);
          userProfileData.promotion.universityType = getCheckedValues('#proceso-promocion-content input[id^="uni-"]');
          userProfileData.promotion.locationType = getCheckedValues('#proceso-promocion-content input[id^="loc-"]');
          userProfileData.promotion.sportsDivision = getCheckedValues('#proceso-promocion-content input[id^="div-"]');
          userProfileData.promotion.budget = document.getElementById('promotion-budget').value;
          userProfileData.promotion.objectives = document.getElementById('promotion-objectives').value;
          break;
  }

  renderPromotionalProfile();

  console.log("Datos que se van a guardar en Firestore:", JSON.parse(JSON.stringify(userProfileData)));
  await saveProfileToFirestore(user.uid, userProfileData);
  // ← nuevo: avisar a “Proceso” de que el perfil cambió
  document.dispatchEvent(new CustomEvent('profile:changed', { detail: userProfileData }));

  console.log("--- ✅ FIN DEL GUARDADO ---");
}

// REEMPLAZA TU FUNCIÓN renderPage ENTERA POR ESTA VERSIÓN FINAL
async function renderPage(pageId) {
  const contentDiv = document.getElementById(`${pageId}-content`);
  if (!contentDiv) return;

  const pageSource = pages[pageId];

  try {
    // Paso 1: Cargar el contenido HTML de la vista correspondiente
    if (pageSource.endsWith('.html')) {
      const response = await fetch(pageSource);
      if (!response.ok) throw new Error(`No se pudo cargar ${pageSource}`);
      const html = await response.text();
      contentDiv.innerHTML = html;
    } else {
      contentDiv.innerHTML = pageSource;
    }

    // --- ¡NUEVA LÓGICA INTELIGENTE! ---
    // Paso 2: Si la página que acabamos de cargar es el 'inicio', la hacemos dinámica
    if (pageId === 'inicio') {
      // pintar el snapshot actual
      renderHomeTasksSnapshot(contentDiv);
    }

    if (pageId === 'documentos') {
      await initDocsFeature();
    }

    // Paso 3: Ejecutamos el resto de funciones específicas de cada página (como antes)
    if (pageId === 'finanzas') renderFinancialChart();
    if (pageId === 'perfil') {
      renderPerfilSubPages();   // ya lo tenías
      initProfileFeature();     // <— NUEVO: engancha eventos de Mi Perfil
    }
    if (pageId === 'proceso') {
      renderPromotionalProfile();
      populatePromotionForm();
      renderUniversityInterest();
      // 👉 añade la inicialización del nuevo módulo:
      initProcessFeature();
    }
    if (pageId === 'tareas') {
      if (auth.currentUser) {
        await initTasksFeature(auth.currentUser);
      }
      return; // Importante: salimos para no ejecutar lógica antigua
    }



  } catch (error) {
    console.error("Error al renderizar la página:", pageId, error);
    contentDiv.innerHTML = `<p class="text-danger">Error al cargar el contenido de esta sección.</p>`;
  }
}
// Pinta el bloque de "Tareas pendientes" del INICIO usando la caché de tasks.js
function renderHomeTasksSnapshot(rootEl) {
  if (!rootEl) return;
  const tasks = getTasksData(); // <-- viene de tasks.js

  const pending = tasks.filter(t => t.status !== 'Completado');
  const next3 = pending.slice(0, 3);

  // Soporta 2 maquetas de HTML:
  //  - IDs específicos (#home-pending-count, #home-upcoming-list)
  //  - Fallback a tu versión anterior (.card-text.display-4 y .list-group)
  const cntEl  = rootEl.querySelector('#home-pending-count') || rootEl.querySelector('.card-text.display-4');
  const listEl = rootEl.querySelector('#home-upcoming-list') || rootEl.querySelector('.list-group');

  if (cntEl) cntEl.textContent = pending.length;

  if (listEl) {
    if (next3.length === 0) {
      listEl.innerHTML = '<p class="text-center p-3">¡Felicidades! No tienes tareas pendientes.</p>';
    } else {
      listEl.innerHTML = next3.map(t => {
        const color = t.status === 'En Progreso' ? 'warning' : 'secondary';
        return `
          <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
            <div>
              <h6 class="mb-1 fw-bold">${t.title}</h6>
              <small class="text-muted">${t.notes || 'Sin notas adicionales.'}</small>
            </div>
            <span class="badge bg-${color} rounded-pill">${t.status}</span>
          </div>`;
      }).join('');
    }
  }
}

// Inicializa las secciones dinámicas de "Mi Perfil" (Académica y Deportiva)
function initPerfilDynamicSections() {
  // --- Sociales ---
  if (document.getElementById('social-links-container')) {
    renderSocialLinks();
  }

  // --- Académica ---
  if (document.getElementById('study-options-container')) {
    renderStudyOptions();
  }
  if (document.getElementById('exam-container')) {
    renderExams();
  }
  if (document.getElementById('academic-history-container')) {
    renderAcademicHistory(userProfileData, auth.currentUser?.uid || '');
  }

  // --- Deportiva: Select de posición principal ---
  const mainPositionSelect = document.getElementById('athletic-mainPosition');
  if (mainPositionSelect) {
    mainPositionSelect.innerHTML =
      '<option selected disabled>Selecciona...</option>' +
      footballPositions.map(p => `<option value="${p.value}">${p.text}</option>`).join('');
    mainPositionSelect.value = userProfileData.athletic.mainPosition || '';
  }

  // Posiciones secundarias + marcadores de campo
  if (document.getElementById('secondary-positions-container')) {
    renderSecondaryPositions();
  }
  if (document.getElementById('pitch-markers-container')) {
    renderPitchMarkers();
  }

  // Multimedia
  if (document.getElementById('highlights-container')) {
    renderMultimediaLinks('highlights', userProfileData.media.highlights);
  }
  if (document.getElementById('matches-container')) {
    renderMultimediaLinks('matches', userProfileData.media.matches);
  }

  // Historial de equipos y estadísticas
  if (document.getElementById('team-history-container')) {
    renderTeamHistory(userProfileData);
  }
  if (document.getElementById('stats-container')) {
    renderStats();
  }
}
function renderPerfilSubPages() {
  const personales = document.getElementById('personales-tab-content');
  const academica  = document.getElementById('academica-tab-content');
  const deportiva  = document.getElementById('deportiva-tab-content');
  if (!personales || !academica || !deportiva) return;

  personales.innerHTML = perfilSubPages.personales;
  academica.innerHTML  = perfilSubPages.academica;
  deportiva.innerHTML  = perfilSubPages.deportiva;

  // Poblar y luego inicializar dinámicas
  if (typeof populateProfileForms === 'function') {
    populateProfileForms();
  }
  initPerfilDynamicSections();

  // Enganchar botones Guardar (idempotente)
  const scope = document.getElementById('perfil-content') || document;
  scope.querySelectorAll('.save-profile-btn').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const formId = btn.getAttribute('data-form') || '';
      await saveProfileData(formId);

      const container = btn.closest('.card, form');
      let badge = container?.querySelector('.save-status');
      if (!badge && container) {
        badge = document.createElement('span');
        badge.className = 'save-status ms-2 text-success fw-bold';
        container.appendChild(badge);
      }
      if (badge) {
        badge.textContent = 'Cambios guardados';
        setTimeout(() => { badge.textContent = ''; }, 2000);
      }
    });
  });
}

function renderPromotionalProfile() {
  const container = document.getElementById('proceso-perfil-content');
  if (!container) return;
  
  const data = userProfileData;
  const mainPosData = footballPositions.find(p => p.value === data.athletic.mainPosition) || {coords:{top:'0',left:'0'}, value:''};
  const mainHighlight = data.media.highlights.find(h => h.isMain) || data.media.highlights[0] || { url: '', name: 'No video selected' };
  
  const studyOptionsHTML = data.academic.studyOptions.length > 0
      ? data.academic.studyOptions.map(option => `<span class="badge bg-secondary me-1">${option}</span>`).join(' ')
      : 'No especificada';
  
  const examsHTML = data.academic.exams.length > 0
      ? data.academic.exams.map(exam => `<strong>${exam.type}:</strong> ${exam.score}`).join(' | ')
      : 'No hay exámenes registrados.';
  const secondaryPositionsHTML = data.athletic.secondaryPositions.map(secPosValue => {
      const posData = footballPositions.find(p => p.value === secPosValue);
      if (!posData) return '';
      return `<div class="position-marker secondary" style="top: ${posData.coords.top}; left: ${posData.coords.left};">${posData.value}</div>`;
  }).join('');
  container.innerHTML = `
      <div class="card shadow-sm overflow-hidden profile-promocional">
          <div class="profile-header-banner" style="background-image: url('${data.media.banner}');">
          </div>
          
          <div class="card-body position-relative">
              <div class="profile-main-info d-flex flex-column flex-md-row align-items-center">
                  <div class="profile-picture">
                      <img src="${data.media.profilePicture || 'https://placehold.co/120x120'}" alt="Foto de Perfil de ${data.personal.name || 'Jugador'}" />
                  </div>
                  <div class="ms-md-4 mt-3 mt-md-0 text-center text-md-start">
                      <h2 class="fw-bold mb-0">${data.personal.name} ${data.personal.surname}</h2>
                      <p class="lead text-eture-red fw-bold mb-1">${data.athletic.currentTeam || 'Sin equipo'} - ${data.athletic.currentDivision || 'Sin división'}</p>
                      <p class="text-muted mb-1">Estado: <span class="fw-bold text-dark">${data.academic.status}</span></p>
                      <div>
                          <p class="text-muted d-inline">Carreras de interés: </p>
                          <div class="d-inline-block">${studyOptionsHTML}</div>
                      </div>
                  </div>
              </div>
              <div class="row g-3 text-center my-4">
                  <div class="col-4">
                      <div class="stat-card p-2 rounded">
                          <div class="fs-4 fw-bold">${data.athletic.height || 'N/A'}<span class="fs-6 fw-normal">cm</span></div>
                          <div class="small text-muted">Altura</div>
                      </div>
                  </div>
                  <div class="col-4">
                      <div class="stat-card p-2 rounded">
                          <div class="fs-4 fw-bold">${data.athletic.weight || 'N/A'}<span class="fs-6 fw-normal">kg</span></div>
                          <div class="small text-muted">Peso</div>
                      </div>
                  </div>
                  <div class="col-4">
                      <div class="stat-card p-2 rounded">
                          <div class="fs-4 fw-bold">${data.academic.gpa || 'N/A'}</div>
                          <div class="small text-muted">GPA</div>
                      </div>
                  </div>
              </div>
              <div class="row g-4 align-items-center mb-4">
                  <div class="col-lg-7">
                      <h5 class="fw-bold text-center mb-3">Vídeo de Highlights (${mainHighlight.name})</h5>
                       <a href="${mainHighlight.url}" target="_blank" class="text-decoration-none">
                          <div class="video-placeholder rounded" style="background-image: url('${data.media.videoThumbnail}');">
                              <div class="play-icon">▶</div>
                          </div>
                      </a>
                  </div>
                  <div class="col-lg-5">
                      <h5 class="fw-bold text-center mb-3">Posiciones en Campo</h5>
                          <div class="football-pitch mx-auto" style="max-width: 250px;">
                          <div class="pitch-marking center-line"></div><div class="pitch-marking center-circle"></div>
                          <div class="pitch-marking penalty-area-top"></div><div class="pitch-marking penalty-area-bottom"></div>
                          <div class="pitch-marking goal-area-top"></div><div class="pitch-marking goal-area-bottom"></div>
                          <div class="position-marker main" style="top: ${mainPosData.coords.top}; left: ${mainPosData.coords.left};">${mainPosData.value}</div>
                          ${secondaryPositionsHTML}
                      </div>
                  </div>
              </div>
              
              <ul class="nav nav-tabs nav-fill" id="promocional-info-tabs" role="tablist">
                  <li class="nav-item" role="presentation"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#promo-bio" type="button">Bio</button></li>
                  <li class="nav-item" role="presentation"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#promo-academica" type="button">Info. Académica</button></li>
                  <li class="nav-item" role="presentation"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#promo-deportiva" type="button">Info. Deportiva</button></li>
              </ul>
              <div class="tab-content p-3 border border-top-0 rounded-bottom">
                  <div class="tab-pane fade show active" id="promo-bio" role="tabpanel">
                      <p class="mb-0 text-muted">Soy un mediapunta creativo y trabajador, con gran visión de juego y capacidad para llegar al área. Mi objetivo es compaginar mi pasión por el fútbol con una educación de primer nivel en Estados Unidos. Estoy listo para aportar mi máximo esfuerzo tanto en el campo como en el aula.</p>
                  </div>
                  <div class="tab-pane fade p-3" id="promo-academica" role="tabpanel">
                       <p class="fw-bold mb-2">Resultados de Exámenes</p>
                       <p class="small text-muted mb-3">${examsHTML}</p>
                       <div class="text-center">
                          <p class="small text-muted mb-2">El historial completo y expedientes están disponibles bajo solicitud.</p>
                          <button class="btn btn-sm btn-outline-secondary">Solicitar Acceso</button>
                       </div>
                  </div>
                  <div class="tab-pane fade text-center p-4" id="promo-deportiva" role="tabpanel">
                      <p class="fw-bold mb-2">🔒 Información Deportiva Completa</p>
                      <p class="small text-muted mb-2">El historial de equipos, estadísticas detalladas y vídeos de partidos completos están disponibles bajo solicitud.</p>
                      <button class="btn btn-sm btn-outline-secondary">Solicitar Acceso</button>
                  </div>
              </div>
          </div>
          <div class="card-footer bg-light text-center text-muted small">
              <p class="mb-0">Esta ficha se actualiza automáticamente con los datos de tu sección "Mi Perfil".</p>
          </div>
      </div>`;
}
// NUEVO: color del badge según estado
function getBadgeColorForStatus(status) {
  switch ((status || '').toLowerCase()) {
    case 'aceptada':         return 'success';
    case 'rechazada':        return 'danger';
    case 'oferta recibida':  return 'primary';
    case 'en contacto':      return 'info';
    case 'pendiente':
    default:                 return 'secondary';
  }
}

function hasOffer(uni) {
  const d = uni?.offerDetails || {};
  const amounts =
    (Array.isArray(d.costs) && d.costs.some(i => Number(i.amount) > 0)) ||
    (Array.isArray(d.scholarships) && d.scholarships.some(i => Number(i.amount) > 0));
  return amounts || !!d.documentUrl;
}

function computeUniversityStatus(uni) {
  // Los estados "duros" los fija la app; el resto es derivado
  if ((uni.status || '').toLowerCase() === 'aceptada')  return 'Aceptada';
  if ((uni.status || '').toLowerCase() === 'rechazada') return 'Rechazada';
  if (hasOffer(uni))                                    return 'Oferta recibida';
  return 'Pendiente';
}

function badgeForComputedStatus(status) {
  switch ((status || '').toLowerCase()) {
    case 'aceptada':        return 'success';
    case 'rechazada':       return 'dark';
    case 'oferta recibida': return 'info';
    case 'pendiente':
    default:                return 'secondary';
  }
}

// --- Seguimiento proactivo: helpers ---
function nextStepTypeLabel(t) {
  const map = { llamada: 'Llamada', email: 'Email', reunion: 'Reunión', otro: 'Otro' };
  return map[(t || '').toLowerCase()] || 'Paso';
}
function formatDateShort(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy}`;
  } catch { return ''; }
}

/**
 * Crea/actualiza la tarea en Firestore para el próximo paso de una universidad.
 * Requiere: uni.nextStep = { type, dueAt (ISO), done: false, taskId? }
 */
async function ensureNextStepTask(userId, uni) {
  if (!userId || !uni?.nextStep?.dueAt || !uni?.nextStep?.type) return;

  const dueDateOnly = uni.nextStep.dueAt.split('T')[0]; // 'YYYY-MM-DD'
  const payload = {
    title: `Próximo paso con ${uni.name} — ${nextStepTypeLabel(uni.nextStep.type)}`,
    status: 'Pendiente',
    dueDate: dueDateOnly,
    notes: 'Creado desde Interés de Universidades',
    category: 'universities',
    universityId: uni.id,
  };

  try {
    if (uni.nextStep.taskId) {
      await updateTaskSvc(userId, uni.nextStep.taskId, payload);
    } else {
      const ref = await addTaskSvc(userId, payload);
      // soporta ambas formas (obj con id, o string)
      uni.nextStep.taskId = (ref && (ref.id || ref)) || uni.nextStep.taskId || null;
    }
    document.dispatchEvent(new Event('tasks:changed'));
  } catch (err) {
    console.error('No se pudo sincronizar la tarea del próximo paso:', err);
  }
}

/** Marca como completada la tarea asociada al próximo paso (si existe) */
async function completeNextStepTask(userId, uni) {
  try {
    if (uni?.nextStep?.taskId) {
      await updateTaskSvc(userId, uni.nextStep.taskId, { status: 'Completado' });
      document.dispatchEvent(new Event('tasks:changed'));
    }
  } catch (err) {
    console.error('No se pudo completar la tarea asociada:', err);
  }
}

function renderUniversityInterest() {
  const container = document.getElementById('university-interest-list');
  if (!container) return;

  const list = Array.isArray(userProfileData.universityInterest)
    ? userProfileData.universityInterest
    : (userProfileData.universityInterest = []);

  if (list.length === 0) {
    container.innerHTML = `<div class="alert alert-info mb-0">Aún no hay universidades que hayan mostrado interés.</div>`;
    return;
  }

  const fmtShort = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const f = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const t = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      return `${f} • ${t}`;
    } catch { return iso; }
  };

  container.innerHTML = `
    <div class="d-none d-md-flex row fw-bold text-muted small mb-2 border-bottom pb-2">
      <div class="col-md-4">Universidad</div>
      <div class="col-md-3">Seguimiento</div>
      <div class="col-md-3">Oferta de Beca</div>
      <div class="col-md-2 text-end">Acciones</div>
    </div>

    ${list.map(uni => {
      // --- oferta / progreso
      let pct = 0, totalCost = 0, totalSch = 0;
      if (uni.offerDetails && Array.isArray(uni.offerDetails.costs) && Array.isArray(uni.offerDetails.scholarships)) {
        totalCost = uni.offerDetails.costs.reduce((s, it) => s + (Number(it.amount) || 0), 0);
        totalSch  = uni.offerDetails.scholarships.reduce((s, it) => s + (Number(it.amount) || 0), 0);
        if (totalCost > 0) pct = Math.round((totalSch / totalCost) * 100);
      }
      const offerExists = hasOffer(uni);

      // --- último apunte del historial
      const last = (uni.timeline && uni.timeline[0]) || null;
      const lastText = last ? `${last.type || 'Acción'}: ${last.text || ''}` : 'Sin notas';

      // --- próximo paso (tarea pendiente más cercana)
      const tasks = (typeof getTasksData === 'function') ? getTasksData() : [];
      const next = tasks
        .filter(t => t.universityId === uni.id && t.status !== 'Completado')
        .sort((a,b) => (a.dueDate||'').localeCompare(b.dueDate||''))[0];
      const nextHTML = next
        ? `<div class="small mt-2"><span class="badge bg-warning text-dark">Próximo paso: ${next.title || 'Tarea'} • ${fmtShort(next.dueDate)}</span></div>`
        : `<div class="small mt-2 text-muted">Sin próximos pasos</div>`;

      // --- estado calculado
      const computed = computeUniversityStatus(uni);
      const badgeCol = badgeForComputedStatus(computed);
      const isClosed = (computed === 'Aceptada' || computed === 'Rechazada');

      return `
        <div class="row align-items-center border-bottom py-3">
          <!-- Universidad: papelera + nombre + editar (compacto) -->
          <div class="col-md-4 d-flex align-items-center">
            <button class="btn btn-link p-0 me-2 text-danger delete-university-btn" data-university-id="${uni.id}" title="Eliminar">
              <i class="bi bi-trash3"></i>
            </button>
            <span class="fw-bold me-2 flex-grow-1">${uni.name}</span>
            <button class="btn btn-sm btn-outline-secondary edit-university-btn" data-university-id="${uni.id}" title="Renombrar">Editar</button>
          </div>

          <!-- Seguimiento: última nota + botón historial + próximo paso (sin inputs) -->
          <div class="col-md-3">
            <div class="small text-muted">Última nota</div>
            <div class="d-flex align-items-center gap-2">
              <span class="text-truncate" style="max-width: 240px;">${lastText}</span>
              <span class="badge bg-${badgeCol} ms-auto">${computed}</span>
              <button class="btn btn-sm btn-outline-primary open-timeline-modal-btn" data-university-id="${uni.id}">Historial</button>
            </div>
            ${nextHTML}
          </div>

          <!-- Oferta -->
          <div class="col-md-3">
            ${offerExists ? `
              <div class="d-flex align-items-center">
                <div class="progress flex-grow-1" style="height: 24px;">
                  <div class="progress-bar bg-eture-red fw-bold" role="progressbar" style="width:${pct}%;" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">${pct}%</div>
                </div>
                <button class="btn btn-sm btn-outline-primary open-scholarship-modal-btn ms-2" data-university-id="${uni.id}">Ver Desglose</button>
              </div>
              ${uni.offerDetails?.documentUrl ? `<a class="small d-block mt-1" href="${uni.offerDetails.documentUrl}" target="_blank" rel="noopener">Documento</a>` : ''}
            ` : `
              <p class="mb-2 text-muted small">Sin oferta registrada</p>
              <button class="btn btn-sm btn-outline-primary open-scholarship-modal-btn" data-university-id="${uni.id}">Añadir oferta</button>
            `}
          </div>

          <!-- Acciones -->
          <div class="col-md-2 text-end">
            ${offerExists && !isClosed ? `
              <button class="btn btn-sm btn-success accept-university-btn" data-university-id="${uni.id}">Aceptar</button>
              <button class="btn btn-sm btn-outline-dark reject-university-btn ms-1" data-university-id="${uni.id}">Rechazar</button>
            ` : `
              ${computed === 'Aceptada' ? '<span class="badge bg-success">Aceptada</span>' : ''}
              ${computed === 'Rechazada' ? '<span class="badge bg-dark">Rechazada</span>' : ''}
            `}
          </div>
        </div>
      `;
    }).join('')}
  `;
}

// REEMPLAZO COMPLETO: ahora soporta subir PDF de la oferta a Storage
function openScholarshipModal(universityId) {
  const modalEl = document.getElementById('scholarship-modal');
  if (!modalEl) return;

  const uniData = (userProfileData.universityInterest || []).find(u => u.id === universityId);
  if (!uniData) return;
  if (!uniData.offerDetails) uniData.offerDetails = { costs: [], scholarships: [], documentUrl: '' };

  const formatCurrency = (n) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n || 0);
  const modalTitle  = modalEl.querySelector('.modal-title');
  const modalBody   = modalEl.querySelector('.modal-body');
  const modalFooter = modalEl.querySelector('.modal-footer');

  modalTitle.innerHTML = `Editar Desglose: <span class="fw-normal">${uniData.name}</span>`;

  function renderForm() {
    const row = (item, type) => `
      <div class="input-group mb-2" data-type="${type}">
        <input type="text" class="form-control item-name" value="${item?.name || ''}" placeholder="Nombre del concepto">
        <span class="input-group-text">$</span>
        <input type="number" class="form-control item-amount" value="${item?.amount || 0}" placeholder="0">
        <button class="btn btn-outline-danger delete-item-btn" type="button">X</button>
      </div>`;

    modalBody.innerHTML = `
      <div class="row g-4">
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header fw-bold">Costes Anuales (COA)</div>
            <div class="card-body" id="costs-list">
              ${(uniData.offerDetails.costs || []).map(it => row(it,'cost')).join('') || '<p class="text-muted small">No hay costes añadidos.</p>'}
            </div>
            <div class="card-footer"><button class="btn btn-sm btn-outline-primary" id="add-cost-btn">+ Añadir Coste</button></div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header fw-bold">Paquete de Beca</div>
            <div class="card-body" id="scholarships-list">
              ${(uniData.offerDetails.scholarships || []).map(it => row(it,'scholarship')).join('') || '<p class="text-muted small">No hay becas añadidas.</p>'}
            </div>
            <div class="card-footer"><button class="btn btn-sm btn-outline-primary" id="add-scholarship-btn">+ Añadir Beca</button></div>
          </div>
        </div>
      </div>

      <div class="card mt-4">
        <div class="card-body bg-light">
          <div class="d-flex justify-content-around text-center">
            <div><h6 class="fw-normal mb-0">Total COA</h6><p class="fs-5 fw-bold mb-0" id="total-cost-display">$0.00</p></div>
            <div><h6 class="fw-normal mb-0">Beca Total</h6><p class="fs-5 fw-bold text-success mb-0" id="total-scholarship-display">$0.00</p></div>
            <div><h6 class="fw-normal mb-0">Coste Neto Anual</h6><p class="fs-5 fw-bold text-eture-red mb-0" id="net-cost-display">$0.00</p></div>
          </div>
        </div>
      </div>

      <div class="mt-4">
        <h6 class="fw-bold">Documento de la Beca (PDF/JPG/PNG)</h6>
        <div class="input-group">
          <input type="file" class="form-control" id="scholarship-file-upload" accept=".pdf,.jpg,.jpeg,.png">
          <button class="btn btn-outline-secondary" type="button" ${!uniData.offerDetails.documentUrl ? 'disabled' : ''} id="view-scholarship-doc-btn">
            Ver Documento
          </button>
        </div>
        <div class="form-text">Sube el documento oficial de la oferta para tenerlo guardado.</div>
        <div class="small mt-2" id="upload-status"></div>
      </div>
    `;

    modalFooter.innerHTML = `
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
      <button type="button" class="btn btn-primary" id="save-scholarship-changes-btn">Guardar Cambios</button>
    `;

    updateTotals();
  }

  function updateTotals() {
    let totalCost = 0;
    document.querySelectorAll('#costs-list .item-amount').forEach(i => totalCost += Number(i.value) || 0);
    let totalSch = 0;
    document.querySelectorAll('#scholarships-list .item-amount').forEach(i => totalSch += Number(i.value) || 0);
    const net = totalCost - totalSch;
    document.getElementById('total-cost-display').textContent = formatCurrency(totalCost);
    document.getElementById('total-scholarship-display').textContent = formatCurrency(totalSch);
    document.getElementById('net-cost-display').textContent = formatCurrency(net);
  }

  function handleAddItem(type) {
    const listId = type === 'cost' ? 'costs-list' : 'scholarships-list';
    const list = document.getElementById(listId);
    if (list.querySelector('p')) list.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'input-group mb-2';
    row.dataset.type = type;
    row.innerHTML = `
      <input type="text" class="form-control item-name" placeholder="Nombre del concepto">
      <span class="input-group-text">$</span>
      <input type="number" class="form-control item-amount" value="0" placeholder="0">
      <button class="btn btn-outline-danger delete-item-btn" type="button">X</button>
    `;
    list.appendChild(row);
  }

  function handleDeleteItem(btn) {
    const row = btn.closest('.input-group');
    row.remove();
    updateTotals();
  }

  async function handleUpload(fileInput) {
    const file = fileInput.files?.[0];
    if (!file) return;
    const status = document.getElementById('upload-status');
    if (!auth.currentUser) { alert('Debes iniciar sesión'); return; }

    status.textContent = 'Subiendo documento…';

    try {
      const uploaded = await uploadUserFile(
        auth.currentUser.uid,
        file,
        { folder: `offers/${uniData.id}`,
          onProgress: (pct) => { status.textContent = `Subiendo documento… ${pct}%`; } }
      );
      uniData.offerDetails.documentUrl = uploaded.url || '';
      // Guardamos de inmediato y avisamos
      await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
      document.dispatchEvent(new CustomEvent('profile:changed', { detail: userProfileData }));
      status.textContent = 'Documento subido correctamente.';
      renderForm(); // refresca el botón "Ver Documento"
    } catch (err) {
      console.error(err);
      status.textContent = 'No se pudo subir el documento.';
      alert('No se pudo subir el documento.');
    }
  }

  function saveChanges() {
    const newCosts = [];
    document.querySelectorAll('#costs-list .input-group').forEach(r => {
      newCosts.push({ name: r.querySelector('.item-name').value, amount: Number(r.querySelector('.item-amount').value) || 0 });
    });
    const newSch = [];
    document.querySelectorAll('#scholarships-list .input-group').forEach(r => {
      newSch.push({ name: r.querySelector('.item-name').value, amount: Number(r.querySelector('.item-amount').value) || 0 });
    });

    uniData.offerDetails.costs = newCosts;
    uniData.offerDetails.scholarships = newSch;

    if (auth.currentUser) {
      saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    }
    document.dispatchEvent(new CustomEvent('profile:changed', { detail: userProfileData }));

    bootstrap.Modal.getInstance(modalEl).hide();
    renderUniversityInterest();
  }

  // Delegación para elementos dinámicos
  modalBody.onclick = (e) => {
    if (e.target.matches('#add-cost-btn')) handleAddItem('cost');
    if (e.target.matches('#add-scholarship-btn')) handleAddItem('scholarship');
    if (e.target.matches('.delete-item-btn')) handleDeleteItem(e.target);
    if (e.target.matches('#view-scholarship-doc-btn') && uniData.offerDetails.documentUrl) {
      window.open(uniData.offerDetails.documentUrl, '_blank');
    }
  };
  modalBody.oninput = (e) => {
    if (e.target.matches('.item-amount')) updateTotals();
  };
  modalBody.onchange = (e) => {
    if (e.target.matches('#scholarship-file-upload')) handleUpload(e.target);
  };
  modalFooter.onclick = (e) => {
    if (e.target.matches('#save-scholarship-changes-btn')) saveChanges();
  };

  renderForm();
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function openUniTimelineModal(universityId) {
  const modalEl = document.getElementById('university-timeline-modal');
  if (!modalEl) return;

  const uni = (userProfileData.universityInterest || []).find(u => u.id === universityId);
  if (!uni) return;
  if (!Array.isArray(uni.timeline)) uni.timeline = [];

  const $ = (sel, root = modalEl) => root.querySelector(sel);

  const titleEl   = $('.modal-title');
  const list      = $('#timeline-list');
  const saveBtn   = $('#timeline-save-action-btn');
  const typeSel   = $('#timeline-act-type');
  const dtInput   = $('#timeline-act-datetime');
  const textInput = $('#timeline-act-text');
  const textHelp  = $('#timeline-act-text-help');
  const countEl   = $('#timeline-act-count');
  const nextStepSlot = $('#university-next-step-slot');

  titleEl.innerHTML = `Seguimiento: <span class="fw-normal">${uni.name}</span>`;

  // === Helpers de fechas y UI ===
  const now = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  const toLocalInput = (d) => {
    // YYYY-MM-DDTHH:mm en local
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  const roundToNextQuarterHour = (d) => {
    const r = new Date(d);
    const m = r.getMinutes();
    const add = (15 - (m % 15)) % 15;
    r.setMinutes(m + add, 0, 0);
    return r;
  };
  const defaultDTForType = (type) => {
    if (type === 'Reunión') {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(17, 0, 0, 0);
      return d;
    }
    return roundToNextQuarterHour(new Date());
  };
  const fmtDateTime = (iso) => {
    try { return new Date(iso).toLocaleString('es-ES'); } catch { return iso || ''; }
  };
  const nowISO = () => new Date().toISOString();
  const toISOFromLocal = (localDT) => {
    if (!localDT) return '';
    const d = new Date(localDT);
    if (isNaN(d)) return '';
    return d.toISOString();
  };

  const typePlaceholders = {
    'Llamada': 'Ej: Llamada con Head Coach.',
    'Email':   'Ej: Email de presentación enviado.',
    'Reunión': 'Ej: Videollamada con Staff.',
    'Mensaje': 'Ej: Mensaje por WhatsApp al asistente.',
    'Otro':    'Describe la acción brevemente.'
  };

  function closeTimelineModal() {
  const inst = bootstrap.Modal.getInstance(modalEl);
  if (inst) inst.hide();
  // por si queda backdrop residual en navegadores lentos
  setTimeout(() => {
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
  }, 150);
}

  function setSmartDefaults() {
    const t = typeSel.value || 'Llamada';
    textInput.placeholder = typePlaceholders[t] || 'Describe la acción brevemente.';
    dtInput.value = toLocalInput(defaultDTForType(t));
    validateForm();
  }

  function validateForm() {
    const ok = !!(typeSel.value && dtInput.value && textInput.value.trim().length >= 3);
    saveBtn.disabled = !ok;
    countEl.textContent = `${textInput.value.length}/200`;
  }

  // === Render del historial ===
  function renderTimeline() {
    const rows = [...uni.timeline]
      .sort((a,b) => (b.at || '').localeCompare(a.at || ''))
      .map(item => {
        const icon = item.type === 'Llamada' ? 'bi-telephone'
                  : item.type === 'Email'    ? 'bi-envelope'
                  : item.type === 'Reunión'  ? 'bi-people'
                  : item.type === 'Mensaje'  ? 'bi-chat'
                  : item.type === 'Completado' ? 'bi-check2-circle'
                  : 'bi-sticky';
        const doneBadge = item.done ? `<span class="badge bg-success ms-2">Hecho</span>` : '';
        const doneLine  = item.doneAt ? `<div class="small text-muted">Finalizado: ${fmtDateTime(item.doneAt)}</div>` : '';
        const taskChip  = item.linkedTaskId ? `
          <button class="btn btn-sm btn-outline-secondary mt-2 view-task-btn" data-task-id="${item.linkedTaskId}">
            Ver en Tareas
          </button>` : '';
        return `
          <div class="border rounded p-2 mb-2">
            <div class="small text-muted d-flex align-items-center">
              <i class="bi ${icon} me-2"></i>
              ${fmtDateTime(item.at)} • ${item.author || ''}
              ${doneBadge}
            </div>
            <div><strong>${item.type || 'Acción'}:</strong> ${item.text || ''}</div>
            ${doneLine}
            ${taskChip}
          </div>
        `;
      }).join('');

    list.innerHTML = rows || `<div class="text-muted">Sin notas todavía.</div>`;
  }

  // === Próximo paso (tarea pendiente más cercana) ===
  function renderNextStepSlot() {
    const tasks = (typeof getTasksData === 'function') ? getTasksData() : [];
    const pending = tasks
      .filter(t => t.status !== 'Completado' && t.universityId === uni.id)
      .sort((a,b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    if (pending.length === 0) {
      nextStepSlot.innerHTML = `<div class="text-muted">No hay pasos planificados.</div>`;
      return;
    }
    const t = pending[0];
    nextStepSlot.innerHTML = `
      <div class="d-flex align-items-center">
        <div class="me-3">
          <div class="fw-bold">${t.title || 'Próximo paso'}</div>
          <div class="small text-muted">${fmtDateTime(t.dueDate || '')}</div>
          ${t.notes ? `<div class="small mt-1">${t.notes}</div>` : ''}
        </div>
        <div class="ms-auto d-flex gap-2">
          <button class="btn btn-sm btn-outline-secondary" id="view-next-step-btn" data-task-id="${t.id}">Ver en Tareas</button>
          <button class="btn btn-sm btn-success" id="mark-next-step-done-btn" data-task-id="${t.id}">Marcar como hecho</button>
        </div>
      </div>
    `;
  }

  // === Completar tarea y volcar al historial ===
  async function markTaskDone(taskId) {
    if (!auth.currentUser) return;
    const result = prompt('Añade un resultado/nota (opcional):', '');
    try {
      const completedAt = nowISO();
      await updateTaskSvc(auth.currentUser.uid, taskId, {
        status: 'Completado',
        completedAt,
        result: result || ''
      });

      // Intentamos actualizar la ENTRADA ORIGINAL del timeline (la programada) si existe.
      const original = uni.timeline.find(x => x.linkedTaskId === taskId);
      if (original) {
        original.done = true;
        original.doneAt = completedAt;
        if (result && result.trim()) {
          original.text = `${original.text} — ${result.trim()}`;
        }
      } else {
        // Si no existe, añadimos una entrada de "Completado"
        uni.timeline.unshift({
          id: 'tl_' + Date.now(),
          at: completedAt,
          author: auth.currentUser?.email || '',
          type: 'Completado',
          text: result || 'Tarea completada',
          done: true,
          doneAt: completedAt,
          linkedTaskId: taskId
        });
      }

      if (auth.currentUser) await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
      document.dispatchEvent(new Event('tasks:changed'));
      renderTimeline();
      renderNextStepSlot();
      renderUniversityInterest();
    } catch (err) {
      console.error('No se pudo completar la tarea:', err);
      alert('No se pudo completar la tarea.');
    }
  }

  // === Guardar acción (crea historial + tarea coherente) ===
  async function saveAction() {
    if (!auth.currentUser) { alert('Debes iniciar sesión'); return; }
    const type = (typeSel.value || 'Otro').trim();
    const dtLocal = dtInput.value;
    const text = (textInput.value || '').trim();
    if (!dtLocal || text.length < 3) { return; }

    const iso = toISOFromLocal(dtLocal);
    if (!iso) { alert('Fecha inválida'); return; }
    const isPast = (new Date(iso).getTime() <= Date.now());

    // 1) Creamos SIEMPRE la entrada de historial (programada)
    const newTimelineItem = {
      id: 'tl_' + Date.now(),
      at: iso,
      author: auth.currentUser?.email || '',
      type,
      text,
      done: isPast,            // si es pasado, ya la marcamos como hecha
      doneAt: isPast ? iso : '' // y fijamos la hora real (misma que la programada)
    };

    // 2) Creamos la TAREA SIEMPRE (coherente con pasado/futuro)
    let createdTaskId = null;
    try {
      const t = {
        title: `${type} con ${uni.name}`,
        notes: text,
        dueDate: iso,
        status: isPast ? 'Completado' : 'Pendiente',
        completedAt: isPast ? iso : '',  // si es pasada, ya completa
        category: 'Universidad',
        universityId: uni.id,
        createdAt: nowISO()
      };
      const res = await addTaskSvc(auth.currentUser.uid, t);
      createdTaskId = (res && res.id) ? res.id : (typeof res === 'string' ? res : null);
      document.dispatchEvent(new Event('tasks:changed'));
    } catch (err) {
      console.error('No se pudo crear la tarea:', err);
      // seguimos sin linkedTaskId
    }
    if (createdTaskId) newTimelineItem.linkedTaskId = createdTaskId;

    // 3) Persistimos perfil + refrescamos
    uni.timeline.unshift(newTimelineItem);
    await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    renderTimeline();
    renderNextStepSlot();
    renderUniversityInterest();

    // 4) Reset UI
    textInput.value = '';
    validateForm();
  }

  // === Navegar a la pestaña de Tareas ===
  function goToTasksTab() {
    closeTimelineModal();
    const tasksTab =
      document.querySelector('#main-nav [data-bs-toggle="tab"][href="#tareas"]') ||
      document.querySelector('#main-nav [data-bs-target="#tareas"]');
    if (tasksTab) new bootstrap.Tab(tasksTab).show();
  }

  // === Estado inicial UI ===
  setSmartDefaults();
  renderTimeline();
  renderNextStepSlot();
  validateForm();

  // === Eventos de UI ===
  typeSel.addEventListener('change', setSmartDefaults);
  dtInput.addEventListener('input', validateForm);
  textInput.addEventListener('input', validateForm);

  saveBtn.onclick = saveAction;

  // Delegación para botones del slot de próximo paso y del historial
  nextStepSlot.onclick = async (e) => {
    const viewBtn = e.target.closest('#view-next-step-btn');
    if (viewBtn) { goToTasksTab(); return; }

    const doneBtn = e.target.closest('#mark-next-step-done-btn');
    if (doneBtn) { await markTaskDone(doneBtn.dataset.taskId); return; }
  };

  list.onclick = (e) => {
    const viewBtn = e.target.closest('.view-task-btn');
    if (!viewBtn) return;
    goToTasksTab();
  };

  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}


function renderFinancialChart() {
    const ctx = document.getElementById('financial-chart')?.getContext('2d');
    if (!ctx) return;
    new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Pagado', 'Pendiente'],
        datasets: [{
          label: 'Estado de Pagos',
          data: [4000, 6000],
          backgroundColor: ['#28a745', '#dc3545'],
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' },
          title: { display: true, text: 'Balance Total del Servicio (€)' }
        }
      }
    });
}
// ========== Mis Documentos ==========

function populatePromotionForm() {
  const promotionData = userProfileData.promotion || {};
  const form = document.getElementById('proceso-promocion-content');
  if (!form) return;

  // --- PASO CLAVE: LIMPIEZA PREVIA ---
  // Primero, desmarcamos todas las casillas para empezar de cero.
  form.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);

  // --- AHORA, MARCAMOS LAS QUE ESTÁN GUARDADAS ---
  (promotionData.universityType || []).forEach(val => {
    const el = form.querySelector(`input[value="${val}"]`);
    if (el) el.checked = true;
  });
  (promotionData.locationType || []).forEach(val => {
    const el = form.querySelector(`input[value="${val}"]`);
    if (el) el.checked = true;
  });
  (promotionData.sportsDivision || []).forEach(val => {
    const el = form.querySelector(`input[value="${val}"]`);
    if (el) el.checked = true;
  });

  // Rellenamos el resto de los campos
  document.getElementById('promotion-budget').value = promotionData.budget || '';
  document.getElementById('promotion-objectives').value = promotionData.objectives || '';
}

// ▼▼▼ Rellena la pestaña "Personales", "Académica" y "Deportiva" con datos reales ▼▼▼
function populateProfileForms() {
  const p = userProfileData?.personal || {};
  const c = userProfileData?.contact  || {};
  const ac = userProfileData?.academic || {};
  const at = userProfileData?.athletic || {};
  const parent = userProfileData?.parent || {};
  const normalizeES = (v) => {
    if (!v) return v;
    const m = {'Spain':'España','United States':'Estados Unidos','United Kingdom':'Reino Unido','Czech Republic':'Chequia','Czechia':'Chequia'};
    return m[v] || v;
  };
  p.nationality = normalizeES(p.nationality);
  c.country     = normalizeES(c.country);


  // --- Selects básicos (se crean solo si están vacíos) ---
  ensureCountrySelect('#personal-nationality', p.nationality || '');
  ensurePhoneCodeSelect('#contact-phoneCode', c.phoneCode || '');
  ensureCountrySelect('#contact-country',      c.country     || '');

  // --- Personales ---
  setValue('#personal-email', p.email || (auth.currentUser?.email || ''));
  setValue('#personal-name', p.name || '');
  setValue('#personal-surname', p.surname || '');
  setValue('#personal-birthDate', toISODate(p.birthDate || ''));
  setValue('#personal-passportNumber', p.passportNumber || '');
  setValue('#personal-passportExpiry', toISODate(p.passportExpiry || ''));

  // --- Contacto (contrato) ---
  setValue('#contact-phoneNumber', c.phoneNumber || '');
  setValue('#contact-address1', c.address1 || '');
  setValue('#contact-address2', c.address2 || '');
  setValue('#contact-city', c.city || '');
  setValue('#contact-postalCode', c.postalCode || '');
  setValue('#contact-province', c.province || '');

  // --- Padre/Madre/Tutor ---
  setValue('#parent-name', parent.name || '');
  setValue('#parent-relation', parent.relation || '');
  setValue('#parent-email', parent.email || '');
  setValue('#parent-phone', parent.phone || '');

  // --- Académica (básico) ---
  setValue('#academic-status', ac.status || '');
  setValue('#academic-englishLevel', ac.englishLevel || '');
  // (los arrays de studyOptions/exams los pinta initPerfilDynamicSections -> renderStudyOptions/renderExams)

  // --- Deportiva (básico) ---
  setValue('#athletic-height', at.height ?? '');
  setValue('#athletic-weight', at.weight ?? '');
  setValue('#athletic-currentTeam', at.currentTeam || '');
  setValue('#athletic-currentDivision', at.currentDivision || '');
  setValue('#athletic-dominantFoot', at.dominantFoot || '');
  // La "posición principal" y secundarias se pintan en initPerfilDynamicSections()
  refreshSpainRulesFromForm();

}

/* ==== Helpers locales para escritura segura ==== */
function setValue(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.value = value ?? '';
}
function ensureSelectOptions(selector, values = [], selected = '') {
  const sel = document.querySelector(selector);
  if (!sel) return;
  const needsInit = !(sel.options && sel.options.length > 0);
  if (needsInit) {
    const placeholder = `<option value="" disabled ${selected ? '' : 'selected'}>Selecciona...</option>`;
    sel.innerHTML = placeholder + values.map(v => `<option value="${v}">${v}</option>`).join('');
  }
  sel.value = selected || '';
}
// ---- 👇 NUEVO: pinta selects de país en español, con banderita y España primero

// --- Helpers para banderas -> ISO y nombre en español ---
function flagEmojiToISO(flag) {
  if (!flag) return '';
  const cps = Array.from(flag, ch => ch.codePointAt(0));
  // Banderas normales: 2 "Regional Indicator Symbols"
  if (cps.length === 2 && cps[0] >= 0x1F1E6 && cps[1] >= 0x1F1E6) {
    const A = 0x1F1E6; // 'A'
    const c1 = String.fromCharCode(cps[0] - A + 65);
    const c2 = String.fromCharCode(cps[1] - A + 65);
    return c1 + c2; // ej: "ES"
  }
  return ''; // otras banderas especiales (Inglaterra, etc.) caerán al fallback
}

function spanishNameFromCountry(c) {
  // 1) Intento con ISO deducido de la bandera
  const iso = flagEmojiToISO(c.emoji || '');
  try {
    if (iso && typeof Intl?.DisplayNames === 'function') {
      const dn = new Intl.DisplayNames(['es'], { type: 'region' });
      const name = dn.of(iso);
      if (name) return name;
    }
  } catch (_) {}

  // 2) Fallback manual para algunos nombres comunes
  const map = {
    'Spain': 'España',
    'United States': 'Estados Unidos',
    'United Kingdom': 'Reino Unido',
    'Czech Republic': 'Chequia',
    'Czechia': 'Chequia',
    'Germany': 'Alemania',
    'France': 'Francia',
    'Italy': 'Italia',
    'Portugal': 'Portugal',
    'Greece': 'Grecia',
    'Netherlands': 'Países Bajos',
    'Switzerland': 'Suiza',
    'Austria': 'Austria',
    'Belgium': 'Bélgica',
    'Denmark': 'Dinamarca',
    'Sweden': 'Suecia',
    'Norway': 'Noruega',
    'Finland': 'Finlandia',
    'Ireland': 'Irlanda',
    'Poland': 'Polonia',
    'Hungary': 'Hungría',
    'Romania': 'Rumanía',
    'Turkey': 'Turquía',
    'Russia': 'Rusia',
    'China': 'China',
    'Japan': 'Japón',
    'South Korea': 'Corea del Sur',
    'Australia': 'Australia',
    'Canada': 'Canadá',
    'Mexico': 'México',
    'Brazil': 'Brasil',
    'Argentina': 'Argentina',
    'Chile': 'Chile',
    'Colombia': 'Colombia',
    'Peru': 'Perú',
    'Uruguay': 'Uruguay',
    'Paraguay': 'Paraguay',
    // añade aquí cualquiera que detectes distinto
  };
  return map[c.name] || c.name || '';
}

// --- Select de PAÍS (bandera + nombre en español, España primero) ---
function ensureCountrySelect(selector, selectedValue = '') {
  const sel = document.querySelector(selector);
  if (!sel) return;

  const items = countries.map(c => ({
    emoji: (c.emoji || '').toString(),
    code: (c.code || '').toString(),   // ej: +34
    es: spanishNameFromCountry(c),     // nombre en español
    raw: c
  }));

  items.sort((a, b) => {
    const aES = a.es.toLowerCase() === 'españa' || a.code === '+34';
    const bES = b.es.toLowerCase() === 'españa' || b.code === '+34';
    if (aES && !bES) return -1;
    if (!aES && bES) return 1;
    return a.es.localeCompare(b.es, 'es', { sensitivity: 'base' });
  });

  const placeholder = `<option value="" disabled ${selectedValue ? '' : 'selected'}>Selecciona...</option>`;
  sel.innerHTML = placeholder + items.map(c =>
    `<option value="${c.es}">${c.emoji ? c.emoji + ' ' : ''}${c.es}</option>`
  ).join('');

  // normalizamos "Spain" -> "España" para preseleccionar
  const norm = v => (v && v.toString().trim().toLowerCase() === 'spain') ? 'España' : v;
  sel.value = norm(selectedValue) || '';
}

// --- Select de CÓDIGO TEL. (bandera + Nombre ES + (+código), +34 primero) ---
function ensurePhoneCodeSelect(selector, selectedValue = '') {
  const sel = document.querySelector(selector);
  if (!sel) return;

  const items = countries.map(c => ({
    emoji: (c.emoji || '').toString(),
    es: spanishNameFromCountry(c),
    value: (c.code || '').toString(),  // ej: +34
  }));

  items.sort((a, b) => {
    const aES = a.value === '+34' || a.es.toLowerCase() === 'españa';
    const bES = b.value === '+34' || b.es.toLowerCase() === 'españa';
    if (aES && !bES) return -1;
    if (!aES && bES) return 1;
    return a.es.localeCompare(b.es, 'es', { sensitivity: 'base' });
  });

  const placeholder = `<option value="" disabled ${selectedValue ? '' : 'selected'}>Selecciona...</option>`;
  sel.innerHTML = placeholder + items.map(c =>
    `<option value="${c.value}">${c.emoji ? c.emoji + ' ' : ''}${c.es} (${c.value})</option>`
  ).join('');

  sel.value = selectedValue || '';
}


function isSpain(v) {
  if (!v) return false;
  const s = v.toString().trim().toLowerCase();
  return s === 'españa' || s === 'spain';
}
// Convierte "ES" -> "🇪🇸", "US" -> "🇺🇸"
function isoToFlagEmoji(iso) {
  if (!iso || typeof iso !== 'string' || iso.length !== 2) return '';
  const A = 0x41;           // 'A'
  const REGIONAL = 0x1F1E6; // Unicode base para banderas
  const first  = iso.charCodeAt(0) - A + REGIONAL;
  const second = iso.charCodeAt(1) - A + REGIONAL;
  return String.fromCodePoint(first, second);
}

function applySpainContactRules(enable) {
  // Label de Provincia
  const provinceInput = document.getElementById('contact-province');
  const provinceLabel = provinceInput?.closest('.col-md-6')?.querySelector('.form-label');
  if (provinceLabel) provinceLabel.textContent = enable ? 'Provincia *' : 'Provincia/Estado *';

  // Código Postal
  const postal = document.getElementById('contact-postalCode');
  if (postal) {
    if (enable) {
      postal.setAttribute('pattern', '\\d{5}');
      postal.setAttribute('inputmode', 'numeric');
      postal.setAttribute('maxlength', '5');
      postal.placeholder = 'Ej: 28001';
    } else {
      postal.removeAttribute('pattern');
      postal.removeAttribute('maxlength');
      postal.placeholder = '';
    }
  }

  // Código de teléfono y país
  const phoneCodeSel = document.getElementById('contact-phoneCode');
  if (enable && phoneCodeSel && !phoneCodeSel.value) phoneCodeSel.value = '+34';

  const countrySel = document.getElementById('contact-country');
  if (enable && countrySel && !countrySel.value) countrySel.value = 'España';
}

function refreshSpainRulesFromForm() {
  const country = document.getElementById('contact-country')?.value;
  applySpainContactRules(isSpain(country));

  // Sincroniza prefijo si no lo ha tocado el usuario manualmente
  const phoneSel = document.getElementById('contact-phoneCode');
  const match = countries.find(c => spanishNameFromCountry(c) === country);
  if (phoneSel && match && (!phoneSel.value || phoneSel.value === '+34' || phoneSel.value === '')) {
    phoneSel.value = match.code || '';
  }
}

// Devuelve el nombre del país en español si tenemos un ISO-2; si no, usa el que venga
function spanishCountryLabel(c) {
  const iso = (c.iso2 || c.alpha2 || c.cca2 || c.code2 || '').toString().toUpperCase();
  try {
    if (iso && /^[A-Z]{2}$/.test(iso) && typeof Intl?.DisplayNames === 'function') {
      const dn = new Intl.DisplayNames(['es'], { type: 'region' });
      return dn.of(iso) || c.name;
    }
  } catch (_) {}
  // Fallbacks rápidos para casos típicos si tu lista no trae ISO-2
  const quickMap = { 'Spain':'España', 'United States':'Estados Unidos', 'United Kingdom':'Reino Unido', 'Germany':'Alemania',
                     'France':'Francia', 'Italy':'Italia', 'Portugal':'Portugal' };
  return quickMap[c.name] || c.name;
}

// Prepara países para UI: español + España primero + resto ordenado
function prepareCountriesForUI(list = []) {
  const normalized = list.map(c => ({
    label: spanishCountryLabel(c), // nombre en ES para mostrar
    iso: (c.iso2 || c.alpha2 || c.cca2 || c.code2 || '').toString().toUpperCase(),
    code: c.code || '',            // prefijo telefónico
    raw: c
  }));
  // España primero; luego alfabético por label (ES)
  normalized.sort((a, b) => {
    const aES = a.iso === 'ES' || a.label === 'España';
    const bES = b.iso === 'ES' || b.label === 'España';
    if (aES && !bES) return -1;
    if (!aES && bES) return 1;
    return a.label.localeCompare(b.label, 'es', { sensitivity: 'base' });
  });
  return normalized;
}

function openSocialLinkModalForAdd() {
    const modalEl = document.getElementById('social-media-modal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    editingSocialLinkIndex = null; // Reset
    document.getElementById('social-type').value = 'Instagram'; // Reset to default
    document.getElementById('social-url').value = '';
    modalEl.querySelector('.modal-title').textContent = 'Añadir Red Social';
    modal.show();
}
function openSocialLinkModalForEdit(index) {
    const modalEl = document.getElementById('social-media-modal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    const link = userProfileData.media.social[index];
    if (link) {
        editingSocialLinkIndex = index;
        document.getElementById('social-type').value = link.type;
        document.getElementById('social-url').value = link.url;
        modalEl.querySelector('.modal-title').textContent = 'Editar Red Social';
        modal.show();
    }
}
function renderSocialLinks() {
    const container = document.getElementById('social-links-container');
    if (!container) return;
    const links = userProfileData.media.social || [];
    if (links.length === 0) {
        container.innerHTML = `<p class="text-muted small">No hay redes sociales añadidas.</p>`;
        return;
    }
    container.innerHTML = links.map((link, index) => `
        <div class="input-group mb-2">
            <span class="input-group-text" style="width: 120px;">${link.type}</span>
             <a href="${link.url}" target="_blank" rel="noopener noreferrer" class="form-control text-truncate d-flex align-items-center text-decoration-none">${link.url}</a>
            <button class="btn btn-outline-primary edit-social-link-btn" type="button" data-index="${index}">Editar</button>
            <button class="btn btn-outline-danger remove-social-link-btn" type="button" data-index="${index}">Eliminar</button>
        </div>
    `).join('');
}
function removeSocialLink(index) {
  if (confirm('¿Estás seguro de que quieres eliminar esta red social?')) {
      userProfileData.media.social.splice(index, 1);
      renderSocialLinks();
  }
}
function handleSaveSocialLink() {
    const type = document.getElementById('social-type').value;
    const url = document.getElementById('social-url').value;
    if (url) {
        if (!userProfileData.media.social) userProfileData.media.social = [];
        
        if (editingSocialLinkIndex !== null) {
            userProfileData.media.social[editingSocialLinkIndex] = { type, url };
        } else {
            userProfileData.media.social.push({ type, url });
        }
        
        renderSocialLinks();
        bootstrap.Modal.getInstance(document.getElementById('social-media-modal')).hide();
        editingSocialLinkIndex = null;
    }
}
function openMultimediaModal(element = null, type, label, placeholder) {
    const modalEl = document.getElementById('multimedia-modal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    
    editingMultimediaElement = element;
    
    const typeInput = modalEl.querySelector('#multimedia-type');
    const nameLabel = modalEl.querySelector('label[for="multimedia-name"]');
    const nameInput = modalEl.querySelector('#multimedia-name');
    const urlInput = modalEl.querySelector('#multimedia-url');
    
    if (element) { // Editing existing
        const dataType = element.dataset.type;
        const dataIndex = parseInt(element.dataset.index, 10);
        const item = userProfileData.media[dataType][dataIndex];
        const currentLabel = dataType === 'highlights' ? 'Nombre del vídeo' : 'Descripción (Rival, color camiseta, dorsal)';
        
        typeInput.value = dataType;
        nameLabel.textContent = currentLabel;
        nameInput.value = item.name;
        urlInput.value = item.url;
        modalEl.querySelector('.modal-title').textContent = 'Editar Multimedia';
    } else { // Adding new
        typeInput.value = type;
        nameLabel.textContent = label;
        nameInput.placeholder = placeholder;
        nameInput.value = '';
        urlInput.value = '';
        modalEl.querySelector('.modal-title').textContent = 'Añadir Multimedia';
    }
    
    modal.show();
}
function handleSaveMultimediaLink() {
    const type = document.getElementById('multimedia-type').value;
    const name = document.getElementById('multimedia-name').value;
    const url = document.getElementById('multimedia-url').value;
    if (!name || !url || !type) return;
    if (editingMultimediaElement) { // Update existing
        const index = parseInt(editingMultimediaElement.dataset.index, 10);
        userProfileData.media[type][index] = { ...userProfileData.media[type][index], name, url };
    } else { // Add new
        if (!userProfileData.media[type]) userProfileData.media[type] = [];
        const isMain = type === 'highlights' && userProfileData.media[type].length === 0; // First highlight is main by default
        userProfileData.media[type].push({ name, url, isMain });
    }
    renderMultimediaLinks(type, userProfileData.media[type]);
    bootstrap.Modal.getInstance(document.getElementById('multimedia-modal')).hide();
    editingMultimediaElement = null;
    renderPromotionalProfile();
}
function renderMultimediaLinks(type, data) {
    const container = document.getElementById(`${type}-container`);
    if (!container) return;
    
    if (!data || data.length === 0) {
        container.innerHTML = `<p class="text-muted small">No hay ${type === 'highlights' ? 'vídeos' : 'partidos'} añadidos.</p>`;
        return;
    }
    container.innerHTML = data.map((item, index) => `
        <div class="input-group mb-2">
            <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="form-control d-flex align-items-center text-truncate text-decoration-none" title="${item.url}">${item.name}</a>
            ${type === 'highlights' ? `<button class="btn ${item.isMain ? 'btn-success' : 'btn-outline-secondary'} set-main-highlight-btn" type="button" data-index="${index}" title="Marcar como vídeo principal">★</button>` : ''}
            <button class="btn btn-outline-primary edit-multimedia-btn" type="button" data-type="${type}" data-index="${index}">Editar</button>
            <button class="btn btn-outline-danger remove-multimedia-btn" type="button" data-type="${type}" data-index="${index}">Eliminar</button>
        </div>
    `).join('');
}
// REEMPLAZA tu función removeMultimediaLink ANTIGUA por esta NUEVA VERSIÓN
function removeMultimediaLink(element) {
  const type = element.dataset.type; // Obtiene si es 'highlights' o 'matches' desde el botón
  const index = parseInt(element.dataset.index, 10); // Obtiene la posición del elemento a borrar
  const user = auth.currentUser; // Necesitamos saber qué usuario está logueado

  // Comprobación de seguridad
  if (!user) {
    console.error("No se puede eliminar porque no hay usuario autenticado.");
    return;
  }

  // Creamos el texto para la confirmación
  const itemTypeForConfirmation = type === 'highlights' ? 'vídeo' : 'partido';

  // PASO 1: Pedimos confirmación al usuario
  if (confirm(`¿Estás seguro de que quieres eliminar este ${itemTypeForConfirmation}?`)) {

    // PASO 2: Eliminamos el elemento de nuestra variable local 'userProfileData'
    const removedItem = userProfileData.media[type].splice(index, 1)[0];

    // Lógica extra: si borramos el vídeo principal, nombramos al primero que quede como principal
    if (type === 'highlights' && removedItem.isMain && userProfileData.media.highlights.length > 0) {
      userProfileData.media.highlights[0].isMain = true;
    }

    // PASO 3: Actualizamos la vista para que el cambio se vea al instante
    renderMultimediaLinks(type, userProfileData.media[type]);
    renderPromotionalProfile();

    // PASO 4: ¡CRUCIAL! Guardamos el objeto de datos (ya sin el elemento borrado) en Firestore
    saveProfileToFirestore(user.uid, userProfileData);
  }
}
function setMainHighlight(element) {
    const index = parseInt(element.dataset.index, 10);
    userProfileData.media.highlights.forEach((h, i) => {
        h.isMain = (i === index);
    });
    renderMultimediaLinks('highlights', userProfileData.media.highlights);
    renderPromotionalProfile();
}
function renderStudyOptions() {
    const container = document.getElementById('study-options-container');
    if (!container) return;
    container.innerHTML = ''; // Clear existing before rendering
    (userProfileData.academic.studyOptions || []).forEach(option => addStudyOption(option));
}
function addStudyOption(value = '') {
    const container = document.getElementById('study-options-container');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'input-group mb-2';
    div.innerHTML = `
        <input type="text" class="form-control study-option-input" value="${value}" placeholder="Ej: Business Administration">
        <button class="btn btn-outline-danger remove-study-option-btn" type="button">Eliminar</button>
    `;
    container.appendChild(div);
}
function renderExams() {
    const container = document.getElementById('exam-container');
    if (!container) return;
    container.innerHTML = ''; // Clear existing
    (userProfileData.academic.exams || []).forEach(exam => addExam(exam));
}
function addExam(exam = { type: 'Duolingo', score: ''}) {
    const container = document.getElementById('exam-container');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'input-group mb-2';
    
    const standardExams = ["Duolingo", "TOEFL", "IELTS", "SAT"];
    const isOther = !standardExams.includes(exam.type);
    
    const optionsHTML = standardExams.map(t => `<option value="${t}" ${t === exam.type ? 'selected' : ''}>${t}</option>`).join('');
    div.innerHTML = `
        <select class="form-select exam-type" style="flex-basis: 150px; flex-grow: 0;">
            ${optionsHTML}
            <option value="Otro" ${isOther ? 'selected' : ''}>Otro</option>
        </select>
        <input type="text" class="form-control exam-name-other ${isOther ? '' : 'd-none'}" placeholder="Nombre del examen" value="${isOther ? exam.type : ''}">
        <input type="text" class="form-control exam-score" value="${exam.score}" placeholder="Puntuación">
        <button class="btn btn-outline-danger remove-exam-btn" type="button">Eliminar</button>
    `;
    container.appendChild(div);
}
function generateAcademicHistory() {
    const container = document.getElementById('academic-history-container');
    if (!container) return;
    const birthDateStr = userProfileData.personal.birthDate;
    if (!birthDateStr || !/^\d{2}\/\d{2}\/\d{4}$/.test(birthDateStr)) {
        container.innerHTML = `<div class="alert alert-info">Por favor, introduce tu fecha de nacimiento en "Datos Personales" para generar tu historial académico.</div>`;
        return;
    }
    const birthYear = parseInt(birthDateStr.split('/')[2], 10);
    const currentYear = new Date().getFullYear();
    
    if ((currentYear - birthYear) < 14) {
        container.innerHTML = `<div class="alert alert-warning">El historial académico se genera para mayores de 14 años.</div>`;
        return;
    }
    container.innerHTML = ''; // Clear previous content
    
    const defaults = [
        { level: 'ESO', course: '3' },
        { level: 'ESO', course: '4' },
        { level: 'Bachillerato', course: '1' },
        { level: 'Bachillerato', course: '2' }
    ];
    
    const currentAcademicYearStart = (new Date().getMonth() < 8) ? currentYear - 1 : currentYear;
    const firstAcademicYearStart = birthYear + 14;
    
    let academicYearIndex = 0;
    for (let yearStart = firstAcademicYearStart; yearStart <= currentAcademicYearStart; yearStart++) {
        const yearEnd = yearStart + 1;
        const season = `${yearStart}-${yearEnd}`;
        const currentDefault = defaults[academicYearIndex] || null;
        
        const months = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
        const monthOptions = months.map(m => `<option>${m}</option>`).join('');
        const cardHTML = `
          <div class="card mb-3">
              <div class="card-header fw-bold">${season}</div>
              <div class="card-body">
                  <div class="row g-3">
                      <div class="col-md-4">
                          <label class="form-label">Nivel Educativo</label>
                          <select class="form-select academic-level-select">
                              <option ${!currentDefault ? 'selected' : ''} disabled>Selecciona...</option>
                              <option ${currentDefault?.level === 'ESO' ? 'selected' : ''}>ESO</option>
                              <option ${currentDefault?.level === 'Bachillerato' ? 'selected' : ''}>Bachillerato</option>
                              <option>Grado Medio</option>
                              <option>Grado Superior</option>
                              <option>Universidad</option>
                              <option>No estudié/Otro</option>
                          </select>
                      </div>
                      <div class="col-md-3 course-details">
                          <label class="form-label">Curso</label>
                          <select class="form-select academic-course-select">
                              <option ${currentDefault?.course === '1' ? 'selected' : ''}>1</option>
                              <option ${currentDefault?.course === '2' ? 'selected' : ''}>2</option>
                              <option ${currentDefault?.course === '3' ? 'selected' : ''}>3</option>
                              <option ${currentDefault?.course === '4' ? 'selected' : ''}>4</option>
                          </select>
                      </div>
                      <div class="col-md-3 university-details d-none">
                          <label class="form-label">Créditos aprobados/matriculados</label>
                          <input type="number" class="form-control" placeholder="Ej: 60">
                      </div>
                      
                      <div class="col-md-2 gpa-details">
                          <label class="form-label">Nota Media</label>
                          <input type="number" step="0.01" class="form-control" placeholder="Ej: 3.8">
                      </div>
                      <div class="col-md-3 file-details">
                          <label class="form-label">Adjuntar Notas</label>
                          <input type="file" class="form-control">
                      </div>
                  </div>
                  <div class="row g-3 mt-1">
                      <div class="col-12 other-details d-none">
                           <label class="form-label">¿Qué hiciste ese curso académico?</label>
                           <textarea class="form-control" rows="2"></textarea>
                      </div>
                  </div>
                  <div class="graduation-wrapper mt-3">
                      <div class="form-check">
                          <input class="form-check-input graduation-check" type="checkbox" id="graduated-check-${yearEnd}">
                          <label class="form-check-label" for="graduated-check-${yearEnd}">
                              Marcar si te graduaste este año
                          </label>
                      </div>
                      <div class="row g-2 mt-2 d-none graduation-details" id="graduation-details-${yearEnd}">
                          <div class="col-md-6">
                              <label class="form-label small">Mes de Graduación</label>
                              <select class="form-select form-select-sm">${monthOptions}</select>
                          </div>
                          <div class="col-md-6">
                              <label class="form-label small">Año de Graduación</label>
                              <input type="number" class="form-control form-select-sm" value="${yearEnd}">
                          </div>
                      </div>
                  </div>
              </div>
          </div>`;
        container.insertAdjacentHTML('beforeend', cardHTML);
        academicYearIndex++;
    }
    // After rendering, trigger change event for pre-selected dropdowns to show/hide correct fields
    container.querySelectorAll('.academic-level-select').forEach(select => {
      if (select.value && select.value !== 'Selecciona...') {
          select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
}
function renderSecondaryPositions() {
    const container = document.getElementById('secondary-positions-container');
    if (!container) return;
    container.innerHTML = ''; // Clear existing
    (userProfileData.athletic.secondaryPositions || []).forEach(pos => addSecondaryPosition(pos));
}
function addSecondaryPosition(value = '') {
    const container = document.getElementById('secondary-positions-container');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'input-group mb-2';
    const options = footballPositions.map(p => `<option value="${p.value}" ${p.value === value ? 'selected' : ''}>${p.text}</option>`).join('');
    div.innerHTML = `
        <select class="form-select secondary-position-select">${options}</select>
        <button class="btn btn-outline-danger remove-secondary-pos-btn" type="button">Eliminar</button>
    `;
    container.appendChild(div);
}
function renderPitchMarkers() {
    const container = document.getElementById('pitch-markers-container');
    if (!container) return;
    
    const mainPosValue = document.getElementById('athletic-mainPosition')?.value;
    const secondaryPosValues = Array.from(document.querySelectorAll('.secondary-position-select')).map(s => s.value);
    
    container.innerHTML = footballPositions.map(pos => {
        let className = 'position-marker';
        if (pos.value === mainPosValue) {
            className += ' main';
        } else if (secondaryPosValues.includes(pos.value)) {
            className += ' secondary';
        }
        return `<div class="${className}" style="top: ${pos.coords.top}; left: ${pos.coords.left};">${pos.value}</div>`;
    }).join('');
}
function generateTeamHistory() {
    const container = document.getElementById('team-history-container');
    if (!container) return;
    const birthDateStr = userProfileData.personal.birthDate;
    if (!birthDateStr || !/^\d{2}\/\d{2}\/\d{4}$/.test(birthDateStr)) {
        container.innerHTML = `<div class="alert alert-warning">Introduce una fecha de nacimiento válida en "Datos Personales" para generar tu historial de equipos.</div>`;
        return;
    }
    
    const birthDateParts = birthDateStr.split('/');
    const birthDate = new Date(parseInt(birthDateParts[2]), parseInt(birthDateParts[1]) - 1, parseInt(birthDateParts[0]));
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    
    if (age < 14) {
        container.innerHTML = `<div class="alert alert-info">El historial de equipos se genera a partir de los 14 años.</div>`;
        return;
    }
    const seasons = [];
    for (let i = age; i >= 14; i--) {
        const yearEnd = today.getFullYear() - (age - i);
        const yearStart = yearEnd - 1;
        seasons.push({ season: `${yearStart}-${yearEnd}`, age: i });
    }
    container.innerHTML = `
        <div class="row g-3 fw-bold text-muted d-none d-md-flex mb-2">
            <div class="col-md-3">Temporadas</div>
            <div class="col-md-5">Nombre del Club</div>
            <div class="col-md-4">División Categoría</div>
        </div>
        ${seasons.map(({season, age}) => `
            <div class="row g-2 mb-2 align-items-center">
                <div class="col-md-3"><label class="form-label d-md-none">Temporada (Edad)</label><input type="text" class="form-control" value="${season} (${age} años)" readonly></div>
                <div class="col-md-5"><label class="form-label d-md-none">Club</label><input type="text" class="form-control" placeholder="Nombre del club"></div>
                <div class="col-md-4"><label class="form-label d-md-none">División</label><input type="text" class="form-control" placeholder="Categoría"></div>
            </div>
        `).join('')}`;
}
function renderStats() {
  const container = document.getElementById('stats-container');
  if (!container) return;

  const stats = userProfileData.athletic.stats || {};
  const mainPos =
    document.getElementById('athletic-mainPosition')?.value ||
    userProfileData.athletic.mainPosition || '';

  // Acepta varios formatos: POR, GK, Portero, Goalkeeper
  const isGK = /(^POR$|^GK$|portero|goalkeeper)/i.test(mainPos);

  if (isGK) {
    container.innerHTML = `
      <div class="col-4">
        <label class="form-label">Partidos Jugados</label>
        <input type="number" class="form-control" id="stat-played" value="${stats.played ?? ''}">
      </div>
      <div class="col-4">
        <label class="form-label">Goles Encajados</label>
        <input type="number" class="form-control" id="stat-goalsConceded" value="${stats.goalsConceded ?? ''}">
      </div>
      <div class="col-4">
        <label class="form-label">Paradas</label>
        <input type="number" class="form-control" id="stat-saves" value="${stats.saves ?? ''}">
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="col-4">
        <label class="form-label">Partidos Jugados</label>
        <input type="number" class="form-control" id="stat-played" value="${stats.played ?? ''}">
      </div>
      <div class="col-4">
        <label class="form-label">Goles</label>
        <input type="number" class="form-control" id="stat-goals" value="${stats.goals ?? ''}">
      </div>
      <div class="col-4">
        <label class="form-label">Asistencias</label>
        <input type="number" class="form-control" id="stat-assists" value="${stats.assists ?? ''}">
      </div>
    `;
  }
}


// REEMPLAZO COMPLETO de initApp
async function initApp(user) {
  console.log('✅ initApp: usuario autenticado ->', user?.uid);

  // 1) PERFIL: crear si no existe y cargar datos reales
  try {
    // ensureProfile devuelve { id, ...datosPerfil }
    const existing = await ensureProfile(user.uid, emptyProfileData);
    const { id, ...profileData } = existing || {};
    if (profileData && Object.keys(profileData).length) {
      profileState.data = profileData;   // actualiza el estado global
      userProfileData = profileState.data; // re-vincula la referencia local
    }
  } catch (err) {
    console.error('Error cargando/creando perfil:', err);
  }

  // 2) TAREAS: precargar la caché para que Inicio no muestre 0
  await preloadTasks(user.uid);

  try {
  const existingTasks = getTasksData();
  existingTasks.forEach(t => {
    if (isTaskDone(t?.status) && t?.meta?.universityId) {
      // usa id de tarea si existe; si no, generamos una clave estable
      const key = t.id || `${t.title}|${t.due}|${t.meta.universityId}`;
      processedDoneTaskIds.add(key);
    }
  });
} catch (_) {}

  // 3) Render inicial
  renderPage('inicio'); // puedes cambiarlo a 'perfil' si prefieres aterrizar ahí
}


  
  // Main navigation
  document.getElementById('main-nav').addEventListener('show.bs.tab', (event) => {
      const pageId = event.target.getAttribute('href').substring(1);
      renderPage(pageId);
  });
  
  // --- CENTRALIZED DELEGATED EVENT LISTENERS ---
  const mainContent = document.getElementById('main-content');
  
// REEMPLAZA TU BLOQUE mainContent.addEventListener ENTERO POR ESTE
mainContent.addEventListener('click', async e => {
  const target = e.target;
  
  // --- LÓGICA PARA LOS ENLACES DE "MI PROCESO > OVERVIEW" ---
  const overviewLink = target.closest('#proceso-overview-content .list-group-item[data-target-tab]');
  if (overviewLink) {
    e.preventDefault(); // Evitamos que el enlace recargue la página
    const targetTabId = overviewLink.dataset.targetTab;
    // Buscamos el BOTÓN de la pestaña que corresponde a nuestro enlace
    const targetTabButton = document.querySelector(`#proceso-nav button[data-bs-target="#${targetTabId}"]`);
    if (targetTabButton) {
      // Usamos la magia de Bootstrap para mostrar esa pestaña
      new bootstrap.Tab(targetTabButton).show();
    }
    return; // Salimos de la función porque ya hemos manejado este clic
  }

  // --- LÓGICA PARA TODOS LOS DEMÁS BOTONES ---
  const button = target.closest('button');
  if (!button) return; // Si no es un enlace de overview NI un botón, ahora sí que no hacemos nada

  // Lógica para guardar datos del perfil
  if (button.classList.contains('save-profile-btn')) {
    const formId = button.dataset.form;
    await saveProfileData(formId);

    const statusEl = button.parentElement.querySelector('.save-status');
    if (statusEl) {
      statusEl.textContent = "¡Guardado!";
      setTimeout(() => { statusEl.textContent = ""; }, 2000);
    }
  }  
});

// ✅ Delegación global para Universidades (añadir/editar/eliminar/timeline/aceptar/rechazar + nota + nextStep)
document.body.addEventListener('click', async (e) => {
  // Añadir universidad
  const addBtn = e.target.closest('#proceso-content .add-university-btn');
  if (addBtn) {
    e.preventDefault();
    const name = (prompt('Nombre de la universidad') || '').trim();
    if (!name) return;

    if (!Array.isArray(userProfileData.universityInterest)) {
      userProfileData.universityInterest = [];
    }
    userProfileData.universityInterest.unshift({
      id: 'uni_' + Date.now(),
      name,
      status: 'Pendiente',
      offerDetails: { costs: [], scholarships: [], documentUrl: '' },
      timeline: [],
      nextStep: null
    });

    renderUniversityInterest();
    document.dispatchEvent(new Event('profile:changed'));
    if (auth.currentUser) await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    return;
  }

  // Editar nombre
  const editBtn = e.target.closest('#proceso-content .edit-university-btn');
  if (editBtn) {
    e.preventDefault();
    const id = editBtn.dataset.universityId;
    const uni = (userProfileData.universityInterest || []).find(u => u.id === id);
    if (!uni) return;

    const newName = (prompt('Nuevo nombre de la universidad', uni.name) || '').trim();
    if (!newName) return;

    uni.name = newName;
    renderUniversityInterest();
    if (auth.currentUser) await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    return;
  }

  // Eliminar (papelera a la izquierda del nombre)
  const delBtn = e.target.closest('#proceso-content .delete-university-btn');
  if (delBtn) {
    e.preventDefault();
    const id = delBtn.dataset.universityId;
    if (!confirm('¿Eliminar esta universidad?')) return;

    userProfileData.universityInterest =
      (userProfileData.universityInterest || []).filter(u => u.id !== id);

    renderUniversityInterest();
    document.dispatchEvent(new Event('profile:changed'));
    if (auth.currentUser) await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    return;
  }

  // Abrir historial (timeline)
  const tlBtn = e.target.closest('#proceso-content .open-timeline-modal-btn');
  if (tlBtn) {
    e.preventDefault();
    openUniTimelineModal(tlBtn.dataset.universityId);
    return;
  }

  // Añadir nota rápida (inline)
  const addNoteBtn = e.target.closest('#proceso-content .timeline-add-inline-btn');
  if (addNoteBtn) {
    e.preventDefault();
    const id = addNoteBtn.dataset.universityId;
    const uni = (userProfileData.universityInterest || []).find(u => u.id === id);
    if (!uni) return;
    if (!Array.isArray(uni.timeline)) uni.timeline = [];

    const input = document.querySelector(`.timeline-inline-text[data-university-id="${id}"]`);
    const text = (input?.value || '').trim();
    if (!text) return;

    uni.timeline.unshift({
      id: 'tl_' + Date.now(),
      at: new Date().toISOString(),
      author: auth.currentUser?.email || '',
      text
    });
    if (input) input.value = '';

    if (auth.currentUser) await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    renderUniversityInterest();
    return;
  }

  // Aceptar oferta
  const acceptBtn = e.target.closest('#proceso-content .accept-university-btn');
  if (acceptBtn) {
    e.preventDefault();
    const id = acceptBtn.dataset.universityId;
    const uni = (userProfileData.universityInterest || []).find(u => u.id === id);
    if (!uni) return;

    if (!hasOffer(uni)) { alert('Primero registra una oferta.'); return; }

    uni.status = 'Aceptada';
    uni.timeline = uni.timeline || [];
    uni.timeline.unshift({ id:'tl_'+Date.now(), at:new Date().toISOString(), author:auth.currentUser?.email||'', text:'Oferta aceptada' });

    // Cerrar próximo paso/tarea si existía
    await completeNextStepTask(auth.currentUser?.uid, uni);
    if (uni.nextStep) uni.nextStep.done = true;

    renderUniversityInterest();
    if (auth.currentUser) await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    return;
  }

  // Rechazar oferta
  const rejectBtn = e.target.closest('#proceso-content .reject-university-btn');
  if (rejectBtn) {
    e.preventDefault();
    const id = rejectBtn.dataset.universityId;
    const uni = (userProfileData.universityInterest || []).find(u => u.id === id);
    if (!uni) return;

    if (!hasOffer(uni)) { alert('Primero registra una oferta.'); return; }

    if (!confirm('¿Rechazar esta oferta?')) return;
    uni.status = 'Rechazada';
    uni.timeline = uni.timeline || [];
    uni.timeline.unshift({ id:'tl_'+Date.now(), at:new Date().toISOString(), author:auth.currentUser?.email||'', text:'Oferta rechazada' });

    // Cerrar próximo paso/tarea si existía
    await completeNextStepTask(auth.currentUser?.uid, uni);
    if (uni.nextStep) uni.nextStep.done = true;

    renderUniversityInterest();
    if (auth.currentUser) await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    return;
  }

  // Guardar / programar PRÓXIMO PASO
  const saveNextBtn = e.target.closest('#proceso-content .nextstep-save-btn');
  if (saveNextBtn) {
    e.preventDefault();
    const id = saveNextBtn.dataset.universityId;
    const row = saveNextBtn.closest('.row');
    const typeSel = row?.querySelector(`.nextstep-type[data-university-id="${id}"]`);
    const dateInp = row?.querySelector(`.nextstep-date[data-university-id="${id}"]`);

    const type = (typeSel?.value || '').trim();
    const dateStr = (dateInp?.value || '').trim(); // YYYY-MM-DD
    if (!type || !dateStr) { alert('Selecciona tipo y fecha.'); return; }

    const uni = (userProfileData.universityInterest || []).find(u => u.id === id);
    if (!uni) return;

    uni.nextStep = { type, dueAt: new Date(`${dateStr}T00:00:00`).toISOString(), done: false, taskId: uni.nextStep?.taskId || null };

    // Sincroniza tarea
    await ensureNextStepTask(auth.currentUser?.uid, uni);

    if (auth.currentUser) await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    renderUniversityInterest();
    return;
  }

  // Marcar PRÓXIMO PASO como hecho
  const doneNextBtn = e.target.closest('#proceso-content .nextstep-done-btn');
  if (doneNextBtn) {
    e.preventDefault();
    const id = doneNextBtn.dataset.universityId;
    const uni = (userProfileData.universityInterest || []).find(u => u.id === id);
    if (!uni || !uni.nextStep) return;

    uni.nextStep.done = true;
    await completeNextStepTask(auth.currentUser?.uid, uni);

    if (auth.currentUser) await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    renderUniversityInterest();
    return;
  }
});

// Cambiar estado desde el <select> de la columna "Estado"
document.body.addEventListener('change', async (e) => {
  const statusSel = e.target.closest('#proceso-content .uni-status-select');
  if (!statusSel) return;

  const id = statusSel.dataset.universityId;
  const newStatus = statusSel.value;
  const uni = (userProfileData.universityInterest || []).find(u => u.id === id);
  if (!uni) return;

  uni.status = newStatus;
  renderUniversityInterest();
  document.dispatchEvent(new Event('profile:changed'));
  if (auth.currentUser) await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
});

// Aceptar beca (botón en Acciones)
document.body.addEventListener('click', async (e) => {
  const acceptBtn = e.target.closest('#proceso-content .accept-offer-btn');
  if (!acceptBtn) return;

  const id = acceptBtn.dataset.universityId;
  const uni = (userProfileData.universityInterest || []).find(u => u.id === id);
  if (!uni) return;

  uni.status = 'Aceptada';
  renderUniversityInterest();
  document.dispatchEvent(new Event('profile:changed'));
  if (auth.currentUser) await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
});


  mainContent.addEventListener('change', e => {
      const target = e.target;
  });
  

  // Listeners for elements outside the main content area (modals, global buttons)
  document.getElementById('save-social-link')?.addEventListener('click', handleSaveSocialLink);
  document.getElementById('save-multimedia-link')?.addEventListener('click', handleSaveMultimediaLink);

  
  document.body.addEventListener('click', e => {
      if (e.target.matches('.open-scholarship-modal-btn')) {
          openScholarshipModal(e.target.dataset.universityId);
      }
  });
  
// === API pública para la pantalla "Mi Perfil" (usada desde profile.js) ===
window.profileAPI = {
  // estado (objeto vivo)
  get userProfileData() { return userProfileData; },
  set userProfileData(v) { userProfileData = v; },

  // helpers de datos/fechas
  toSpanishDate,
  refreshSpainRulesFromForm,

  // renderizado de UI
  renderStats,
  renderPitchMarkers,
  addStudyOption,
  addExam,
  addSecondaryPosition,

  // sociales y multimedia
  openSocialLinkModalForAdd,
  openSocialLinkModalForEdit,
  removeSocialLink,
  openMultimediaModal,
  removeMultimediaLink,
  setMainHighlight,

  // históricos
  generateAcademicHistory,
  generateTeamHistory,

  // persistencia
  saveProfileToFirestore,
};

// === Logout global, por delegación ===
document.body.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action="logout"], #logout-btn');
  if (!el) return;

  e.preventDefault(); // evita que un <a> navegue o que Bootstrap cambie de tab
  e.stopPropagation();


  console.log('Cerrando sesión…');
  signOut(auth)
    .then(() => {
      console.log('✅ Sesión cerrada');
      // Si tienes login.html, puedes redirigir:
      // window.location.href = 'login.html';
      // Si no, recarga y tu handleAuthState ya te mandará al login:
      window.location.reload();
    })
    .catch((err) => {
      console.error('Error al cerrar sesión:', err);
      alert('No se pudo cerrar la sesión. Reinténtalo.');
    });
});

// Cuando cambian las tareas en cualquier parte, si estamos en INICIO, refrescamos ese bloque
document.addEventListener('tasks:changed', async () => {
  try {
    const tasks = getTasksData(); // caché de tasks.js
    for (const t of tasks) {
      if (!t || !isTaskDone(t.status) || !t.meta?.universityId) continue;

      // clave para no duplicar entradas en el timeline
      const key = t.id || `${t.title}|${t.due}|${t.meta.universityId}`;
      if (processedDoneTaskIds.has(key)) continue;

      const uni = (userProfileData.universityInterest || []).find(u => u.id === t.meta.universityId);
      if (!uni) { processedDoneTaskIds.add(key); continue; }

      // Fecha: usa completedAt si existe; si no due; y si no, ahora
      const whenISO = t.completedAt || t.due || new Date().toISOString();
      const whenTxt = new Date(whenISO).toLocaleString('es-ES');
      const type = inferActionType(t);
      const note = (t.notes || '').trim();

      // Añadir al historial de esa universidad (arriba del todo)
      uni.timeline = uni.timeline || [];
      uni.timeline.unshift({
        id: 'tl_' + Date.now(),
        at: new Date().toISOString(),
        author: auth.currentUser?.email || '',
        text: `${type} realizada (${whenTxt})${note ? `. Notas: ${note}` : ''}`
      });

      // Persistir y refrescar UI
      if (auth.currentUser) {
        await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
      }
      renderUniversityInterest();

      // Marcar esta tarea como procesada para no repetir
      processedDoneTaskIds.add(key);
    }
  } catch (err) {
    console.error('Error procesando tareas completadas para timeline:', err);
  }

  // Mantener el snapshot de Inicio al día
  const inicioContent = document.getElementById('inicio-content');
  if (inicioContent) renderHomeTasksSnapshot(inicioContent);
});

// Cuando cambian los documentos en cualquier parte:
// - Si estamos en PROCESO, refrescamos su UI.
// - Si estamos en DOCUMENTOS, refrescamos la lista.
document.addEventListener('docs:changed', () => {
  // PROCESO
  const procesoContent = document.getElementById('proceso-content');
  if (procesoContent) {
    // idempotente (no rompe si ya estaba)
    try { initProcessFeature(); } catch (_) {}
  }

  // DOCUMENTOS
  const docsContent = document.getElementById('documentos-content');
  if (docsContent) {
    // idempotente (no rompe si ya estaba)
    try { initDocsFeature(); } catch (_) {}
  }
});

// app.js - NUEVA LÍNEA AL FINAL
handleAuthState(initApp);