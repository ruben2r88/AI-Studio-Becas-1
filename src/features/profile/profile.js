// src/features/profile/profile.js
// Engancha (solo una vez) los eventos de la pantalla "Mi Perfil".

import { auth } from "../../../services/auth.js";

export function initProfileFeature() {
  wirePerfilClicks();
  wirePerfilChanges();
  wireUniversityDecision();
}

/* =========================
   1) CLICS dentro de #perfil-content
   ========================= */
function wirePerfilClicks() {
  const mainContent = document.getElementById("main-content");
  if (!mainContent || mainContent.dataset.perfilClicks === "1") return;
  mainContent.dataset.perfilClicks = "1";

  mainContent.addEventListener("click", (e) => {
    const target = e.target;
    const button = target.closest("button");
    const withinPerfil = target.closest("#perfil-content");
    if (!withinPerfil) return;

    const p = window.profileAPI; // API expuesta por app.js

    // Botones "Añadir" / "Editar" / "Eliminar" de Mi Perfil
    if (button?.id === "add-social-link-btn") p.openSocialLinkModalForAdd();
    if (button?.id === "add-study-option-btn") p.addStudyOption();
    if (button?.id === "add-exam-btn") p.addExam();
    if (button?.id === "add-secondary-pos-btn") p.addSecondaryPosition();
    if (button?.id === "add-highlights-btn") p.openMultimediaModal(null, "highlights", "Video name", "Highlights 2024");
    if (button?.id === "add-match-btn") p.openMultimediaModal(null, "matches", "Description (Opponent, jersey color, jersey number)", "vs Team X - White #10");

    if (button?.classList.contains("edit-social-link-btn")) p.openSocialLinkModalForEdit(parseInt(button.dataset.index, 10));
    if (button?.classList.contains("remove-social-link-btn")) p.removeSocialLink(parseInt(button.dataset.index, 10));
    if (button?.classList.contains("edit-multimedia-btn")) p.openMultimediaModal(button);
    if (button?.classList.contains("remove-multimedia-btn")) p.removeMultimediaLink(button);
    if (button?.classList.contains("set-main-highlight-btn")) p.setMainHighlight(button);

    if (button?.classList.contains("remove-study-option-btn")) { button.closest(".input-group")?.remove(); }
    if (button?.classList.contains("remove-exam-btn")) { button.closest(".input-group")?.remove(); }
    if (button?.classList.contains("remove-secondary-pos-btn")) { button.closest(".input-group")?.remove(); p.renderPitchMarkers(); }
  });
}

/* =========================
   2) CAMBIOS dentro de #perfil-content
   ========================= */
function wirePerfilChanges() {
  const mainContent = document.getElementById("main-content");
  if (!mainContent || mainContent.dataset.perfilChanges === "1") return;
  mainContent.dataset.perfilChanges = "1";

  mainContent.addEventListener("change", (e) => {
    const target = e.target;
    const withinPerfil = target.closest("#perfil-content");
    if (!withinPerfil) return;

    const p = window.profileAPI;

    // País -> reglas de España (provincia, postal, prefijo)
    if (target.id === "contact-country") {
      p.refreshSpainRulesFromForm();
    }

    // Posiciones -> redibuja marcadores + cambia stats si cambia la principal
    if (target.matches("#athletic-mainPosition, .secondary-position-select")) {
      p.renderPitchMarkers();
      if (target.id === "athletic-mainPosition") p.renderStats();
    }

    // Fecha de nacimiento -> genera históricos
    if (target.id === "personal-birthDate") {
      const data = p.userProfileData;
      data.personal.birthDate = p.toSpanishDate(target.value);
      p.generateAcademicHistory();
      p.generateTeamHistory();
    }

    // Mostrar/ocultar campos según selección
    if (target.classList.contains("graduation-check")) {
      const detailsDiv = target.closest(".graduation-wrapper")?.querySelector(".graduation-details");
      if (detailsDiv) detailsDiv.classList.toggle("d-none", !target.checked);
    }
    if (target.classList.contains("academic-level-select")) {
      const cardBody = target.closest(".card-body");
      cardBody.querySelector(".course-details")?.classList.toggle("d-none", target.value === "Universidad" || target.value === "No estudié/Otro");
      cardBody.querySelector(".university-details")?.classList.toggle("d-none", target.value !== "Universidad");
      cardBody.querySelector(".other-details")?.classList.toggle("d-none", target.value !== "No estudié/Otro");
      const show = target.value !== "No estudié/Otro";
      cardBody.querySelector(".gpa-details")?.classList.toggle("d-none", !show);
      cardBody.querySelector(".file-details")?.classList.toggle("d-none", !show);
      cardBody.querySelector(".graduation-wrapper")?.classList.toggle("d-none", !show);
    }
    if (target.classList.contains("exam-type")) {
      const otherNameInput = target.closest(".input-group")?.querySelector(".exam-name-other");
      if (otherNameInput) otherNameInput.classList.toggle("d-none", target.value !== "Otro");
    }
  });
}

/* =========================
   3) CAMBIO fuera (#universities)
   ========================= */
function wireUniversityDecision() {
  document.body.addEventListener("change", (e) => {
    if (!e.target.matches(".university-decision-select")) return;
    const p = window.profileAPI;
    const data = p.userProfileData;
    const uniId = e.target.dataset.universityId;
    const decision = e.target.value;
    const uni = (data.universityInterest || []).find(u => u.id === uniId);
    if (!uni) return;
    uni.playerDecision = decision;
    if (auth.currentUser) p.saveProfileToFirestore(auth.currentUser.uid, data);
  });
}
