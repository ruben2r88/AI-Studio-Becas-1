// File: app.coaches.js — Build: 2025-11-25T11:45Z
    // ---------------------------
    // Router por hash (visto en Paso 2)
    // ---------------------------
    (function () {
      const main = document.getElementById('main-content');
      const tabs = document.querySelectorAll('#coaches-tabs .nav-link');
      const VIEW_MAP = {
        dashboard: 'views/coaches/dashboard.html',
        players:   'views/coaches/players.html',
        favorites: 'views/coaches/favorites.html',
        'my-needs':'views/coaches/my-needs.html',
        chat:      'views/coaches/chat.html',
        'coaches-player': 'views/coaches/player.html',
      };
      const VIEW_TAB_ALIASES = {
        'coaches-player': 'players',
      };

      async function loadView(view) {
        const url = VIEW_MAP[view] || VIEW_MAP.dashboard;
        try {
          const res = await fetch(url, { cache: 'no-cache' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const html = await res.text();
          main.innerHTML = html;
          setActive(view);
          // Hooks por vista
          if (view === 'players') initPlayersView();
          if (view === 'dashboard') initDashboardView();
          if (view === 'my-needs') initMyNeedsView();
          if (view === 'coaches-player') initPlayerProfileView();
        } catch (e) {
          main.innerHTML = '<div class="alert alert-light border">This view is not ready yet.</div>';
          setActive(view);
        }
      }

      function setActive(view) {
        const activeView = VIEW_TAB_ALIASES[view] || view;
        tabs.forEach(a => a.classList.toggle('active', a.dataset.view === activeView));
      }
      function getHashView() {
        const h = (location.hash || '').replace('#','').trim();
        return h && VIEW_MAP[h] ? h : 'dashboard';
      }
      window.addEventListener('hashchange', () => loadView(getHashView()));
      document.addEventListener('DOMContentLoaded', () => loadView(getHashView()));

    // ---------------------------
    // Players: datos + UI + lógica
    // ---------------------------
    // Si tienes jugadores reales, publícalos como window.eturePlayers = [...]
    // Shape esperado (mínimo):
    // { id, name, club, country, category, positions:[], status, gpa, heightCm, weightKg }
    const coachesPlayers = [
      {id:'p1', name:'Vicent Abaso', club:'CD Vinaròs', country:'Spain', stateProvince:'Castellón', category:'Third Division', positions:['CM','RM'], status:'Transfer', gpa:null, heightCm:180, weightKg:78},
      {id:'p2', name:'Lucía Santos', club:'Eture FC', country:'Spain', stateProvince:'Madrid', category:'Youth National League', positions:['CB'], status:'Freshman', gpa:3.5, heightCm:172, weightKg:64},
      {id:'p3', name:'Diego Ramos', club:'Eture FC', country:'Spain', stateProvince:'Madrid', category:'Regional Preferente', positions:['ST'], status:'Graduate', gpa:3.2, heightCm:183, weightKg:76},
      {id:'p4', name:'Marcos Pérez', club:'ICAP Year', country:'USA', stateProvince:'Florida', category:'Eture FC A', positions:['GK'], status:'Freshman', gpa:3.8, heightCm:188, weightKg:82},
      {id:'p5', name:'Sofía Martín', club:'Scholarship ES', country:'Spain', stateProvince:'Castellón', category:'Academy League', positions:['CM'], status:'Transfer', gpa:3.9, heightCm:167, weightKg:58},
      {id:'p6', name:'Álvaro Ruiz', club:'Eture FC', country:'Spain', stateProvince:'Madrid', category:'Regional Preferente', positions:['CB'], status:'Graduate', gpa:null, heightCm:185, weightKg:80},
      {id:'p7', name:'Julia Gómez', club:'ICAP Year', country:'USA', stateProvince:'Texas', category:'Vinaros CF B', positions:['ST','LW'], status:'Freshman', gpa:3.6, heightCm:170, weightKg:60},
      {id:'p8', name:'Leo Ortega', club:'Scholarship ES', country:'Spain', stateProvince:'Castellón', category:'Third Division', positions:['CM'], status:'Transfer', gpa:3.4, heightCm:177, weightKg:72},
      {id:'p9', name:'Nerea Vidal', club:'Eture FC', country:'Spain', stateProvince:'Madrid', category:'Youth National League', positions:['GK'], status:'Freshman', gpa:3.7, heightCm:179, weightKg:70},
      {id:'p10', name:'Hugo López', club:'ICAP Year', country:'USA', stateProvince:'Texas', category:'Gap Year', positions:['CB'], status:'Graduate', gpa:3.1, heightCm:186, weightKg:81},
      {id:'p11', name:'Paula Núñez', club:'Scholarship ES', country:'Spain', stateProvince:'Madrid', category:'Academy League', positions:['RM','CM'], status:'Freshman', gpa:3.3, heightCm:168, weightKg:59},
      {id:'p12', name:'Carlos Vega', club:'Eture FC', country:'Spain', stateProvince:'Castellón', category:'Regional Preferente', positions:['ST'], status:'Transfer', gpa:3.0, heightCm:182, weightKg:77},
    ];
    const coachesNeeds = [];
    const PLAYER_DETAIL_VIEW = 'coaches-player';
    const PLAYER_PROFILE_STORAGE_KEY = 'eture.selectedPlayerId';

    function getAllPlayers() {
      try {
        if (Array.isArray(window.eturePlayers) && window.eturePlayers.length) return window.eturePlayers;
      } catch(_) {}
      return coachesPlayers;
    }

    function normalizeFilterValue(value) {
      if (value == null) return '';
      const trimmed = String(value).trim();
      if (!trimmed || trimmed.toLowerCase() === 'any') return '';
      return trimmed.toUpperCase();
    }

    function playerHasPosition(player, normalizedPos) {
      if (!normalizedPos) return true;
      const single = player.position ? String(player.position).trim().toUpperCase() : '';
      if (single && single === normalizedPos) return true;
      if (Array.isArray(player.positions)) {
        return player.positions.some(pos => String(pos).trim().toUpperCase() === normalizedPos);
      }
      return false;
    }

    function playerHasStatus(player, normalizedStatus) {
      if (!normalizedStatus) return true;
      const status = player.status ? String(player.status).trim().toUpperCase() : '';
      return status === normalizedStatus;
    }

    function playerCategory(player) {
      return player?.category ?? player?.program ?? '';
    }

    function filterPlayers(players, filters={}) {
      if (!Array.isArray(players)) return [];
      const {
        position='',
        status='',
        category='',
        country='',
        gpaMin='any',
        stateProvince=''
      } = filters || {};

      const normalizedPos = normalizeFilterValue(position);
      const normalizedStatus = normalizeFilterValue(status);
      const normalizedCategory = normalizeFilterValue(category);
      const normalizedCountry = normalizeFilterValue(country);
      const normalizedState = normalizeFilterValue(stateProvince);
      const gpaRaw = (gpaMin == null ? '' : String(gpaMin).trim());
      const gpaThreshold = gpaRaw && gpaRaw.toLowerCase() !== 'any' ? parseFloat(gpaRaw) : null;

      return players.filter(player => {
        const matchesPos = !normalizedPos || playerHasPosition(player, normalizedPos);
        const matchesStatus = !normalizedStatus || playerHasStatus(player, normalizedStatus);
        const matchesCategory = !normalizedCategory || normalizeFilterValue(playerCategory(player)) === normalizedCategory;
        const matchesCountry = !normalizedCountry || normalizeFilterValue(player.country) === normalizedCountry;
        const numericGpa = typeof player.gpa === 'number' ? player.gpa : 0;
        const matchesGpa = gpaThreshold == null || numericGpa >= gpaThreshold;
        const matchesState = !normalizedState || normalizeFilterValue(player.stateProvince) === normalizedState;
        return matchesPos && matchesStatus && matchesCategory && matchesCountry && matchesGpa && matchesState;
      });
    }

    function initPlayerProfileView() {
      // Wire the "Back to players" button in the full player profile view
      var backBtn = document.querySelector('[data-coaches-back]');

      if (backBtn) {
        backBtn.addEventListener('click', function (event) {
          event.preventDefault();
          // Navigate back to the players view (hash router will load the list)
          window.location.hash = '#players';
        });
      }

      var profileFavBtn = document.querySelector('.player-profile-fav-btn[data-fav-toggle]');
      if (profileFavBtn) {
        profileFavBtn.addEventListener('click', function (event) {
          event.preventDefault();
          var playerId = profileFavBtn.getAttribute('data-player-id') || '';
          console.log('[Favorites] Toggle requested for player ID:', playerId);
          profileFavBtn.classList.toggle('is-favorite');
        });
      }
    }

    function initPlayersView() {
      const $ = (sel, ctx=document) => ctx.querySelector(sel);
      const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));
      const wrap = document; // view ya está en main
      const selPos = $('#filter-position', wrap);
      const selStatus = $('#filter-status', wrap);
      const selCategory = $('#playersCategoryFilter', wrap);
      const selCountry = $('#playersCountryFilter', wrap);
      const selGpa = $('#playersGpaFilter', wrap);
      const selState = $('#playersStateFilter', wrap);
      const btnSearch = $('#btn-search', wrap);
      const btnGrid = $('#btn-grid', wrap);
      const btnList = $('#btn-list', wrap);
      const results = $('#players-results', wrap);
      const pager = $('#players-pager', wrap);
      if (!results || !pager || !btnGrid || !btnList || !selPos || !selStatus) return;
      const detailViewKey = (results?.dataset.playerView || PLAYER_DETAIL_VIEW).replace(/^#/, '');
      const goToPlayerProfile = (playerId, viewOverride) => {
        if (playerId) {
          localStorage.setItem(PLAYER_PROFILE_STORAGE_KEY, playerId);
        }
        const normalizedView = (viewOverride || detailViewKey || '').replace(/^#/, '');
        if (normalizedView) {
          location.hash = `#${normalizedView}`;
        }
      };
      let currentQuickviewPlayerId = null;

      function getPlayerById(playerId) {
        const list = (typeof getAllPlayers === 'function')
          ? getAllPlayers()
          : (Array.isArray(coachesPlayers) ? coachesPlayers : []);
        if (!list || !list.length) return null;

        return list.find((p) => {
          const id = p.id ?? p.playerId ?? p.uuid;
          return String(id) === String(playerId);
        }) || null;
      }

      function openPlayerQuickview(playerId) {
        const quickviewRoot = document.getElementById('player-quickview');
        if (!quickviewRoot) {
          console.warn('Quickview container #player-quickview not found');
          return;
        }

        const player = getPlayerById(playerId);
        if (!player) {
          console.warn('Player not found for quickview:', playerId);
          return;
        }

        currentQuickviewPlayerId = playerId;

        const nameEl = quickviewRoot.querySelector('.player-quickview__name');
        const posEl = quickviewRoot.querySelector('.player-quickview__position');
        const clubEl = quickviewRoot.querySelector('.player-quickview__club');
        const statusEl = quickviewRoot.querySelector('.player-quickview__status');
        const categoryEl = quickviewRoot.querySelector('.player-quickview__category');
        const summaryEl = quickviewRoot.querySelector('.player-quickview__summary');

        if (nameEl) nameEl.textContent = player.name || player.fullName || '';
        if (posEl) posEl.textContent = player.position || player.primaryPosition || '';
        if (clubEl) clubEl.textContent = player.club || player.currentClub || '';
        if (statusEl) statusEl.textContent = player.status || player.academicStatus || '';
        if (categoryEl) categoryEl.textContent = player.category || player.programCategory || '';
        if (summaryEl) {
          summaryEl.textContent =
            player.summary ||
            player.bio ||
            'More details will be available in the full profile.';
        }

        const quickviewFavBtn = quickviewRoot.querySelector('.player-quickview-fav-btn[data-fav-toggle]');
        if (quickviewFavBtn) {
          quickviewFavBtn.setAttribute('data-player-id', String(playerId));
          quickviewFavBtn.classList.remove('is-favorite');
        }

        quickviewRoot.classList.add('is-open');
        quickviewRoot.setAttribute('aria-hidden', 'false');
        quickviewRoot.dataset.playerId = String(playerId);
      }

      function closePlayerQuickview() {
        const quickviewRoot = document.getElementById('player-quickview');
        if (!quickviewRoot) return;

        quickviewRoot.classList.remove('is-open');
        quickviewRoot.setAttribute('aria-hidden', 'true');
        delete quickviewRoot.dataset.playerId;
        currentQuickviewPlayerId = null;
      }

      function initPlayerQuickviewEvents() {
        const quickviewRoot = document.getElementById('player-quickview');
        if (!quickviewRoot) return;

        quickviewRoot.querySelectorAll('[data-player-quickview-close]')
          .forEach((el) => {
            el.addEventListener('click', (event) => {
              event.preventDefault();
              closePlayerQuickview();
            });
          });

        const fullBtn = quickviewRoot.querySelector('[data-player-quickview-full-profile]');
        if (fullBtn) {
          fullBtn.addEventListener('click', (event) => {
            event.preventDefault();
            if (!currentQuickviewPlayerId) {
              console.warn('No currentQuickviewPlayerId when opening full profile');
              return;
            }
            goToPlayerProfile(currentQuickviewPlayerId);
            closePlayerQuickview();
          });
        }

        quickviewRoot.addEventListener('click', (event) => {
          const favBtn = event.target.closest('.player-quickview-fav-btn[data-fav-toggle]');
          if (!favBtn || !quickviewRoot.contains(favBtn)) return;

          event.stopPropagation();
          const playerId = favBtn.getAttribute('data-player-id') || quickviewRoot.dataset.playerId || '';
          console.log('[Favorites] Toggle requested for player ID:', playerId);
          favBtn.classList.toggle('is-favorite');
        });
      }
      const EMPTY_RESULTS_TEXT = 'No players found for the selected filters.';

      // Estado
      const STATE = { 
        mode:'grid', 
        page:1, 
        pageSize:12, 
        pos: selPos?.value || '', 
        status: selStatus?.value || '',
        category: selCategory?.value || 'any',
        country: selCountry?.value || 'any',
        gpaMin: selGpa?.value || 'any',
        stateProvince: selState?.value || 'any'
      };

      function paginate(items) {
        const start = (STATE.page - 1) * STATE.pageSize;
        return items.slice(start, start + STATE.pageSize);
      }

      function renderGrid(items) {
        if (!items.length) {
          results.innerHTML = `<div class="col-12"><div class="alert alert-light border text-center py-4">${EMPTY_RESULTS_TEXT}</div></div>`;
          return;
        }
        results.innerHTML = items.map(p => {
          const categoryLabel = playerCategory(p);
          return `
          <div class="col-12 col-md-4">
            <div class="card player-card coach-player-card shadow-sm h-100 d-flex flex-column" data-id="${p.id}">
              <div class="card-body coach-player-card-body d-flex flex-column align-items-center text-center h-100">
                <button
                  class="player-fav-btn"
                  type="button"
                  data-fav-toggle
                  data-player-id="${p.id}"
                  aria-label="Add to favorites"
                >
                  +
                </button>
                <div class="coach-player-avatar rounded-circle bg-secondary-subtle mb-3"></div>
                <h5 class="player-name mb-1">${p.name}</h5>
                <div class="player-position text-muted small mb-2">${p.positions?.[0] ?? 'N/A'}</div>
                <div class="player-club text-muted small mb-3">${[p.club, p.country].filter(Boolean).join(' • ') || '—'}</div>
                <div class="coach-player-chips d-flex flex-wrap justify-content-center gap-2 mb-1 w-100">
                  <span class="badge-eture-soft">GPA ${p.gpa ?? 'N/A'}</span>
                  <span class="badge-eture-soft">Height ${p.heightCm ?? '—'}cm</span>
                  <span class="badge-eture-soft">Weight ${p.weightKg ?? '—'}kg</span>
                </div>
                <div class="coach-player-chips d-flex flex-wrap justify-content-center gap-2 mb-3 w-100">
                  <span class="badge-eture">${categoryLabel}</span>
                  <span class="badge-eture-soft">${p.status ?? ''}</span>
                </div>
                <button
                  type="button"
                  class="btn btn-outline-danger btn-sm rounded-pill coach-view-profile-btn w-auto mt-auto mx-auto"
                  data-view="${detailViewKey}"
                  data-player-id="${p.id}"
                >View profile</button>
              </div>
            </div>
          </div>
        `;
        }).join('');
        // click → QuickView
        $$('.player-card', results).forEach(card => {
          card.addEventListener('click', (event) => {
            if (event.target.closest('[data-fav-toggle]')) return;
            openPlayerQuickview(card.dataset.id);
          });
        });
        $$('.coach-view-profile-btn', results).forEach(btn => {
          btn.addEventListener('click', (event) => {
            event.stopPropagation();
            const card = btn.closest('[data-id]');
            const playerId = btn.dataset.playerId || card?.dataset.id || '';
            openPlayerQuickview(playerId);
          });
        });
      }

      function renderList(items) {
        const rows = items.length
          ? items.map(p => {
              const categoryLabel = playerCategory(p);
              return `
              <tr data-id="${p.id}" class="player-row" style="cursor:pointer">
                <td>${p.name}</td>
                <td>${p.positions?.[0] ?? ''}</td>
                <td><span class="badge-eture-soft">${p.status ?? ''}</span></td>
                <td><span class="badge-eture">${categoryLabel}</span></td>
                <td>${p.gpa ?? 'N/A'}</td>
                <td>${p.heightCm ?? '—'}cm</td>
                <td>${p.weightKg ?? '—'}kg</td>
                <td>${p.club ?? ''}</td>
                <td>${p.country ?? ''}</td>
                <td class="text-end">
                  <button
                    type="button"
                    class="btn btn-outline-danger btn-sm coach-view-profile-btn"
                    data-view="${detailViewKey}"
                    data-player-id="${p.id}"
                  >View profile</button>
                  <button
                    class="player-fav-btn player-fav-btn--list"
                    type="button"
                    data-fav-toggle
                    data-player-id="${p.id}"
                    aria-label="Add to favorites"
                  >
                    +
                  </button>
                </td>
              </tr>
            `;
            }).join('')
          : `<tr><td colspan="10" class="text-center text-muted py-3">${EMPTY_RESULTS_TEXT}</td></tr>`;

        results.innerHTML = `
          <div class="col-12">
            <div class="table-responsive">
              <table class="table table-sm align-middle">
                <thead><tr>
                  <th>Name</th><th>Pos</th><th>Status</th><th>Category</th><th>GPA</th><th>Ht</th><th>Wt</th><th>Club</th><th>Country</th><th class="text-end">Profile</th>
                </tr></thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>
            </div>
          </div>`;
        if (!items.length) return;
        // click → QuickView
        $$('.player-row', results).forEach(row => {
          row.addEventListener('click', (event) => {
            if (event.target.closest('[data-fav-toggle]')) return;
            openPlayerQuickview(row.dataset.id);
          });
        });
        $$('.coach-view-profile-btn', results).forEach(btn => {
          btn.addEventListener('click', (event) => {
            event.stopPropagation();
            const row = btn.closest('[data-id]');
            const playerId = btn.dataset.playerId || row?.dataset.id || '';
            openPlayerQuickview(playerId);
          });
        });
      }

      // Simple favorites toggle logger (UI only for now)
      results.addEventListener('click', (event) => {
        const favBtn = event.target.closest('[data-fav-toggle]');
        if (!favBtn || !results.contains(favBtn)) return;

        event.stopPropagation();
        const playerId = favBtn.getAttribute('data-player-id') || '';
        console.log('[Favorites] Toggle requested for player ID:', playerId);

        // Simple visual feedback toggle (no persistence yet)
        favBtn.classList.toggle('is-favorite');
      });

      function renderPager(total) {
        const pages = Math.max(1, Math.ceil(total / STATE.pageSize));
        const canPrev = STATE.page > 1;
        const canNext = STATE.page < pages;
        pager.innerHTML = `
          <div class="d-flex justify-content-between align-items-center mt-3">
            <div class="small text-muted">Page ${STATE.page} of ${pages} • ${total} players</div>
            <div class="btn-group">
              <button class="btn btn-outline-secondary btn-sm" id="pg-prev" ${canPrev?'':'disabled'}>Prev</button>
              <button class="btn btn-outline-secondary btn-sm" id="pg-next" ${canNext?'':'disabled'}>Next</button>
            </div>
          </div>`;
        $('#pg-prev', pager)?.addEventListener('click', () => { 
          STATE.page = Math.max(1, STATE.page - 1); 
          refresh(); 
        });
        $('#pg-next', pager)?.addEventListener('click', () => { 
          STATE.page = STATE.page + 1; 
          refresh(); 
        });
      }

      function refresh() {
        let filtered = filterPlayers(getAllPlayers(), {
          position: STATE.pos,
          status: STATE.status,
          category: STATE.category,
          country: STATE.country,
          gpaMin: STATE.gpaMin,
          stateProvince: STATE.stateProvince
        });
        const normalizedPos = normalizeFilterValue(STATE.pos);
        if (normalizedPos) {
          filtered = filtered.sort((a,b) => {
            const am = playerHasPosition(a, normalizedPos) ? 1 : 0;
            const bm = playerHasPosition(b, normalizedPos) ? 1 : 0;
            return bm - am;
          });
        }
        const totalPages = Math.max(1, Math.ceil(filtered.length / STATE.pageSize));
        if (STATE.page > totalPages) STATE.page = totalPages;
        const pageItems = paginate(filtered);
        if (STATE.mode === 'grid') renderGrid(pageItems); else renderList(pageItems);
        renderPager(filtered.length);
      }

      const handleFiltersChange = () => {
        STATE.pos = selPos?.value || '';
        STATE.status = selStatus?.value || '';
        STATE.category = selCategory?.value || 'any';
        STATE.country = selCountry?.value || 'any';
        STATE.gpaMin = selGpa?.value || 'any';
        STATE.stateProvince = selState?.value || 'any';
        STATE.page = 1;
        refresh();
      };

      // Eventos UI
      btnSearch?.removeAttribute('disabled');
      btnGrid?.removeAttribute('disabled');
      btnList?.removeAttribute('disabled');
      selPos?.addEventListener('change', handleFiltersChange);
      selStatus?.addEventListener('change', handleFiltersChange);
      selCategory?.addEventListener('change', handleFiltersChange);
      selCountry?.addEventListener('change', handleFiltersChange);
      selGpa?.addEventListener('change', handleFiltersChange);
      selState?.addEventListener('change', handleFiltersChange);
      btnSearch?.addEventListener('click', handleFiltersChange);
      btnGrid?.addEventListener('click', () => { 
        btnGrid.classList.add('active'); btnList.classList.remove('active'); 
        STATE.mode='grid'; 
        refresh(); 
      });
      btnList?.addEventListener('click', () => { 
        btnList.classList.add('active'); btnGrid.classList.remove('active'); 
        STATE.mode='list'; 
        refresh(); 
      });

      initPlayerQuickviewEvents();

      // Primera carga
      refresh();
    }

    // ---------------------------
    // Dashboard dynamic section
    // ---------------------------
    function initDashboardView() {
      const FEATURED_MAX = 3;
      const dashSel = document.getElementById('dash-position');
      const dashWrap = document.getElementById('dash-featured');
      if (!dashSel || !dashWrap) return;
      const EMPTY_DASH_TEXT = 'No players found for this position.';

      function renderFeatured(pos) {
        const filtered = filterPlayers(getAllPlayers(), { position: pos }).slice(0, FEATURED_MAX);
        if (!filtered.length) {
          dashWrap.innerHTML = `<div class="col-12"><div class="alert alert-light border text-center py-4">${EMPTY_DASH_TEXT}</div></div>`;
          return;
        }
        dashWrap.innerHTML = filtered.map(p => `
          <div class="col-12 col-md-4">
            <div class="card player-card coach-player-card player-feature shadow-sm h-100 d-flex flex-column" data-id="${p.id}">
              <div class="card-body coach-player-card-body d-flex flex-column align-items-center text-center h-100">
                <div class="coach-player-avatar rounded-circle bg-secondary-subtle mb-3"></div>
                <h5 class="player-name mb-1">${p.name}</h5>
                <div class="player-position text-muted small mb-2">${p.positions?.[0] ?? 'N/A'}</div>
                <div class="player-club text-muted small mb-3">${[p.club, p.country].filter(Boolean).join(' • ') || '—'}</div>
                <div class="coach-player-chips d-flex flex-wrap justify-content-center gap-2 mb-1 w-100">
                  <span class="badge-eture-soft">GPA ${p.gpa ?? 'N/A'}</span>
                  <span class="badge-eture-soft">Height ${p.heightCm ?? '—'}cm</span>
                  <span class="badge-eture-soft">Weight ${p.weightKg ?? '—'}kg</span>
                </div>
                <div class="coach-player-chips d-flex flex-wrap justify-content-center gap-2 mb-3 w-100">
                  <span class="badge-eture">${playerCategory(p)}</span>
                  <span class="badge-eture-soft">${p.status ?? ''}</span>
                </div>
                <button type="button" class="btn btn-outline-danger btn-sm rounded-pill coach-view-profile-btn w-auto mt-auto mx-auto">View profile</button>
              </div>
            </div>
          </div>
        `).join('');
      }

      dashSel.addEventListener('change', () => renderFeatured(dashSel.value));
      renderFeatured(dashSel.value || 'CM');
    }

    function initMyNeedsView() {
      const $ = (sel, ctx = document) => ctx.querySelector(sel);
      const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
      const wrap = document;

      const modal = $('#need-modal', wrap);
      const formCard = $('#need-form-card', wrap);
      const modalTitle = $('#need-form-title', wrap);
      const MODAL_BACKDROP_ID = 'need-modal-backdrop';

      const positionSelect = $('#need-position', wrap);
      const scholarshipTypeSelect = $('#need-scholarship-type', wrap);
      const athleticInput = $('#need-athletic-scholarship', wrap);
      const academicTextarea = $('#need-academic-scholarship', wrap);
      const budgetInput = $('#need-player-budget', wrap);
      const notesInput = $('#need-notes', wrap);

      const originRadios = $$('input[name="need-origin"]', wrap);
      const traitsButtons = $$('.need-trait-btn', wrap);

      const btnOpenForm = $('#btn-open-need-form', wrap);
      const btnSave = $('#btn-save-need', wrap);
      const btnCancel = $('#btn-cancel-need', wrap);
      const modalCloseButtons = $$('[data-need-modal-close]', wrap);

      const emptyState = $('#needs-empty-state', wrap);
      const openWrapper = $('#needs-open-wrapper', wrap);
      const openBody = $('#needs-open-body', wrap);
      const closedWrapper = $('#needs-closed-wrapper', wrap);
      const closedBody = $('#needs-closed-body', wrap);
      const closedTableContainer = $('#needs-closed-table-container', wrap);
      const allCoveredMessage = $('#needs-all-covered-message', wrap);
      const btnToggleClosed = $('#btn-toggle-closed-needs', wrap);

      if (!formCard) {
        return;
      }

      const athleticGroup = athleticInput ? athleticInput.closest('.mb-3') : null;

      let editingNeedId = null;
      let closedVisible = true;

      // --- Modal helpers ---
      function createBackdrop() {
        let backdrop = document.getElementById(MODAL_BACKDROP_ID);
        if (!backdrop) {
          backdrop = document.createElement('div');
          backdrop.id = MODAL_BACKDROP_ID;
          backdrop.className = 'modal-backdrop fade show';
          document.body.appendChild(backdrop);
        }
      }

      function removeBackdrop() {
        const backdrop = document.getElementById(MODAL_BACKDROP_ID);
        if (backdrop && backdrop.parentNode) {
          backdrop.parentNode.removeChild(backdrop);
        }
      }

      function openNeedModal(isEdit) {
        if (!modal) return;
        if (modalTitle) {
          modalTitle.textContent = isEdit ? 'Edit Need' : 'New Need';
        }
        modal.classList.add('show');
        modal.removeAttribute('aria-hidden');
        modal.style.display = 'block';
        document.body.classList.add('modal-open');
        createBackdrop();

        if (positionSelect) {
          positionSelect.focus();
        }
      }

      function closeNeedModal() {
        if (!modal) return;
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
        removeBackdrop();
      }

      // --- Origin helpers ---
      function getSelectedOrigin() {
        const checked = originRadios.find(r => r.checked);
        return checked ? checked.value : '';
      }

      function setSelectedOrigin(value) {
        originRadios.forEach(r => {
          r.checked = (r.value === value);
        });
      }

      // --- Traits helpers ---
      function resetTraits() {
        traitsButtons.forEach(btn => {
          btn.classList.remove('btn-secondary', 'text-white');
          if (!btn.classList.contains('btn-outline-secondary')) {
            btn.classList.add('btn-outline-secondary');
          }
        });
      }

      function getSelectedTraits() {
        return traitsButtons
          .filter(btn => btn.classList.contains('btn-secondary'))
          .map(btn => btn.dataset.trait || btn.textContent.trim());
      }

      function toggleTrait(btn) {
        const isActive = btn.classList.toggle('btn-secondary');
        btn.classList.toggle('btn-outline-secondary', !isActive);
        btn.classList.toggle('text-white', isActive);
      }

      traitsButtons.forEach(btn => {
        btn.addEventListener('click', () => toggleTrait(btn));
      });

      // --- Scholarship type UI logic ---
      function applyScholarshipTypeUI() {
        if (!scholarshipTypeSelect) return;
        const type = scholarshipTypeSelect.value || '';

        // Default: athletic visible and editable
        if (athleticGroup) athleticGroup.classList.remove('d-none');
        if (athleticInput) {
          athleticInput.disabled = false;
        }
        if (budgetInput) {
          budgetInput.disabled = false;
        }

        if (type === 'full') {
          // Full scholarship: cost = 0 locked
          if (budgetInput) {
            budgetInput.value = '0';
            budgetInput.disabled = true;
          }
        } else if (type === 'walk-on') {
          // Walk-on: no athletic scholarship
          if (athleticGroup) athleticGroup.classList.add('d-none');
          if (athleticInput) {
            athleticInput.value = '';
            athleticInput.disabled = true;
          }
          if (budgetInput) {
            budgetInput.disabled = false;
          }
        }
        // partial or empty → default behavior
      }

      if (scholarshipTypeSelect) {
        scholarshipTypeSelect.addEventListener('change', applyScholarshipTypeUI);
      }

      // --- Form helpers ---
      function resetForm() {
        if (positionSelect) positionSelect.value = '';
        setSelectedOrigin('any');
        if (scholarshipTypeSelect) scholarshipTypeSelect.value = '';
        if (athleticInput) athleticInput.value = '';
        if (academicTextarea) academicTextarea.value = '';
        if (budgetInput) budgetInput.value = '';
        if (notesInput) notesInput.value = '';
        resetTraits();
        editingNeedId = null;
        applyScholarshipTypeUI();
      }

      function formatCurrency(value) {
        if (value === null || value === undefined || value === '') return 'Not set';
        const num = Number(value);
        if (!isFinite(num)) return 'Not set';
        return num.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' USD';
      }

      function formatOrigin(origin) {
        if (origin === 'american') return '🇺🇸 American';
        if (origin === 'spanish') return '🇪🇸 Spanish';
        if (origin === 'any') return '🌍 Any';
        return origin || '—';
      }

      // --- Render table ---
      function renderNeedsTable() {
        if (!emptyState || (!openWrapper && !closedWrapper)) return;

        const hasNeeds = Array.isArray(coachesNeeds) && coachesNeeds.length > 0;
        if (!hasNeeds) {
          emptyState.classList.remove('d-none');
          if (openWrapper) {
            openWrapper.classList.add('d-none');
            if (openBody) openBody.innerHTML = '';
          }
          if (closedWrapper) {
            closedWrapper.classList.add('d-none');
            if (closedBody) closedBody.innerHTML = '';
          }
          return;
        }

        emptyState.classList.add('d-none');

        const openNeeds = coachesNeeds.filter(n => n.status !== 'closed');
        const closedNeeds = coachesNeeds.filter(n => n.status === 'closed');

        if (openNeeds.length === 0 && closedNeeds.length > 0) {
          if (allCoveredMessage) allCoveredMessage.classList.remove('d-none');
        } else {
          if (allCoveredMessage) allCoveredMessage.classList.add('d-none');
        }

        function scholarshipLabelFor(need) {
          if (need.scholarshipType === 'full') return 'Full scholarship';
          if (need.scholarshipType === 'partial') return 'Partial scholarship';
          if (need.scholarshipType === 'walk-on') return 'Walk-on';
          return null;
        }

        function renderRow(need, isClosed) {
          const traitsHtml = (need.traits && need.traits.length)
            ? need.traits.map(tr => '<span class="badge-eture-soft me-1 mb-1">' + tr + '</span>').join('')
            : '<span class="text-muted small">No traits selected</span>';

          const costText = formatCurrency(need.playerCost);
          const statusText = isClosed ? 'Closed' : 'Open';
          const statusClass = isClosed
            ? 'status-pill status-pill-closed'
            : 'status-pill status-pill-open';

          const rowClass = isClosed ? ' class="needs-row-closed"' : '';

          const editDisabledAttr = isClosed ? ' disabled' : '';
          const closeDisabledAttr = isClosed ? ' disabled' : '';

          const scholarshipLabel = scholarshipLabelFor(need);
          const scholarshipHtml = scholarshipLabel
            ? '<div class="needs-scholarship-label">' + scholarshipLabel + '</div>'
            : '';

          return (
            '<tr data-need-id="' + need.id + '"' + rowClass + '>' +
              '<td>' +
                '<span class="badge-eture-soft">' + (need.position || '—') + '</span>' +
                scholarshipHtml +
              '</td>' +
              '<td>' + formatOrigin(need.origin) + '</td>' +
              '<td>' + costText + '</td>' +
              '<td>' + traitsHtml + '</td>' +
              '<td><span class="' + statusClass + '">' + statusText + '</span></td>' +
              '<td class="text-end">' +
                '<button type="button" class="btn btn-sm btn-outline-secondary me-1" data-need-edit="' + need.id + '"' + editDisabledAttr + '>Edit</button>' +
                '<button type="button" class="btn btn-sm btn-outline-success" data-need-close="' + need.id + '"' + closeDisabledAttr + '>Close</button>' +
              '</td>' +
            '</tr>'
          );
        }

        // Render open needs
        if (openWrapper && openBody) {
          if (!openNeeds.length) {
            openWrapper.classList.add('d-none');
            openBody.innerHTML = '';
          } else {
            openWrapper.classList.remove('d-none');
            openBody.innerHTML = openNeeds.map(n => renderRow(n, false)).join('');
          }
        }

        // Render closed needs
        if (closedWrapper && closedBody) {
          if (!closedNeeds.length) {
            closedWrapper.classList.add('d-none');
            closedBody.innerHTML = '';
          } else {
            closedWrapper.classList.remove('d-none');
            closedBody.innerHTML = closedNeeds.map(n => renderRow(n, true)).join('');
          }
        }

        // Handle Closed wrapper visibility based on whether there are closed needs
        if (closedWrapper) {
          if (!closedNeeds.length) {
            closedWrapper.classList.add('d-none');
          } else {
            closedWrapper.classList.remove('d-none');
          }
        }

        // Handle table show/hide based on toggle
        if (closedTableContainer && closedNeeds.length) {
          if (!closedVisible) {
            closedTableContainer.classList.add('d-none');
          } else {
            closedTableContainer.classList.remove('d-none');
          }
        }

        // Update toggle button text
        if (btnToggleClosed) {
          if (!closedNeeds.length) {
            btnToggleClosed.disabled = true;
            btnToggleClosed.textContent = "Hide closed";
          } else {
            btnToggleClosed.disabled = false;
            btnToggleClosed.textContent = closedVisible ? "Hide closed" : "Show closed";
          }
        }

        wireNeedActions();
      }

      function collectFormData() {
        const position = positionSelect ? positionSelect.value : '';
        const origin = getSelectedOrigin();

        if (!position || !origin) {
          alert('Please select a position and player origin.');
          return null;
        }

        const scholarshipType = scholarshipTypeSelect ? scholarshipTypeSelect.value : '';
        const athletic = athleticInput && !athleticInput.disabled ? athleticInput.value : '';
        const academic = academicTextarea ? academicTextarea.value.trim() : '';
        const budget = budgetInput ? budgetInput.value : '';
        const comments = notesInput ? notesInput.value.trim() : '';
        const traits = getSelectedTraits();

        return {
          id: editingNeedId || ('need_' + Date.now()),
          position: position,
          origin: origin,
          scholarshipType: scholarshipType || null,
          athleticScholarship: athletic,
          academicScholarship: academic,
          playerCost: budget,
          traits: traits,
          comments: comments,
          status: editingNeedId
            ? (coachesNeeds.find(n => n.id === editingNeedId)?.status || 'open')
            : 'open'
        };
      }

      function populateForm(need) {
        if (!need) return;
        editingNeedId = need.id;

        if (positionSelect) positionSelect.value = need.position || '';
        setSelectedOrigin(need.origin || 'any');

        if (scholarshipTypeSelect) {
          scholarshipTypeSelect.value = need.scholarshipType || '';
        }
        if (athleticInput) athleticInput.value = need.athleticScholarship || '';
        if (academicTextarea) academicTextarea.value = need.academicScholarship || '';
        if (budgetInput) budgetInput.value = need.playerCost || '';
        if (notesInput) notesInput.value = need.comments || '';

        resetTraits();
        if (need.traits && need.traits.length) {
          need.traits.forEach(tr => {
            const btn = traitsButtons.find(b => (b.dataset.trait || b.textContent.trim()) === tr);
            if (btn) {
              btn.classList.add('btn-secondary', 'text-white');
              btn.classList.remove('btn-outline-secondary');
            }
          });
        }

        applyScholarshipTypeUI();
        openNeedModal(true);
      }

      function wireNeedActions() {
        const bodies = [openBody, closedBody].filter(Boolean);
        bodies.forEach(body => {
          const editButtons = body.querySelectorAll('[data-need-edit]');
          editButtons.forEach(btn => {
            btn.addEventListener('click', () => {
              if (btn.disabled) return;
              const id = btn.getAttribute('data-need-edit');
              const need = coachesNeeds.find(n => n.id === id);
              if (!need || need.status === 'closed') return;
              populateForm(need);
            });
          });

          const closeButtons = body.querySelectorAll('[data-need-close]');
          closeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
              if (btn.disabled) return;
              const id = btn.getAttribute('data-need-close');
              const idx = coachesNeeds.findIndex(n => n.id === id);
              if (idx === -1) return;

              const confirmed = window.confirm(
                'Are you sure you want to mark this need as closed? This will move it to the Closed Needs list.'
              );
              if (!confirmed) return;

              coachesNeeds[idx].status = 'closed';
              renderNeedsTable();
            });
          });
        });
      }

      // --- Button events ---
      if (btnToggleClosed) {
        btnToggleClosed.addEventListener('click', () => {
          closedVisible = !closedVisible;
          renderNeedsTable();
        });
      }

      if (btnSave) {
        btnSave.addEventListener('click', () => {
          const data = collectFormData();
          if (!data) return;

          const existingIndex = coachesNeeds.findIndex(n => n.id === data.id);
          if (existingIndex >= 0) {
            coachesNeeds[existingIndex] = data;
          } else {
            coachesNeeds.push(data);
          }

          renderNeedsTable();
          resetForm();
          closeNeedModal();
        });
      }

      if (btnCancel) {
        btnCancel.addEventListener('click', () => {
          resetForm();
          closeNeedModal();
        });
      }

      modalCloseButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          resetForm();
          closeNeedModal();
        });
      });

      if (btnOpenForm && formCard) {
        btnOpenForm.addEventListener('click', () => {
          resetForm();
          openNeedModal(false);
        });
      }

      // Initialize view
      resetForm();
      renderNeedsTable();
    }

    })();
