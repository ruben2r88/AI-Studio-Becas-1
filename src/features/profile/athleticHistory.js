// src/features/profile/athleticHistory.js

// Renderiza el historial de equipos en #team-history-container
export function renderTeamHistory(userProfileData) {
  const container = document.getElementById('team-history-container');
  if (!container) return;

  const birthDateStr = userProfileData?.personal?.birthDate;
  if (!birthDateStr || !/^\d{2}\/\d{2}\/\d{4}$/.test(birthDateStr)) {
    container.innerHTML = `<div class="alert alert-warning">Introduce una fecha de nacimiento válida en "Datos Personales" para generar tu historial de equipos.</div>`;
    return;
  }

  const [d, m, y] = birthDateStr.split('/').map(Number);
  const birthDate = new Date(y, m - 1, d);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const mm = today.getMonth() - birthDate.getMonth();
  if (mm < 0 || (mm === 0 && today.getDate() < birthDate.getDate())) age--;

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
      <div class="row g-2 mb-2 align-items-center" data-season="${season}">
        <div class="col-md-3">
          <label class="form-label d-md-none">Temporada (Edad)</label>
          <input type="text" class="form-control" value="${season} (${age} años)" readonly>
        </div>
        <div class="col-md-5">
          <label class="form-label d-md-none">Club</label>
          <input type="text" class="form-control" placeholder="Nombre del club">
        </div>
        <div class="col-md-4">
          <label class="form-label d-md-none">División</label>
          <input type="text" class="form-control" placeholder="Categoría">
        </div>
      </div>
    `).join('')}
  `;

  // Rellenar con lo guardado
  const saved = (userProfileData.athletic && userProfileData.athletic.teamHistory) || [];
  const rows = container.querySelectorAll('.row.g-2.mb-2.align-items-center');
  rows.forEach(row => {
    const seasonInput = row.querySelector('input');
    const season = seasonInput?.value.split('(')[0].trim();
    const rec = saved.find(r => r.season === season);
    if (!rec) return;
    const inputs = row.querySelectorAll('input');
    if (inputs[1]) inputs[1].value = rec.club || '';
    if (inputs[2]) inputs[2].value = rec.division || '';
  });
}

// Lee los datos del DOM y devuelve el array listo para guardar
export function readTeamHistoryFromUI() {
  const rows = document.querySelectorAll('#team-history-container .row.g-2.mb-2.align-items-center');
  return Array.from(rows).map(row => {
    const inputs = row.querySelectorAll('input');
    const seasonAge = inputs[0]?.value || '';
    const season = seasonAge.split('(')[0].trim();
    const club = inputs[1]?.value || '';
    const division = inputs[2]?.value || '';
    return { season, club, division };
  }).filter(x => x.club || x.division);
}
