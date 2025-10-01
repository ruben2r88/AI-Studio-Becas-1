// src/features/profile/academicHistory.js
import { uploadUserFile, getFileURLByPath, deleteUserFile } from '../../../services/storage.js';

/**
 * Render de historial académico (incluye manejo de subir "Adjuntar Notas")
 * Guardamos en cada curso: season, level, course, gpa, etc. y además:
 *   - notesFilePath (ruta en Storage)
 *   - notesFileName (nombre mostrado)
 */
export function renderAcademicHistory(userProfileData, userId) {
  const container = document.getElementById('academic-history-container');
  if (!container) return;

  // Validación básica de fecha de nacimiento
  const birthDateStr = userProfileData?.personal?.birthDate;
  if (!birthDateStr || !/^\d{2}\/\d{2}\/\d{4}$/.test(birthDateStr)) {
    container.innerHTML = `<div class="alert alert-info">Please enter your date of birth in "Personal Information" to generate your academic history.</div>`;
    return;
  }

  const birthYear = parseInt(birthDateStr.split('/')[2], 10);
  const currentYear = new Date().getFullYear();
  if ((currentYear - birthYear) < 14) {
    container.innerHTML = `<div class="alert alert-warning">Academic history is generated for students aged 14 or older.</div>`;
    return;
  }

  container.innerHTML = '';

  // Niveles por defecto para los 4 cursos “típicos”
  const defaults = [
    { level: 'ESO',          course: '3' },
    { level: 'ESO',          course: '4' },
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

    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const monthOptions = months.map(m => `<option>${m}</option>`).join('');

    container.insertAdjacentHTML('beforeend', `
      <div class="card mb-3" data-season="${season}">
        <div class="card-header fw-bold">${season}</div>
        <div class="card-body">
          <div class="row g-3">
            <div class="col-md-4">
              <label class="form-label">Education Level</label>
              <select class="form-select academic-level-select">
                <option ${!currentDefault ? 'selected' : ''} disabled>Select...</option>
                <option value="ESO" ${currentDefault?.level === 'ESO' ? 'selected' : ''}>ESO (Lower Secondary)</option>
                <option value="Bachillerato" ${currentDefault?.level === 'Bachillerato' ? 'selected' : ''}>Bachillerato (Upper Secondary)</option>
                <option value="Grado Medio">Intermediate Vocational</option>
                <option value="Grado Superior">Advanced Vocational</option>
                <option value="Universidad">University</option>
                <option value="No estudié/Otro">Did not study/Other</option>
              </select>
            </div>

            <div class="col-md-3 course-details">
              <label class="form-label">Year</label>
              <select class="form-select academic-course-select">
                <option ${currentDefault?.course === '1' ? 'selected' : ''}>1</option>
                <option ${currentDefault?.course === '2' ? 'selected' : ''}>2</option>
                <option ${currentDefault?.course === '3' ? 'selected' : ''}>3</option>
                <option ${currentDefault?.course === '4' ? 'selected' : ''}>4</option>
              </select>
            </div>

            <div class="col-md-3 university-details d-none">
              <label class="form-label">Credits earned/enrolled</label>
              <input type="number" class="form-control" placeholder="E.g.: 60">
            </div>

            <div class="col-md-2 gpa-details">
              <label class="form-label">Grade point average</label>
              <input type="number" step="0.01" class="form-control" placeholder="E.g.: 3.8">
            </div>

            <div class="col-md-3 file-details">
              <label class="form-label">Attach transcripts</label>
              <input type="file" class="form-control ah-file-input">
              <div class="small mt-1 d-flex align-items-center gap-2">
                <a class="ah-file-link d-none" target="_blank" rel="noopener">View file</a>
                <button type="button" class="btn btn-sm btn-outline-danger d-none ah-file-remove">Remove</button>
                <span class="text-muted ah-file-status"></span>
              </div>
            </div>
          </div>

          <div class="row g-3 mt-1">
            <div class="col-12 other-details d-none">
              <label class="form-label">What did you do during that academic year?</label>
              <textarea class="form-control" rows="2"></textarea>
            </div>
          </div>

          <div class="graduation-wrapper mt-3">
            <div class="form-check">
              <input class="form-check-input graduation-check" type="checkbox" id="graduated-check-${yearEnd}">
              <label class="form-check-label" for="graduated-check-${yearEnd}">Check if you graduated this year</label>
            </div>
            <div class="row g-2 mt-2 d-none graduation-details" id="graduation-details-${yearEnd}">
              <div class="col-md-6">
                <label class="form-label small">Graduation month</label>
                <select class="form-select form-select-sm">${monthOptions}</select>
              </div>
              <div class="col-md-6">
                <label class="form-label small">Graduation year</label>
                <input type="number" class="form-control form-select-sm" value="${yearEnd}">
              </div>
            </div>
          </div>
        </div>
      </div>
    `);

    academicYearIndex++;
  }

  // Mostrar/ocultar secciones según nivel
  container.querySelectorAll('.academic-level-select').forEach(select => {
    const cardBody = select.closest('.card-body');
    const apply = () => {
      cardBody.querySelector('.course-details')?.classList.toggle('d-none', select.value === 'Universidad' || select.value === 'No estudié/Otro');
      cardBody.querySelector('.university-details')?.classList.toggle('d-none', select.value !== 'Universidad');
      const showGpaAndFile = select.value !== 'No estudié/Otro';
      cardBody.querySelector('.gpa-details')?.classList.toggle('d-none', !showGpaAndFile);
      cardBody.querySelector('.file-details')?.classList.toggle('d-none', !showGpaAndFile);
      cardBody.querySelector('.other-details')?.classList.toggle('d-none', select.value !== 'No estudié/Otro');
      cardBody.querySelector('.graduation-wrapper')?.classList.toggle('d-none', !showGpaAndFile);
    };
    select.addEventListener('change', apply);
    apply();
  });

  // Check de graduación
  container.querySelectorAll('.graduation-check').forEach(chk => {
    const detailsDiv = chk.closest('.graduation-wrapper')?.querySelector('.graduation-details');
    const apply = () => { if (detailsDiv) detailsDiv.classList.toggle('d-none', !chk.checked); };
    chk.addEventListener('change', apply);
  });

  // --------- Cargar lo guardado (incluye link de archivo) ----------
  const saved = (userProfileData.academic && userProfileData.academic.history) || [];
  saved.forEach(async h => {
    const card = Array.from(container.querySelectorAll('.card'))
      .find(c => c.dataset.season === h.season);
    if (!card) return;

    const levelSel = card.querySelector('.academic-level-select');
    const courseSel = card.querySelector('.academic-course-select');
    const uniInput  = card.querySelector('.university-details input');
    const gpaInput  = card.querySelector('.gpa-details input');
    const gradChk   = card.querySelector('.graduation-check');
    const gradDet   = card.querySelector('.graduation-details');
    const gradMonthSel = gradDet?.querySelector('select');
    const gradYearInp  = gradDet?.querySelector('input[type="number"]');

    if (levelSel && h.level)  levelSel.value = h.level;
    if (courseSel && h.course) courseSel.value = h.course;
    if (uniInput && h.uniCredits != null) uniInput.value = h.uniCredits;
    if (gpaInput && h.gpa != null) gpaInput.value = h.gpa;
    if (levelSel) levelSel.dispatchEvent(new Event('change', { bubbles: true }));

    if (gradChk && h.graduated) {
      gradChk.checked = true;
      if (gradDet) gradDet.classList.remove('d-none');
      if (gradMonthSel && h.gradMonth) gradMonthSel.value = h.gradMonth;
      if (gradYearInp  && h.gradYear)  gradYearInp.value  = h.gradYear;
    }

    // vínculo del archivo si existe
    if (h.notesFilePath) {
      const link = card.querySelector('.ah-file-link');
      const rmBtn = card.querySelector('.ah-file-remove');
      try {
        const url = await getFileURLByPath(h.notesFilePath);
        if (link) {
          link.href = url;
          link.textContent = h.notesFileName || 'View file';
          link.classList.remove('d-none');
        }
        if (rmBtn) rmBtn.classList.remove('d-none');
        // guardamos en dataset para readAcademicHistoryFromUI
        card.dataset.notesFilePath = h.notesFilePath;
        card.dataset.notesFileName = h.notesFileName || '';
      } catch (_) {}
    }
  });

  // ====== Handlers de archivo (subir / quitar) ======
  function wireFileField(card) {
    const season = card.dataset.season;
    const input  = card.querySelector('.ah-file-input');
    const link   = card.querySelector('.ah-file-link');
    const rmBtn  = card.querySelector('.ah-file-remove');
    const status = card.querySelector('.ah-file-status');

    const setStatus = (msg) => { if (status) status.textContent = msg || ''; };

    // Subida
    async function onFileChange(e) {
      const file = e.target.files?.[0];
      if (!file || !userId) return;

      try {
        setStatus('Uploading...');
        // Si ya hay uno, lo borramos (evita huérfanos)
        const previousPath = card.dataset.notesFilePath;
        if (previousPath) {
          try { await deleteUserFile(previousPath); } catch (_) {}
        }

        // Subimos a users/{uid}/docs/academic/{season}/<nombre>
        const { fullPath, url, name } = await uploadUserFile(userId, file, { folder: `academic/${season}` });
        card.dataset.notesFilePath = fullPath;
        card.dataset.notesFileName = name || file.name;

        if (link) {
          link.href = url;
          link.textContent = name || file.name;
          link.classList.remove('d-none');
        }
        if (rmBtn) rmBtn.classList.remove('d-none');
        setStatus('Done ✓');

        // Permite volver a elegir el mismo nombre de archivo después
        e.target.value = '';
      } catch (err) {
        console.error('Error uploading transcripts:', err);
        setStatus('Upload error');
        alert('Could not upload the transcript file.');
      }
    }

    input?.addEventListener('change', onFileChange);

    // Quitar
    rmBtn?.addEventListener('click', async () => {
      const path = card.dataset.notesFilePath;
      if (!path) return;
      if (!confirm('Remove the attached file for this year?')) return;
      try { await deleteUserFile(path); } catch (_) {}

      // Limpia estado visual y datasets
      card.dataset.notesFilePath = '';
      card.dataset.notesFileName = '';
      if (link) {
        link.href = '#';
        link.textContent = '';
        link.classList.add('d-none');
      }
      rmBtn.classList.add('d-none');
      setStatus('');

      // Re-crea el <input type="file"> y vuelve a enganchar onFileChange
      const fresh = input.cloneNode(true);
      input.replaceWith(fresh);
      fresh.addEventListener('change', onFileChange);
    });
  }

  // Conecta handlers en todas las tarjetas
  container.querySelectorAll('.card').forEach(wireFileField);
}

/** Lee el DOM y devuelve array con todos los cursos + referencia del archivo */
export function readAcademicHistoryFromUI() {
  const cards = document.querySelectorAll('#academic-history-container .card');
  return Array.from(cards).map(card => {
    const season = card.dataset.season || (card.querySelector('.card-header')?.textContent.trim() || '');
    const levelSel = card.querySelector('.academic-level-select');
    const courseSel = card.querySelector('.academic-course-select');
    const uniInput  = card.querySelector('.university-details input');
    const gpaInput  = card.querySelector('.gpa-details input');
    const gradChk   = card.querySelector('.graduation-check');
    const gradDet   = card.querySelector('.graduation-details');
    const gradMonthSel = gradDet?.querySelector('select');
    const gradYearInp  = gradDet?.querySelector('input[type="number"]');

    return {
      season,
      level: levelSel?.value || '',
      course: courseSel?.value || '',
      uniCredits: uniInput?.value || '',
      gpa: gpaInput?.value || '',
      graduated: !!gradChk?.checked,
      gradMonth: gradMonthSel?.value || '',
      gradYear:  gradYearInp?.value  || '',
      // Referencia del archivo en Storage (si existe)
      notesFilePath: card.dataset.notesFilePath || '',
      notesFileName: card.dataset.notesFileName || ''
    };
  });
}
