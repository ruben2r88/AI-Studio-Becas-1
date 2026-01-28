// File: app.us.js — Build: 2025-11-25T12:55Z
// This file drives the entire application logic.
// Here you will find all variables, functions, and wiring required for the app to work.
// app.js - NEW LINES AT THE BEGINNING
// NEW LINE AT THE BEGINNING
/* ===== IMPORTS (single block) ===== */
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
import { profileState, emptyProfileData, getTrip, setTrip } from './src/state/profileState.js';
import { uploadUserFile, listUserFiles, deleteUserFile } from './services/storage.js';
import { renderAcademicHistory, readAcademicHistoryFromUI } from './src/features/profile/academicHistory.js';
import { renderTeamHistory, readTeamHistoryFromUI } from './src/features/profile/athleticHistory.js';
import { initTasksFeature, getTasksData, preloadTasks } from "./src/features/tasks/tasks.js";
import { initProcessFeature } from "./src/features/process/process.js";
import { initDocsFeature } from "./src/features/docs/docs.js";
import { initProfileFeature } from "./src/features/profile/profile.js";
import { HELP_MAP, resolveHelpKey } from "./src/features/checklist/help.js";


/* ===== FIN IMPORTS ===== */
      
let editingMultimediaElement = null;
let editingSocialLinkIndex = null;
let tripSaveStatusTimer = null;

function updateTripStatus(message, { isError = false, autoClearMs = 0 } = {}) {
  const statusEl = document.getElementById('trip-save-status');
  if (!statusEl) return;

  if (tripSaveStatusTimer) {
    window.clearTimeout(tripSaveStatusTimer);
    tripSaveStatusTimer = null;
  }

  statusEl.textContent = message || '';
  statusEl.classList.toggle('text-danger', isError && Boolean(message));

  if (message && autoClearMs > 0) {
    tripSaveStatusTimer = window.setTimeout(() => {
      const el = document.getElementById('trip-save-status');
      if (el) {
        el.textContent = '';
        el.classList.remove('text-danger');
      }
      tripSaveStatusTimer = null;
    }, autoClearMs);
  }
}

const DEFAULT_DEMO_MODE = true;
const SUBMISSION_DEMO_MODE = true;

const VISA_SUBMISSION_STORAGE_KEY = 'visaSubmission';
const SUBMISSION_STATE_STORAGE_KEY = 'visa.submission.us.state';
const SUBMISSION_CA_REGION_STORAGE_KEY = 'visa.submission.us.caRegion';
const SUBMISSION_CHOICE_STORAGE_KEY = 'visa.submitChoice';
const SPAIN_STAYS_STORAGE_KEY = 'visa.spainStays';
const SPAIN_FEE_ACK_STORAGE_KEY = 'visa_spain_fee_ack';
const MINOR_STORAGE_KEY = 'visa_is_minor';
const MINOR_CHECKLIST_KEYS = [
  'birth-certificate',
  'parents-passports',
  'parents-passports-notarized',
  'parental-authorization',
  'parental-authorization-notarized',
  'sex-crimes-registry',
  'sex-crimes-registry-authorization',
  'financial-means-translation'
];
const CHECKLIST_KEY_ALIASES = {
  'parents-passports-notarized': 'parents-passports',
  'parental-authorization-notarized': 'parental-authorization',
  'sex-crimes-registry-authorization': 'sex-crimes-registry'
};
const LEGACY_SPAIN_FEE_ACK_KEYS = ['submissionSpainAcknowledged', 'visa.spainFeeAck'];

const SPAIN_SUBMISSION_DEFAULTS = Object.freeze({
  europeVisit: '',
  stays: [],
  feeAcknowledged: false
});

const MY_VISA_STATE_STORAGE_KEY = 'myVisaState';
const visaUiState = {
  checklistProgress: {
    items: [],
    verified: 0,
    total: 0,
    uploaded: 0
  }
};

function cleanupModalArtifacts() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.modal-backdrop').forEach((el) => el.remove());
  document.body.classList.remove('modal-open');
  document.body.style.removeProperty('paddingRight');
  const root = document.getElementById('visa-section-root') || document.querySelector('[data-visa-root]') || document.body;
  if (root) root.removeAttribute('aria-hidden');
}

function safeGet(value, fallback) {
  return value == null ? fallback : value;
}

function paintSectionError(sectionId) {
  if (typeof document === 'undefined') return;
  if (!sectionId) return;
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.innerHTML = '<p class="text-danger">There was an error loading this section.</p>';
}

function getChecklistItemsForMode(mode) {
  try {
    return Array.isArray(mode)
      ? mode
      : (typeof getChecklistDefinitionForMode === 'function'
        ? getChecklistDefinitionForMode(mode)
        : []);
  } catch (error) {
    console.error('Unable to resolve checklist items for mode', error);
    return [];
  }
}

function getChecklistState() {
  ensureVisaDefaults();
  if (!userProfileData.visa.checklist) {
    userProfileData.visa.checklist = { items: [], total: 0, uploaded: 0, _updatedAt: '' };
  }

  const cl = userProfileData.visa.checklist;
  cl.isMinor = getIsMinor();
  const existingArray = Array.isArray(cl.items) ? cl.items : [];
  const fromArray = new Map(existingArray.map(item => [item.key, item]));

  const keyed = {};
  Object.keys(cl).forEach((key) => {
    if (['items', 'total', 'uploaded', '_updatedAt'].includes(key)) return;
    const value = cl[key];
    if (value && typeof value === 'object') keyed[key] = value;
  });

  cl.items = VISA_CHECKLIST_CATALOG.map((catalogItem) => {
    const aliases = [catalogItem.key, ...(catalogItem.legacyKeys || [])];
    let stored = null;
    for (const alias of aliases) {
      if (fromArray.has(alias)) {
        stored = fromArray.get(alias);
        break;
      }
      if (keyed[alias]) {
        stored = keyed[alias];
        break;
      }
    }

    aliases.forEach(alias => {
      if (alias !== catalogItem.key) delete cl[alias];
    });

    const status = normalizeChecklistStatus(stored?.status);
    const fileUrl = stored?.fileUrl || stored?.file_url || '';
    const fileName = stored?.fileName || stored?.file_name || '';
    const fileSize = stored?.fileSize ?? stored?.file_size ?? null;
    const fileMime = stored?.fileMime || stored?.file_mime || '';
    const notes = stored?.notes || '';
    const updatedAt = stored?.updatedAt || stored?.updated_at || stored?._updatedAt || '';

    let reviewRaw = stored?.review;
    if (!reviewRaw && stored) {
      const fallbackReviewedAt = stored?.reviewedAt || stored?.reviewed_at || '';
      const fallbackReviewerName = stored?.reviewerName || stored?.reviewer_name || '';
      const fallbackReviewerId = stored?.reviewerId || stored?.reviewer_id || '';
      const verifiedAt = stored?.verifiedAt || stored?.verified_at || '';
      const verifiedBy = stored?.verifiedBy || stored?.verified_by || '';
      const verifiedByName = stored?.verifiedByName || stored?.verified_by_name || '';
      const deniedAt = stored?.deniedAt || stored?.denied_at || '';
      const deniedBy = stored?.deniedBy || stored?.denied_by || '';
      const deniedByName = stored?.deniedByName || stored?.denied_by_name || '';
      const denialReasonLegacy = stored?.denialReason || stored?.denial_reason || '';

      if (status === 'verified') {
        reviewRaw = {
          reviewerId: verifiedBy || fallbackReviewerId || '',
          reviewerName: verifiedByName || fallbackReviewerName || '',
          reviewedAt: verifiedAt || fallbackReviewedAt || '',
          decision: 'verified',
          reason: ''
        };
      } else if (status === 'denied') {
        reviewRaw = {
          reviewerId: deniedBy || fallbackReviewerId || '',
          reviewerName: deniedByName || fallbackReviewerName || '',
          reviewedAt: deniedAt || fallbackReviewedAt || '',
          decision: 'denied',
          reason: denialReasonLegacy || ''
        };
      }
    }

    let review = null;
    if (reviewRaw && typeof reviewRaw === 'object') {
      review = {
        reviewerId: reviewRaw.reviewerId || reviewRaw.reviewedBy || '',
        reviewerName: reviewRaw.reviewerName || '',
        reviewedAt: reviewRaw.reviewedAt || reviewRaw.reviewed_at || '',
        decision: reviewRaw.decision || '',
        reason: reviewRaw.reason || ''
      };
    }

    if (review) {
      review.decision = review.decision || (status === 'verified' ? 'verified' : status === 'denied' ? 'denied' : '');
      if (review.decision === 'denied') {
        review.reason = (review.reason || stored?.denialReason || stored?.denial_reason || '').trim();
      } else {
        review.reason = '';
      }
      if (!review.reviewedAt) review.reviewedAt = updatedAt;
    }

    if (!review || !review.decision) {
      review = null;
    }

    return {
      key: catalogItem.key,
      title: catalogItem.title,
      minor: Boolean(catalogItem.minor),
      status,
      fileUrl,
      fileName,
      fileSize,
      fileMime,
      notes,
      updatedAt,
      review,
      sampleUrl: catalogItem.sampleUrl || ''
    };
  });

  recalcVisaChecklistProgress(cl);
  syncChecklistKeyedState(cl);
  return cl;
}

function isChecklistItemVerified(key, stateOverride = null) {
  try {
    const normalizedKey = normalizeChecklistKeyInput(key);
    if (!normalizedKey) return false;
    const state = stateOverride || getChecklistState();
    const entry = safeGet(state.items?.[normalizedKey], null);
    return normalizeChecklistStatus(entry?.status) === 'verified';
  } catch (_) {
    return false;
  }
}

function getProgressCountsForModeSafe(items) {
  try {
    const list = Array.isArray(items) ? items : [];
    const state = getChecklistState();
    const verified = list.filter((item) => isChecklistItemVerified(item?.key, state)).length;
    return { verified, total: list.length };
  } catch (_) {
    const total = Array.isArray(items) ? items.length : 0;
    return { verified: 0, total };
  }
}

function showTabPane(id) {
  if (typeof document === 'undefined') return;
  const root = document.querySelector('[data-visa-root]') || document;
  root.querySelectorAll('.tab-pane').forEach((pane) => {
    pane.classList.remove('show','active');
    pane.setAttribute('aria-hidden','true');
    pane.hidden = true;
  });
  if (!id) return;
  let pane =
    root.querySelector(`#${id}`) ||
    document.getElementById(id) ||
    root.querySelector(`#${id}-pane`) ||
    document.getElementById(`${id}-pane`);
  if (pane) {
    pane.classList.add('show','active');
    pane.removeAttribute('aria-hidden');
    pane.hidden = false;
  }
}

function renderVisaSubmission() {
  try {
    initVisaSubmissionUI?.();
    renderSubmissionProgress();
  } catch (err) {
    console.error('Submission render failed', err);
    paintSectionError('visa-submission');
  }
}

function renderVisaChecklist() {
  try {
    const mode = typeof getSubmissionMode === 'function' ? getSubmissionMode() : 'usa';
    const definition = typeof getChecklistDefinitionForMode === 'function' ? getChecklistDefinitionForMode(mode) : [];
    const items = Array.isArray(definition) ? definition : [];
    const root = document.getElementById('visa-checklist');
    if (!root) return;

    if (!root.dataset.originalTemplate) {
      root.dataset.originalTemplate = root.innerHTML; // Preserve initial checklist markup.
    }

    if (items.length === 0) {
      visaChecklistEventsBound = false;
      root.innerHTML = '<div class="text-muted">No checklist items to show for this mode.</div>';
      root.dataset.checklistEmpty = '1';
      return;
    }

    if (root.dataset.checklistEmpty === '1' && root.dataset.originalTemplate) {
      root.innerHTML = root.dataset.originalTemplate; // Restore original template when items return.
      delete root.dataset.checklistEmpty;
      visaChecklistEventsBound = false;
    }

    initVisaChecklistUI?.();
    console.debug('renderVisaChecklist ok');
  } catch (err) {
    console.error('Checklist render failed', err);
    paintSectionError('visa-checklist');
  }
}

function renderVisaAppointment() {
  try {
    initVisaAppointmentUI?.();
    console.debug('renderVisaAppointment ok');
  } catch (err) {
    console.error('Appointment render failed', err);
    paintSectionError('visa-appointment');
  }
}

async function handleTripSave(event) {
  event?.preventDefault?.();
  updateTripStatus('');

  const saveButton = document.getElementById('trip-save-btn');
  const departureInput = document.getElementById('trip-departure-date');
  const arrivalInput = document.getElementById('trip-arrival-date');
  const arrivalTimeInput = document.getElementById('trip-arrival-time');
  const placeInput = document.getElementById('trip-arrival-place');
  const confirmInput = document.getElementById('trip-read-confirm');

  if (saveButton) saveButton.disabled = true;

  const currentTrip = getTrip();
  const rawDeparture = departureInput?.value || '';
  const rawArrival = arrivalInput?.value || '';
  const rawArrivalTime = arrivalTimeInput?.value || '';
  const departureDate = rawDeparture || null;
  const arrivalDate = rawArrival || null;
  const arrivalTime = rawArrivalTime || '';

  if (departureDate && arrivalDate && arrivalDate < departureDate) {
    updateTripStatus('Arrival date must be on or after departure date.', { isError: true });
    if (saveButton) saveButton.disabled = false;
    return;
  }

  const nextTrip = {
    departureDate,
    arrivalDate,
    arrivalTime,
    arrivalPlace: (placeInput?.value || '').trim(),
    itineraryFileUrl: currentTrip.itineraryFileUrl || '',
    confirmed: confirmInput?.checked === true
  };

  setTrip(nextTrip);

  try {
    if (auth.currentUser) {
      await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    }
    emitAppStateUpdated();
    renderVisaTrip();
    updateTripStatus('Saved ✓', { autoClearMs: 2500 });
  } catch (error) {
    console.error('Unable to save trip details', error);
    updateTripStatus('Save failed', { isError: true, autoClearMs: 4000 });
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

async function handleTripFileChange(event) {
  const input = event?.target;
  if (!input || !input.files || input.files.length === 0) return;

  const file = input.files[0];
  if (!file) return;

  updateTripStatus('Uploading…');
  input.disabled = true;

  try {
    const uid = auth?.currentUser?.uid
      || window.profileState?.data?.uid
      || window.profileState?.data?.id
      || 'anonymous';

    const uploadResult = await uploadUserFile(uid, file, { folder: 'trips' });
    const fileUrl = uploadResult?.url || uploadResult?.downloadURL || '';
    if (!fileUrl) {
      throw new Error('Upload did not return a file URL.');
    }

    setTrip({ itineraryFileUrl: fileUrl });

    if (auth.currentUser) {
      await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    }

    emitAppStateUpdated();
    renderVisaTrip();
    updateTripStatus('Uploaded ✓', { autoClearMs: 2500 });
  } catch (error) {
    console.error('Unable to upload itinerary', error);
    updateTripStatus('Upload failed', { isError: true, autoClearMs: 4000 });
  } finally {
    input.disabled = false;
    input.value = '';
  }
}

function renderVisaTrip() {
  try {
    const trip = getTrip();
    const departureInput = document.getElementById('trip-departure-date');
    const arrivalInput = document.getElementById('trip-arrival-date');
    const arrivalTimeInput = document.getElementById('trip-arrival-time');
    const placeInput = document.getElementById('trip-arrival-place');
    const confirmInput = document.getElementById('trip-read-confirm');
    const itineraryLink = document.getElementById('trip-itinerary-link');

    if (departureInput) departureInput.value = trip.departureDate || '';
    if (arrivalInput) arrivalInput.value = trip.arrivalDate || '';
    if (arrivalTimeInput) arrivalTimeInput.value = trip.arrivalTime || '';
    if (placeInput) placeInput.value = trip.arrivalPlace || '';
    if (confirmInput) confirmInput.checked = trip.confirmed === true;

    if (itineraryLink) {
      const url = trip.itineraryFileUrl || '';
      if (url) {
        itineraryLink.href = url;
        itineraryLink.classList.remove('d-none');
      } else {
        itineraryLink.removeAttribute('href');
        itineraryLink.classList.add('d-none');
      }
    }

    if (!renderVisaTrip._bound) {
      document.getElementById('trip-save-btn')?.addEventListener('click', handleTripSave);
      document.getElementById('trip-itinerary-file')?.addEventListener('change', handleTripFileChange);
      renderVisaTrip._bound = true;
    }
  } catch (error) {
    console.error('Trip render failed', error);
  }
}

function renderVisaApproval() {
  try {
    initVisaApprovalUI?.();
  } catch (err) {
    console.error('VisaApproval render failed', err);
    paintSectionError('visa-approval');
  }
}

function renderVisaTIE() {
  try {
    initVisaTieUI?.();
  } catch (err) {
    console.error('TIE render failed', err);
    paintSectionError('visa-tie');
  }
}

function renderVisaTab(tabName) {
  const paneIdMap = {
    overview: 'visa-overview',
    submission: 'visa-submission',
    checklist: 'visa-checklist',
    appointment: 'visa-appointment',
    trip: 'visa-trip',
    'visa-approval': 'visa-approval',
    tie: 'visa-tie'
  };
  showTabPane(paneIdMap[tabName] || null);

  if (tabName === 'overview') {
    renderVisaOverview?.();
  } else if (tabName === 'submission') {
    renderVisaSubmission();
  } else if (tabName === 'checklist') {
    renderVisaChecklist();
    renderVisaChecklistProgress();
  } else if (tabName === 'appointment') {
    renderVisaAppointment();
  } else if (tabName === 'trip') {
    renderVisaTrip();
  } else if (tabName === 'visa-approval') {
    renderVisaApproval();
  } else if (tabName === 'tie') {
    renderVisaTIE();
  }
}

function rerenderActiveVisaTab() {
  if (typeof document === 'undefined') return;
  const activeBtn = document.querySelector('#visa-tabs .nav-link.active');
  if (!activeBtn) return;
  const tab = activeBtn.getAttribute('data-tab');
  if (!tab) return;
  renderVisaTab(tab);
}

function onVisaTabClick(event) {
  const btn = event.currentTarget;
  const tab = btn?.getAttribute('data-tab') || btn?.getAttribute('data-visa-tab');
  if (!tab) return;
  event?.preventDefault?.();
  try {
    const instance = typeof bootstrap !== 'undefined'
      ? bootstrap.Tab.getOrCreateInstance(btn)
      : null;
    instance?.show();
  } catch (_) {}
  renderVisaTab(tab);
}

function bindVisaTabClicks() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('#visa-tabs [data-tab], #visa-tabs [data-visa-tab]').forEach((btn) => {
    btn.removeEventListener('click', onVisaTabClick);
    btn.addEventListener('click', onVisaTabClick);
  });
}


function initVisaTabsOnReady() {
  if (typeof document === 'undefined') return;
  // QUITA la búsqueda del root para no abortar si no existe
  // const root = document.querySelector('[data-visa-root]');
  const tabs = document.getElementById('visa-tabs');
  // if (!root || !tabs) return;
  if (!tabs) return;
  bindVisaTabClicks();
  const activeBtn = tabs.querySelector('.nav-link.active[data-tab], .nav-link.active[data-visa-tab]');
  const tab = activeBtn?.getAttribute('data-tab') || activeBtn?.getAttribute('data-visa-tab') || 'overview';
  renderVisaTab(tab);
}

if (typeof document !== 'undefined') {
  const ensureVisaTabsReady = () => initVisaTabsOnReady();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureVisaTabsReady, { once: true });
  } else {
    ensureVisaTabsReady();
  }
  document.addEventListener('visa:tabs-ready', initVisaTabsOnReady);
}

if (typeof document !== 'undefined') {
  document.addEventListener('readystatechange', evaluateTripUnlockFromState);
  if (document.readyState !== 'loading') {
    window.setTimeout(() => evaluateTripUnlockFromState(), 0);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('app:state-updated', evaluateTripUnlockFromState);
}

function getDefaultMyVisaState() {
  return {
    submission: {
      method: 'usa',
      spainRequest: {
        status: 'none',
        requestReason: '',
        decisionReason: '',
        requestTimestamp: '',
        decisionTimestamp: ''
      },
      expectedArrival: '',
      spainEuropeVisit: '',
      spainTravel: [],
      spain: {
        termsAccepted: false
      }
    },
    docStatuses: {},
    etureDocs: [],
    isMinor: false,
    appointment: {
      datetime: '',
      center: '',
      proofFile: null,
      readAcknowledged: false
    },
    visaApproval: {
      date: '',
      file: null
    },
    tie: {
      appointmentDate: '',
      policeOffice: '',
      proofFile: null
    }
  };
}

let cachedMyVisaState = null;

function buildTripDocStatusMap(myVisaState, checklistState, profile = null) {
  const map = {};

  const applyStatus = (key, status) => {
    if (!key) return;
    const normalizedKey = normalizeChecklistKeyInput(key);
    if (!normalizedKey) return;
    const normalizedStatus = normalizeChecklistStatus(status);
    const rawStatus = (status || '').toString().toLowerCase();
    const canonicalKey = normalizedKey.replace(/_/g, '-');
    const altKey = canonicalKey.includes('-')
      ? canonicalKey.replace(/-/g, '_')
      : normalizedKey.includes('_')
        ? normalizedKey.replace(/_/g, '-')
        : '';
    const value = { normalized: normalizedStatus, raw: rawStatus };
    map[normalizedKey] = value;
    map[canonicalKey] = value;
    if (altKey && altKey !== normalizedKey && altKey !== canonicalKey) {
      map[altKey] = value;
    }
  };

  if (myVisaState && typeof myVisaState.docStatuses === 'object') {
    Object.keys(myVisaState.docStatuses).forEach((key) => {
      applyStatus(key, myVisaState.docStatuses[key]);
    });
  }

  const applyFromItems = (items) => {
    items.forEach((item) => applyStatus(item?.key, item?.status));
  };

  if (checklistState && Array.isArray(checklistState.items)) {
    applyFromItems(checklistState.items);
  }

  let profileSource = profile;
  if (!profileSource) {
    try {
      profileSource = userProfileData;
    } catch (_) {
      profileSource = null;
    }
  }

  const profileItems = profileSource?.visa?.checklist?.items;
  if (Array.isArray(profileItems)) {
    applyFromItems(profileItems);
  }

  return map;
}

function getDocStatusEntry(docStatuses, keys) {
  if (!docStatuses) return null;
  for (const key of keys) {
    if (!key) continue;
    const normalizedKey = normalizeChecklistKeyInput(key);
    if (normalizedKey && docStatuses[normalizedKey]) return docStatuses[normalizedKey];
    const hyphenKey = normalizedKey.replace(/_/g, '-');
    if (hyphenKey && docStatuses[hyphenKey]) return docStatuses[hyphenKey];
    const underscoreKey = hyphenKey.replace(/-/g, '_');
    if (underscoreKey && docStatuses[underscoreKey]) return docStatuses[underscoreKey];
  }
  return null;
}

function isDocStatusComplete(entry) {
  if (!entry) return false;
  const normalized = (entry.normalized || '').toString().toLowerCase();
  const raw = (entry.raw || '').toString().toLowerCase();
  if (normalized === 'uploaded' || normalized === 'verified' || normalized === 'approved') return true;
  if (raw === 'uploaded' || raw === 'verified' || raw === 'approved') return true;
  return false;
}

function isSpainRoute(profile = {}, myVisaState = null) {
  const candidates = [];
  const pushSubmission = (submission) => {
    if (!submission || typeof submission !== 'object') return;
    ['country', 'mode', 'selected', 'submitChoice', 'method', 'location'].forEach((field) => {
      const value = submission[field];
      if (typeof value === 'string' && value.trim()) {
        candidates.push(value.trim().toLowerCase());
      }
    });
  };

  if (profile?.visa?.submission) pushSubmission(profile.visa.submission);
  if (profile?.submission) pushSubmission(profile.submission);
  if (myVisaState?.submission) pushSubmission(myVisaState.submission);

  const profileChoice = (profile?.visa?.submissionChoice || '').toString().trim().toLowerCase();
  if (profileChoice) candidates.push(profileChoice);

  return candidates.some((value) => value === 'spain' || value === 'es' || value.includes('spain'));
}

function hasFbiAndApostille(docStatuses) {
  const fbiEntry = getDocStatusEntry(docStatuses, ['fbi-report', 'fbi_report', 'fbiReport']);
  const apostilleEntry = getDocStatusEntry(docStatuses, ['fbi-apostille', 'fbi_apostille', 'apostille_fbi', 'fbiApostille']);
  return isDocStatusComplete(fbiEntry) && isDocStatusComplete(apostilleEntry);
}

function hasVisaApproval(myVisaState, docStatuses) {
  const entry = getDocStatusEntry(docStatuses, ['visa-approval', 'visa_approval', 'visaApproval']);
  if (isDocStatusComplete(entry)) return true;
  const fileMeta = normalizeFileMeta(myVisaState?.visaApproval?.file);
  return Boolean(fileMeta?.dataUrl);
}

function canUnlockTrip(docStatuses, profile, myVisaState) {
  if (isSpainRoute(profile, myVisaState)) {
    return hasFbiAndApostille(docStatuses);
  }
  return hasVisaApproval(myVisaState, docStatuses);
}

function emitAppStateUpdated() {
  if (typeof window === 'undefined') return;
  try {
    let profile = null;
    try {
      profile = userProfileData;
    } catch (_) {
      profile = profileState?.data || null;
    }

    const myVisa = getMyVisaState();
    const checklistState = getChecklistState();
    const docs = buildTripDocStatusMap(myVisa, checklistState, profile);
    const detail = { profile, myVisa, docs };
    window.__APP_STATE__ = detail;
    window.dispatchEvent(new CustomEvent('app:state-updated', { detail }));
  } catch (error) {
    console.warn('Unable to emit app state update', error);
  }
}

function normalizeFileMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const name = (meta.name || '').toString();
  const dataUrl = (meta.dataUrl || '').toString();
  if (!name || !dataUrl) return null;
  const size = typeof meta.size === 'number' ? meta.size : Number(meta.size);
  const type = (meta.type || '').toString();
  const uploadedAt = meta.uploadedAt || new Date().toISOString();
  return {
    name,
    dataUrl,
    size: Number.isFinite(size) ? size : null,
    type,
    uploadedAt
  };
}

const SPAIN_REQUEST_STATUSES = ['none', 'pending', 'approved', 'denied'];
const SPAIN_REQUEST_LEGACY_STATUS_MAP = {
  pending: 'pending',
  requested: 'pending'
};
const SPAIN_STUDENT_DOC_KEYS = [
  'fbi-report',
  'fbi-apostille',
  'fbi-report-translation',
  'fbi-apostille-translation'
];
const SPAIN_DOC_LABELS = {
  'fbi-report': 'FBI Background Check',
  'fbi-apostille': 'Apostille of The Hague (FBI record)',
  'fbi-report-translation': 'Translation of FBI Background Check',
  'fbi-apostille-translation': 'Translation of Apostille'
};
function getCurrentSubmissionMethod() {
  const state = getMyVisaState();
  return state.submission?.method === 'spain' ? 'spain' : 'usa';
}

function getSubmissionMode() {
  return getCurrentSubmissionMethod();
}

function getUsaChecklistDefinition() {
  return VISA_CHECKLIST_CATALOG.map((item) => ({
    key: item.key,
    label: item.title,
    minor: item.minor === true
  }));
}

function getChecklistDefinitionForMode(mode) {
  if (mode === 'spain') {
    return [
      { key: 'fbi-report', label: 'FBI Background Check' },
      { key: 'fbi-apostille', label: 'Apostille of FBI' },
      { key: 'fbi-report-translation', label: 'Translation of FBI' },
      { key: 'fbi-apostille-translation', label: 'Translation of Apostille' }
    ];
  }
  return getUsaChecklistDefinition();
}

function getChecklistAllowedKeys(mode = getSubmissionMode()) {
  const definition = getChecklistDefinitionForMode(mode);
  return definition.map((entry) => entry.key);
}
const SPAIN_REQUIRED_DOCS = [
  { key: 'fbi-report', title: 'FBI Background Check' },
  { key: 'fbi-apostille', title: 'Apostille of FBI' },
  { key: 'fbi-report-translation', title: 'Translation of FBI' },
  { key: 'fbi-apostille-translation', title: 'Translation of Apostille' }
];

let spainRequestModal = null;
const TAB_DISABLE_HANDLERS = new Map();

function normalizeEtureDoc(doc, fallbackIndex = 0) {
  if (!doc || typeof doc !== 'object') {
    return null;
  }
  const rawId = doc.id || doc.key || doc.slug || doc.uuid || `eture-${fallbackIndex}`;
  const id = (rawId || `eture-${fallbackIndex}`).toString();
  const name = (doc.name || doc.title || 'ETURE document').toString();
  const fileSource = doc.fileMeta || doc.file || null;
  const fileMeta = normalizeFileMeta(fileSource);
  const fileUrl = (doc.fileUrl || fileMeta?.dataUrl || '').toString();
  const uploadedAt = (doc.uploadedAt || doc.updatedAt || fileMeta?.uploadedAt || '').toString();
  const status = normalizeChecklistStatus(doc.status || 'uploaded');
  const fileName = (doc.fileName || fileMeta?.name || '').toString();
  const fileMime = (doc.fileMime || fileMeta?.type || '').toString();
  return {
    id,
    name,
    status,
    fileMeta,
    fileUrl,
    fileName,
    fileMime,
    uploadedAt
  };
}

function sanitizeSpainTravelEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => {
    const safe = entry && typeof entry === 'object' ? entry : {};
    const place = (safe.place || safe.country || safe.location || '').toString();
    const entryDate = (safe.entry || safe.entryDate || '').toString();
    const exitDate = (safe.exit || safe.exitDate || '').toString();
    return {
      place,
      entry: entryDate,
      exit: exitDate
    };
  });
}

function getEtureDocs() {
  return getNormalizedEtureDocs();
}

function getSpainTravelEntries() {
  ensureVisaDefaults();
  userProfileData.visa.spainTravel = sanitizeSpainTravelEntries(userProfileData.visa.spainTravel);
  return userProfileData.visa.spainTravel.map((entry) => ({ ...entry }));
}

function setSpainTravelEntries(entries) {
  ensureVisaDefaults();
  const sanitized = sanitizeSpainTravelEntries(entries);
  userProfileData.visa.spainTravel = sanitized.map((entry) => ({ ...entry }));
  return userProfileData.visa.spainTravel;
}

function getSpainEuropeVisitFlag() {
  ensureVisaDefaults();
  const flag = (userProfileData.visa.spainEuropeVisit || '').toString().toLowerCase();
  if (flag === 'yes' || flag === 'no') return flag;
  return userProfileData.visa.spainTravel.length ? 'yes' : 'no';
}

function setSpainEuropeVisitFlag(value) {
  ensureVisaDefaults();
  const normalized = value === 'yes' ? 'yes' : value === 'no' ? 'no' : '';
  userProfileData.visa.spainEuropeVisit = normalized;
  return normalized;
}

function normalizeMyVisaState(state) {
  const defaults = getDefaultMyVisaState();
  const raw = state && typeof state === 'object' ? state : {};

  const submissionRaw = raw.submission && typeof raw.submission === 'object' ? raw.submission : {};
  const legacySubmissionLocation = (raw.submissionLocation || '').toString().trim().toLowerCase();
  const methodRaw = (submissionRaw.method || legacySubmissionLocation || defaults.submission.method).toString().trim().toLowerCase();
  const normalizedMethod = methodRaw === 'spain' ? 'spain' : 'usa';

  const spainRequestRaw = submissionRaw.spainRequest && typeof submissionRaw.spainRequest === 'object'
    ? submissionRaw.spainRequest
    : {};
  let spainStatusRaw = (spainRequestRaw.status || '').toString().trim().toLowerCase();
  if (SPAIN_REQUEST_LEGACY_STATUS_MAP[spainStatusRaw]) {
    spainStatusRaw = SPAIN_REQUEST_LEGACY_STATUS_MAP[spainStatusRaw];
  }
  const spainStatus = SPAIN_REQUEST_STATUSES.includes(spainStatusRaw) ? spainStatusRaw : 'none';
  let requestReason = (spainRequestRaw.requestReason || '').toString();
  let decisionReason = (spainRequestRaw.decisionReason || '').toString();
  const legacyReason = (spainRequestRaw.reason || '').toString();
  if (!requestReason && spainStatus === 'pending') {
    requestReason = legacyReason;
  }
  if (!decisionReason && spainStatus === 'denied') {
    decisionReason = legacyReason;
  }
  const requestTimestamp = (spainRequestRaw.requestTimestamp || spainRequestRaw.timestamp || '').toString();
  const decisionTimestamp = (spainRequestRaw.decisionTimestamp || '').toString();

  const appointmentRaw = raw.appointment && typeof raw.appointment === 'object' ? raw.appointment : {};
  const visaApprovalRaw = raw.visaApproval && typeof raw.visaApproval === 'object' ? raw.visaApproval : {};
  const tieRaw = raw.tie && typeof raw.tie === 'object' ? raw.tie : {};

  const docStatusesRaw = raw.docStatuses && typeof raw.docStatuses === 'object' ? raw.docStatuses : {};
  const docStatuses = {};
  Object.keys(docStatusesRaw).forEach((key) => {
    if (!key) return;
    docStatuses[normalizeChecklistKeyInput(key)] = normalizeChecklistStatus(docStatusesRaw[key]);
  });

  const etureRaw = Array.isArray(raw.etureDocs) ? raw.etureDocs : [];
  const etureDocs = etureRaw
    .map((doc, index) => normalizeEtureDoc(doc, index))
    .filter(Boolean);

  const profileTravel = getSpainTravelEntries();
  const profileVisitFlag = getSpainEuropeVisitFlag();
  const spainTravelRaw = Array.isArray(submissionRaw.spainTravel)
    ? submissionRaw.spainTravel
    : Array.isArray(raw.spainTravel)
      ? raw.spainTravel
      : profileTravel;
  const spainTravel = sanitizeSpainTravelEntries(spainTravelRaw);
  const spainVisitRaw = (submissionRaw.spainEuropeVisit || raw.spainEuropeVisit || profileVisitFlag || '').toString().toLowerCase();
  const spainEuropeVisit = spainVisitRaw === 'yes' ? 'yes' : spainVisitRaw === 'no' ? 'no' : (spainTravel.length ? 'yes' : '');

  const spainSettingsRaw = submissionRaw.spain && typeof submissionRaw.spain === 'object'
    ? submissionRaw.spain
    : raw.spain && typeof raw.spain === 'object'
      ? raw.spain
      : {};
  const spainTermsAccepted = typeof spainSettingsRaw.termsAccepted === 'boolean'
    ? spainSettingsRaw.termsAccepted
    : typeof submissionRaw.spainTermsAccepted === 'boolean'
      ? submissionRaw.spainTermsAccepted
      : typeof raw.spainTermsAccepted === 'boolean'
        ? raw.spainTermsAccepted
        : getLegacySpainTermsAccepted();

  return {
    submission: {
      method: normalizedMethod,
      spainRequest: {
        status: spainStatus,
        requestReason,
        decisionReason,
        requestTimestamp,
        decisionTimestamp
      },
      expectedArrival: (submissionRaw.expectedArrival || submissionRaw.expectedArrivalDate || '').toString(),
      spainEuropeVisit,
      spainTravel,
      spain: {
        termsAccepted: spainTermsAccepted === true
      }
    },
    docStatuses,
    etureDocs,
    isMinor: raw.isMinor === true ? true : raw.isMinor === false ? false : defaults.isMinor,
    appointment: {
      datetime: (appointmentRaw.datetime || appointmentRaw.dateTime || '').toString(),
      center: (appointmentRaw.center || appointmentRaw.blsCenter || '').toString(),
      proofFile: normalizeFileMeta(appointmentRaw.proofFile),
      readAcknowledged: appointmentRaw.readAcknowledged === true
    },
    visaApproval: {
      date: (visaApprovalRaw.date || '').toString(),
      file: normalizeFileMeta(visaApprovalRaw.file)
    },
    tie: {
      appointmentDate: (tieRaw.appointmentDate || '').toString(),
      policeOffice: (tieRaw.policeOffice || '').toString(),
      proofFile: normalizeFileMeta(tieRaw.proofFile)
    }
  };
}

function getMyVisaState() {
  if (cachedMyVisaState) {
    return JSON.parse(JSON.stringify(cachedMyVisaState));
  }

  let parsed = null;
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage?.getItem(MY_VISA_STATE_STORAGE_KEY);
      if (stored) {
        parsed = JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Unable to read myVisa state from storage', error);
    }
  }

  let normalized = normalizeMyVisaState(parsed);
  const defaults = getDefaultMyVisaState();
  const submission = getVisaSubmissionState();
  const derivedMethod = submission.submitChoice === 'spain' ? 'spain' : 'usa';

  if (!normalized.submission || typeof normalized.submission !== 'object') {
    normalized.submission = { ...defaults.submission };
  }

  if (!normalized.submission.method) {
    normalized.submission.method = derivedMethod;
  }

  if (normalized.submission.method !== derivedMethod) {
    normalized.submission.method = derivedMethod;
  }

  const normalizedSubmission = { ...normalized.submission };
  const normalizedSpain = normalizedSubmission.spain && typeof normalizedSubmission.spain === 'object'
    ? { ...normalizedSubmission.spain }
    : {};

  normalized.submission = {
    ...defaults.submission,
    ...normalizedSubmission,
    spainRequest: {
      ...defaults.submission.spainRequest,
      ...(normalizedSubmission.spainRequest || {})
    },
    spain: {
      ...defaults.submission.spain,
      ...normalizedSpain,
      termsAccepted: normalizedSpain.termsAccepted === true
    }
  };

  const minorFlag = getIsMinor();
  normalized.isMinor = minorFlag;

  const profileAppointment = userProfileData?.visa?.appointment;
  if (profileAppointment && typeof profileAppointment === 'object') {
    normalized.appointment = normalized.appointment || { ...getDefaultMyVisaState().appointment };
    if (!normalized.appointment.datetime) {
      normalized.appointment.datetime = (profileAppointment.datetime || profileAppointment.dateTime || '').toString();
    }
    if (!normalized.appointment.center) {
      normalized.appointment.center = (profileAppointment.center || profileAppointment.blsCenter || '').toString();
    }
    if (!normalized.appointment.proofFile && profileAppointment.proofFile) {
      normalized.appointment.proofFile = normalizeFileMeta(profileAppointment.proofFile);
    }
    if (profileAppointment.readAcknowledged === true) {
      normalized.appointment.readAcknowledged = true;
    }
  }

  cachedMyVisaState = normalized;
  return JSON.parse(JSON.stringify(normalized));
}

function saveMyVisaState(updater) {
  const current = getMyVisaState();
  const candidate = typeof updater === 'function'
    ? normalizeMyVisaState(updater({ ...current }))
    : normalizeMyVisaState({ ...current, ...updater });

  if (candidate.isMinor !== current.isMinor) {
    setIsMinor(candidate.isMinor === true);
  }

  const defaults = getDefaultMyVisaState();
  const submissionInput = candidate.submission && typeof candidate.submission === 'object'
    ? { ...candidate.submission }
    : {};
  const spainInput = submissionInput.spain && typeof submissionInput.spain === 'object'
    ? { ...submissionInput.spain }
    : {};

  candidate.submission = {
    ...defaults.submission,
    ...submissionInput,
    spainRequest: {
      ...defaults.submission.spainRequest,
      ...(submissionInput.spainRequest || {})
    },
    spain: {
      ...defaults.submission.spain,
      ...spainInput,
      termsAccepted: spainInput.termsAccepted === true
    }
  };

  cachedMyVisaState = candidate;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(MY_VISA_STATE_STORAGE_KEY, JSON.stringify(candidate));
    } catch (error) {
      console.warn('Unable to persist myVisa state', error);
    }
  }

  emitAppStateUpdated();

  return JSON.parse(JSON.stringify(candidate));
}

function getNormalizedEtureDocs() {
  const seen = new Map();

  const addDoc = (doc, index = 0) => {
    const normalized = normalizeEtureDoc(doc, index);
    if (!normalized) return;
    const existing = seen.get(normalized.id);
    if (!existing) {
      seen.set(normalized.id, normalized);
      return;
    }
    const hasExistingFile = Boolean(existing.fileMeta?.dataUrl || existing.fileUrl);
    const hasNewFile = Boolean(normalized.fileMeta?.dataUrl || normalized.fileUrl);
    if (!hasExistingFile && hasNewFile) {
      seen.set(normalized.id, normalized);
      return;
    }
    if (hasExistingFile && hasNewFile && !existing.fileMeta?.dataUrl && normalized.fileMeta?.dataUrl) {
      seen.set(normalized.id, normalized);
    }
  };

  const profileDocs = userProfileData?.visa?.etureDocs;
  if (Array.isArray(profileDocs)) {
    profileDocs.forEach((doc, index) => addDoc(doc, index));
  }

  const stateDocs = getMyVisaState().etureDocs;
  if (Array.isArray(stateDocs)) {
    const offset = Array.isArray(profileDocs) ? profileDocs.length : 0;
    stateDocs.forEach((doc, index) => addDoc(doc, offset + index));
  }

  return Array.from(seen.values());
}

const BLS_CENTER_DETAILS = {
  "Boston": {
    addressLines: [
      "15 Court Square, Suite 520",
      "Boston, MA 02108"
    ],
    mapsQuery: "15 Court Square, Suite 520, Boston, MA 02108",
    notes: [
      "Bring printed appointment confirmation and a valid photo ID.",
      "Arrive 10–15 minutes early for security and check-in."
    ],
    phone: "(617) 536-2506 / 2527",
    email: "cog.boston@maec.es",
    site: "https://usa.blsspainvisa.com/boston/"
  },
  "Chicago": {
    addressLines: [
      "121 W Wacker Dr, Suite 1307",
      "Chicago, IL 60601"
    ],
    mapsQuery: "121 W Wacker Dr, Suite 1307, Chicago, IL 60601",
    notes: [
      "Bring printed appointment confirmation and a valid photo ID."
    ],
    phone: "(312) 782-4588 / 4589",
    email: "cog.chicago@maec.es",
    site: "https://usa.blsspainvisa.com/chicago/"
  },
  "Houston": {
    addressLines: [
      "2500 W Loop S #270",
      "Houston, TX 77027"
    ],
    mapsQuery: "2500 W Loop S #270, Houston, TX 77027",
    notes: [
      "Bring printed appointment confirmation and a valid photo ID."
    ],
    phone: "(713) 783-6200 / 05 / 14",
    email: "",
    site: "https://usa.blsspainvisa.com/houston/"
  },
  "Los Angeles": {
    addressLines: [
      "6380 Wilshire Blvd, Suite 1100",
      "Los Angeles, CA 90048"
    ],
    mapsQuery: "6380 Wilshire Blvd, Suite 1100, Los Angeles, CA 90048",
    notes: [
      "Bring printed appointment confirmation and a valid photo ID."
    ],
    phone: "(323) 938-0158 / 0166",
    email: "cog.losangeles@maec.es",
    site: "https://usa.blsspainvisa.com/losangeles/"
  },
  "Miami": {
    addressLines: [
      "3191 Coral Way, Suite 611",
      "Miami, FL 33145"
    ],
    mapsQuery: "3191 Coral Way, Suite 611, Miami, FL 33145",
    notes: [
      "Bring printed appointment confirmation and a valid photo ID."
    ],
    phone: "(305) 446-5511 / 12 / 13",
    email: "cog.miami@maec.es",
    site: "https://usa.blsspainvisa.com/miami/"
  },
  "New York": {
    addressLines: [
      "55 W 39th St, 18th Floor",
      "New York, NY 10018"
    ],
    mapsQuery: "55 W 39th St, 18th Floor, New York, NY 10018",
    notes: [
      "Bring printed appointment confirmation and a valid photo ID."
    ],
    phone: "(212) 355-4080 / 81 / 82 / 85 / 90",
    email: "cog.nuevayork@maec.es",
    site: "https://usa.blsspainvisa.com/nyc/"
  },
  "San Francisco": {
    addressLines: [
      "717 Market St, Suite 425",
      "San Francisco, CA 94103"
    ],
    mapsQuery: "717 Market St, Suite 425, San Francisco, CA 94103",
    notes: [
      "Bring printed appointment confirmation and a valid photo ID."
    ],
    phone: "(415) 922-2995 / 96",
    email: "cog.sanfrancisco@maec.es",
    site: "https://usa.blsspainvisa.com/sanfrancisco/"
  },
  "Washington DC": {
    addressLines: [
      "1660 L St NW, Second Floor, Suite 216",
      "Washington, DC 20036"
    ],
    mapsQuery: "1660 L St NW, Suite 216, Washington, DC 20036",
    notes: [
      "Bring printed appointment confirmation and a valid photo ID."
    ],
    phone: "(202) 728-2330",
    email: "cog.washington@maec.es",
    site: "https://usa.blsspainvisa.com/washington/"
  },
  "San Juan PR": {
    addressLines: [
      "Edificio Mercantil Plaza, Piso 11, Oficina 1101",
      "Av. Ponce de León s/n, Hato Rey, San Juan 00918"
    ],
    mapsQuery: "Edificio Mercantil Plaza, Piso 11, Oficina 1101, Av. Ponce de León s/n, Hato Rey, San Juan 00918",
    notes: [
      "Bring printed appointment confirmation and a valid photo ID."
    ],
    phone: "(787) 758-6090 / 6142 / 6279",
    email: "cog.sanjuandePuertoRico@maec.es",
    site: "https://do.blsspainvisa.com/"
  }
};

const BLS_CENTER_DETAILS_BY_SLUG = Object.entries(BLS_CENTER_DETAILS).reduce((acc, [city, detail]) => {
  const slug = toCitySlug(city);
  acc[slug] = { city, slug, ...detail };
  return acc;
}, {});

const CHECKLIST_DOM_ID_MAP = {
  'eture-docs': 'CHK_ETURE_DOCS',
  passport: 'CHK_PASSPORT',
  'fbi-report': 'CHK_FBI_REPORT',
  'fbi-apostille': 'CHK_FBI_APOSTILLE',
  'fbi-report-translation': 'CHK_FBI_REPORT_TRANSLATION',
  'fbi-apostille-translation': 'CHK_FBI_APOSTILLE_TRANSLATION',
  'financial-means': 'CHK_FINANCIAL_MEANS',
  'financial-means-translation': 'CHK_FINANCIAL_MEANS_TRANSLATION',
  'financial-means-apostille': 'CHK_FINANCIAL_MEANS_APOSTILLE',
  'birth-certificate': 'CHK_MINOR_BIRTH_CERT',
  'parents-passports': 'CHK_MINOR_PARENTS_PASSPORTS',
  'parental-authorization': 'CHK_MINOR_PARENTAL_AUTHORIZATION'
};

const CONSULATE_BY_STATE = {
  AL: { city: 'Houston', url: BLS_CENTER_DETAILS['Houston'].site },
  AK: { city: 'San Francisco', url: BLS_CENTER_DETAILS['San Francisco'].site },
  AZ: { city: 'Los Angeles', url: BLS_CENTER_DETAILS['Los Angeles'].site },
  AR: { city: 'Houston', url: BLS_CENTER_DETAILS['Houston'].site },
  CA: { city: null, url: null, requiresCaSplit: true },
  CO: { city: 'Los Angeles', url: BLS_CENTER_DETAILS['Los Angeles'].site },
  CT: { city: 'New York', url: BLS_CENTER_DETAILS['New York'].site },
  DC: { city: 'Washington DC', url: BLS_CENTER_DETAILS['Washington DC'].site },
  DE: { city: 'New York', url: BLS_CENTER_DETAILS['New York'].site },
  FL: { city: 'Miami', url: BLS_CENTER_DETAILS['Miami'].site },
  GA: { city: 'Miami', url: BLS_CENTER_DETAILS['Miami'].site },
  HI: { city: 'San Francisco', url: BLS_CENTER_DETAILS['San Francisco'].site },
  ID: { city: 'San Francisco', url: BLS_CENTER_DETAILS['San Francisco'].site },
  IL: { city: 'Chicago', url: BLS_CENTER_DETAILS['Chicago'].site },
  IN: { city: 'Chicago', url: BLS_CENTER_DETAILS['Chicago'].site },
  IA: { city: 'Chicago', url: BLS_CENTER_DETAILS['Chicago'].site },
  KS: { city: 'Chicago', url: BLS_CENTER_DETAILS['Chicago'].site },
  KY: { city: 'Chicago', url: BLS_CENTER_DETAILS['Chicago'].site },
  LA: { city: 'Houston', url: BLS_CENTER_DETAILS['Houston'].site },
  ME: { city: 'Boston', url: BLS_CENTER_DETAILS['Boston'].site },
  MD: { city: 'Washington DC', url: BLS_CENTER_DETAILS['Washington DC'].site },
  MA: { city: 'Boston', url: BLS_CENTER_DETAILS['Boston'].site },
  MI: { city: 'Chicago', url: BLS_CENTER_DETAILS['Chicago'].site },
  MN: { city: 'Chicago', url: BLS_CENTER_DETAILS['Chicago'].site },
  MS: { city: 'Houston', url: BLS_CENTER_DETAILS['Houston'].site },
  MO: { city: 'Chicago', url: BLS_CENTER_DETAILS['Chicago'].site },
  MT: { city: 'San Francisco', url: BLS_CENTER_DETAILS['San Francisco'].site },
  NE: { city: 'Chicago', url: BLS_CENTER_DETAILS['Chicago'].site },
  NV: { city: 'San Francisco', url: BLS_CENTER_DETAILS['San Francisco'].site },
  NH: { city: 'Boston', url: BLS_CENTER_DETAILS['Boston'].site },
  NJ: { city: 'New York', url: BLS_CENTER_DETAILS['New York'].site },
  NM: { city: 'Houston', url: BLS_CENTER_DETAILS['Houston'].site },
  NY: { city: 'New York', url: BLS_CENTER_DETAILS['New York'].site },
  NC: { city: 'Washington DC', url: BLS_CENTER_DETAILS['Washington DC'].site },
  ND: { city: 'Chicago', url: BLS_CENTER_DETAILS['Chicago'].site },
  OH: { city: 'Chicago', url: BLS_CENTER_DETAILS['Chicago'].site },
  OK: { city: 'Houston', url: BLS_CENTER_DETAILS['Houston'].site },
  OR: { city: 'San Francisco', url: BLS_CENTER_DETAILS['San Francisco'].site },
  PA: { city: 'New York', url: BLS_CENTER_DETAILS['New York'].site },
  PR: { city: 'San Juan PR', url: BLS_CENTER_DETAILS['San Juan PR'].site },
  RI: { city: 'Boston', url: BLS_CENTER_DETAILS['Boston'].site },
  SC: { city: 'Miami', url: BLS_CENTER_DETAILS['Miami'].site },
  SD: { city: 'Chicago', url: BLS_CENTER_DETAILS['Chicago'].site },
  TN: { city: 'Houston', url: BLS_CENTER_DETAILS['Houston'].site },
  TX: { city: 'Houston', url: BLS_CENTER_DETAILS['Houston'].site },
  UT: { city: 'Los Angeles', url: BLS_CENTER_DETAILS['Los Angeles'].site },
  VT: { city: 'Boston', url: BLS_CENTER_DETAILS['Boston'].site },
  VA: { city: 'Washington DC', url: BLS_CENTER_DETAILS['Washington DC'].site },
  VI: { city: 'San Juan PR', url: BLS_CENTER_DETAILS['San Juan PR'].site },
  WA: { city: 'San Francisco', url: BLS_CENTER_DETAILS['San Francisco'].site },
  WV: { city: 'Washington DC', url: BLS_CENTER_DETAILS['Washington DC'].site },
  WI: { city: 'Chicago', url: BLS_CENTER_DETAILS['Chicago'].site },
  WY: { city: 'San Francisco', url: BLS_CENTER_DETAILS['San Francisco'].site }
};

const CA_REGION_TO_CITY = {
  north: 'San Francisco',
  south: 'Los Angeles'
};

let cachedIsMinor = null;

function normalizeChecklistKeyInput(key) {
  const raw = (key || '').toString().trim();
  if (!raw) return '';
  return CHECKLIST_KEY_ALIASES[raw] || raw;
}

function isChecklistItemVisible(item, includeMinor = getIsMinor()) {
  if (!item) return false;
  return !item.minor || includeMinor === true;
}

function getIsMinor() {
  if (typeof cachedIsMinor === 'boolean') return cachedIsMinor;

  let value = null;
  const storedProfile = userProfileData?.visa?.checklist;
  if (storedProfile && typeof storedProfile.isMinor === 'boolean') {
    value = storedProfile.isMinor;
  }

  if (value === null && typeof window !== 'undefined') {
    try {
      const stored = window.localStorage?.getItem(MINOR_STORAGE_KEY);
      if (stored !== null) {
        value = stored === 'true';
      }
    } catch (error) {
      console.warn('Unable to read minor flag from storage', error);
    }
  }

  if (value === null) value = false;
  cachedIsMinor = value === true;

  if (!userProfileData.visa) userProfileData.visa = {};
  userProfileData.visa.checklist = userProfileData.visa.checklist || { items: [], total: 0, uploaded: 0, _updatedAt: '' };
  userProfileData.visa.checklist.isMinor = cachedIsMinor;

  return cachedIsMinor;
}

function setIsMinor(value) {
  const next = value === true;
  if (cachedIsMinor === next) {
    return next;
  }
  cachedIsMinor = next;

  if (!userProfileData.visa) userProfileData.visa = {};
  userProfileData.visa.checklist = userProfileData.visa.checklist || { items: [], total: 0, uploaded: 0, _updatedAt: '' };
  userProfileData.visa.checklist.isMinor = next;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(MINOR_STORAGE_KEY, next ? 'true' : 'false');
    } catch (error) {
      console.warn('Unable to persist minor flag', error);
    }
  }

  return next;
}

function getLegacySpainTermsAccepted() {
  return !!(userProfileData?.visa?.spainTermsAccepted);
}

function getSpainTermsAccepted() {
  const state = cachedMyVisaState || getMyVisaState();
  return !!(state?.submission?.spain?.termsAccepted);
}

function setSpainTermsAccepted(value) {
  userProfileData.visa = userProfileData.visa || {};
  userProfileData.visa.spainTermsAccepted = value === true;
  saveUserProfile();
  return userProfileData.visa.spainTermsAccepted;
}

function setSpainInfoAccepted(val) {
  const next = getVisaSubmissionState();
  next.spainInfoAccepted = !!val;
  setVisaSubmissionState(next);
  saveUserProfile();
  renderVisaSubmissionSpain(next);
  renderVisaChecklistProgress();
  renderVisaOverview();
}

if (typeof window !== 'undefined') {
  window.setSpainInfoAccepted = setSpainInfoAccepted;
}

function openSpainRequestModal(mode = 'request') {
  const modalEl = document.getElementById('spain-request-modal');
  const reasonInput = document.getElementById('spain-request-reason');
  const ackCheckbox = document.getElementById('spain-terms-check');
  const submitBtn = document.getElementById('spain-request-submit');
  if (!modalEl || !reasonInput || !ackCheckbox || !submitBtn) return;

  const submissionState = getVisaSubmissionState();
  const canonicalStatus = normalizeSpainRequestStatus(submissionState.spainRequestStatus);
  if (mode === 'request' && canonicalStatus === 'approved') {
    return;
  }
  const readOnly = mode === 'view' || canonicalStatus === 'approved';
  const storedReason = (submissionState.spainRequestReason || '').toString();

  const formCheck = ackCheckbox.closest('.form-check');

  reasonInput.disabled = readOnly;
  reasonInput.value = readOnly ? storedReason : '';

  if (formCheck) {
    formCheck.hidden = readOnly;
  }
  ackCheckbox.checked = false;
  ackCheckbox.disabled = readOnly;

  submitBtn.hidden = readOnly;
  submitBtn.disabled = true;

  spainRequestModal = bootstrap.Modal.getOrCreateInstance(modalEl);
  spainRequestModal.show();

  if (!readOnly) {
    setTimeout(() => {
      try {
        reasonInput.focus();
      } catch (_) {
        /* ignore */
      }
    }, 100);
  }

  validateSpainRequestModal();
}

function validateSpainRequestModal() {
  const submitBtn = document.getElementById('spain-request-submit');
  if (!submitBtn || submitBtn.hidden) return;
  const reason = (document.getElementById('spain-request-reason')?.value || '').trim();
  const ack = document.getElementById('spain-terms-check')?.checked === true;
  submitBtn.disabled = !(ack && reason.length >= 10);
}

function handleSpainRequestSubmit(event) {
  event?.preventDefault?.();
  const reasonInput = document.getElementById('spain-request-reason');
  const ackCheckbox = document.getElementById('spain-terms-check');
  const submitBtn = document.getElementById('spain-request-submit');
  const modalEl = document.getElementById('spain-request-modal');

  const reason = (reasonInput?.value || '').trim();
  if (!ackCheckbox?.checked) {
    alert('Please accept the terms.');
    return;
  }
  if (reason.length < 10) {
    alert('Please explain your reason (at least 10 characters).');
    reasonInput?.focus();
    return;
  }

  setSpainStatus('pending', reason);
  applySpainUiVisibility('pending');
  renderVisaChecklistProgress(getChecklistState());

  if (submitBtn) submitBtn.disabled = true;
  if (modalEl) {
    const modalInstance = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
    modalInstance?.hide();
  }
  cleanupModalArtifacts();
}

function handleSubmissionSpainRequestConfirm(event) {
  handleSpainRequestSubmit(event);
}

function handleSpainRequestCancel(event) {
  event?.preventDefault?.();
  const modalEl = document.getElementById('spain-request-modal');
  if (modalEl) {
    const modalInstance = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
    modalInstance?.hide();
  }
  window.setTimeout(cleanupModalArtifacts, 0);
}

function handleSpainRequestClose(event) {
  event?.preventDefault?.();
  window.setTimeout(cleanupModalArtifacts, 0);
}

function saveUserProfile() {
  ensureVisaDefaults();
  if (auth.currentUser) {
    saveProfileToFirestore(auth.currentUser.uid, userProfileData).catch((error) => {
      console.error('Unable to save user profile', error);
    });
  }
}

function setTripTabEnabled(enabled) {
  if (typeof document === 'undefined') return;
  const tabId = 'visa-trip-tab';
  setTabDisabled(tabId, !enabled);
  const tab = document.getElementById(tabId);
  if (tab) {
    tab.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    if (enabled) {
      tab.removeAttribute('tabindex');
    }
  }
  const pane = document.getElementById('visa-trip');
  if (pane) {
    pane.setAttribute('aria-hidden', enabled ? 'false' : 'true');
  }
  if (!enabled && tab?.classList.contains('active')) {
    const fallback = document.getElementById('visa-overview-tab');
    try {
      if (fallback && typeof bootstrap !== 'undefined') {
        bootstrap.Tab.getOrCreateInstance(fallback).show();
      }
    } catch (_) {}
  }
}

function evaluateTripUnlockFromState() {
  try {
    let profile = null;
    try {
      profile = userProfileData;
    } catch (_) {
      profile = profileState?.data || null;
    }
    const myVisaState = getMyVisaState();
    const checklistState = getChecklistState();
    const docStatuses = buildTripDocStatusMap(myVisaState, checklistState, profile);
    const enabled = canUnlockTrip(docStatuses, profile, myVisaState);
    setTripTabEnabled(enabled);
  } catch (error) {
    console.warn('Trip unlock evaluation failed', error);
  }
}

function recalcVisaProgressAndRender() {
  const cl = getChecklistState();
  renderVisaChecklistProgress(cl);
  renderVisaOverview();
  renderSubmissionProgress();
  rerenderActiveVisaTab();
  evaluateTripUnlockFromState();
}

function showChecklistRow(docKey, visible) {
  const normalizedKey = normalizeChecklistKeyInput(docKey);
  if (!normalizedKey) return;
  const row = document.querySelector(`[data-doc-key="${normalizedKey}"]`);
  if (!row) return;
  row.classList.toggle('d-none', visible === false);
  if (visible === false) {
    row.setAttribute('aria-hidden', 'true');
  } else {
    row.removeAttribute('aria-hidden');
  }
}

function normalizeBooleanFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const truthy = ['1', 'true', 'yes', 'on'];
  const falsy = ['0', 'false', 'no', 'off'];
  if (truthy.includes(normalized)) return true;
  if (falsy.includes(normalized)) return false;
  return null;
}

function computeDemoModeFlag() {
  if (typeof window === 'undefined') {
    return DEFAULT_DEMO_MODE;
  }

  try {
    const params = new URLSearchParams(window.location?.search || '');
    const demoParam = normalizeBooleanFlag(params.get('demo'));
    if (demoParam !== null) return demoParam;

    const staffParam = normalizeBooleanFlag(params.get('staff'));
    if (staffParam !== null) return staffParam;
  } catch (_) {
    // ignore parsing issues and fall back to defaults below
  }

  const configured =
    window.APP?.demoMode ??
    window.APP_CONFIG?.demoMode ??
    window.DEMO_MODE;

  if (typeof configured === 'boolean') return configured;

  return DEFAULT_DEMO_MODE;
}

const DEMO_MODE = computeDemoModeFlag();

function isDemoModeEnabled() {
  return DEMO_MODE === true;
}

const SUBMISSION_STATUS_META = {
  pending: {
    key: 'pending',
    label: 'Pending',
    chipClass: 'badge bg-secondary',
    overviewClass: 'badge bg-secondary',
    progress: 0
  },
  submitted: {
    key: 'submitted',
    label: 'Submitted',
    chipClass: 'badge bg-primary text-white',
    overviewClass: 'badge bg-primary',
    progress: 100
  },
  verified: {
    key: 'verified',
    label: 'Verified',
    chipClass: 'badge bg-success',
    overviewClass: 'badge bg-success',
    progress: 100
  },
  denied: {
    key: 'denied',
    label: 'Denied',
    chipClass: 'badge bg-danger',
    overviewClass: 'badge bg-danger',
    progress: 0
  }
};

let cachedVisaSubmissionState = null;

function getDefaultVisaSubmissionState() {
  return {
    stateCode: '',
    consulateKey: '',
    consulateCity: '',
    consulateUrl: '',
    caRegion: '',
    dateISO: '',
    fileMeta: null,
    status: 'Pending',
    denyReason: '',
    lastUpdateISO: '',
    submitChoice: 'usa',
    spain: { ...SPAIN_SUBMISSION_DEFAULTS },
    spainRequestStatus: 'none',
    spainRequestReason: ''
  };
}

function sanitizeSubmissionStatus(status) {
  const normalized = (status || '').toString().trim().toLowerCase();
  if (normalized && SUBMISSION_STATUS_META[normalized]) {
    return SUBMISSION_STATUS_META[normalized].label;
  }
  return SUBMISSION_STATUS_META.pending.label;
}

function resolveSubmissionStatusMeta(status) {
  const normalized = (status || '').toString().trim().toLowerCase();
  return SUBMISSION_STATUS_META[normalized] || SUBMISSION_STATUS_META.pending;
}

function toCitySlug(city) {
  return (city || '').toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return value.toString().replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return char;
    }
  });
}

function getCityDetails(cityName) {
  if (!cityName) return null;
  const slug = toCitySlug(cityName);
  const details = BLS_CENTER_DETAILS_BY_SLUG[slug];
  if (!details) return null;
  return {
    ...details,
    url: details.site || ''
  };
}

function resolveCenterForState(stateCode, caRegion) {
  if (!stateCode) return null;
  const code = stateCode.trim().toUpperCase();
  const entry = CONSULATE_BY_STATE[code];
  if (!entry) {
    return { missing: true };
  }

  if (entry.requiresCaSplit) {
    const region = (caRegion || '').toString().trim().toLowerCase();
    const targetCity = CA_REGION_TO_CITY[region];
    if (!targetCity) {
      return {
        requiresRegion: true,
        missing: false
      };
    }
    const details = getCityDetails(targetCity);
    if (!details) {
      return {
        slug: toCitySlug(targetCity),
        city: targetCity,
        url: '',
        details: null,
        caRegion: region,
        requiresRegion: false,
        missing: false
      };
    }
    return {
      slug: details.slug || toCitySlug(details.city),
      city: details.city,
      url: details.url || entry?.url || '',
      details,
      caRegion: region,
      requiresRegion: false,
      missing: false
    };
  }

  const details = getCityDetails(entry.city);
  if (!details) {
    return {
      slug: toCitySlug(entry.city),
      city: entry.city,
      url: entry.url || '',
      details: null,
      missing: false,
      requiresRegion: false
    };
  }
  return {
    slug: details.slug || toCitySlug(details.city),
    city: details.city,
    url: details.url || entry.url || '',
    details,
    missing: false,
    requiresRegion: false
  };
}

function applyCenterResolution(state) {
  if (!state) return state;
  const center = resolveCenterForState(state.stateCode, state.caRegion);
  if (!center || center.missing || center.requiresRegion) {
    state.blsSelection = null;
    state.consulateKey = '';
    state.consulateCity = '';
    state.consulateUrl = '';
    if (!center || !center.requiresRegion) {
      state.caRegion = '';
    }
    return state;
  }

  const details = center.details || getCityDetails(center.city) || {};
  const bookingUrl = details.site || center.url || '';
  state.consulateKey = center.slug || toCitySlug(center.city);
  state.consulateCity = center.city;
  state.consulateUrl = bookingUrl;
  if (state.stateCode !== 'CA') {
    state.caRegion = '';
  }
  state.blsSelection = {
    key: state.consulateKey,
    city: center.city,
    addressLines: Array.isArray(details.addressLines) ? details.addressLines.slice() : [],
    notes: Array.isArray(details.notes) ? details.notes.slice() : [],
    phone: details.phone || '',
    email: details.email || '',
    mapsUrl: details.mapsQuery || '',
    bookingUrl
  };
  return state;
}

function normalizeVisaSubmissionState(data = {}) {
  const base = getDefaultVisaSubmissionState();
  const merged = { ...base, ...data };

  merged.stateCode = (merged.stateCode || '').toString().trim().toUpperCase();
  merged.caRegion = (merged.caRegion || '').toString().trim().toLowerCase();
  if (merged.stateCode !== 'CA') {
    merged.caRegion = '';
  }

  const spainRaw = merged.spain && typeof merged.spain === 'object' ? merged.spain : {};
  const normalizedSpain = {
    ...SPAIN_SUBMISSION_DEFAULTS,
    ...spainRaw
  };
  normalizedSpain.europeVisit = ['yes', 'no'].includes((normalizedSpain.europeVisit || '').toString().toLowerCase())
    ? (normalizedSpain.europeVisit || '').toString().toLowerCase()
    : '';
  const staysArray = Array.isArray(normalizedSpain.stays) ? normalizedSpain.stays : [];
  normalizedSpain.stays = staysArray.map((stay) => {
    const safe = stay && typeof stay === 'object' ? stay : {};
    return {
      place: (safe.place || '').toString(),
      entryDate: (safe.entryDate || '').toString(),
      exitDate: (safe.exitDate || '').toString()
    };
  });
  normalizedSpain.feeAcknowledged = normalizedSpain.feeAcknowledged === true || normalizedSpain.feeAcknowledged === 'true';
  merged.spain = normalizedSpain;

  const rawSpainStatus = merged.spainRequestStatus
    || normalizedSpain.status
    || (normalizedSpain.requestStatus || '')
    || '';
  merged.spainRequestStatus = normalizeSpainRequestStatus(rawSpainStatus);
  merged.spainRequestReason = (merged.spainRequestReason
    || normalizedSpain.requestReason
    || '').toString();
  if (merged.spainRequestStatus === 'none') {
    merged.spainRequestReason = '';
  }

  const rawChoice = (merged.submitChoice || '').toString().toLowerCase();
  merged.submitChoice = rawChoice === 'spain' ? 'spain' : 'usa';

  merged.status = sanitizeSubmissionStatus(merged.status);
  if (merged.status !== SUBMISSION_STATUS_META.denied.label) {
    merged.denyReason = '';
  } else {
    merged.denyReason = (merged.denyReason || '').trim();
  }

  if (merged.fileMeta) {
    const allowedMeta = {
      name: merged.fileMeta.name || '',
      size: typeof merged.fileMeta.size === 'number' ? merged.fileMeta.size : null,
      type: merged.fileMeta.type || '',
      dataUrl: merged.fileMeta.dataUrl || ''
    };
    if (!allowedMeta.name) {
      merged.fileMeta = null;
    } else {
      merged.fileMeta = allowedMeta;
    }
  } else {
    merged.fileMeta = null;
  }

  merged.lastUpdateISO = merged.lastUpdateISO || '';
  return applyCenterResolution(merged);
}

function getVisaSubmissionState() {
  if (cachedVisaSubmissionState) {
    return JSON.parse(JSON.stringify(cachedVisaSubmissionState));
  }

  let source = null;

  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage?.getItem(VISA_SUBMISSION_STORAGE_KEY);
      if (stored) {
        source = JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Unable to read visa submission from storage', error);
    }

    if (!source && window.profileState?.visa?.submission) {
      source = window.profileState.visa.submission;
    }

    if (!source) {
      const savedStateCode = window.localStorage?.getItem(SUBMISSION_STATE_STORAGE_KEY) || '';
      if (savedStateCode) {
        source = {
          stateCode: savedStateCode,
          caRegion: window.localStorage?.getItem(SUBMISSION_CA_REGION_STORAGE_KEY) || ''
        };
      }
    }

    try {
      const storedChoice = window.localStorage?.getItem(SUBMISSION_CHOICE_STORAGE_KEY);
      if (storedChoice) {
        source = source || {};
        source.submitChoice = storedChoice;
      }

      const storedStays = window.localStorage?.getItem(SPAIN_STAYS_STORAGE_KEY);
      if (storedStays) {
        const parsedStays = JSON.parse(storedStays);
        if (Array.isArray(parsedStays)) {
          source = source || {};
          source.spain = source.spain || {};
          source.spain.stays = parsedStays;
        }
      }

    } catch (error) {
      console.warn('Unable to parse stored submission helper values', error);
    }
  }

  const normalized = normalizeVisaSubmissionState(source || getDefaultVisaSubmissionState());
  cachedVisaSubmissionState = normalized;
  return JSON.parse(JSON.stringify(normalized));
}

function persistVisaSubmissionState(updater) {
  const current = getVisaSubmissionState();
  const candidate = typeof updater === 'function'
    ? normalizeVisaSubmissionState(updater({ ...current }))
    : normalizeVisaSubmissionState({ ...current, ...updater });

  const now = new Date().toISOString();
  candidate.lastUpdateISO = now;
  candidate.spain = candidate.spain || { ...SPAIN_SUBMISSION_DEFAULTS };
  cachedVisaSubmissionState = candidate;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(VISA_SUBMISSION_STORAGE_KEY, JSON.stringify(candidate));
    } catch (error) {
      console.warn('Unable to persist visa submission state', error);
    }

    try {
      if (candidate.stateCode) {
        window.localStorage?.setItem(SUBMISSION_STATE_STORAGE_KEY, candidate.stateCode);
      } else {
        window.localStorage?.removeItem(SUBMISSION_STATE_STORAGE_KEY);
      }

      if (candidate.stateCode === 'CA' && candidate.caRegion) {
        window.localStorage?.setItem(SUBMISSION_CA_REGION_STORAGE_KEY, candidate.caRegion);
      } else {
        window.localStorage?.removeItem(SUBMISSION_CA_REGION_STORAGE_KEY);
      }

      window.localStorage?.setItem(SUBMISSION_CHOICE_STORAGE_KEY, candidate.submitChoice || 'usa');

      if (candidate.spain && Array.isArray(candidate.spain.stays)) {
        window.localStorage?.setItem(SPAIN_STAYS_STORAGE_KEY, JSON.stringify(candidate.spain.stays));
      } else {
        window.localStorage?.removeItem(SPAIN_STAYS_STORAGE_KEY);
      }

    } catch (error) {
      console.warn('Unable to persist submission helper state', error);
    }

    window.profileState = window.profileState || {};
    window.profileState.visa = window.profileState.visa || {};
    window.profileState.visa.submission = JSON.parse(JSON.stringify(candidate));
  }

  ensureVisaDefaults();
  userProfileData.visa.submission = JSON.parse(JSON.stringify(candidate));

  updateVisaSubmissionUI(candidate);
  renderVisaOverview();
  emitAppStateUpdated();
  evaluateTripUnlockFromState();
  return candidate;
}

function setVisaSubmissionState(nextStateOrUpdater) {
  if (typeof nextStateOrUpdater === 'function') {
    return persistVisaSubmissionState(nextStateOrUpdater);
  }
  return persistVisaSubmissionState(() => nextStateOrUpdater);
}

function renderVisaSubmissionConsulate(state, centerOverride = null) {
  const container = document.getElementById('submission-consulate-card');
  if (!container) return;

  const stateCode = (state?.stateCode || '').toString().trim().toUpperCase();
  if (!stateCode) {
    container.innerHTML = '<div class="border rounded p-4 bg-light text-muted">Select a state to view your BLS submission location.</div>';
    return;
  }

  const center = centerOverride || resolveCenterForState(stateCode, state?.caRegion);

  if (!center || center.missing) {
    container.innerHTML = '<div class="alert alert-secondary mb-0" role="alert">We couldn’t find your jurisdiction. Please pick the nearest consulate city.</div>';
    return;
  }

  if (center.requiresRegion) {
    container.innerHTML = `
      <div class="card border-warning">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
            <div>
              <h6 class="fw-bold mb-1">Select a California region</h6>
              <small class="text-muted">Consulate / BLS Center</small>
            </div>
            <a class="btn btn-primary disabled" href="#" role="button" aria-disabled="true" tabindex="-1" title="Select a region first">Book at BLS Spain Visa Service</a>
          </div>
          <p class="mb-0 small text-muted">Choose Northern or Southern California to view your BLS center details.</p>
        </div>
      </div>
    `;
    return;
  }

  const details = center.details || getCityDetails(center.city);
  if (!details) {
    const fallbackUrl = center.url || '';
    const bookingLabel = 'Book at BLS Spain Visa Service';
    const bookingButton = fallbackUrl
      ? `<a class="btn btn-primary" href="${fallbackUrl}" target="_blank" rel="noopener">${bookingLabel}</a>`
      : `<a class="btn btn-primary disabled" href="#" role="button" aria-disabled="true" tabindex="-1" title="URL not available">${bookingLabel}</a>`;

    container.innerHTML = `
      <div class="card">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
            <div>
              <h6 class="fw-bold mb-1">BLS ${center.city}</h6>
              <small class="text-muted">Consulate / BLS Center</small>
            </div>
            ${bookingButton}
          </div>
          <div class="text-muted">Center details are coming soon. Please continue monitoring this page.</div>
        </div>
      </div>
    `;
    return;
  }

  const bookingUrl = details.site || center.url || '';
  const addressLines = Array.isArray(details.addressLines)
    ? details.addressLines.filter(line => line && line.trim())
    : [];
  const notes = Array.isArray(details.notes)
    ? details.notes.filter(note => note && note.trim())
    : [];
  const hasAddress = addressLines.length > 0;
  const hasNotes = notes.length > 0;
  const mapsLink = details.mapsQuery
    ? `<a class="small d-inline-block mt-1" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(details.mapsQuery)}" target="_blank" rel="noopener">Open in Google Maps</a>`
    : '';
  const phone = (details.phone || '').toString().trim();
  const email = (details.email || '').toString().trim();
  const contactItems = [];
  if (phone) {
    contactItems.push(`<li><span class="fw-semibold">Phone:</span> ${phone}</li>`);
  }
  if (email) {
    contactItems.push(`<li><span class="fw-semibold">Email:</span> <a href="mailto:${email}">${email}</a></li>`);
  }
  const contactsHtml = contactItems.length
    ? `<div class="mt-3"><span class="fw-semibold d-block mb-1">Contacts</span><ul class="list-unstyled small mb-0">${contactItems.join('')}</ul></div>`
    : '';
  const bookingLabel = 'Book at BLS Spain Visa Service';
  const hasUrl = Boolean(bookingUrl);
  const bookingButton = hasUrl
    ? `<a class="btn btn-primary" href="${bookingUrl}" target="_blank" rel="noopener">${bookingLabel}</a>`
    : `<a class="btn btn-primary disabled" href="#" role="button" aria-disabled="true" tabindex="-1" title="URL not available">${bookingLabel}</a>`;

  container.innerHTML = `
    <div class="card">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
          <div>
            <h6 class="fw-bold mb-1">BLS ${details.city}</h6>
            <small class="text-muted">Consulate / BLS Center</small>
          </div>
          ${bookingButton}
        </div>
        ${hasAddress || mapsLink ? `<div class="mb-3"><span class="fw-semibold d-block mb-1">Address</span><div>${addressLines.map((line) => `<div>${line}</div>`).join('')}</div>${mapsLink}</div>` : ''}
        ${hasNotes ? `<div class="mt-3"><span class="fw-semibold d-block mb-1">Important notes</span><ul class="mb-0">${notes.map((note) => `<li>${note}</li>`).join('')}</ul></div>` : ''}
        ${contactsHtml}
        ${!hasUrl ? '<div class="form-text text-danger mt-3">Booking link not available yet. Please contact ETURE support.</div>' : ''}
      </div>
    </div>
  `;
}

function isStudentMinor() {
  const birthDateStr = userProfileData?.personal?.birthDate;
  if (!birthDateStr || !/^\d{2}\/\d{2}\/\d{4}$/.test(birthDateStr)) return false;
  const [dayStr, monthStr, yearStr] = birthDateStr.split('/');
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10);
  const year = parseInt(yearStr, 10);
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) return false;
  const birthDate = new Date(year, month - 1, day);
  if (Number.isNaN(birthDate.getTime())) return false;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age < 18;
}

function getSpainRequiredDocs() {
  return SPAIN_REQUIRED_DOCS.map((config) => {
    const item = getChecklistItem(config.key);
    const status = normalizeChecklistStatus(item?.status);
    return {
      key: config.key,
      title: config.title,
      status,
      fileUrl: item?.fileUrl || '',
      fileName: item?.fileName || '',
      review: item?.review || null,
      checklistDomId: getChecklistDomIdForKey(config.key)
    };
  });
}

function computeSpainSubmissionProgress() {
  const docs = getSpainRequiredDocs();
  const total = docs.length;
  const verified = docs.filter((doc) => normalizeChecklistStatus(doc.status) === 'verified').length;
  const percent = total ? Math.round((verified / total) * 100) : 0;
  return { docs, total, verified, percent };
}

function renderSubmissionDocList(containerId, emptyId, docs = []) {
  const listEl = document.getElementById(containerId);
  const emptyEl = emptyId ? document.getElementById(emptyId) : null;
  if (!listEl) return;

  if (!Array.isArray(docs) || !docs.length) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('d-none');
    return;
  }

  if (emptyEl) emptyEl.classList.add('d-none');

  listEl.innerHTML = docs.map((doc) => {
    const statusMeta = getChecklistVisualState({ status: doc.status });
    const iconHtml = statusMeta.icon ? `<span aria-hidden="true" class="me-1">${statusMeta.icon}</span>` : '';
    const denialReason = normalizeChecklistStatus(doc.status) === 'denied'
      ? (doc.review?.reason || '')
      : '';
    const denialHtml = denialReason
      ? `<div class="small text-danger mt-1">${escapeHtml(denialReason)}</div>`
      : '';
    const viewControl = doc.fileUrl
      ? `<a class="btn btn-sm btn-outline-secondary" href="${escapeHtml(doc.fileUrl)}" target="_blank" rel="noopener">View file</a>`
      : '<span class="text-muted small">No file</span>';

    return `
      <div class="list-group-item d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3" data-doc-key="${escapeHtml(doc.key)}">
        <div class="flex-grow-1">
          <div class="d-flex flex-wrap align-items-center gap-2">
            <span class="fw-semibold">${escapeHtml(doc.title)}</span>
            <span class="visa-doc-status ${statusMeta.listClass}" data-state="${statusMeta.key}">${iconHtml}${statusMeta.label}</span>
          </div>
          ${denialHtml}
        </div>
        <div class="d-flex flex-wrap align-items-center gap-2">
          ${viewControl}
        </div>
      </div>
    `;
  }).join('');
}

function getChecklistMirrorDocs() {
  const cl = getChecklistState();
  const includeMinor = getIsMinor();
  if (!Array.isArray(cl.items)) return [];
  return cl.items
    .filter(item => isChecklistItemVisible(item, includeMinor))
    .map((item) => ({
      key: item.key,
      title: item.title,
      status: normalizeChecklistStatus(item.status),
      fileUrl: item.fileUrl || '',
      fileName: item.fileName || '',
      review: item.review || null
    }));
}

function applySpainUiVisibility(status) {
  const normalized = normalizeSpainRequestStatus(status || 'none');
  const effective = normalized === 'pending' ? 'requested' : normalized;
  const banner = document.getElementById('spain-restrictions-banner');
  const requestBtn = document.getElementById('spain-request-btn');
  const blueLink = document.getElementById('spain-view-restrictions-link');
  const show = (el, visible) => {
    if (!el) return;
    el.classList.toggle('d-none', !visible);
    if ('hidden' in el) {
      el.hidden = !visible;
    }
    if (el.hasAttribute('aria-hidden')) {
      el.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }
  };

  const bannerVisible = effective === 'requested' || effective === 'approved';
  show(banner, bannerVisible);

  const requestVisible = effective === 'none' || effective === 'denied';
  show(requestBtn, requestVisible);
  if (requestBtn) {
    requestBtn.disabled = !requestVisible;
  }

  if (blueLink) {
    blueLink.classList.add('d-none');
    blueLink.setAttribute('aria-hidden', 'true');
  }
}

function renderVisaSubmissionSpain(resolvedState = null, myStateOverride = null) {
  const spainSection = document.getElementById('submission-spain-section');
  if (!spainSection) return;

  try {
    const submissionState = resolvedState || getVisaSubmissionState();
    const myState = myStateOverride || getMyVisaState();
    const spainRequest = myState.submission?.spainRequest || { status: 'none', reason: '' };
    const status = getSpainRequestStatus(myState);
    const approved = isSpainApproved(myState);

    const minorHint = document.getElementById('submission-spain-minor-hint');
    if (minorHint) {
      minorHint.classList.toggle('d-none', !getIsMinor());
    }

    applySpainUiVisibility(submissionState.spainRequestStatus || status);

    const content = document.getElementById('submission-spain-content');
    if (content) {
      content.classList.remove('d-none');
    }

    const requestRow = document.getElementById('spain-approval-card');
    const approvedRow = document.getElementById('submission-spain-approved-row');

    if (requestRow) {
      requestRow.classList.remove('d-none');
    }

    const euBlock = document.getElementById('spain-eu-stays-block');
    if (euBlock) {
      euBlock.hidden = !approved;
    }

    const allowEuEntries = approved;
    const euEntriesCard = document.getElementById('submission-spain-eu-entries');
    if (euEntriesCard) {
      euEntriesCard.classList.toggle('d-none', !allowEuEntries);
      euEntriesCard.setAttribute('aria-hidden', allowEuEntries ? 'false' : 'true');
    }

    const requestBtn = document.getElementById('spain-request-btn');
    const requestStatus = document.getElementById('submission-spain-request-status');
    const requestAlert = document.getElementById('submission-spain-request-alert');
    const requestReasonEl = document.getElementById('submission-spain-request-reason');
    const actionsContainer = document.getElementById('submission-spain-request-actions');
    const liveRegion = document.getElementById('submission-spain-request-live');
    const statusPill = document.getElementById('spain-request-status-pill');

    if (requestAlert) {
      requestAlert.classList.add('d-none');
      requestAlert.textContent = '';
    }
    if (requestStatus) {
      requestStatus.classList.add('d-none');
      requestStatus.textContent = '';
    }
    if (actionsContainer) {
      actionsContainer.innerHTML = '';
    }

    if (requestStatus) {
      if (status === 'pending') {
        requestStatus.textContent = 'Pending review by ETURE staff...';
        requestStatus.classList.remove('d-none');
      } else if (status === 'approved') {
        requestStatus.textContent = 'Approved by ETURE staff';
        requestStatus.classList.remove('d-none');
      } else if (status === 'denied') {
        requestStatus.textContent = 'Request denied';
        requestStatus.classList.remove('d-none');
      } else {
        requestStatus.classList.add('d-none');
        requestStatus.textContent = '';
      }
    }

    if (requestReasonEl) {
      const reasonValue = (spainRequest.requestReason
        || submissionState.spainRequestReason
        || '').toString();
      const reasonText = reasonValue ? `Reason provided: ${escapeHtml(reasonValue)}` : '';
      requestReasonEl.textContent = reasonText;
      requestReasonEl.classList.toggle('d-none', !reasonText);
    }

    if (statusPill) {
      let pillHtml = '<span class="badge bg-secondary">No request</span>';
      if (status === 'pending') {
        pillHtml = '<span class="badge bg-warning text-dark">Pending</span>';
      } else if (status === 'approved') {
        pillHtml = '<span class="badge bg-success">Approved</span>';
      } else if (status === 'denied') {
        pillHtml = '<span class="badge bg-danger">Denied</span>';
      }
      statusPill.innerHTML = pillHtml;
    }

    if (status === 'denied' && requestAlert) {
      const denialReason = spainRequest.decisionReason || 'Request denied. Please contact ETURE staff or request again.';
      requestAlert.textContent = denialReason;
      requestAlert.classList.remove('d-none');
    } else if (requestAlert) {
      requestAlert.classList.add('d-none');
      requestAlert.textContent = '';
    }

    if (actionsContainer) {
      actionsContainer.innerHTML = '';
      const allowStaffActions = (SUBMISSION_DEMO_MODE === true || isCurrentUserStaff());
      if (allowStaffActions && status === 'pending') {
        const approveBtn = document.createElement('button');
        approveBtn.id = 'submission-spain-approve-btn';
        approveBtn.type = 'button';
        approveBtn.className = 'btn btn-success btn-sm';
        approveBtn.textContent = 'Approve';
        actionsContainer.appendChild(approveBtn);

        const denyBtn = document.createElement('button');
        denyBtn.id = 'submission-spain-deny-btn';
        denyBtn.type = 'button';
        denyBtn.className = 'btn btn-danger btn-sm';
        denyBtn.textContent = 'Deny';
        actionsContainer.appendChild(denyBtn);
      }
      if (allowStaffActions && status !== 'none') {
        const resetBtn = document.createElement('button');
        resetBtn.id = 'submission-spain-reset-btn';
        resetBtn.type = 'button';
        resetBtn.className = 'btn btn-outline-secondary btn-sm';
        resetBtn.textContent = 'Reset';
        resetBtn.addEventListener('click', (event) => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          handleSpainReset();
        });
        actionsContainer.appendChild(resetBtn);
      }
    }

    if (liveRegion) {
      let announcement = '';
      if (status === 'pending') announcement = 'Spain submission request sent. Awaiting staff approval.';
      else if (status === 'approved') announcement = 'Spain submission request approved. Spain submission unlocked.';
      else if (status === 'denied') announcement = 'Spain submission request denied.';
      liveRegion.textContent = announcement;
    }

    const showApproved = approved;
    if (approvedRow) {
      approvedRow.classList.toggle('d-none', !showApproved);
    }

    const arrivalInput = document.getElementById('submission-spain-arrival-date');
    if (arrivalInput) {
      if (showApproved) {
        arrivalInput.value = myState.submission?.expectedArrival || '';
      } else {
        arrivalInput.value = '';
      }
      arrivalInput.disabled = !showApproved;
      arrivalInput.setAttribute('aria-disabled', showApproved ? 'false' : 'true');
    }

    const europeVisitRadios = document.querySelectorAll('input[name="submission-spain-eu-visit"]');
    const staysSection = document.getElementById('submission-spain-stays-section');
    const addStayBtn = document.getElementById('spain-add-stay-btn');
    const staysBody = document.getElementById('submission-spain-stays-body');

    const profileTravel = getSpainTravelEntries();
    const myTravel = sanitizeSpainTravelEntries(myState.submission?.spainTravel || []);
    const submissionTravel = Array.isArray(submissionState.spain?.stays)
      ? sanitizeSpainTravelEntries(
          submissionState.spain.stays.map((stay) => ({
            place: stay?.place || '',
            entry: stay?.entryDate || '',
            exit: stay?.exitDate || ''
          }))
        )
      : [];
    const travelEntries = myTravel.length ? myTravel : (profileTravel.length ? profileTravel : submissionTravel);
    const submissionVisit = (submissionState.spain?.europeVisit || '').toString().toLowerCase();
    const myVisit = (myState.submission?.spainEuropeVisit || '').toString().toLowerCase();
    const profileVisit = getSpainEuropeVisitFlag();
    let europeVisit = myVisit === 'yes' || myVisit === 'no'
      ? myVisit
      : submissionVisit === 'yes' || submissionVisit === 'no'
        ? submissionVisit
        : profileVisit;
    if (europeVisit !== 'yes' && europeVisit !== 'no') {
      europeVisit = travelEntries.length ? 'yes' : 'no';
    }

    europeVisitRadios.forEach((radio) => {
      if (!radio) return;
      if (!allowEuEntries) {
        radio.checked = false;
        radio.disabled = true;
        return;
      }
      radio.checked = radio.value === europeVisit;
      radio.disabled = false;
    });

    const shouldShowStays = allowEuEntries && europeVisit === 'yes';
    if (staysSection) {
      staysSection.classList.toggle('d-none', !shouldShowStays);
    }
    if (addStayBtn) {
      const canAdd = allowEuEntries;
      addStayBtn.classList.toggle('d-none', !canAdd);
      addStayBtn.disabled = !canAdd;
    }

    if (staysBody) {
      const displayRows = shouldShowStays
        ? (travelEntries.length ? travelEntries : [{ place: '', entry: '', exit: '' }])
        : [];
      staysBody.innerHTML = displayRows.map((stay, index) => {
        const placeValue = escapeHtml(stay.place || '');
        const entryValue = escapeHtml(stay.entry || '');
        const exitValue = escapeHtml(stay.exit || '');
        return `
          <tr class="submission-spain-stay-row" data-index="${index}">
            <td><input type="text" class="form-control form-control-sm" placeholder="Country / Place" value="${placeValue}" data-field="place"></td>
            <td><input type="date" class="form-control form-control-sm" id="spain-stay-entry-${index}" placeholder="dd/mm/aaaa" value="${entryValue}" data-field="entry"></td>
            <td><input type="date" class="form-control form-control-sm" id="spain-stay-exit-${index}" placeholder="dd/mm/aaaa" value="${exitValue}" data-field="exit"></td>
            <td class="text-end"><button type="button" class="btn btn-link btn-sm text-danger submission-spain-remove-stay">Remove</button></td>
          </tr>
        `;
      }).join('');
      if (!shouldShowStays) {
        staysBody.innerHTML = '';
      }
    }

    const docs = getSpainRequiredDocs();
    renderSubmissionDocList('submission-spain-doc-list', 'submission-spain-doc-empty', docs);
  } catch (error) {
    console.error('[Spain intro render]', error);
  }
}

function normalizeSpainRequestStatus(status) {
  const normalized = (status || '').toString().trim().toLowerCase();
  if (SPAIN_REQUEST_LEGACY_STATUS_MAP[normalized]) {
    return SPAIN_REQUEST_LEGACY_STATUS_MAP[normalized];
  }
  return SPAIN_REQUEST_STATUSES.includes(normalized) ? normalized : 'none';
}

function getSpainRequestStatus(stateOverride = null) {
  let rawStatus = '';

  if (stateOverride && typeof stateOverride === 'object') {
    if (typeof stateOverride.spainRequestStatus === 'string') {
      rawStatus = stateOverride.spainRequestStatus;
    } else if (stateOverride.submission?.spainRequest?.status) {
      rawStatus = stateOverride.submission.spainRequest.status;
    }
  }

  if (!rawStatus) {
    const submissionState = getVisaSubmissionState();
    rawStatus = submissionState.spainRequestStatus
      || submissionState.spain?.status
      || '';
  }

  if (!rawStatus) {
    const fallbackState = stateOverride && typeof stateOverride === 'object'
      ? stateOverride
      : getMyVisaState();
    rawStatus = fallbackState?.submission?.spainRequest?.status
      || userProfileData?.visa?.spainRequest?.status
      || '';
  }

  return normalizeSpainRequestStatus(rawStatus);
}

function isSpainApproved(stateOverride = null) {
  return getSpainRequestStatus(stateOverride) === 'approved';
}

function isSpainRequested(stateOverride = null) {
  return getSpainRequestStatus(stateOverride) === 'pending';
}

function setSpainStatus(status, reason = '') {
  updateSpainRequestStatus(status, typeof reason === 'string' ? reason : '');
}

function updateSpainRequestStatus(nextStatus, reason = '') {
  const previousStatus = getSpainRequestStatus();
  const normalized = normalizeSpainRequestStatus(nextStatus);
  const trimmed = reason.trim();
  const nextState = saveMyVisaState((state) => {
    state.submission = state.submission || { ...getDefaultMyVisaState().submission };
    const current = state.submission.spainRequest && typeof state.submission.spainRequest === 'object'
      ? { ...state.submission.spainRequest }
      : { ...getDefaultMyVisaState().submission.spainRequest };

    const nowIso = new Date().toISOString();

    current.status = normalized;
    if (normalized === 'pending') {
      current.requestReason = trimmed;
      current.decisionReason = '';
      current.requestTimestamp = nowIso;
      current.decisionTimestamp = '';
    } else if (normalized === 'denied') {
      current.decisionReason = trimmed;
      current.decisionTimestamp = nowIso;
    } else if (normalized === 'approved') {
      current.decisionReason = '';
      current.decisionTimestamp = nowIso;
    } else if (normalized === 'none') {
      current.requestReason = '';
      current.decisionReason = '';
      current.requestTimestamp = '';
      current.decisionTimestamp = '';
    }

    state.submission.spainRequest = current;
    if (normalized !== 'approved') {
      state.submission.expectedArrival = '';
    }
    return state;
  });

  ensureVisaDefaults();
  const latestRequest = nextState.submission?.spainRequest || { ...getDefaultMyVisaState().submission.spainRequest };
  userProfileData.visa.spainRequest = {
    status: latestRequest.status,
    requestReason: latestRequest.requestReason || '',
    decisionReason: latestRequest.decisionReason || ''
  };
  persistVisaSubmissionState((state) => {
    state.spainRequestStatus = normalized;
    state.spainRequestReason = normalized === 'none'
      ? ''
      : (nextState.submission?.spainRequest?.requestReason || '').toString();
    return state;
  });
  saveUserProfile();

  let effectiveState = nextState;
  if ((normalized === 'none' || normalized === 'denied') && previousStatus !== normalized) {
    clearEuEntriesState();
    effectiveState = getMyVisaState();
  }

  renderVisaSubmissionSpain(getVisaSubmissionState(), effectiveState);
  applySpainUiVisibility(normalized);
  recalcVisaProgressAndRender();
}

function handleSubmissionSpainRequestClick() {
  openSpainRequestModal('request');
}

function handleSubmissionSpainActionsClick(event) {
  const approveBtn = event.target.closest('#submission-spain-approve-btn');
  if (approveBtn) {
    setSpainStatus('approved');
    applySpainUiVisibility('approved');
    return;
  }
  const denyBtn = event.target.closest('#submission-spain-deny-btn');
  if (denyBtn) {
    const reason = window.prompt('Provide a short reason for denying this request.');
    if (reason === null) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      alert('A reason is required to deny the request.');
      return;
    }
    setSpainStatus('denied', trimmed);
    applySpainUiVisibility('denied');
  }
  const resetBtn = event.target.closest('#submission-spain-reset-btn');
  if (resetBtn) {
    handleSpainReset();
    return;
  }
}

function handleSpainReset() {
  saveMyVisaState((state) => {
    state.submission = state.submission || { ...getDefaultMyVisaState().submission };
    state.submission.spain = state.submission.spain || { ...getDefaultMyVisaState().submission.spain };
    state.submission.spain.termsAccepted = false;
    return state;
  });
  setSpainTermsAccepted(false);
  updateSpainRequestStatus('none');
  const submission = getVisaSubmissionState();
  submission.spainInfoAccepted = false;
  setVisaSubmissionState(submission);
  saveUserProfile();
  renderVisaSubmissionSpain(getVisaSubmissionState());
  applySpainUiVisibility('none');
  recalcVisaProgressAndRender();
  cleanupModalArtifacts();
}

if (typeof window !== 'undefined') {
  window.handleSpainReset = handleSpainReset;
}

function handleSubmissionSpainArrivalChange(event) {
  const value = (event.target?.value || '').toString();
  const nextState = saveMyVisaState((state) => {
    state.submission = state.submission || { ...getDefaultMyVisaState().submission };
    state.submission.expectedArrival = value;
    return state;
  });
  renderVisaSubmissionSpain(getVisaSubmissionState(), nextState);
  recalcVisaProgressAndRender();
}

function persistSpainTravelChanges(entries, europeVisit) {
  const sanitizedEntries = sanitizeSpainTravelEntries(entries);
  let visitFlag = (europeVisit || '').toString().toLowerCase();
  if (visitFlag !== 'yes' && visitFlag !== 'no') {
    visitFlag = sanitizedEntries.length ? 'yes' : 'no';
  }

  const travelToStore = visitFlag === 'yes'
    ? (sanitizedEntries.length ? sanitizedEntries : [{ place: '', entry: '', exit: '' }])
    : [];

  const storedTravel = setSpainTravelEntries(travelToStore);
  setSpainEuropeVisitFlag(visitFlag);

  const submissionState = persistVisaSubmissionState((state) => {
    state.spain = state.spain || { ...SPAIN_SUBMISSION_DEFAULTS };
    state.spain.europeVisit = visitFlag;
    state.spain.stays = visitFlag === 'yes'
      ? storedTravel.map((stay) => ({
          place: stay.place,
          entryDate: stay.entry,
          exitDate: stay.exit
        }))
      : [];
    return state;
  });

  const nextState = saveMyVisaState((state) => {
    state.submission = state.submission || { ...getDefaultMyVisaState().submission };
    state.submission.spainTravel = storedTravel;
    state.submission.spainEuropeVisit = visitFlag;
    return state;
  });

  try {
    if (auth.currentUser) {
      saveProfileToFirestore(auth.currentUser.uid, userProfileData).catch((error) => {
        console.error('Unable to persist Spain travel data', error);
      });
    }
  } catch (error) {
    console.error('Unable to persist Spain travel data', error);
  }

  renderVisaSubmissionSpain(submissionState, nextState);
  recalcVisaProgressAndRender();
}

function handleSpainEuropeVisitChange(event) {
  const selected = (event.target?.value || '').toString().toLowerCase();
  if (selected === 'no') {
    persistSpainTravelChanges([], 'no');
    return;
  }
  const current = getSpainTravelEntries();
  const next = current.length ? current : [{ place: '', entry: '', exit: '' }];
  persistSpainTravelChanges(next, 'yes');
}

function handleAddSpainStayRow() {
  const travel = getSpainTravelEntries();
  travel.push({ place: '', entry: '', exit: '' });
  persistSpainTravelChanges(travel, 'yes');
}

function handleRemoveSpainStayRow(index) {
  const travel = getSpainTravelEntries();
  if (index < 0 || index >= travel.length) return;
  travel.splice(index, 1);
  persistSpainTravelChanges(travel, 'yes');
}

function handleSpainStayFieldChange(index, field, value) {
  if (index < 0) return;
  const normalizedField = field === 'entry' ? 'entry' : field === 'exit' ? 'exit' : 'place';
  const travel = getSpainTravelEntries();
  while (travel.length <= index) {
    travel.push({ place: '', entry: '', exit: '' });
  }
  travel[index] = {
    place: normalizedField === 'place' ? value : travel[index].place,
    entry: normalizedField === 'entry' ? value : travel[index].entry,
    exit: normalizedField === 'exit' ? value : travel[index].exit
  };
  persistSpainTravelChanges(travel, 'yes');
}

function handleSpainStaysInput(event) {
  const target = event.target;
  if (!target || !target.dataset?.field) return;
  const row = target.closest('.submission-spain-stay-row');
  if (!row) return;
  const index = Number(row.dataset.index);
  if (!Number.isFinite(index)) return;
  handleSpainStayFieldChange(index, target.dataset.field, target.value || '');
}

function handleSpainStaysClick(event) {
  const removeBtn = event.target.closest('.submission-spain-remove-stay');
  if (!removeBtn) return;
  event.preventDefault();
  const row = removeBtn.closest('.submission-spain-stay-row');
  if (!row) return;
  const index = Number(row.dataset.index);
  if (!Number.isFinite(index)) return;
  handleRemoveSpainStayRow(index);
}

function buildFileMetaFromFile(file, dataUrl) {
  if (!file || !dataUrl) return null;
  return normalizeFileMeta({
    name: file.name,
    size: typeof file.size === 'number' ? file.size : null,
    type: file.type || '',
    dataUrl,
    uploadedAt: new Date().toISOString()
  });
}

function formatFileMeta(meta) {
  if (!meta) return '';
  const sizeText = formatSubmissionFileSize(meta.size || 0);
  const uploadedAt = formatDateForDisplay(meta.uploadedAt);
  const parts = [];
  if (uploadedAt) parts.push(`Uploaded ${uploadedAt}`);
  if (meta.name) parts.push(meta.name + (sizeText ? ` (${sizeText})` : ''));
  return parts.join(' — ');
}

function openFileMeta(meta) {
  if (!meta?.dataUrl) return;
  window.open(meta.dataUrl, '_blank', 'noopener');
}

function formatSubmissionFileSize(bytes) {
  if (!bytes || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function updateVisaSubmissionUI(state) {
  const pane = document.getElementById('visa-submission');
  if (!pane) return;

  const resolvedState = normalizeVisaSubmissionState(state || getVisaSubmissionState());
  const meta = resolveSubmissionStatusMeta(resolvedState.status);

  const choiceSelect = document.getElementById('submission-choice');
  let selectedPath = resolvedState.submitChoice || 'usa';
  if (getIsMinor() && selectedPath === 'spain') {
    selectedPath = 'usa';
  }
  if (choiceSelect && choiceSelect.value !== selectedPath) {
    choiceSelect.value = selectedPath;
  }
  applySubmissionChoice(selectedPath);

  const current = getMyVisaState();
  if (current.submission?.method !== selectedPath) {
    saveMyVisaState((state) => {
      state.submission = state.submission || { ...getDefaultMyVisaState().submission };
      state.submission.method = selectedPath;
      return state;
    });
  }

  updateVisaAppointmentUI();

  const stateSelect = document.getElementById('submission-us-state');
  if (stateSelect && stateSelect.value !== resolvedState.stateCode) {
    stateSelect.value = resolvedState.stateCode || '';
  }

  const caRegionField = document.getElementById('submission-ca-region-field');
  const caRegionSelect = document.getElementById('submission-ca-region');
  const isCalifornia = resolvedState.stateCode === 'CA';
  if (caRegionField) caRegionField.classList.toggle('d-none', !isCalifornia);
  if (caRegionSelect) {
    caRegionSelect.value = isCalifornia ? (resolvedState.caRegion || '') : '';
  }

  const center = resolveCenterForState(resolvedState.stateCode, resolvedState.caRegion);
  renderVisaSubmissionConsulate(resolvedState, center);
  renderVisaSubmissionSpain(resolvedState, getMyVisaState());
  renderSubmissionProgress();

  const statusChip = document.getElementById('submission-status');
  if (statusChip) {
    statusChip.textContent = meta.label;
    statusChip.className = meta.chipClass;
  }

  const dateInput = document.getElementById('visa-submission-date');
  if (dateInput) {
    dateInput.value = resolvedState.dateISO || '';
  }

  const helper = document.getElementById('submission-proof-helper');
  const alertBox = document.getElementById('submission-deny-alert');
  if (resolvedState.status === SUBMISSION_STATUS_META.denied.label && resolvedState.denyReason) {
    if (helper) helper.classList.add('d-none');
    if (alertBox) {
      alertBox.textContent = resolvedState.denyReason;
      alertBox.classList.remove('d-none');
    }
  } else {
    if (helper) helper.classList.remove('d-none');
    if (alertBox) {
      alertBox.textContent = '';
      alertBox.classList.add('d-none');
    }
  }

  const fileInput = document.getElementById('visa-submission-proof');
  const replaceBtn = document.getElementById('submission-proof-replace');
  const viewBtn = document.getElementById('submission-proof-view');
  const fileMeta = resolvedState.fileMeta;
  const hasFile = Boolean(fileMeta && fileMeta.name);

  if (fileInput) {
    fileInput.classList.toggle('visually-hidden', hasFile);
    if (!hasFile) {
      fileInput.value = '';
    }
  }

  if (replaceBtn) {
    replaceBtn.classList.toggle('d-none', !hasFile);
    replaceBtn.disabled = !hasFile;
  }

  if (viewBtn) {
    viewBtn.classList.toggle('d-none', !hasFile);
    viewBtn.disabled = !hasFile || !fileMeta?.dataUrl;
    viewBtn.dataset.fileUrl = fileMeta?.dataUrl || '';
    viewBtn.setAttribute('aria-label', hasFile ? `View ${fileMeta.name}` : 'No file uploaded');
  }

  const metaText = document.getElementById('submission-proof-meta');
  if (metaText) {
    if (hasFile) {
      const sizeText = formatSubmissionFileSize(fileMeta.size || 0);
      const uploadedAt = formatDateForDisplay(resolvedState.lastUpdateISO) || 'recently';
      metaText.textContent = `Uploaded ${uploadedAt} — ${fileMeta.name}${sizeText ? ` (${sizeText})` : ''}`;
      metaText.classList.remove('d-none');
    } else {
      metaText.textContent = '';
      metaText.classList.add('d-none');
    }
  }

  const demoActions = document.getElementById('submission-demo-actions');
  if (demoActions) {
    const shouldShow = SUBMISSION_DEMO_MODE === true;
    demoActions.classList.toggle('d-none', !shouldShow);
    const verifyBtn = document.getElementById('submission-verify-btn');
    const denyBtn = document.getElementById('submission-deny-btn');
    if (verifyBtn) {
      verifyBtn.disabled = !hasFile || meta.key === 'verified';
    }
    if (denyBtn) {
      denyBtn.disabled = !hasFile;
    }
  }

  const updated = document.getElementById('visa-submission-updated');
  if (updated) {
    const formatted = formatDateForDisplay(resolvedState.lastUpdateISO);
    updated.textContent = `Last update — ${formatted || '—'}`;
  }

  const lastAction = document.getElementById('submission-last-action');
  if (lastAction) {
    if (resolvedState.dateISO) {
      const readable = new Date(resolvedState.dateISO);
      lastAction.textContent = Number.isNaN(readable.getTime())
        ? ''
        : `Submission date: ${readable.toLocaleDateString()}`;
    } else {
      lastAction.textContent = '';
    }
  }

  renderSubmissionProgress();
}

function renderSubmissionProgress(summary = null) {
  const container = document.getElementById('submission-progress');
  const bar = document.getElementById('submission-progress-bar');
  const text = document.getElementById('submission-progress-text');
  if (!container || !bar || !text) return;

  let total = null;
  let verified = null;
  let percent = null;
  const myState = getMyVisaState();
  const submissionMethod = myState.submission?.method === 'spain' ? 'spain' : 'usa';

  let spainDocsForRender = null;
  if (submissionMethod === 'spain') {
    const spainProgress = computeSpainSubmissionProgress();
    total = spainProgress.total;
    verified = spainProgress.verified;
    percent = spainProgress.percent;
    spainDocsForRender = spainProgress.docs;
  } else {
    if (summary && typeof summary === 'object') {
      if (typeof summary.total === 'number') total = summary.total;
      if (typeof summary.verified === 'number') verified = summary.verified;
      if (typeof summary.percent === 'number') percent = summary.percent;
    }

    if (total === null || verified === null) {
      const cl = getChecklistState();
      const metrics = recalcVisaChecklistProgress(cl);
      total = metrics.total;
      verified = metrics.verified;
      percent = metrics.percent;
    } else if (percent === null && total > 0) {
      percent = Math.round((verified / total) * 100);
    }
  }

  const safeTotal = Number.isFinite(total) ? Math.max(total, 0) : 0;
  const safeVerified = Number.isFinite(verified) ? Math.max(verified, 0) : 0;
  const safePercent = Number.isFinite(percent)
    ? Math.min(100, Math.max(percent, 0))
    : (safeTotal > 0 ? Math.min(100, Math.max(Math.round((safeVerified / safeTotal) * 100), 0)) : 0);

  bar.style.width = `${safePercent}%`;
  bar.setAttribute('aria-valuenow', String(safePercent));
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');

  text.textContent = `${safeVerified}/${safeTotal} verified`;

  container.classList.toggle('placeholder-glow', safeTotal === 0);
  bar.classList.toggle('bg-success', true);

  renderSubmissionDocList('submission-usa-doc-list', 'submission-usa-doc-empty', getChecklistMirrorDocs());
  renderSubmissionDocList('submission-spain-doc-list', 'submission-spain-doc-empty', spainDocsForRender || getSpainRequiredDocs());

  applyProgressToTarget('visa-appointment-progress-bar', 'visa-appointment-progress-text', safePercent, safeVerified, safeTotal);
  applyProgressToTarget('visa-approval-progress-bar', 'visa-approval-progress-text', safePercent, safeVerified, safeTotal);
  applyProgressToTarget('visa-tie-progress-bar', 'visa-tie-progress-text', safePercent, safeVerified, safeTotal);
}

function applyProgressToTarget(barId, textId, percent, verified, total) {
  const bar = document.getElementById(barId);
  const text = document.getElementById(textId);
  if (bar) {
    bar.style.width = `${percent}%`;
    bar.setAttribute('aria-valuenow', String(percent));
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
  }
  if (text) {
    text.textContent = `${verified}/${total} verified`;
  }
}

function clearEuEntriesState() {
  ensureVisaDefaults();
  userProfileData.visa.spainTravel = [];
  userProfileData.visa.spainEuropeVisit = '';

  persistVisaSubmissionState((state) => {
    state.spain = state.spain || { ...SPAIN_SUBMISSION_DEFAULTS };
    state.spain.europeVisit = '';
    state.spain.stays = [];
    return state;
  });

  saveMyVisaState((state) => {
    state.submission = state.submission || { ...getDefaultMyVisaState().submission };
    state.submission.spainTravel = [];
    state.submission.spainEuropeVisit = '';
    return state;
  });

  if (typeof document !== 'undefined') {
    const radios = document.querySelectorAll('input[name="submission-spain-eu-visit"]');
    radios.forEach((radio) => {
      radio.checked = false;
    });
    const staysBody = document.getElementById('submission-spain-stays-body');
    if (staysBody) {
      staysBody.innerHTML = '';
    }
  }

  saveUserProfile();
}

function updateVisaAppointmentUI() {
  const myState = getMyVisaState();
  const submissionState = getVisaSubmissionState();
  const appointment = myState.appointment || {};
  const isSpain = (myState.submission?.method || 'usa') === 'spain';

  const banner = document.getElementById('visa-appointment-warning');
  const helper = document.getElementById('visa-appointment-helper');
  const dateInput = document.getElementById('visa-appointment-dt');
  const readCheck = document.getElementById('visa-appointment-read');
  const saveBtn = document.getElementById('visa-appointment-save-btn');
  const fileMetaEl = document.getElementById('visa-appointment-file-meta');
  const viewBtn = document.getElementById('visa-appointment-view');
  const proofInput = document.getElementById('visa-appointment-proof');
  const centerCard = document.getElementById('visa-appointment-center-card');
  const centerCityEl = document.getElementById('visa-appointment-center-city');
  const centerAddressEl = document.getElementById('visa-appointment-center-address');
  const centerPhoneEl = document.getElementById('visa-appointment-center-phone');
  const centerEmailEl = document.getElementById('visa-appointment-center-email');
  const centerContactEl = document.getElementById('visa-appointment-center-contact');
  const centerWebsiteLink = document.getElementById('visa-appointment-center-website');
  const centerMapsLink = document.getElementById('visa-appointment-center-maps');
  if (banner) {
    const content = `<div class="fw-semibold">Last-minute path (Spain)</div><div>If your application will be submitted in Spain, ETURE staff will manage your appointment. Certificates of submission and resolution will appear in My Documents. You don’t need to book a BLS appointment.</div>`;
    banner.innerHTML = content;
    banner.classList.toggle('d-none', !isSpain);
  }
  if (helper) {
    helper.classList.toggle('d-none', !isSpain);
  }

  const centerInfo = resolveCenterForState(submissionState.stateCode, submissionState.caRegion);
  let centerLabel = centerInfo?.details?.city || centerInfo?.details?.name || centerInfo?.city || '';
  const centerDetails = centerInfo?.details || null;
  const addressLines = Array.isArray(centerDetails?.addressLines) ? centerDetails.addressLines : [];
  const phone = (centerDetails?.phone || '').trim();
  const email = (centerDetails?.email || '').trim();
  const site = (centerDetails?.site || centerInfo?.url || '').trim();
  const mapsQuery = (centerDetails?.mapsQuery || centerLabel || '').trim();
  let cardMessage = '';

  if (!centerLabel && appointment.center) {
    centerLabel = appointment.center;
  }

  if (!submissionState.stateCode) {
    centerLabel = 'Center not assigned';
    cardMessage = 'Select your state in the Submission tab to view your BLS center.';
  } else if (centerInfo?.requiresRegion) {
    centerLabel = 'California region needed';
    cardMessage = 'Choose Northern or Southern California in the Submission tab to continue.';
  } else if (centerInfo?.missing) {
    centerLabel = 'Center not available';
    cardMessage = 'ETURE will confirm your BLS center soon.';
  }

  if (dateInput) {
    dateInput.value = appointment.datetime || '';
    dateInput.disabled = isSpain;
    dateInput.setAttribute('aria-disabled', isSpain ? 'true' : 'false');
  }

  if (centerCard) {
    centerCard.classList.toggle('opacity-50', isSpain);
    centerCard.setAttribute('aria-disabled', isSpain ? 'true' : 'false');
  }
  if (centerCityEl) {
    centerCityEl.textContent = centerLabel || 'Center not assigned';
  }
  if (centerAddressEl) {
    if (addressLines.length) {
      centerAddressEl.innerHTML = addressLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
    } else if (cardMessage) {
      centerAddressEl.innerHTML = `<div>${escapeHtml(cardMessage)}</div>`;
    } else {
      centerAddressEl.innerHTML = '<div>Details pending. ETURE will confirm soon.</div>';
    }
  }
  if (centerContactEl) {
    centerContactEl.classList.toggle('d-none', !phone && !email);
  }
  if (centerPhoneEl) {
    if (phone) {
      const telHref = phone.replace(/[^0-9+]/g, '');
      centerPhoneEl.innerHTML = `<span class="fw-semibold">Phone:</span> <a href="tel:${escapeHtml(telHref)}">${escapeHtml(phone)}</a>`;
      centerPhoneEl.classList.remove('d-none');
    } else {
      centerPhoneEl.textContent = '';
      centerPhoneEl.classList.add('d-none');
    }
  }
  if (centerEmailEl) {
    if (email) {
      const emailHref = encodeURIComponent(email);
      centerEmailEl.innerHTML = `<span class="fw-semibold">Email:</span> <a href="mailto:${emailHref}">${escapeHtml(email)}</a>`;
      centerEmailEl.classList.remove('d-none');
    } else {
      centerEmailEl.textContent = '';
      centerEmailEl.classList.add('d-none');
    }
  }
  if (centerWebsiteLink) {
    if (site) {
      centerWebsiteLink.href = site;
      centerWebsiteLink.classList.remove('d-none');
    } else {
      centerWebsiteLink.href = '#';
      centerWebsiteLink.classList.add('d-none');
    }
  }
  if (centerMapsLink) {
    const query = mapsQuery || addressLines.join(', ');
    if (query) {
      centerMapsLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
      centerMapsLink.classList.remove('d-none');
    } else {
      centerMapsLink.href = '#';
      centerMapsLink.classList.add('d-none');
    }
  }

  if (readCheck) {
    readCheck.checked = appointment.readAcknowledged === true;
    readCheck.disabled = isSpain;
    readCheck.setAttribute('aria-disabled', isSpain ? 'true' : 'false');
  }
  if (saveBtn) {
    const acknowledged = appointment.readAcknowledged === true;
    const canSave = isSpain ? true : acknowledged;
    saveBtn.disabled = !canSave;
    saveBtn.setAttribute('aria-disabled', canSave ? 'false' : 'true');
  }

  const proofFile = appointment.proofFile && normalizeFileMeta(appointment.proofFile);
  if (proofInput) {
    proofInput.disabled = isSpain;
    proofInput.classList.toggle('d-none', isSpain && !proofFile);
    proofInput.setAttribute('aria-disabled', isSpain ? 'true' : 'false');
  }
  if (fileMetaEl) {
    const metaText = formatFileMeta(proofFile);
    if (metaText) {
      fileMetaEl.textContent = metaText;
      fileMetaEl.classList.remove('d-none');
    } else {
      fileMetaEl.textContent = '';
      fileMetaEl.classList.add('d-none');
    }
  }
  if (viewBtn) {
    const hasFile = Boolean(proofFile?.dataUrl);
    viewBtn.classList.toggle('d-none', !hasFile);
    viewBtn.disabled = !hasFile;
    viewBtn.dataset.fileUrl = hasFile ? proofFile.dataUrl : '';
  }
}

async function handleVisaAppointmentFileChange(event) {
  const input = event.target;
  if (!input?.files || !input.files.length) return;
  const file = input.files[0];
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const nextState = saveMyVisaState((state) => {
      state.appointment = state.appointment || {};
      state.appointment.proofFile = buildFileMetaFromFile(file, dataUrl);
      return state;
    });
    syncAppointmentProfile(nextState);
    updateVisaAppointmentUI();
  } catch (error) {
    console.error('Unable to read appointment proof', error);
  } finally {
    input.value = '';
  }
}

function handleVisaAppointmentView() {
  const state = getMyVisaState();
  if (state.appointment?.proofFile) {
    openFileMeta(state.appointment.proofFile);
  }
}

function syncAppointmentProfile(state = null) {
  ensureVisaDefaults();
  const nextState = state || getMyVisaState();
  const appointment = nextState.appointment || {};
  userProfileData.visa.appointment = {
    datetime: appointment.datetime || '',
    center: appointment.center || '',
    readAcknowledged: appointment.readAcknowledged === true,
    proofFile: appointment.proofFile ? { ...appointment.proofFile } : null
  };
}

function handleVisaAppointmentReadToggle(event) {
  const checked = event?.target?.checked === true;
  const nextState = saveMyVisaState((state) => {
    state.appointment = state.appointment || {};
    state.appointment.readAcknowledged = checked;
    return state;
  });
  syncAppointmentProfile(nextState);
  updateVisaAppointmentUI();
}

function handleVisaAppointmentSave() {
  const myState = getMyVisaState();
  if ((myState.submission?.method || 'usa') === 'spain') {
    return;
  }
  const dateInput = document.getElementById('visa-appointment-dt');
  const readCheck = document.getElementById('visa-appointment-read');
  if (readCheck && !readCheck.checked) {
    alert('Please confirm that you have read the appointment preparation checklist before saving.');
    return;
  }
  const submissionState = getVisaSubmissionState();
  const centerInfo = resolveCenterForState(submissionState.stateCode, submissionState.caRegion);
  const centerLabel = centerInfo?.details?.city || centerInfo?.details?.name || centerInfo?.city || '';
  const nextState = saveMyVisaState((state) => {
    state.appointment = state.appointment || {};
    state.appointment.datetime = dateInput?.value || '';
    state.appointment.center = centerLabel;
    state.appointment.readAcknowledged = readCheck?.checked === true;
    return state;
  });
  syncAppointmentProfile(nextState);
  renderVisaOverview();
  updateVisaAppointmentUI();
}

function updateVisaApprovalUI() {
  const myState = getMyVisaState();
  const approval = myState.visaApproval || {};

  const dateInput = document.getElementById('visa-approval-date');
  const fileMetaEl = document.getElementById('visa-approval-file-meta');
  const viewBtn = document.getElementById('visa-approval-view');

  if (dateInput) {
    dateInput.value = approval.date || '';
  }

  const fileMeta = approval.file && normalizeFileMeta(approval.file);
  if (fileMetaEl) {
    const metaText = formatFileMeta(fileMeta);
    if (metaText) {
      fileMetaEl.textContent = metaText;
      fileMetaEl.classList.remove('d-none');
    } else {
      fileMetaEl.textContent = '';
      fileMetaEl.classList.add('d-none');
    }
  }
  if (viewBtn) {
    const hasFile = Boolean(fileMeta?.dataUrl);
    viewBtn.classList.toggle('d-none', !hasFile);
    viewBtn.disabled = !hasFile;
    viewBtn.dataset.fileUrl = hasFile ? fileMeta.dataUrl : '';
  }
  updateVisaTieIndicator();
}

async function handleVisaApprovalFileChange(event) {
  const input = event.target;
  if (!input?.files || !input.files.length) return;
  const file = input.files[0];
  try {
    const dataUrl = await readFileAsDataUrl(file);
    saveMyVisaState((state) => {
      state.visaApproval = state.visaApproval || {};
      state.visaApproval.file = buildFileMetaFromFile(file, dataUrl);
      return state;
    });
    updateVisaApprovalUI();
    renderVisaOverview();
    updateVisaTieIndicator();
  } catch (error) {
    console.error('Unable to read visa approval file', error);
  } finally {
    input.value = '';
  }
}

function handleVisaApprovalSave() {
  const dateInput = document.getElementById('visa-approval-date');
  saveMyVisaState((state) => {
    state.visaApproval = state.visaApproval || {};
    state.visaApproval.date = dateInput?.value || '';
    return state;
  });
  renderVisaOverview();
  updateVisaTieIndicator();
  updateVisaApprovalUI();
}

function handleVisaApprovalView() {
  const state = getMyVisaState();
  if (state.visaApproval?.file) {
    openFileMeta(state.visaApproval.file);
  }
}

function updateVisaTieIndicator() {
  const indicator = document.getElementById('visa-tie-visa-indicator');
  if (!indicator) return;
  const myState = getMyVisaState();
  const hasVisaFile = Boolean(normalizeFileMeta(myState.visaApproval?.file)?.dataUrl);
  indicator.classList.toggle('d-none', !hasVisaFile);
}

function updateVisaTieUI() {
  const myState = getMyVisaState();
  const tieState = myState.tie || {};
  const readOnly = window.STAFF_READ_ONLY_TIE === true;

  const dateInput = document.getElementById('tie-appointment-date');
  const officeInput = document.getElementById('tie-office');
  const fileInput = document.getElementById('tie-proof');
  const fileMetaEl = document.getElementById('tie-proof-meta');
  const viewBtn = document.getElementById('tie-proof-view');
  const saveBtn = document.getElementById('visa-tie-save-btn');

  if (dateInput) {
    dateInput.value = tieState.appointmentDate || '';
    dateInput.disabled = readOnly;
    dateInput.setAttribute('aria-disabled', readOnly ? 'true' : 'false');
  }
  if (officeInput) {
    officeInput.value = tieState.policeOffice || '';
    officeInput.disabled = readOnly;
    officeInput.setAttribute('aria-disabled', readOnly ? 'true' : 'false');
  }
  if (fileInput) {
    fileInput.classList.toggle('d-none', readOnly);
    fileInput.disabled = readOnly;
    if (readOnly) {
      fileInput.value = '';
    }
  }

  const proofFile = tieState.proofFile && normalizeFileMeta(tieState.proofFile);
  if (fileMetaEl) {
    const metaText = formatFileMeta(proofFile);
    if (metaText) {
      fileMetaEl.textContent = metaText;
      fileMetaEl.classList.remove('d-none');
    } else {
      fileMetaEl.textContent = '';
      fileMetaEl.classList.add('d-none');
    }
  }
  if (viewBtn) {
    const hasFile = Boolean(proofFile?.dataUrl);
    viewBtn.classList.toggle('d-none', !hasFile);
    viewBtn.disabled = !hasFile;
    viewBtn.dataset.fileUrl = hasFile ? proofFile.dataUrl : '';
  }

  if (saveBtn) {
    if (readOnly) {
      saveBtn.textContent = 'Managed by ETURE staff';
      saveBtn.disabled = true;
      saveBtn.classList.remove('btn-eture-red');
      saveBtn.classList.add('btn-outline-secondary');
    } else {
      saveBtn.textContent = 'Save TIE';
      saveBtn.disabled = false;
      saveBtn.classList.add('btn-eture-red');
      saveBtn.classList.remove('btn-outline-secondary');
    }
  }

  updateVisaTieIndicator();
}

async function handleTieFileChange(event) {
  if (window.STAFF_READ_ONLY_TIE === true) {
    event.target.value = '';
    return;
  }
  const input = event.target;
  if (!input?.files || !input.files.length) return;
  const file = input.files[0];
  try {
    const dataUrl = await readFileAsDataUrl(file);
    saveMyVisaState((state) => {
      state.tie = state.tie || {};
      state.tie.proofFile = buildFileMetaFromFile(file, dataUrl);
      return state;
    });
    updateVisaTieUI();
    renderVisaOverview();
  } catch (error) {
    console.error('Unable to read TIE proof', error);
  } finally {
    input.value = '';
  }
}

function handleTieViewClick() {
  const state = getMyVisaState();
  if (state.tie?.proofFile) {
    openFileMeta(state.tie.proofFile);
  }
}

function handleTieSaveClick() {
  if (window.STAFF_READ_ONLY_TIE === true) return;
  const dateInput = document.getElementById('tie-appointment-date');
  const officeInput = document.getElementById('tie-office');
  saveMyVisaState((state) => {
    state.tie = state.tie || {};
    state.tie.appointmentDate = dateInput?.value || '';
    state.tie.policeOffice = officeInput?.value || '';
    return state;
  });
  renderVisaOverview();
  updateVisaTieUI();
}

function initVisaAppointmentUI() {
  const pane = document.getElementById('visa-appointment');
  if (!pane || pane.dataset.initAppointment === '1') {
    updateVisaAppointmentUI();
    return;
  }

  pane.dataset.initAppointment = '1';

  document.getElementById('visa-appointment-proof')?.addEventListener('change', handleVisaAppointmentFileChange);
  document.getElementById('visa-appointment-view')?.addEventListener('click', handleVisaAppointmentView);
  document.getElementById('visa-appointment-read')?.addEventListener('change', handleVisaAppointmentReadToggle);
  document.getElementById('visa-appointment-save-btn')?.addEventListener('click', handleVisaAppointmentSave);

  updateVisaAppointmentUI();
  syncAppointmentProfile();
}

function initVisaApprovalUI() {
  const pane = document.getElementById('visa-approval');
  if (!pane || pane.dataset.initApproval === '1') {
    updateVisaApprovalUI();
    return;
  }

  pane.dataset.initApproval = '1';

  document.getElementById('visa-approval-scan')?.addEventListener('change', handleVisaApprovalFileChange);
  document.getElementById('visa-approval-view')?.addEventListener('click', handleVisaApprovalView);
  document.getElementById('visa-approval-save-btn')?.addEventListener('click', handleVisaApprovalSave);

  updateVisaApprovalUI();
}

function initVisaTieUI() {
  const pane = document.getElementById('visa-tie');
  if (!pane || pane.dataset.initTie === '1') {
    updateVisaTieUI();
    return;
  }

  pane.dataset.initTie = '1';

  document.getElementById('tie-proof')?.addEventListener('change', handleTieFileChange);
  document.getElementById('tie-proof-view')?.addEventListener('click', handleTieViewClick);
  document.getElementById('visa-tie-save-btn')?.addEventListener('click', handleTieSaveClick);

  updateVisaTieUI();
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

let submissionDenyModal = null;

function initVisaSubmissionUI() {
  const pane = document.getElementById('visa-submission');
  if (!pane || pane.dataset.initSubmission === '1') {
    updateVisaSubmissionUI(getVisaSubmissionState());
    return;
  }

  pane.dataset.initSubmission = '1';

  const stateSelect = document.getElementById('submission-us-state');
  const caRegionSelect = document.getElementById('submission-ca-region');
  const dateInput = document.getElementById('visa-submission-date');
  const fileInput = document.getElementById('visa-submission-proof');
  const replaceBtn = document.getElementById('submission-proof-replace');
  const viewBtn = document.getElementById('submission-proof-view');
  const verifyBtn = document.getElementById('submission-verify-btn');
  const denyBtn = document.getElementById('submission-deny-btn');
  const modalEl = document.getElementById('submission-deny-modal');
  const modalConfirm = document.getElementById('submission-deny-confirm');
  const choiceSelect = document.getElementById('submission-choice');
  const requestBtn = document.getElementById('spain-request-btn');
  const requestActions = document.getElementById('submission-spain-request-actions');
  const arrivalInput = document.getElementById('submission-spain-arrival-date');
  const requestModalEl = document.getElementById('spain-request-modal');
  const termsReasonInput = document.getElementById('spain-request-reason');
  const termsAckCheckbox = document.getElementById('spain-terms-check');
  const requestSubmitBtn = document.getElementById('spain-request-submit');
  const requestCancelBtn = document.getElementById('spain-request-cancel');
  const requestCloseBtn = document.getElementById('spain-request-close');
  const viewMoreBtn = document.getElementById('spain-restrictions-viewmore');

  stateSelect?.addEventListener('change', handleSubmissionStateChange);
  caRegionSelect?.addEventListener('change', handleSubmissionCaRegionChange);
  dateInput?.addEventListener('change', handleSubmissionDateChange);
  fileInput?.addEventListener('change', handleSubmissionProofChange);
  replaceBtn?.addEventListener('click', () => fileInput?.click());
  viewBtn?.addEventListener('click', handleSubmissionProofViewClick);
  verifyBtn?.addEventListener('click', handleSubmissionVerify);
  denyBtn?.addEventListener('click', openSubmissionDenyModal);
  choiceSelect?.addEventListener('change', handleSubmissionChoiceChange);
  requestBtn?.addEventListener('click', handleSubmissionSpainRequestClick);
  requestActions?.addEventListener('click', handleSubmissionSpainActionsClick);
  arrivalInput?.addEventListener('change', handleSubmissionSpainArrivalChange);

  if (modalEl && modalConfirm) {
    modalConfirm.addEventListener('click', handleSubmissionDenyConfirm);
    modalEl.addEventListener('shown.bs.modal', () => {
      const reasonField = document.getElementById('submission-deny-reason');
      if (reasonField) {
        const state = getVisaSubmissionState();
        reasonField.value = state.denyReason || '';
        reasonField.classList.remove('is-invalid');
        setTimeout(() => reasonField.focus(), 150);
      }
    });
    submissionDenyModal = bootstrap.Modal.getOrCreateInstance(modalEl);
  }

  if (requestModalEl && !requestModalEl.dataset.bound) {
    requestModalEl.dataset.bound = '1';
    const removeAriaHidden = () => requestModalEl.removeAttribute('aria-hidden');
    requestModalEl.addEventListener('hidden.bs.modal', () => {
      spainRequestModal = null;
      removeAriaHidden();
      cleanupModalArtifacts();
    });
    requestModalEl.addEventListener('shown.bs.modal', removeAriaHidden);
  }

  if (requestSubmitBtn && requestSubmitBtn.dataset.bound !== '1') {
    requestSubmitBtn.dataset.bound = '1';
    requestSubmitBtn.addEventListener('click', handleSubmissionSpainRequestConfirm);
  }

  if (requestCancelBtn && requestCancelBtn.dataset.bound !== '1') {
    requestCancelBtn.dataset.bound = '1';
    requestCancelBtn.addEventListener('click', handleSpainRequestCancel);
  }

  if (requestCloseBtn && requestCloseBtn.dataset.bound !== '1') {
    requestCloseBtn.dataset.bound = '1';
    requestCloseBtn.addEventListener('click', handleSpainRequestClose);
  }

  if (termsReasonInput && termsReasonInput.dataset.bound !== '1') {
    termsReasonInput.dataset.bound = '1';
    termsReasonInput.addEventListener('input', validateSpainRequestModal);
  }

  if (termsAckCheckbox && termsAckCheckbox.dataset.bound !== '1') {
    termsAckCheckbox.dataset.bound = '1';
    termsAckCheckbox.addEventListener('change', validateSpainRequestModal);
  }

  if (viewMoreBtn && viewMoreBtn.dataset.bound !== '1') {
    viewMoreBtn.dataset.bound = '1';
    viewMoreBtn.addEventListener('click', (event) => {
      event?.preventDefault?.();
      openSpainRequestModal('view');
    });
  }

  const euVisitRadios = document.querySelectorAll('input[name="submission-spain-eu-visit"]');
  euVisitRadios.forEach((radio) => {
    if (!radio || radio.dataset.bound === '1') return;
    radio.dataset.bound = '1';
    radio.addEventListener('change', handleSpainEuropeVisitChange);
  });

  const addStayBtn = document.getElementById('spain-add-stay-btn');
  if (addStayBtn && addStayBtn.dataset.bound !== '1') {
    addStayBtn.dataset.bound = '1';
    addStayBtn.addEventListener('click', handleAddSpainStayRow);
  }

  const staysBody = document.getElementById('submission-spain-stays-body');
  if (staysBody && staysBody.dataset.bound !== '1') {
    staysBody.dataset.bound = '1';
    staysBody.addEventListener('click', handleSpainStaysClick);
    staysBody.addEventListener('input', handleSpainStaysInput);
    staysBody.addEventListener('change', handleSpainStaysInput);
  }

  updateVisaSubmissionUI(getVisaSubmissionState());
  renderSubmissionProgress();
}

function handleSubmissionStateChange(event) {
  const stateCode = (event.target?.value || '').toString().trim().toUpperCase();
  persistVisaSubmissionState((state) => {
    state.stateCode = stateCode;
    if (stateCode !== 'CA') {
      state.caRegion = '';
    }
    return state;
  });
  if (stateCode) scrollSubmissionCenterIntoView();
}

function handleSubmissionCaRegionChange(event) {
  const region = (event.target?.value || '').toString().trim().toLowerCase();
  persistVisaSubmissionState((state) => {
    state.caRegion = region;
    return state;
  });
  if (region) scrollSubmissionCenterIntoView();
}

function scrollSubmissionCenterIntoView() {
  const container = document.getElementById('submission-consulate-card');
  if (!container) return;
  try {
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (_) {
    container.scrollIntoView();
  }
}

function handleSubmissionDateChange(event) {
  const dateValue = event.target?.value || '';
  persistVisaSubmissionState((state) => {
    state.dateISO = dateValue;
    if (dateValue) {
      state.status = SUBMISSION_STATUS_META.submitted.label;
      state.denyReason = '';
    }
    return state;
  });
}

async function handleSubmissionProofChange(event) {
  const input = event.target;
  if (!input?.files || !input.files.length) return;

  const file = input.files[0];
  try {
    const dataUrl = await readFileAsDataUrl(file);
    persistVisaSubmissionState((state) => {
      state.fileMeta = {
        name: file.name,
        size: typeof file.size === 'number' ? file.size : null,
        type: file.type || '',
        dataUrl
      };
      state.status = SUBMISSION_STATUS_META.submitted.label;
      state.denyReason = '';
      return state;
    });
  } catch (error) {
    console.error('Unable to read submission proof', error);
  } finally {
    input.value = '';
  }
}

function handleSubmissionProofViewClick(event) {
  const button = event.currentTarget;
  const url = button?.dataset?.fileUrl;
  if (url) {
    window.open(url, '_blank', 'noopener');
  }
}

function handleSubmissionVerify() {
  persistVisaSubmissionState((state) => {
    state.status = SUBMISSION_STATUS_META.verified.label;
    state.denyReason = '';
    return state;
  });
}

function openSubmissionDenyModal() {
  if (submissionDenyModal) {
    submissionDenyModal.show();
  }
}

function handleSubmissionDenyConfirm() {
  const reasonField = document.getElementById('submission-deny-reason');
  if (!reasonField) return;

  const reason = reasonField.value.trim();
  if (reason.length < 5) {
    reasonField.classList.add('is-invalid');
    reasonField.focus();
    return;
  }

  persistVisaSubmissionState((state) => {
    state.status = SUBMISSION_STATUS_META.denied.label;
    state.denyReason = reason;
    return state;
  });

  reasonField.classList.remove('is-invalid');
  submissionDenyModal?.hide();
}

function renderSubmissionSpainMirror() {
  renderVisaSubmissionSpain(getVisaSubmissionState(), getMyVisaState());
}

function applySubmissionChoice(choice) {
  const normalized = choice === 'spain' ? 'spain' : 'usa';
  const isMinor = getIsMinor();
  const select = document.getElementById('submission-choice');
  if (select) {
    const spainOption = select.querySelector('option[value="spain"]');
    if (spainOption) {
      spainOption.disabled = isMinor;
      if (isMinor) {
        spainOption.setAttribute('title', 'Minors must submit their visa application in the USA.');
        spainOption.setAttribute('aria-disabled', 'true');
      } else {
        spainOption.setAttribute('title', 'Spain (last-minute)');
        spainOption.setAttribute('aria-disabled', 'false');
      }
    }
  }
  const effectiveChoice = normalized === 'spain' && isMinor ? 'usa' : normalized;
  if (select && select.value !== effectiveChoice) {
    select.value = effectiveChoice;
  }
  const usaSection = document.getElementById('submission-usa-section');
  const spainSection = document.getElementById('submission-spain-section');
  if (usaSection) usaSection.classList.toggle('d-none', effectiveChoice !== 'usa');
  if (spainSection) spainSection.classList.toggle('d-none', effectiveChoice !== 'spain');
  const disableAppointments = effectiveChoice === 'spain';
  setTabDisabled('visa-appointment-tab', disableAppointments);
  setTabDisabled('visa-approval-tab', disableAppointments);
  const liveRegion = document.getElementById('submission-choice-live');
  if (liveRegion) {
    if (liveRegion.dataset.choiceValue !== effectiveChoice) {
      liveRegion.textContent = effectiveChoice === 'spain'
        ? 'Spain (last-minute) submission selected.'
        : 'USA submission selected.';
      liveRegion.dataset.choiceValue = effectiveChoice;
    }
  }
}

function getChecklistDomIdForKey(key) {
  if (!key) return '';
  const normalizedKey = normalizeChecklistKeyInput(key);
  const mapped = CHECKLIST_DOM_ID_MAP[normalizedKey];
  if (mapped) return `chk-${mapped}`;
  const fallback = normalizedKey.toString().toUpperCase().replace(/[^A-Z0-9_-]/g, '-');
  return fallback ? `chk-${fallback}` : '';
}

function setTabDisabled(tabButtonId, disabled) {
  const button = document.getElementById(tabButtonId);
  if (!button) return;
  const prevent = TAB_DISABLE_HANDLERS.get(tabButtonId);
  if (disabled) {
    if (!prevent) {
      const handler = (event) => event.preventDefault();
      button.addEventListener('click', handler, true);
      TAB_DISABLE_HANDLERS.set(tabButtonId, handler);
    }
    button.classList.add('disabled', 'pe-none', 'text-muted');
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('tabindex', '-1');
  } else {
    if (prevent) {
      button.removeEventListener('click', prevent, true);
      TAB_DISABLE_HANDLERS.delete(tabButtonId);
    }
    button.classList.remove('disabled', 'pe-none', 'text-muted');
    button.setAttribute('aria-disabled', 'false');
    button.removeAttribute('tabindex');
  }

  const targetSelector = button.getAttribute('data-bs-target');
  if (targetSelector) {
    const pane = document.querySelector(targetSelector);
    if (pane) {
      if (disabled) {
        pane.setAttribute('aria-disabled', 'true');
      } else {
        pane.removeAttribute('aria-disabled');
      }
    }
  }
}

function handleSubmissionChoiceChange(event) {
  const rawValue = (event.target?.value || '').toString().toLowerCase();
  const desired = rawValue === 'spain' ? 'spain' : 'usa';
  const isMinor = getIsMinor();
  const next = isMinor && desired === 'spain' ? 'usa' : desired;

  if (desired === 'spain' && isMinor) {
    alert('Minors must submit their visa application in the USA.');
  }

  persistVisaSubmissionState((state) => {
    state.submitChoice = next;
    return state;
  });

  saveMyVisaState((state) => {
    state.submission = state.submission || { ...getDefaultMyVisaState().submission };
    state.submission.method = next;
    if (next !== 'spain') {
      state.submission.spain = state.submission.spain || { ...getDefaultMyVisaState().submission.spain };
      state.submission.spain.termsAccepted = false;
    }
    return state;
  });

  if (next !== 'spain') {
    setSpainInfoAccepted(false);
    setSpainTermsAccepted(false);
  }

  if (event.target && event.target.value !== next) {
    event.target.value = next;
  }

  applySubmissionChoice(next);
  renderVisaSubmissionSpain(getVisaSubmissionState(), getMyVisaState());
  updateVisaAppointmentUI();
  recalcVisaProgressAndRender();
}

function handleChecklistMinorToggle(event) {
  const next = Boolean(event.target?.checked);
  setIsMinor(next);

  const cl = getChecklistState();
  MINOR_CHECKLIST_KEYS.forEach((key) => showChecklistRow(key, next));

  renderVisaChecklistList(cl);
  const visibleItems = getVisibleChecklistItems();
  if (!visibleItems.some(item => item.key === currentVisaChecklistKey)) {
    currentVisaChecklistKey = visibleItems[0]?.key || null;
  }
  renderVisaChecklistDetail(currentVisaChecklistKey);
  recalcVisaProgressAndRender();
}

function goToChecklistAndFocus(docKey) {
  const normalizedKey = normalizeChecklistKeyInput(docKey);
  const domId = getChecklistDomIdForKey(normalizedKey);
  if (!domId) return;
  switchToChecklistAndFocus(domId);
}

function switchToChecklistAndFocus(domId) {
  if (!domId) return;
  const tabs = document.getElementById('visa-tabs');
  const checklistBtn = tabs?.querySelector('[data-bs-target="#visa-checklist"]');
  if (checklistBtn) {
    bootstrap.Tab.getOrCreateInstance(checklistBtn).show();
  }

  const attemptHighlight = (attempt = 0) => {
    const row = document.getElementById(domId);
    if (!row) {
      if (attempt < 10) {
        window.setTimeout(() => attemptHighlight(attempt + 1), 120);
      }
      return;
    }
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('bg-warning-subtle', 'border-warning');
    window.setTimeout(() => {
      row.classList.remove('bg-warning-subtle', 'border-warning');
    }, 1500);
  };

  window.setTimeout(() => attemptHighlight(), 200);
}
if (typeof window !== 'undefined') {
  window.DEMO_MODE = DEMO_MODE;
  window.APP = window.APP || {};
  if (typeof window.APP.demoMode === 'undefined') {
    window.APP.demoMode = DEMO_MODE;
  }
  if (typeof window.STAFF_READ_ONLY_TIE === 'undefined') {
    window.STAFF_READ_ONLY_TIE = false;
  } else {
    window.STAFF_READ_ONLY_TIE = window.STAFF_READ_ONLY_TIE === true;
  }
}

// === Follow-up de tareas completadas ya volcadas al timeline ===
const processedDoneTaskIds = new Set();

function isTaskDone(status) {
  const s = (status || '').toString().toLowerCase();
  return s === 'completado' || s === 'completed' || s === 'done' || s === 'hecho';
}

function translateTaskStatus(status) {
  const s = (status || '').toString().toLowerCase();
  switch (s) {
    case 'en progreso':
    case 'in progress':
      return 'In Progress';
    case 'completado':
    case 'completed':
    case 'done':
    case 'hecho':
      return 'Completed';
    case 'pendiente':
    case 'pending':
    default:
      return 'Pending';
  }
}

function getTaskStatusColor(status) {
  const s = (status || '').toString().toLowerCase();
  if (s === 'completado' || s === 'completed' || s === 'done' || s === 'hecho') {
    return 'success';
  }
  if (s === 'en progreso' || s === 'in progress') {
    return 'warning';
  }
  return 'secondary';
}

function inferActionType(task) {
  const inTitle = (task.title || '').toLowerCase();
  if ((task.meta && task.meta.actionType)) return task.meta.actionType; // si lo guardamos al crear
  if (inTitle.includes('llamada')) return 'Llamada';
  if (inTitle.includes('email') || inTitle.includes('correo')) return 'Email';
  if (inTitle.includes('reunión') || inTitle.includes('meeting')) return 'Meeting';
  if (inTitle.includes('mensaje') || inTitle.includes('dm')) return 'Message';
  return 'Action';
}

// --- HELPERS ---
function toISODate(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const str = typeof value === 'string' ? value.trim() : '';
  if (!str) return '';
  if (str.includes('/')) {
    const compact = str.replace(/\s/g, '');
    const parts = compact.split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`;
    }
  }
  return str.slice(0, 10);
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
  inicio: 'views/us/inicio.html',
  perfil: 'views/us/perfil.html',
  proceso: 'views/us/proceso.html',
  tareas: 'views/us/tareas.html',
  documentos: 'views/us/documentos.html',
  finanzas: 'views/us/myfinancials.html',
  chat: 'views/us/chat.html',
  ayuda: 'views/us/ayuda.html',
  'my-program': 'views/us/my-program.html', // My Program view lives under /views, not /src/views
  'my-academics': 'views/us/my-academics.html',
  visa: 'views/us/my-visa.html'    // ← ESTA LÍNEA con coma arriba
};
const perfilSubPages = {
    personales: `
      <form class="card" id="form-personales"><div class="card-body">
          <h5 class="fw-bold">Credentials</h5>
          <div class="mb-4"><label class="form-label">Primary email *</label><input type="email" class="form-control" id="personal-email" readonly></div>
          
          <h5 class="fw-bold">Personal Information</h5>
          <div class="row g-3 mb-4">
            <div class="col-md-6"><label class="form-label">First name *</label><input type="text" class="form-control" id="personal-name"></div>
            <div class="col-md-6"><label class="form-label">Last name *</label><input type="text" class="form-control" id="personal-surname"></div>
            <div class="col-md-6"><label class="form-label">Nationality *</label><select class="form-select" id="personal-nationality"></select></div>
            <div class="col-md-6"><label class="form-label">Date of birth *</label><input type="date" class="form-control" id="personal-birthDate"></div>
            <div class="col-md-6"><label class="form-label">Passport number *</label><input type="text" class="form-control" id="personal-passportNumber"></div>
            <div class="col-md-6"><label class="form-label">Passport expiration date *</label><input type="date" class="form-control" id="personal-passportExpiry"></div>
          </div>
          <h5 class="fw-bold">Contact Information (For Contract)</h5>
          <div class="row g-3 mb-4">
              <div class="col-md-6"><label class="form-label">Country code *</label><select class="form-select" id="contact-phoneCode"></select></div>
              <div class="col-md-6"><label class="form-label">Mobile phone *</label><input type="tel" class="form-control" id="contact-phoneNumber"></div>
              <div class="col-md-8"><label class="form-label">Street and number *</label><input type="text" class="form-control" id="contact-address1"></div>
              <div class="col-md-4"><label class="form-label">Address line 2</label><input type="text" class="form-control" id="contact-address2"></div>
              <div class="col-md-6"><label class="form-label">City *</label><input type="text" class="form-control" id="contact-city"></div>
              <div class="col-md-6"><label class="form-label">Postal code *</label><input type="text" class="form-control" id="contact-postalCode"></div>
              <div class="col-md-6"><label class="form-label">Province/State *</label><input type="text" class="form-control" id="contact-province"></div>
              <div class="col-md-6"><label class="form-label">Country *</label><select class="form-select" id="contact-country"></select></div>
          </div>
          <h5 class="fw-bold">Contact Information (Parent or Guardian)</h5>
          <div class="row g-3 mb-4">
            <div class="col-md-6"><label class="form-label">Contact name *</label><input type="text" class="form-control" id="parent-name"></div>
            <div class="col-md-6"><label class="form-label">Relationship *</label><input type="text" class="form-control" id="parent-relation" placeholder="E.g.: Father, Mother"></div>
            <div class="col-md-6"><label class="form-label">Contact email *</label><input type="email" class="form-control" id="parent-email"></div>
            <div class="col-md-6"><label class="form-label">Contact phone *</label><input type="tel" class="form-control" id="parent-phone"></div>
          </div>
          <h5 class="fw-bold">Social Media</h5>
          <div id="social-links-container" class="mb-3"></div>
          <button type="button" class="btn btn-outline-primary" id="add-social-link-btn">Add Social Profile</button>
      
      </div>
      <div class="card-footer text-end bg-light">
          <span class="save-status me-3 text-success fw-bold"></span>
          <button type="button" class="btn btn-eture-red fw-bold save-profile-btn" data-form="form-personales">Save Changes</button>
      </div>
      </form>`,
    academica: `
      <div class="card" id="form-academica">
          <div class="card-body">
              <h5 class="fw-bold">Academic Status</h5>
              <div class="row g-3 mb-4 align-items-center">
                  <div class="col-md-auto">
                      <label class="form-label" for="academic-status">Current status *</label>
                      <select class="form-select" id="academic-status" style="width: auto;">
                          <option value="Freshman">Freshman</option>
                          <option value="Transfer">Transfer</option>
                          <option value="Graduate">Graduate</option>
                      </select>
                  </div>
                  <div class="col-md">
                      <small class="text-muted lh-sm">
                          <b>Freshman:</b> You are starting your college career in the United States.
                          <br/>
                          <b>Transfer:</b> You already study at a university and will transfer your credits.
                          <br/>
                          <b>Graduate:</b> You will pursue a master's degree or graduate studies.
                      </small>
                  </div>
              </div>
              
              <hr class="my-4">
              
              <h5 class="fw-bold">College Major Options in the U.S.</h5>
              <p class="text-muted small">Add up to three majors you would like to study. Having several alternatives increases your chances.</p>
              <div id="study-options-container" class="mb-2"></div>
              <button type="button" class="btn btn-sm btn-outline-primary" id="add-study-option-btn">Add another option</button>
              
              <hr class="my-4">
              <h5 class="fw-bold">English Level and Standardized Tests</h5>
              <div class="row g-3">
                  <div class="col-md-6">
                      <label class="form-label">English level (Common European Framework)</label>
                      <select class="form-select" id="academic-englishLevel"><option>A1 - Beginner</option><option>A2 - Beginner</option><option>B1 - Intermediate</option><option>B2 - Upper Intermediate</option><option>C1 - Advanced</option><option>C2 - Proficient</option></select>
                  </div>
                  <div class="col-md-6">
                      <label class="form-label">Standardized tests</label>
                      <div id="exam-container"></div>
                      <button type="button" class="btn btn-sm btn-outline-primary mt-2" id="add-exam-btn">Add Exam</button>
                  </div>
              </div>
              <hr class="my-4">
              <h5 class="fw-bold">Detailed Academic History</h5>
              <p class="text-muted small">Make sure the history is generated correctly after entering your date of birth in the Personal Information section.</p>
              <div id="academic-history-container" class="mb-4">
                  <div class="alert alert-info">Please enter your date of birth in "Personal Information" to generate your academic history.</div>
              </div>
          </div>
          <div class="card-footer text-end bg-light">
              <span class="save-status me-3 text-success fw-bold"></span>
              <button type="button" class="btn btn-eture-red fw-bold save-profile-btn" data-form="form-academica">Save Changes</button>
          </div>
      </div>`,
    deportiva: `
      <div class="card" id="form-deportiva">
          <div class="card-body">
              <div class="row g-4">
                  <div class="col-lg-7">
                      <h5 class="fw-bold">Physical Data</h5>
                      <div class="row g-3 mb-4">
                          <div class="col-md-6"><label class="form-label">Height (cm) *</label><input type="number" class="form-control" id="athletic-height"></div>
                          <div class="col-md-6"><label class="form-label">Weight (kg) *</label><input type="number" class="form-control" id="athletic-weight"></div>
                      </div>
                      
                      <h5 class="fw-bold">Current Team</h5>
                      <div class="row g-3 mb-4">
                          <div class="col-md-6"><label class="form-label">Current team name *</label><input type="text" class="form-control" id="athletic-currentTeam"></div>
                          <div class="col-md-6"><label class="form-label">Current division/category *</label><input type="text" class="form-control" id="athletic-currentDivision"></div>
                      </div>
                      <h5 class="fw-bold">Media Content</h5>
                      <div class="mb-4">
                          <h6>Highlight videos *</h6>
                          <div id="highlights-container"></div>
                          <button type="button" class="btn btn-outline-primary" id="add-highlights-btn">Add Video</button>
                      </div>
                      <div class="mb-4">
                          <h6>Full matches</h6>
                          <div id="matches-container"></div>
                          <button type="button" class="btn btn-outline-primary" id="add-match-btn">Add Match</button>
                      </div>
                      <h5 class="fw-bold">Team History and Stats</h5>
                      <p class="text-muted small">Please add EVERY club you have played for since age 14 (Cadet category) to the present.</p>
                      <div id="team-history-container" class="mb-4">
                          <div class="alert alert-info">Please enter your date of birth in "Personal Information" to generate your team history.</div>
                      </div>
                      <h6>Last Season Stats</h6>
                      <div id="stats-container" class="row g-3"></div>
                  </div>
                  <div class="col-lg-5">
                      <h5 class="fw-bold">Playing Position</h5>
                      <div class="mb-3"><label class="form-label">Primary position *</label><select class="form-select" id="athletic-mainPosition"></select></div>
                      <div class="mb-3">
                          <label class="form-label">Secondary position</label>
                          <div id="secondary-positions-container"></div>
                          <button type="button" class="btn btn-sm btn-outline-primary mt-2" id="add-secondary-pos-btn">Add another position</button>
                      </div>
                       <div class="mb-4"><label class="form-label">Dominant foot *</label><select class="form-select" id="athletic-dominantFoot"><option>Right</option><option>Left</option><option>Both</option></select></div>
                      
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
              <button type="button" class="btn btn-eture-red fw-bold save-profile-btn" data-form="deportiva">Save Changes</button>
          </div>
      </div>`
};
// ... aquí termina todo el bloque de datos de 'perfilSubPages' ...

// --- 4. FUNCIONES DE BASE DE DATOS (USANDO services/firestore.js) ---

async function saveProfileToFirestore(userId, data) {
  try {
    await saveProfile(userId, data);
    console.log("Profile saved successfully in Firestore!");
  } catch (error) {
    console.error("Error saving profile: ", error);
    alert("There was an error saving your profile.");
  }
}

async function loadProfileFromFirestore(userId) {
  try {
    const profile = await getProfile(userId);
    if (profile) {
      console.log("Perfil cargado desde Firestore.");
      return profile;
    } else {
      console.log("Profile does not exist; creating one with default data.");
      const defaultData = JSON.parse(JSON.stringify(emptyProfileData));
      return await ensureProfile(userId, defaultData);
    }
  } catch (error) {
    console.error("Error loading profile: ", error);
    return userProfileData;
  }
}

async function loadTasksFromFirestore(userId) {
  try {
    const tasks = await listTasks(userId);
    if (tasks.length > 0) {
      console.log("Tasks cargadas desde Firestore.");
      return tasks;
    } else {
    console.log("No tasks exist, returning an empty list.");
      return [];
    }
  } catch (error) {
    console.error("Error loading tasks: ", error);
    return [];
  }
}

function ensureVisaDefaults() {
  if (!userProfileData.visa) userProfileData.visa = {};
  const v = userProfileData.visa;
  v.overview = v.overview || {
    status: '',              // e.g. Draft / Submitted / Approved / Denied
    applicationId: '',       // ID de solicitud (si existe)
    portalRef: '',           // referencia del portal/cita (si existe)
    institution: '',         // universidad/centro en España
    consulateCity: '',       // consulado español (ciudad)
    appointmentDate: '',     // fecha de la cita (YYYY-MM-DD)
    appointmentTime: '',     // hora de la cita (HH:mm)
    notes: '',
    lastUpdate: ''
  };
  // porcentaje estimado (lo recalculamos al vuelo, pero guardamos el último)
  v.progressPct = Number(v.progressPct) || 0;
  v.submission = normalizeVisaSubmissionState(v.submission);
  v.appointment = v.appointment || {
    datetime: '',
    center: '',
    readAcknowledged: false,
    proofFile: null
  };
  v.spainRequest = v.spainRequest || {
    status: 'none',
    reason: ''
  };
  v.spainTravel = sanitizeSpainTravelEntries(v.spainTravel);
  const visitFlag = (v.spainEuropeVisit || '').toString().toLowerCase();
  if (visitFlag === 'yes' || visitFlag === 'no') {
    v.spainEuropeVisit = visitFlag;
  } else if (v.spainTravel.length) {
    v.spainEuropeVisit = 'yes';
  } else {
    v.spainEuropeVisit = '';
  }
  v.spainInfoAccepted = v.spainInfoAccepted === true;
}
// --- A PARTIR DE AQUÍ EMPIEZA EL CÓDIGO QUE YA TENÍAS ---

// REEMPLAZA TU FUNCIÓN saveProfileData ENTERA POR ESTA VERSIÓN FINAL Y COMPLETA
async function saveProfileData(formId) {
  console.log(`--- 🕵️‍♂️ INICIANDO GUARDADO para el formulario: ${formId} ---`);
  const user = auth.currentUser;

  if (!user) {
    console.error("CRITICAL ERROR! No authenticated user found for saving.");
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

async function executeInlineModules(container) {
  if (!container) return;
  const scripts = Array.from(container.querySelectorAll('script[type="module"]'));
  if (scripts.length === 0) return;

  await Promise.all(scripts.map((original) => new Promise((resolve) => {
    const replacement = document.createElement('script');
    replacement.type = original.type || 'module';
    Array.from(original.attributes).forEach((attr) => {
      if (attr.name === 'type') return;
      replacement.setAttribute(attr.name, attr.value);
    });
    replacement.textContent = original.textContent || '';
    replacement.addEventListener('load', resolve, { once: true });
    replacement.addEventListener('error', () => resolve(), { once: true });
    original.parentNode?.replaceChild(replacement, original);
    if (!replacement.src) {
      // Inline modules execute immediately; microtask ensures completion.
      queueMicrotask(resolve);
    }
  })));
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
      if (!response.ok) throw new Error(`Unable to load ${pageSource}`);
      const html = await response.text();
      contentDiv.innerHTML = html;
    } else {
      contentDiv.innerHTML = pageSource;
    }

    await executeInlineModules(contentDiv);
    if (pageId === 'finanzas') {
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        window.initMyFinancials?.(contentDiv);
      } catch (error) {
        console.error('Unable to initialize My Financials view', error);
      }
    }

    // --- My Visa (inicialización de Overview y eventos) ---
    if (pageId === 'visa') {
      // Pintar el dashboard de Overview al entrar a My Visa
      renderVisaTab('overview');

      // Ocultar todos los paneles menos el activo por si el CSS de tabs no aplica
      showTabPane('visa-overview');

      // (opcional) Re-pintar al cambiar de pestañas si vuelves a Overview
      const tabs = document.getElementById('visa-tabs');
      if (tabs) {
        bindVisaTabClicks();
        const overviewSummary = contentDiv.querySelector('.visa-overview-summary');

        // Aseguramos que el resumen esté visible al cargar Overview por primera vez
        overviewSummary?.classList.remove('d-none');

        tabs.addEventListener('show.bs.tab', (ev) => {
          const targetSelector = ev.target?.getAttribute('data-bs-target');
          const paneId = targetSelector ? targetSelector.replace('#', '') : null;
          showTabPane(paneId);

          if (overviewSummary) {
            if (paneId === 'visa-overview') {
              overviewSummary.classList.remove('d-none');
            } else {
              overviewSummary.classList.add('d-none');
            }
          }
        });

        tabs.addEventListener('shown.bs.tab', (ev) => {
          const tabName = ev.target?.getAttribute('data-tab');
          if (tabName) {
            renderVisaTab(tabName);
          }
        });

        document.dispatchEvent(new CustomEvent('visa:tabs-ready'));
      }

      // Atajos "Go to …" del dashboard: siempre muestran la pestaña del header
      contentDiv.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.visa-tab-shortcut');
        if (!btn) return;

        ev.preventDefault();
        ev.stopPropagation();

        const targetSelector = btn.getAttribute('data-visa-tab-target'); // ej: "#visa-checklist"
        if (!targetSelector) return;

        // Buscamos el botón REAL del header que controla esa pestaña
        const headerBtn = contentDiv.querySelector(
          `#visa-tabs [data-bs-target="${targetSelector}"]`
        );
        if (!headerBtn) return;

        // Mostrar la pestaña (esto quita "show active" de Overview y lo pone en la nueva)
        bootstrap.Tab.getOrCreateInstance(headerBtn).show();
      });

      // Guardar Overview
      contentDiv.querySelector('#visa-overview-save')?.addEventListener('click', saveVisaOverview);
    }

    // --- NEW SMART LOGIC! ---
    // Step 2: If the page we just loaded is 'inicio', make it dynamic
    if (pageId === 'inicio') {
      // pintar el snapshot actual
      renderHomeTasksSnapshot(contentDiv);
    }

    if (pageId === 'documentos') {
      await initDocsFeature();
    }

    // Step 3: Run the rest of the page-specific functions (as before)
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
    if (pageId === 'my-program') {
      initMyProgramView(contentDiv);
    }
    if (pageId === 'my-academics') {
      initMyAcademicsView(contentDiv);
    }
    if (pageId === 'ayuda') {
      initHelpCenter(contentDiv);
    }
    if (pageId === 'tareas') {
      if (auth.currentUser) {
        await initTasksFeature(auth.currentUser);
      }
      return; // Importante: salimos para no ejecutar lógica antigua
    }



  } catch (error) {
    console.error("Error rendering page:", pageId, error);
    contentDiv.innerHTML = `<p class="text-danger">There was an error loading this section.</p>`;
  }
}

function initMyProgramView(contentRoot) {
  if (!contentRoot) return;

  const tabs = contentRoot.querySelector('#my-program-tabs');
  if (!tabs || tabs.dataset.initialized === 'true') return;

  const navButtons = Array.from(tabs.querySelectorAll('[data-bs-toggle="tab"]'));
  const tabPanes = Array.from(contentRoot.querySelectorAll('#my-program-content .tab-pane'));
  const firstButton = navButtons[0];

  navButtons.forEach((btn) => {
    btn.classList.remove('active');
    btn.setAttribute('aria-selected', 'false');
  });
  tabPanes.forEach((pane) => {
    pane.classList.remove('show', 'active');
  });

  if (firstButton) {
    const targetSelector = firstButton.getAttribute('data-bs-target');
    if (window.bootstrap?.Tab) {
      bootstrap.Tab.getOrCreateInstance(firstButton).show();
    } else {
      firstButton.classList.add('active');
      firstButton.setAttribute('aria-selected', 'true');
      if (targetSelector) {
        const firstPane = contentRoot.querySelector(targetSelector);
        if (firstPane) {
          firstPane.classList.add('show', 'active');
        }
      }
    }
  }

  if (!window.bootstrap?.Tab) {
    tabs.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-bs-toggle="tab"]');
      if (!trigger) return;

      event.preventDefault();

      navButtons.forEach((btn) => {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
      });
      tabPanes.forEach((pane) => {
        pane.classList.remove('show', 'active');
      });

      trigger.classList.add('active');
      trigger.setAttribute('aria-selected', 'true');

      const nextSelector = trigger.getAttribute('data-bs-target');
      if (nextSelector) {
        const pane = contentRoot.querySelector(nextSelector);
        if (pane) {
          pane.classList.add('show', 'active');
        }
      }
    });
  }

  tabs.dataset.initialized = 'true';
  // TODO: Link "Edit in MyVisa" actions to "#my-visa-trip"
  // TODO: Wire CTAs to backend (rides/driver) later
}

function initMyAcademicsView(contentRoot) {
  if (!contentRoot) return;
  const root = contentRoot.querySelector('#my-academics');
  if (!root || root.dataset.step3Initialized === 'true') return;
  root.dataset.step3Initialized = 'true';

  const intentKey = 'eture_myacademics_intent';
  const step1PathKey = 'eture_myacademics_step1_path';
  const step2CompletedKey = 'eture_myacademics_step2_completed';
  const step3ProgramKey = 'eture_myacademics_step3_program';
  const step3CompletedKey = 'eture_myacademics_step3_completed';

  const validPrograms = new Set(['spanish', 'gsc', 'full']);

  const step3Item = root.querySelector('#get-enrolled-accordion [data-step="3"]');
  if (!step3Item) return;
  const step3Button = step3Item.querySelector('.accordion-button');
  const step3Collapse = root.querySelector('#get-enrolled-step-3');
  const step3Content = step3Item.querySelector('[data-step-content]');
  const step3LockIndicator = step3Item.querySelector('[data-lock-indicator]');
  const step3LockedAlert = step3Item.querySelector('[data-locked-alert]');
  const step3CompleteBadge = step3Item.querySelector('[data-step3-complete-badge]');
  const step3Continue = step3Item.querySelector('[data-step3-continue]');
  const step3Cards = Array.from(step3Item.querySelectorAll('[data-step3-card]'));

  const step4Item = root.querySelector('#get-enrolled-accordion [data-step="4"]');
  const step4Button = step4Item?.querySelector('.accordion-button');
  const step4Collapse = root.querySelector('#get-enrolled-step-4');
  const step4Content = step4Item?.querySelector('[data-step-content]');
  const step4LockIndicator = step4Item?.querySelector('[data-lock-indicator]');
  const step4LockedAlert = step4Item?.querySelector('[data-locked-alert]');

  const Collapse = window.bootstrap?.Collapse;

  const showCollapse = (element) => {
    if (!element) return;
    if (Collapse?.getOrCreateInstance) {
      Collapse.getOrCreateInstance(element, { toggle: false }).show();
      return;
    }
    if (Collapse) {
      new Collapse(element, { toggle: false }).show();
      return;
    }
    element.classList.add('show');
  };

  const hideCollapse = (element) => {
    if (!element) return;
    if (Collapse?.getOrCreateInstance) {
      Collapse.getOrCreateInstance(element, { toggle: false }).hide();
      return;
    }
    if (Collapse) {
      new Collapse(element, { toggle: false }).hide();
      return;
    }
    element.classList.remove('show');
  };

  const readStorage = (key) => {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  };

  const writeStorage = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch (_) {}
  };

  const clearStorage = (key) => {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  };

  const normalizeIntent = (intent) => {
    if (!intent) return null;
    if (intent === 'study') return 'credits';
    return intent;
  };

  const isEtureRoute = () => {
    const intent = normalizeIntent(readStorage(intentKey));
    const route = readStorage(step1PathKey);
    return intent === 'credits' && route === 'eture_msu';
  };

  let currentProgram = null;
  let step3Completed = false;
  let refreshScheduled = false;

  const setStepLocked = (item, button, content, lockIndicator, lockedAlert, collapse, shouldLock) => {
    if (!item || !button) return;
    item.classList.toggle('is-locked', shouldLock);
    button.classList.toggle('disabled', shouldLock);
    if (shouldLock) {
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('tabindex', '-1');
      lockIndicator?.classList.remove('d-none');
      lockedAlert?.classList.remove('d-none');
      content?.classList.add('opacity-50');
      hideCollapse(collapse);
      return;
    }
    button.removeAttribute('aria-disabled');
    button.removeAttribute('tabindex');
    lockIndicator?.classList.add('d-none');
    lockedAlert?.classList.add('d-none');
    content?.classList.remove('opacity-50');
  };

  const setStep3Locked = (shouldLock) => {
    setStepLocked(
      step3Item,
      step3Button,
      step3Content,
      step3LockIndicator,
      step3LockedAlert,
      step3Collapse,
      shouldLock
    );
  };

  const setStep4Locked = (shouldLock) => {
    setStepLocked(
      step4Item,
      step4Button,
      step4Content,
      step4LockIndicator,
      step4LockedAlert,
      step4Collapse,
      shouldLock
    );
  };

  const setStep3Completed = (isCompleted, { persist = true } = {}) => {
    step3Completed = isCompleted;
    step3CompleteBadge?.classList.toggle('d-none', !isCompleted);
    if (persist) {
      if (isCompleted) {
        writeStorage(step3CompletedKey, '1');
      } else {
        clearStorage(step3CompletedKey);
      }
    }
    const shouldUnlockStep4 = isCompleted && isEtureRoute();
    setStep4Locked(!shouldUnlockStep4);
    if (!isEtureRoute()) {
      hideCollapse(step4Collapse);
    }
  };

  const updateContinueState = () => {
    if (step3Continue) {
      step3Continue.disabled = !currentProgram;
    }
  };

  const applyProgramSelection = (program, { persist = false } = {}) => {
    if (!validPrograms.has(program)) return;
    currentProgram = program;
    step3Cards.forEach((card) => {
      const isActive = card.dataset.step3Card === program;
      card.classList.toggle('border-primary', isActive);
      card.classList.toggle('bg-light', isActive);
      card.classList.toggle('shadow-sm', isActive);
      card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (persist) {
      writeStorage(step3ProgramKey, program);
    }
    updateContinueState();
  };

  const restoreStep3 = () => {
    const storedProgram = readStorage(step3ProgramKey);
    if (storedProgram && validPrograms.has(storedProgram)) {
      applyProgramSelection(storedProgram, { persist: false });
    }
    const storedCompleted = readStorage(step3CompletedKey) === '1';
    setStep3Completed(Boolean(storedCompleted && currentProgram), { persist: false });
  };

  const refreshStep3Availability = () => {
    const showEtureSteps = isEtureRoute();

    step3Item.classList.toggle('d-none', !showEtureSteps);
    step4Item?.classList.toggle('d-none', !showEtureSteps);

    if (!showEtureSteps) {
      setStep3Locked(true);
      setStep3Completed(false, { persist: false });
      setStep4Locked(true);
      return;
    }

    const step2Completed = readStorage(step2CompletedKey) === '1';
    setStep3Locked(!step2Completed);

    if (!step2Completed) {
      setStep3Completed(false, { persist: false });
      return;
    }

    if (!currentProgram) {
      const storedProgram = readStorage(step3ProgramKey);
      if (storedProgram && validPrograms.has(storedProgram)) {
        applyProgramSelection(storedProgram, { persist: false });
      }
    }

    const storedCompleted = readStorage(step3CompletedKey) === '1';
    setStep3Completed(Boolean(storedCompleted && currentProgram), { persist: false });
  };

  const scheduleRefresh = () => {
    if (refreshScheduled) return;
    refreshScheduled = true;
    requestAnimationFrame(() => {
      refreshScheduled = false;
      refreshStep3Availability();
    });
  };

  step3Cards.forEach((card) => {
    card.addEventListener('click', (event) => {
      if (step3Item.classList.contains('is-locked') || step3Item.classList.contains('d-none')) return;
      if (event.target.closest('[data-step3-pricing-toggle]')) return;
      const program = card.dataset.step3Card;
      if (!program) return;
      if (step3Completed && currentProgram && currentProgram !== program) {
        const confirmed = window.confirm('You changed your program selection. Confirm?');
        if (!confirmed) return;
        applyProgramSelection(program, { persist: true });
        setStep3Completed(true);
        return;
      }
      applyProgramSelection(program);
    });

    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (step3Item.classList.contains('is-locked') || step3Item.classList.contains('d-none')) return;
      if (event.target.closest('[data-step3-pricing-toggle]')) return;
      event.preventDefault();
      const program = card.dataset.step3Card;
      if (!program) return;
      if (step3Completed && currentProgram && currentProgram !== program) {
        const confirmed = window.confirm('You changed your program selection. Confirm?');
        if (!confirmed) return;
        applyProgramSelection(program, { persist: true });
        setStep3Completed(true);
        return;
      }
      applyProgramSelection(program);
    });
  });

  step3Continue?.addEventListener('click', () => {
    if (step3Item.classList.contains('is-locked') || step3Item.classList.contains('d-none')) return;
    if (!currentProgram) return;
    writeStorage(step3ProgramKey, currentProgram);
    setStep3Completed(true);
    hideCollapse(step3Collapse);
    if (isEtureRoute()) {
      showCollapse(step4Collapse);
    }
  });

  root.addEventListener('click', (event) => {
    const step2Continue = event.target.closest('[data-step2-continue]');
    if (step2Continue) {
      scheduleRefresh();
      requestAnimationFrame(() => {
        if (!isEtureRoute()) return;
        if (readStorage(step2CompletedKey) !== '1') return;
        refreshStep3Availability();
        showCollapse(step3Collapse);
      });
      return;
    }

    if (
      event.target.closest('[data-academic-intent]')
      || event.target.closest('[data-step1-choice]')
      || event.target.closest('[data-step1-continue]')
      || event.target.closest('#get-enrolled-step-2')
    ) {
      scheduleRefresh();
    }
  });

  root.addEventListener('input', (event) => {
    if (event.target.closest('#get-enrolled-step-2')) {
      scheduleRefresh();
    }
  });

  restoreStep3();
  refreshStep3Availability();
}

function waitForElement(sel, { timeout = 3000, root = document } = {}) {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('waitForElement requires a DOM'));
  }

  const container = root && typeof root.querySelector === 'function' ? root : document;

  return new Promise((resolve, reject) => {
    const immediate = container.querySelector(sel);
    if (immediate) {
      resolve(immediate);
      return;
    }

    let settled = false;
    const stop = (callback) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timerId);
      callback();
    };

    const observer = new MutationObserver(() => {
      const candidate = container.querySelector(sel);
      if (candidate) {
        stop(() => resolve(candidate));
      }
    });

    observer.observe(container, { childList: true, subtree: true });

    const timerId = setTimeout(() => {
      stop(() => reject(new Error('waitForElement timeout: ' + sel)));
    }, timeout);
  });
}

async function activateBootstrapTabForElement(el) {
  if (!el || typeof document === 'undefined') return;
  const pane = el.closest('.tab-pane');
  if (!pane) return;
  const controlId = pane.getAttribute('aria-labelledby');
  if (!controlId) return;
  const control = document.getElementById(controlId);
  if (!control) return;

  try {
    const Tab = window.bootstrap?.Tab;
    if (Tab?.getOrCreateInstance) {
      Tab.getOrCreateInstance(control).show();
    } else if (Tab) {
      new Tab(control).show();
    } else if (typeof control.click === 'function') {
      control.click();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  } catch (_) {
    try {
      control.click?.();
    } catch (_) {}
  }
}

let myVisaTripNavigationPromise = null;
async function handleDeepLinkMyVisaTrip() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (myVisaTripNavigationPromise) return myVisaTripNavigationPromise;

  myVisaTripNavigationPromise = (async () => {
    const currentHash = window.location.hash || '';
    let shouldRestoreAnchor = false;

    if (currentHash === '#my-visa-trip') {
      shouldRestoreAnchor = true;
      try {
        window.history.replaceState(null, '', '#visa');
      } catch (_) {
        window.location.hash = '#visa';
      }
    } else if (currentHash !== '#visa' && !currentHash.startsWith('#my-visa-trip')) {
      shouldRestoreAnchor = true;
      window.location.hash = '#visa';
    }

    const visaNavLink = document.querySelector('#main-nav a[href="#visa"]');
    if (visaNavLink) {
      try {
        const Tab = window.bootstrap?.Tab;
        if (Tab?.getOrCreateInstance) {
          Tab.getOrCreateInstance(visaNavLink).show();
        } else if (Tab) {
          new Tab(visaNavLink).show();
        } else {
          visaNavLink.click();
        }
      } catch (_) {
        visaNavLink.click?.();
      }
    }

    await waitForElement('#visa-content');
    const anchor = await waitForElement('#my-visa-trip');
    await activateBootstrapTabForElement(anchor);

    const pane = anchor.closest('.tab-pane');
    if (pane) {
      const isPaneVisible = () => {
        if (pane.hidden === false) return true;
        if (pane.classList.contains('show') || pane.classList.contains('active')) return true;
        const ariaHidden = pane.getAttribute('aria-hidden');
        return ariaHidden === null || ariaHidden === 'false';
      };

      if (!isPaneVisible()) {
        await new Promise((resolve) => {
          const observer = new MutationObserver(() => {
            if (isPaneVisible()) {
              observer.disconnect();
              resolve();
            }
          });
          observer.observe(pane, { attributes: true, attributeFilter: ['class', 'aria-hidden', 'hidden'] });
          setTimeout(() => {
            observer.disconnect();
            resolve();
          }, 500);
        });
      }
    }

    anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (shouldRestoreAnchor) {
      try {
        window.history.replaceState(null, '', '#my-visa-trip');
      } catch (_) {
        if (window.location.hash !== '#my-visa-trip') {
          window.location.hash = '#my-visa-trip';
        }
      }
    }
  })()
    .catch((error) => {
      console.warn('handleDeepLinkMyVisaTrip failed', error);
      throw error;
    })
    .finally(() => {
      myVisaTripNavigationPromise = null;
    });

  return myVisaTripNavigationPromise;
}

function handleHashNavigation() {
  if (typeof window === 'undefined') {
    return;
  }

  const currentHash = window.location.hash;
  if (currentHash !== '#my-program') {
    return;
  }

  const navLink = document.querySelector('#main-nav a[href="#my-program"]');
  if (navLink) {
    if (window.bootstrap?.Tab) {
      bootstrap.Tab.getOrCreateInstance(navLink).show();
      return;
    }

    document.querySelectorAll('#main-nav .nav-link').forEach((link) => {
      link.classList.remove('active');
    });
    navLink.classList.add('active');

    const targetSelector = navLink.getAttribute('data-bs-target');
    if (targetSelector) {
      document.querySelectorAll('#main-content .tab-pane').forEach((pane) => {
        pane.classList.remove('show', 'active');
      });
      const targetPane = document.querySelector(targetSelector);
      if (targetPane) {
        targetPane.classList.add('show', 'active');
      }
    }
  }

  renderPage('my-program');
}

function handleAppHashChange(event) {
  if (typeof window === 'undefined') return;

  if (window.location.hash === '#my-visa-trip') {
    event?.preventDefault?.();
    handleDeepLinkMyVisaTrip().catch(console.warn);
    return;
  }

  handleHashNavigation(event);
}

window.addEventListener('hashchange', handleAppHashChange);

if (typeof document !== 'undefined') {
  const tryHandleVisaTripDeepLink = () => {
    if (window.location.hash === '#my-visa-trip') {
      handleDeepLinkMyVisaTrip().catch(console.warn);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryHandleVisaTripDeepLink, { once: true });
  } else {
    tryHandleVisaTripDeepLink();
  }
}

// Pinta el bloque de "Tasks pendientes" del INICIO usando la caché de tasks.js
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
      listEl.innerHTML = '<p class="text-center p-3">Great job! You have no pending tasks.</p>';
    } else {
      listEl.innerHTML = next3.map(t => {
        const color = getTaskStatusColor(t.status);
        const statusLabel = translateTaskStatus(t.status);
        return `
          <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
            <div>
              <h6 class="mb-1 fw-bold">${t.title}</h6>
              <small class="text-muted">${t.notes || 'No additional notes.'}</small>
            </div>
            <span class="badge bg-${color} rounded-pill">${statusLabel}</span>
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
      '<option selected disabled>Select...</option>' +
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

  // Timeline de equipos y estadísticas
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
        badge.textContent = 'Changes saved';
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
      : 'Not specified';
  
  const examsHTML = data.academic.exams.length > 0
      ? data.academic.exams.map(exam => `<strong>${exam.type}:</strong> ${exam.score}`).join(' | ')
      : 'No exams recorded.';
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
                      <img src="${data.media.profilePicture || 'https://placehold.co/120x120'}" alt="Foto de Perfil de ${data.personal.name || 'Player'}" />
                  </div>
                  <div class="ms-md-4 mt-3 mt-md-0 text-center text-md-start">
                      <h2 class="fw-bold mb-0">${data.personal.name} ${data.personal.surname}</h2>
                      <p class="lead text-eture-red fw-bold mb-1">${data.athletic.currentTeam || 'No team'} - ${data.athletic.currentDivision || 'No division'}</p>
                      <p class="text-muted mb-1">Status: <span class="fw-bold text-dark">${data.academic.status}</span></p>
                      <div>
                          <p class="text-muted d-inline">Majors of interest: </p>
                          <div class="d-inline-block">${studyOptionsHTML}</div>
                      </div>
                  </div>
              </div>
              <div class="row g-3 text-center my-4">
                  <div class="col-4">
                      <div class="stat-card p-2 rounded">
                          <div class="fs-4 fw-bold">${data.athletic.height || 'N/A'}<span class="fs-6 fw-normal">cm</span></div>
                          <div class="small text-muted">Height</div>
                      </div>
                  </div>
                  <div class="col-4">
                      <div class="stat-card p-2 rounded">
                          <div class="fs-4 fw-bold">${data.athletic.weight || 'N/A'}<span class="fs-6 fw-normal">kg</span></div>
                          <div class="small text-muted">Weight</div>
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
                      <h5 class="fw-bold text-center mb-3">Highlight Video (${mainHighlight.name})</h5>
                       <a href="${mainHighlight.url}" target="_blank" class="text-decoration-none">
                          <div class="video-placeholder rounded" style="background-image: url('${data.media.videoThumbnail}');">
                              <div class="play-icon">▶</div>
                          </div>
                      </a>
                  </div>
                  <div class="col-lg-5">
                      <h5 class="fw-bold text-center mb-3">Positions on the Field</h5>
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
                  <li class="nav-item" role="presentation"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#promo-academica" type="button">Academic Info.</button></li>
                  <li class="nav-item" role="presentation"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#promo-deportiva" type="button">Athletic Info.</button></li>
              </ul>
              <div class="tab-content p-3 border border-top-0 rounded-bottom">
                  <div class="tab-pane fade show active" id="promo-bio" role="tabpanel">
                      <p class="mb-0 text-muted">I am a creative and hard-working attacking midfielder with great vision and the ability to get into the box. My goal is to combine my passion for soccer with a top-tier education in the United States. I am ready to give my very best both on the field and in the classroom.</p>
                  </div>
                  <div class="tab-pane fade p-3" id="promo-academica" role="tabpanel">
                       <p class="fw-bold mb-2">Exam Results</p>
                       <p class="small text-muted mb-3">${examsHTML}</p>
                       <div class="text-center">
                          <p class="small text-muted mb-2">The full history and transcripts are available upon request.</p>
                          <button class="btn btn-sm btn-outline-secondary">Request Access</button>
                       </div>
                  </div>
                  <div class="tab-pane fade text-center p-4" id="promo-deportiva" role="tabpanel">
                      <p class="fw-bold mb-2">🔒 Full Athletic Information</p>
                      <p class="small text-muted mb-2">Team history, detailed statistics, and full-match videos are available upon request.</p>
                      <button class="btn btn-sm btn-outline-secondary">Request Access</button>
                  </div>
              </div>
          </div>
          <div class="card-footer bg-light text-center text-muted small">
              <p class="mb-0">This profile card updates automatically with the information from your "My Profile" section.</p>
          </div>
      </div>`;
}
function normalizeUniversityStatus(status) {
  const s = (status || '').toLowerCase();
  switch (s) {
    case 'aceptada':
    case 'accepted':
      return 'Accepted';
    case 'rechazada':
    case 'rejected':
      return 'Rejected';
    case 'oferta recibida':
    case 'offer received':
      return 'Offer received';
    case 'en contacto':
    case 'in contact':
      return 'In contact';
    case 'pendiente':
    case 'pending':
    default:
      return 'Pending';
  }
}

// NUEVO: color del badge según estado
function getBadgeColorForStatus(status) {
  switch (normalizeUniversityStatus(status)) {
    case 'Accepted':
      return 'success';
    case 'Rejected':
      return 'danger';
    case 'Offer received':
      return 'primary';
    case 'In contact':
      return 'info';
    case 'Pending':
    default:
      return 'secondary';
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
  const normalized = normalizeUniversityStatus(uni?.status);
  if (normalized === 'Accepted' || normalized === 'Rejected') {
    return normalized;
  }
  if (hasOffer(uni)) {
    return 'Offer received';
  }
  return normalized;
}

function badgeForComputedStatus(status) {
  switch (normalizeUniversityStatus(status)) {
    case 'Accepted':
      return 'success';
    case 'Rejected':
      return 'dark';
    case 'Offer received':
      return 'info';
    case 'In contact':
    case 'Pending':
    default:
      return 'secondary';
  }
}

// --- Follow-up proactivo: helpers ---
function nextStepTypeLabel(t) {
  const map = {
    llamada: 'Call',
    call: 'Call',
    email: 'Email',
    reunion: 'Meeting',
    reunión: 'Meeting',
    meeting: 'Meeting',
    mensaje: 'Message',
    message: 'Message',
    dm: 'Message',
    otro: 'Other',
    other: 'Other',
    completado: 'Completed',
    completed: 'Completed'
  };
  return map[(t || '').toLowerCase()] || 'Step';
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
    title: `Next step with ${uni.name} — ${nextStepTypeLabel(uni.nextStep.type)}`,
    status: 'Pendiente',
    dueDate: dueDateOnly,
    notes: 'Created from University Interest',
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
    console.error('Could not synchronise the next-step task:', err);
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
    console.error('Could not complete the linked task:', err);
  }
}

function renderUniversityInterest() {
  const container = document.getElementById('university-interest-list');
  if (!container) return;

  const list = Array.isArray(userProfileData.universityInterest)
    ? userProfileData.universityInterest
    : (userProfileData.universityInterest = []);

  if (list.length === 0) {
    container.innerHTML = `<div class="alert alert-info mb-0">There are no universities that have shown interest yet.</div>`;
    return;
  }

  const fmtShort = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const f = d.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const t = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      return `${f} • ${t}`;
    } catch { return iso; }
  };

  container.innerHTML = `
    <div class="d-none d-md-flex row fw-bold text-muted small mb-2 border-bottom pb-2">
      <div class="col-md-4">University</div>
      <div class="col-md-3">Follow-up</div>
      <div class="col-md-3">Scholarship Offer</div>
      <div class="col-md-2 text-end">Actions</div>
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
      const lastType = last ? nextStepTypeLabel(last.type) : '';
      const lastText = last ? `${lastType || 'Action'}: ${last.text || ''}` : 'No notes';

      // --- próximo paso (tarea pendiente más cercana)
      const tasks = (typeof getTasksData === 'function') ? getTasksData() : [];
      const next = tasks
        .filter(t => t.universityId === uni.id && t.status !== 'Completado')
        .sort((a,b) => (a.dueDate||'').localeCompare(b.dueDate||''))[0];
      const nextHTML = next
        ? `<div class="small mt-2"><span class="badge bg-warning text-dark">Next step: ${next.title || 'Task'} • ${fmtShort(next.dueDate)}</span></div>`
        : `<div class="small mt-2 text-muted">No upcoming steps</div>`;

      // --- estado calculado
      const computed = computeUniversityStatus(uni);
      const badgeCol = badgeForComputedStatus(computed);
      const isClosed = (computed === 'Accepted' || computed === 'Rejected');

      return `
        <div class="row align-items-center border-bottom py-3">
          <!-- University: papelera + nombre + editar (compacto) -->
          <div class="col-md-4 d-flex align-items-center">
            <button class="btn btn-link p-0 me-2 text-danger delete-university-btn" data-university-id="${uni.id}" title="Delete">
              <i class="bi bi-trash3"></i>
            </button>
            <span class="fw-bold me-2 flex-grow-1">${uni.name}</span>
            <button class="btn btn-sm btn-outline-secondary edit-university-btn" data-university-id="${uni.id}" title="Rename">Edit</button>
          </div>

          <!-- Follow-up: última nota + botón historial + próximo paso (sin inputs) -->
          <div class="col-md-3">
            <div class="small text-muted">Latest note</div>
            <div class="d-flex align-items-center gap-2">
              <span class="text-truncate" style="max-width: 240px;">${lastText}</span>
              <span class="badge bg-${badgeCol} ms-auto">${computed}</span>
              <button class="btn btn-sm btn-outline-primary open-timeline-modal-btn" data-university-id="${uni.id}">Timeline</button>
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
                <button class="btn btn-sm btn-outline-primary open-scholarship-modal-btn ms-2" data-university-id="${uni.id}">View Breakdown</button>
              </div>
              ${uni.offerDetails?.documentUrl ? `<a class="small d-block mt-1" href="${uni.offerDetails.documentUrl}" target="_blank" rel="noopener">Document</a>` : ''}
            ` : `
              <p class="mb-2 text-muted small">No offer recorded</p>
              <button class="btn btn-sm btn-outline-primary open-scholarship-modal-btn" data-university-id="${uni.id}">Add offer</button>
            `}
          </div>

          <!-- Actions -->
          <div class="col-md-2 text-end">
            ${offerExists && !isClosed ? `
              <button class="btn btn-sm btn-success accept-university-btn" data-university-id="${uni.id}">Accept</button>
              <button class="btn btn-sm btn-outline-dark reject-university-btn ms-1" data-university-id="${uni.id}">Reject</button>
            ` : `
              ${computed === 'Accepted' ? '<span class="badge bg-success">Accepted</span>' : ''}
              ${computed === 'Rejected' ? '<span class="badge bg-dark">Rejected</span>' : ''}
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

  modalTitle.innerHTML = `Edit Breakdown: <span class="fw-normal">${uniData.name}</span>`;

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
            <div class="card-header fw-bold">Annual Costs (COA)</div>
            <div class="card-body" id="costs-list">
              ${(uniData.offerDetails.costs || []).map(it => row(it,'cost')).join('') || '<p class="text-muted small">No costs added.</p>'}
            </div>
            <div class="card-footer"><button class="btn btn-sm btn-outline-primary" id="add-cost-btn">+ Add Cost</button></div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header fw-bold">Scholarship Package</div>
            <div class="card-body" id="scholarships-list">
              ${(uniData.offerDetails.scholarships || []).map(it => row(it,'scholarship')).join('') || '<p class="text-muted small">No scholarships added.</p>'}
            </div>
            <div class="card-footer"><button class="btn btn-sm btn-outline-primary" id="add-scholarship-btn">+ Add Scholarship</button></div>
          </div>
        </div>
      </div>

      <div class="card mt-4">
        <div class="card-body bg-light">
          <div class="d-flex justify-content-around text-center">
            <div><h6 class="fw-normal mb-0">Total COA</h6><p class="fs-5 fw-bold mb-0" id="total-cost-display">$0.00</p></div>
            <div><h6 class="fw-normal mb-0">Total Scholarship</h6><p class="fs-5 fw-bold text-success mb-0" id="total-scholarship-display">$0.00</p></div>
            <div><h6 class="fw-normal mb-0">Net Annual Cost</h6><p class="fs-5 fw-bold text-eture-red mb-0" id="net-cost-display">$0.00</p></div>
          </div>
        </div>
      </div>

      <div class="mt-4">
        <h6 class="fw-bold">Scholarship Document (PDF/JPG/PNG)</h6>
        <div class="input-group">
          <input type="file" class="form-control" id="scholarship-file-upload" accept=".pdf,.jpg,.jpeg,.png">
          <button class="btn btn-outline-secondary" type="button" ${!uniData.offerDetails.documentUrl ? 'disabled' : ''} id="view-scholarship-doc-btn">
            View Document
          </button>
        </div>
        <div class="form-text">Upload the official offer document to keep it on file.</div>
        <div class="small mt-2" id="upload-status"></div>
      </div>
    `;

    modalFooter.innerHTML = `
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
      <button type="button" class="btn btn-primary" id="save-scholarship-changes-btn">Save Changes</button>
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
    if (!auth.currentUser) { alert('You must sign in'); return; }

    status.textContent = 'Uploading document…';

    try {
      const uploaded = await uploadUserFile(
        auth.currentUser.uid,
        file,
        { folder: `offers/${uniData.id}`,
          onProgress: (pct) => { status.textContent = `Uploading document… ${pct}%`; } }
      );
      uniData.offerDetails.documentUrl = uploaded.url || '';
      // Guardamos de inmediato y avisamos
      await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
      document.dispatchEvent(new CustomEvent('profile:changed', { detail: userProfileData }));
      status.textContent = 'Document uploaded successfully.';
      renderForm(); // refresca el botón "View Document"
    } catch (err) {
      console.error(err);
      status.textContent = 'Could not upload the document.';
      alert('Could not upload the document.');
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

  titleEl.innerHTML = `Follow-up: <span class="fw-normal">${uni.name}</span>`;

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
    try { return new Date(iso).toLocaleString('en-US'); } catch { return iso || ''; }
  };
  const nowISO = () => new Date().toISOString();
  const toISOFromLocal = (localDT) => {
    if (!localDT) return '';
    const d = new Date(localDT);
    if (isNaN(d)) return '';
    return d.toISOString();
  };

  const typePlaceholders = {
    'Llamada': 'E.g.: Call with Head Coach.',
    'Call':    'E.g.: Call with Head Coach.',
    'Email':   'E.g.: Introduction email sent.',
    'Reunión': 'E.g.: Video call with staff.',
    'Reunion': 'E.g.: Video call with staff.',
    'Meeting': 'E.g.: Video call with staff.',
    'Mensaje': 'E.g.: WhatsApp message to the assistant.',
    'Message': 'E.g.: WhatsApp message to the assistant.',
    'Otro':    'Describe the action briefly.',
    'Other':   'Describe the action briefly.'
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
    textInput.placeholder = typePlaceholders[t] || 'Describe the action briefly.';
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
            View in Tasks
          </button>` : '';
        return `
          <div class="border rounded p-2 mb-2">
            <div class="small text-muted d-flex align-items-center">
              <i class="bi ${icon} me-2"></i>
              ${fmtDateTime(item.at)} • ${item.author || ''}
              ${doneBadge}
            </div>
            <div><strong>${item.type || 'Action'}:</strong> ${item.text || ''}</div>
            ${doneLine}
            ${taskChip}
          </div>
        `;
      }).join('');

    list.innerHTML = rows || `<div class="text-muted">No notes yet.</div>`;
  }

  // === Next step (tarea pendiente más cercana) ===
  function renderNextStepSlot() {
    const tasks = (typeof getTasksData === 'function') ? getTasksData() : [];
    const pending = tasks
      .filter(t => t.status !== 'Completado' && t.universityId === uni.id)
      .sort((a,b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    if (pending.length === 0) {
      nextStepSlot.innerHTML = `<div class="text-muted">No steps planned.</div>`;
      return;
    }
    const t = pending[0];
    nextStepSlot.innerHTML = `
      <div class="d-flex align-items-center">
        <div class="me-3">
          <div class="fw-bold">${t.title || 'Next step'}</div>
          <div class="small text-muted">${fmtDateTime(t.dueDate || '')}</div>
          ${t.notes ? `<div class="small mt-1">${t.notes}</div>` : ''}
        </div>
        <div class="ms-auto d-flex gap-2">
          <button class="btn btn-sm btn-outline-secondary" id="view-next-step-btn" data-task-id="${t.id}">View in Tasks</button>
          <button class="btn btn-sm btn-success" id="mark-next-step-done-btn" data-task-id="${t.id}">Mark as done</button>
        </div>
      </div>
    `;
  }

  // === Completar tarea y volcar al historial ===
  async function markTaskDone(taskId) {
    if (!auth.currentUser) return;
    const result = prompt('Add a result/note (optional):', '');
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
        uni.timeline.unshift({
          id: 'tl_' + Date.now(),
          at: completedAt,
          author: auth.currentUser?.email || '',
          type: 'Completed',
          text: result || 'Task completed',
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
      console.error('Could not mark the task as completed:', err);
      alert('Could not complete the task.');
    }
  }

  // === Guardar acción (crea historial + tarea coherente) ===
  async function saveAction() {
    if (!auth.currentUser) { alert('You must sign in'); return; }
    const type = (typeSel.value || 'Otro').trim();
    const dtLocal = dtInput.value;
    const text = (textInput.value || '').trim();
    if (!dtLocal || text.length < 3) { return; }

    const iso = toISOFromLocal(dtLocal);
    if (!iso) { alert('Invalid date'); return; }
    const isPast = (new Date(iso).getTime() <= Date.now());

    // 1) Creamos SIEMPRE la entrada de historial (programada)
    const newTimelineItem = {
      id: 'tl_' + Date.now(),
      at: iso,
      author: auth.currentUser?.email || '',
      type: nextStepTypeLabel(type),
      text,
      done: isPast,            // si es pasado, ya la marcamos como hecha
      doneAt: isPast ? iso : '' // y fijamos la hora real (misma que la programada)
    };

    // 2) Creamos la TAREA SIEMPRE (coherente con pasado/futuro)
    let createdTaskId = null;
    try {
      const translatedType = nextStepTypeLabel(type);
      const t = {
        title: `${translatedType} with ${uni.name}`,
        notes: text,
        dueDate: iso,
        status: isPast ? 'Completado' : 'Pendiente',
        completedAt: isPast ? iso : '',  // si es pasada, ya completa
        category: 'University',
        universityId: uni.id,
        createdAt: nowISO()
      };
      const res = await addTaskSvc(auth.currentUser.uid, t);
      createdTaskId = (res && res.id) ? res.id : (typeof res === 'string' ? res : null);
      document.dispatchEvent(new Event('tasks:changed'));
    } catch (err) {
      console.error('Could not create the task:', err);
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

  // === Navegar a la pestaña de Tasks ===
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
        labels: ['Paid', 'Pending'],
        datasets: [{
          label: 'Payment Status',
          data: [4000, 6000],
          backgroundColor: ['#28a745', '#dc3545'],
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' },
          title: { display: true, text: 'Total Service Balance (€)' }
        }
      }
    });
}
// ========== Mis Documents ==========

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
    const m = {'España':'Spain','Estados Unidos':'United States','Reino Unido':'United Kingdom','Chequia':'Czech Republic'};
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
    const placeholder = `<option value="" disabled ${selected ? '' : 'selected'}>Select...</option>`;
    sel.innerHTML = placeholder + values.map(v => `<option value="${v}">${v}</option>`).join('');
  }
  sel.value = selected || '';
}
// ---- 👇 Helpers for rendering country selects with flag emoji and Spain on top

// --- Helpers for flag emoji -> ISO and display name ---
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
  return ''; // other special flags fall back to the provided name
}

function spanishNameFromCountry(c) {
  // This function now returns the display name in English, keeping the original name as fallback.
  const iso = flagEmojiToISO(c.emoji || '');
  try {
    if (iso && typeof Intl?.DisplayNames === 'function') {
      const dn = new Intl.DisplayNames(['en'], { type: 'region' });
      const name = dn.of(iso);
      if (name) return name;
    }
  } catch (_) {}

  return c.name || '';
}

// --- Country select (flag + English name, Spain first) ---
function ensureCountrySelect(selector, selectedValue = '') {
  const sel = document.querySelector(selector);
  if (!sel) return;

  const items = countries.map(c => ({
    emoji: (c.emoji || '').toString(),
    code: (c.code || '').toString(),
    label: spanishNameFromCountry(c),
    raw: c
  }));

  items.sort((a, b) => {
    const aES = a.label.toLowerCase() === 'spain' || a.code === '+34';
    const bES = b.label.toLowerCase() === 'spain' || b.code === '+34';
    if (aES && !bES) return -1;
    if (!aES && bES) return 1;
    return a.label.localeCompare(b.label, 'en', { sensitivity: 'base' });
  });

  const placeholder = `<option value="" disabled ${selectedValue ? '' : 'selected'}>Select...</option>`;
  sel.innerHTML = placeholder + items.map(c =>
    `<option value="${c.label}">${c.emoji ? c.emoji + ' ' : ''}${c.label}</option>`
  ).join('');

  const norm = (v) => {
    if (!v) return '';
    const value = v.toString().trim();
    if (value.toLowerCase() === 'españa') return 'Spain';
    return value;
  };
  sel.value = norm(selectedValue) || '';
}

// --- Phone code select (flag + English name + code, +34 first) ---
function ensurePhoneCodeSelect(selector, selectedValue = '') {
  const sel = document.querySelector(selector);
  if (!sel) return;

  const items = countries.map(c => ({
    emoji: (c.emoji || '').toString(),
    label: spanishNameFromCountry(c),
    value: (c.code || '').toString(),
  }));

  items.sort((a, b) => {
    const aES = a.value === '+34' || a.label.toLowerCase() === 'spain';
    const bES = b.value === '+34' || b.label.toLowerCase() === 'spain';
    if (aES && !bES) return -1;
    if (!aES && bES) return 1;
    return a.label.localeCompare(b.label, 'en', { sensitivity: 'base' });
  });

  const placeholder = `<option value="" disabled ${selectedValue ? '' : 'selected'}>Select...</option>`;
  sel.innerHTML = placeholder + items.map(c =>
    `<option value="${c.value}">${c.emoji ? c.emoji + ' ' : ''}${c.label} (${c.value})</option>`
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
  if (provinceLabel) provinceLabel.textContent = enable ? 'Province *' : 'Province/State *';

  // Código Postal
  const postal = document.getElementById('contact-postalCode');
  if (postal) {
    if (enable) {
      postal.setAttribute('pattern', '\\d{5}');
      postal.setAttribute('inputmode', 'numeric');
      postal.setAttribute('maxlength', '5');
      postal.placeholder = 'E.g.: 28001';
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
  if (enable && countrySel && !countrySel.value) countrySel.value = 'Spain';
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

// Returns the country name in English if an ISO code is available; otherwise uses the provided name
function spanishCountryLabel(c) {
  const iso = (c.iso2 || c.alpha2 || c.cca2 || c.code2 || '').toString().toUpperCase();
  try {
    if (iso && /^[A-Z]{2}$/.test(iso) && typeof Intl?.DisplayNames === 'function') {
      const dn = new Intl.DisplayNames(['en'], { type: 'region' });
      return dn.of(iso) || c.name;
    }
  } catch (_) {}
  // Quick fallbacks when ISO codes are missing
  const quickMap = { 'España':'Spain', 'Estados Unidos':'United States', 'Reino Unido':'United Kingdom', 'Alemania':'Germany',
                     'Francia':'France', 'Italia':'Italy', 'Portugal':'Portugal' };
  return quickMap[c.name] || c.name;
}

// Prepare countries for UI: English names + Spain first + alphabetical order
function prepareCountriesForUI(list = []) {
  const normalized = list.map(c => ({
    label: spanishCountryLabel(c),
    iso: (c.iso2 || c.alpha2 || c.cca2 || c.code2 || '').toString().toUpperCase(),
    code: c.code || '',            // prefijo telefónico
    raw: c
  }));
  // España primero; luego alfabético por label (ES)
  normalized.sort((a, b) => {
    const aES = a.iso === 'ES' || a.label === 'Spain';
    const bES = b.iso === 'ES' || b.label === 'Spain';
    if (aES && !bES) return -1;
    if (!aES && bES) return 1;
    return a.label.localeCompare(b.label, 'en', { sensitivity: 'base' });
  });
  return normalized;
}

function openSocialLinkModalForAdd() {
    const modalEl = document.getElementById('social-media-modal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    editingSocialLinkIndex = null; // Reset
    document.getElementById('social-type').value = 'Instagram'; // Reset to default
    document.getElementById('social-url').value = '';
    modalEl.querySelector('.modal-title').textContent = 'Add Social Profile';
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
        modalEl.querySelector('.modal-title').textContent = 'Edit Red Social';
        modal.show();
    }
}
function renderSocialLinks() {
    const container = document.getElementById('social-links-container');
    if (!container) return;
    const links = userProfileData.media.social || [];
    if (links.length === 0) {
        container.innerHTML = `<p class="text-muted small">No social profiles added.</p>`;
        return;
    }
    container.innerHTML = links.map((link, index) => `
        <div class="input-group mb-2">
            <span class="input-group-text" style="width: 120px;">${link.type}</span>
             <a href="${link.url}" target="_blank" rel="noopener noreferrer" class="form-control text-truncate d-flex align-items-center text-decoration-none">${link.url}</a>
            <button class="btn btn-outline-primary edit-social-link-btn" type="button" data-index="${index}">Edit</button>
            <button class="btn btn-outline-danger remove-social-link-btn" type="button" data-index="${index}">Delete</button>
        </div>
    `).join('');
}
function removeSocialLink(index) {
  if (confirm('Are you sure you want to delete this social profile?')) {
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
        const currentLabel = dataType === 'highlights' ? 'Video name' : 'Description (Opponent, jersey color, jersey number)';
        
        typeInput.value = dataType;
        nameLabel.textContent = currentLabel;
        nameInput.value = item.name;
        urlInput.value = item.url;
        modalEl.querySelector('.modal-title').textContent = 'Edit Media';
    } else { // Adding new
        typeInput.value = type;
        nameLabel.textContent = label;
        nameInput.placeholder = placeholder;
        nameInput.value = '';
        urlInput.value = '';
        modalEl.querySelector('.modal-title').textContent = 'Add Media';
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
        container.innerHTML = `<p class="text-muted small">No ${type === 'highlights' ? 'videos' : 'matches'} added.</p>`;
        return;
    }
    container.innerHTML = data.map((item, index) => `
        <div class="input-group mb-2">
            <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="form-control d-flex align-items-center text-truncate text-decoration-none" title="${item.url}">${item.name}</a>
            ${type === 'highlights' ? `<button class="btn ${item.isMain ? 'btn-success' : 'btn-outline-secondary'} set-main-highlight-btn" type="button" data-index="${index}" title="Mark as main video">★</button>` : ''}
            <button class="btn btn-outline-primary edit-multimedia-btn" type="button" data-type="${type}" data-index="${index}">Edit</button>
            <button class="btn btn-outline-danger remove-multimedia-btn" type="button" data-type="${type}" data-index="${index}">Delete</button>
        </div>
    `).join('');
}
// REEMPLAZA tu función removeMultimediaLink ANTIGUA por esta NUEVA VERSIÓN
function removeMultimediaLink(element) {
  const type = element.dataset.type;
  const index = parseInt(element.dataset.index, 10);
  const user = auth.currentUser;

  if (!user) {
    console.error("Cannot delete multimedia because no user is authenticated.");
    return;
  }

  const itemTypeForConfirmation = type === 'highlights' ? 'video' : 'match';

  if (confirm(`Are you sure you want to delete this ${itemTypeForConfirmation}?`)) {

    const removedItem = userProfileData.media[type].splice(index, 1)[0];

    if (type === 'highlights' && removedItem.isMain && userProfileData.media.highlights.length > 0) {
      userProfileData.media.highlights[0].isMain = true;
    }

    renderMultimediaLinks(type, userProfileData.media[type]);
    renderPromotionalProfile();

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
        <input type="text" class="form-control study-option-input" value="${value}" placeholder="E.g.: Business Administration">
        <button class="btn btn-outline-danger remove-study-option-btn" type="button">Delete</button>
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
            <option value="Otro" ${isOther ? 'selected' : ''}>Other</option>
        </select>
        <input type="text" class="form-control exam-name-other ${isOther ? '' : 'd-none'}" placeholder="Exam name" value="${isOther ? exam.type : ''}">
        <input type="text" class="form-control exam-score" value="${exam.score}" placeholder="Score">
        <button class="btn btn-outline-danger remove-exam-btn" type="button">Delete</button>
    `;
    container.appendChild(div);
}
function generateAcademicHistory() {
    const container = document.getElementById('academic-history-container');
    if (!container) return;
    const birthDateStr = userProfileData.personal.birthDate;
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
        
        const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        const monthOptions = months.map(m => `<option>${m}</option>`).join('');
        const cardHTML = `
          <div class="card mb-3">
              <div class="card-header fw-bold">${season}</div>
              <div class="card-body">
                  <div class="row g-3">
                      <div class="col-md-4">
                          <label class="form-label">Education level</label>
                          <select class="form-select academic-level-select">
                              <option ${!currentDefault ? 'selected' : ''} disabled>Select...</option>
                              <option ${currentDefault?.level === 'ESO' ? 'selected' : ''}>ESO</option>
                              <option ${currentDefault?.level === 'Bachillerato' ? 'selected' : ''}>Bachillerato</option>
                              <option>Intermediate Vocational</option>
                              <option>Advanced Vocational</option>
                              <option>University</option>
                              <option>Did not study/Other</option>
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
                          <input type="number" class="form-control" placeholder="Ej: 60">
                      </div>
                      
                      <div class="col-md-2 gpa-details">
                          <label class="form-label">Grade point average</label>
                          <input type="number" step="0.01" class="form-control" placeholder="Ej: 3.8">
                      </div>
                      <div class="col-md-3 file-details">
                          <label class="form-label">Attach transcripts</label>
                          <input type="file" class="form-control">
                      </div>
                  </div>
                  <div class="row g-3 mt-1">
                      <div class="col-12 other-details d-none">
                           <label class="form-label">What did you do that academic year?</label>
                           <textarea class="form-control" rows="2"></textarea>
                      </div>
                  </div>
                  <div class="graduation-wrapper mt-3">
                      <div class="form-check">
                          <input class="form-check-input graduation-check" type="checkbox" id="graduated-check-${yearEnd}">
                          <label class="form-check-label" for="graduated-check-${yearEnd}">
                              Check if you graduated this year
                          </label>
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
          </div>`;
        container.insertAdjacentHTML('beforeend', cardHTML);
        academicYearIndex++;
    }
    // After rendering, trigger change event for pre-selected dropdowns to show/hide correct fields
    container.querySelectorAll('.academic-level-select').forEach(select => {
      if (select.value && select.value !== 'Select...') {
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
        <button class="btn btn-outline-danger remove-secondary-pos-btn" type="button">Delete</button>
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
        container.innerHTML = `<div class="alert alert-warning">Enter a valid birth date in "Personal Information" to generate your team history.</div>`;
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
        container.innerHTML = `<div class="alert alert-info">Team history is generated starting at age 14.</div>`;
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
            <div class="col-md-3">Seasons</div>
            <div class="col-md-5">Club name</div>
            <div class="col-md-4">Division/Category</div>
        </div>
        ${seasons.map(({season, age}) => `
            <div class="row g-2 mb-2 align-items-center">
                <div class="col-md-3"><label class="form-label d-md-none">Season (Age)</label><input type="text" class="form-control" value="${season} (${age} years old)" readonly></div>
                <div class="col-md-5"><label class="form-label d-md-none">Club</label><input type="text" class="form-control" placeholder="Club name"></div>
                <div class="col-md-4"><label class="form-label d-md-none">Division</label><input type="text" class="form-control" placeholder="Category"></div>
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
        <label class="form-label">Matches Played</label>
        <input type="number" class="form-control" id="stat-played" value="${stats.played ?? ''}">
      </div>
      <div class="col-4">
        <label class="form-label">Goals Conceded</label>
        <input type="number" class="form-control" id="stat-goalsConceded" value="${stats.goalsConceded ?? ''}">
      </div>
      <div class="col-4">
        <label class="form-label">Saves</label>
        <input type="number" class="form-control" id="stat-saves" value="${stats.saves ?? ''}">
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="col-4">
        <label class="form-label">Matches Played</label>
        <input type="number" class="form-control" id="stat-played" value="${stats.played ?? ''}">
      </div>
      <div class="col-4">
        <label class="form-label">Goals</label>
        <input type="number" class="form-control" id="stat-goals" value="${stats.goals ?? ''}">
      </div>
      <div class="col-4">
        <label class="form-label">Assists</label>
        <input type="number" class="form-control" id="stat-assists" value="${stats.assists ?? ''}">
      </div>
    `;
  }
}

// Dashboard-style Overview (solo lectura)
function renderVisaOverview() {
  // lectura segura del estado
  const visa = (window.profileState && window.profileState.visa) || {};
  const checklist = visa.checklist || {}; // { uploaded:number, total:number }
  const submission = getVisaSubmissionState();
  const submissionMeta = resolveSubmissionStatusMeta(submission.status);
  const appointment = visa.appointment || {}; // { datetime, center }
  const approval = visa.approval || {}; // { date, scanUploaded:true/false }
  const tie = visa.tie || {}; // { date, status, cardUploaded:true/false }

  // cálculo de % por sección
  const chkTotal = Number(checklist.total || 0);
  const chkUp = Number(checklist.uploaded || 0);
  const checklistPct = chkTotal > 0 ? Math.min(100, Math.round((chkUp / chkTotal) * 100)) : 0;

  const submissionPct = submissionMeta.progress;
  const appointmentPct = appointment.datetime ? 100 : 0;
  const approvalPct = (approval.date || approval.scanUploaded) ? 100 : 0;
  let tiePct = 0;
  if (tie.cardUploaded || (tie.status && String(tie.status).toLowerCase() === 'collected')) tiePct = 100;
  else if (tie.date) tiePct = 50;

  const sectionPcts = [checklistPct, submissionPct, appointmentPct, approvalPct, tiePct];
  const overall = Math.round(sectionPcts.reduce((a, b) => a + b, 0) / sectionPcts.length);

  // paso actual
  let currentStep = 'Completed';
  if (checklistPct < 100) currentStep = 'Checklist';
  else if (submissionPct < 100) currentStep = 'Submission';
  else if (appointmentPct < 100) currentStep = 'Appointment';
  else if (approvalPct < 100) currentStep = 'Visa Approval';
  else if (tiePct < 100) currentStep = 'TIE';

  // helpers de escritura seguros (evitan el error de .value en null)
  const setText = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };
  const setBadge = (id, txt, done) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = txt;
    el.classList.remove('bg-secondary', 'bg-warning', 'bg-success');
    el.classList.add(done ? 'bg-success' : (txt ? 'bg-warning' : 'bg-secondary'));
  };

  // pintar métricas
  const bar = document.getElementById('visa-ov-progress');
  if (bar) bar.style.width = `${overall}%`;
  setText('visa-ov-progress-text', `${overall}% complete`);
  setText('visa-ov-step', currentStep);

  // estados por tarjeta
  const checklistLabel = chkTotal ? `${chkUp}/${chkTotal} docs` : 'No docs yet';
  setBadge('visa-ov-checklist-status', checklistLabel, checklistPct === 100);

  const submissionBadge = document.getElementById('visa-ov-submission-status');
  if (submissionBadge) {
    submissionBadge.textContent = submissionMeta.label;
    submissionBadge.className = submissionMeta.overviewClass;
  }

  const apptLabel = appointment.datetime ? appointment.datetime : 'Not scheduled';
  setBadge('visa-ov-appointment-status', apptLabel, appointmentPct === 100);

  const apprLabel = (approval.date || approval.scanUploaded) ? 'Uploaded' : 'Pending';
  setBadge('visa-ov-approval-status', apprLabel, approvalPct === 100);

  const tieLabel = tie.cardUploaded ? 'Card uploaded' : (tie.date || 'Not scheduled');
  setBadge('visa-ov-tie-status', tieLabel, tiePct === 100);

  // última actualización (si la lleváis en visa._updatedAt)
  const last = visa._updatedAt ? new Date(visa._updatedAt).toLocaleString() : '—';
  setText('visa-ov-last-update', `Last update — ${last}`);
}

// === MyVisa > CHECKLIST ===
const VISA_CHECKLIST_CATALOG = [
  {
    key: 'visa-form',
    legacyKeys: ['visaForm'],
    title: 'Visa Application',
    instructionsHtml: '<p>Complete and sign the National Visa Application form. Handwritten entries must be in capital letters and match your passport details.</p>'
  },
  {
    key: 'passport',
    title: 'Original Passport',
    instructionsHtml: '<p>Passport must include at least two blank pages, remain valid for the program plus three additional months, and have been issued within the last 10 years. Emergency passports are not accepted. Include a plain photocopy.</p>'
  },
  {
    key: 'id-proof',
    legacyKeys: ['idProof'],
    title: 'ID - Proof of Jurisdiction',
    instructionsHtml: '<p>Provide a notarized copy of proof of residence within the consular jurisdiction (e.g., driver’s license, state ID, voter registration, or current student ID).</p>'
  },
  {
    key: 'us-status',
    legacyKeys: ['usStatus'],
    title: 'U.S. immigration status',
    instructionsHtml: '<p>Upload a notarized copy of your lawful U.S. status (e.g., Green Card, valid U.S. visa with I-94, work permit, or parole). Not required for U.S. citizens.</p>'
  },
  {
    key: 'disclaimer',
    legacyKeys: ['disclaimer'],
    title: 'Disclaimer Form',
    instructionsHtml: '<p>Ensure the ETURE disclaimer is signed before uploading. Minors must include guardian signatures.</p>'
  },
  {
    key: 'recent-photo',
    legacyKeys: ['photo'],
    title: 'Two Recent Passport-sized photos.',
    instructionsHtml: '<p>Provide two identical, color 2&quot;x2&quot; photos taken within the last 6 months on a white background. No glasses, hats, or filters.</p>'
  },
  {
    key: 'fees',
    title: 'VISA Fee & BLS Fee',
    instructionsHtml: '<p>Upload proof of payment for the Consulate fee (usually a money order) and the BLS service fee (typically debit or cash). Verify accepted payment methods with your consulate/BLS center.</p>'
  },
  {
    key: 'medical-certificate',
    legacyKeys: ['medical'],
    title: 'Medical Certificate',
    instructionsHtml: '<p>Doctor’s certificate confirming you are free from diseases of public health concern, issued within the last 3 months on official letterhead and signed/stamped by the physician.</p>'
  },
  {
    key: 'fbi-report',
    legacyKeys: ['fbiReport'],
    title: 'FBI Check',
    instructionsHtml: '<p>Submit the FBI background check issued within 6 months of your visa appointment. State or local checks are not accepted.</p>'
  },
  {
    key: 'fbi-apostille',
    legacyKeys: ['fbiApostille'],
    title: 'Apostille of FBI',
    instructionsHtml: '<p>Provide the Hague Apostille authenticating the FBI background check. Ensure it references the same report uploaded.</p>'
  },
  {
    key: 'financial-means',
    legacyKeys: ['funds'],
    title: 'Financial Means',
    instructionsHtml: '<p>Upload a notarized support letter (e.g., from a parent/guardian) and supporting bank statements demonstrating at least USD $700 per month of financial coverage.</p>'
  },
  {
    key: 'birth-certificate',
    legacyKeys: ['birthCert'],
    title: 'Notarized copy of Birth Certificate',
    instructionsHtml: '<p>Provide the original (returned after review) and a notarized copy of your birth certificate issued within the last 12 months.</p>',
    minor: true
  },
  {
    key: 'parents-passports',
    legacyKeys: ['parentsPass'],
    title: 'Apostille of Birth Certificate',
    instructionsHtml: '<p>Upload the Hague Apostille that authenticates your birth certificate. Recommended providers include Monument Visa.</p>',
    minor: true
  },
  {
    key: 'fbi-report-translation',
    legacyKeys: ['fbiTrans'],
    title: 'Translation of FBI',
    instructionsHtml: '<p>Certified Spanish translation of the FBI background check.</p>'
  },
  {
    key: 'fbi-apostille-translation',
    legacyKeys: ['fbiApostTrans'],
    title: 'Translation of Apostille of FBI',
    instructionsHtml: '<p>Certified Spanish translation of the Hague Apostille attached to your FBI background check.</p>'
  },
  {
    key: 'parental-authorization',
    legacyKeys: ['parentAuth'],
    title: 'Translation of Birth Certificate',
    instructionsHtml: '<p>Certified Spanish translation of the birth certificate. Use approved translators or agencies experienced with consular requirements.</p>',
    minor: true
  },
  {
    key: 'sex-crimes-registry',
    legacyKeys: ['sexRegistry'],
    title: 'Translation of Apostille of Birth Certificate',
    instructionsHtml: '<p>Certified Spanish translation of the apostille issued for the birth certificate.</p>',
    minor: true
  },
  {
    key: 'financial-means-translation',
    legacyKeys: ['fundsTrans'],
    title: 'If you are under 18',
    instructionsHtml: '<p>Follow the minor checklist requirements: notarized parental authorization, sexual crimes registry form, notarized copies of guardians’ passports, and any required templates provided by ETURE.</p>',
    minor: true
  }
];

const VISA_CHECKLIST_VISUAL_STATES = {
  pending: {
    key: 'pending',
    label: 'Pending',
    icon: '',
    chipClass: 'badge rounded-pill px-3 py-2 bg-secondary text-light fw-semibold',
    listClass: 'badge rounded-pill px-3 py-2 bg-secondary text-light fw-semibold'
  },
  uploaded: {
    key: 'uploaded',
    label: 'Uploaded',
    icon: '',
    chipClass: 'badge rounded-pill px-3 py-2 bg-primary text-white fw-semibold',
    listClass: 'badge rounded-pill px-3 py-2 bg-primary text-white fw-semibold'
  },
  denied: {
    key: 'denied',
    label: 'Denied',
    icon: '',
    chipClass: 'badge rounded-pill px-3 py-2 bg-danger text-white fw-semibold',
    listClass: 'badge rounded-pill px-3 py-2 bg-danger text-white fw-semibold'
  },
  verified: {
    key: 'verified',
    label: 'Verified',
    icon: '✓',
    chipClass: 'badge rounded-pill px-3 py-2 bg-success text-white fw-semibold',
    listClass: 'badge rounded-pill px-3 py-2 bg-success text-white fw-semibold'
  }
};

let currentVisaChecklistKey = null;
let visaChecklistEventsBound = false;
let visaChecklistToastTimer = null;
let visaChecklistDenyModal = null;
let visaChecklistDenyTargetKey = null;

function normalizeChecklistStatus(value) {
  const normalized = (value || '').toString().toLowerCase();
  if (normalized === 'confirmed') return 'uploaded';
  if (normalized === 'verified') return 'verified';
  if (normalized === 'uploaded') return 'uploaded';
  if (normalized === 'denied') return 'denied';
  return 'pending';
}

function getVisaReviewerMetadata() {
  const user = auth.currentUser;
  if (user) {
    return {
      id: user.uid || user.email || 'staff',
      name: user.displayName || user.email || 'Admissions Staff'
    };
  }

  if (isDemoModeEnabled()) {
    return {
      id: 'demo-reviewer',
      name: 'Demo Reviewer'
    };
  }

  return {
    id: 'staff',
    name: 'Admissions Staff'
  };
}

function getChecklistCatalogItem(key) {
  return VISA_CHECKLIST_CATALOG.find(item => item.key === key) || null;
}

function getChecklistVisualState(item) {
  const status = normalizeChecklistStatus(item?.status);
  if (status === 'verified') return VISA_CHECKLIST_VISUAL_STATES.verified;
  if (status === 'denied') return VISA_CHECKLIST_VISUAL_STATES.denied;
  if (status === 'uploaded') return VISA_CHECKLIST_VISUAL_STATES.uploaded;
  return VISA_CHECKLIST_VISUAL_STATES.pending;
}

function applyChecklistChipForItem(item) {
  const detail = document.getElementById('visa-doc-detail');
  const chip = detail?.querySelector('.visa-doc-status');
  if (!chip) return;
  const meta = getChecklistVisualState(item);
  const iconHtml = meta.icon ? `<span aria-hidden="true" class="me-1">${meta.icon}</span>` : '';
  chip.innerHTML = `${iconHtml}${meta.label}`;
  chip.className = `visa-doc-status ${meta.chipClass}`;
  chip.dataset.state = meta.key;
}

function showVisaChecklistToast(message, type = 'success') {
  const toast = document.getElementById('visa-checklist-toast');
  if (!toast || !message) return;
  if (visaChecklistToastTimer) {
    clearTimeout(visaChecklistToastTimer);
    visaChecklistToastTimer = null;
  }

  toast.textContent = message;
  toast.className = `alert alert-${type} py-2 px-3 small`;
  toast.classList.remove('d-none');

  visaChecklistToastTimer = window.setTimeout(() => {
    toast.classList.add('d-none');
    visaChecklistToastTimer = null;
  }, 3000);
}

function formatDateForDisplay(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function cloneChecklistItem(item) {
  return item ? JSON.parse(JSON.stringify(item)) : null;
}

function restoreChecklistItem(target, source) {
  if (!target || !source) return;
  target.status = source.status;
  target.fileUrl = source.fileUrl || '';
  target.fileName = source.fileName || '';
  target.fileSize = source.fileSize ?? null;
  target.fileMime = source.fileMime || '';
  target.notes = source.notes || '';
  target.updatedAt = source.updatedAt || '';
  target.review = source.review ? { ...source.review } : null;
  target.sampleUrl = target.sampleUrl || source.sampleUrl || '';
  if (!target.review) target.review = null;
}

function isCurrentUserStaff() {
  if (isDemoModeEnabled()) return true;

  const globalFlag =
    (typeof window !== 'undefined' && (
      window.APP?.isStaff ??
      window.APP_CONFIG?.isStaff ??
      window.IS_STAFF ??
      window.IS_ADMIN
    ));

  if (typeof globalFlag === 'boolean') return globalFlag;

  const profile = userProfileData || {};
  if (profile.isStaff === true) return true;
  if (profile?.meta?.isStaff === true) return true;
  if (Array.isArray(profile?.roles) && profile.roles.includes('staff')) return true;
  if (Array.isArray(profile?.permissions) && profile.permissions.includes('staff')) return true;

  return false;
}

function syncChecklistKeyedState(cl) {
  if (!cl || !Array.isArray(cl.items)) return;
  cl.items.forEach((item) => {
    const reviewPayload = item.review && typeof item.review === 'object'
      ? {
          reviewerId: item.review.reviewerId || '',
          reviewerName: item.review.reviewerName || '',
          reviewedAt: item.review.reviewedAt || '',
          decision: item.review.decision || '',
          reason: item.review.reason || ''
        }
      : null;

    const entry = {
      status: item.status,
      fileUrl: item.fileUrl || '',
      fileName: item.fileName || '',
      fileSize: item.fileSize ?? null,
      fileMime: item.fileMime || '',
      notes: item.notes || '',
      updatedAt: item.updatedAt || '',
      review: reviewPayload
    };

    // legacy mirrors to avoid breaking older reads
    entry.file_url = entry.fileUrl;
    entry.file_name = entry.fileName;
    entry.file_size = entry.fileSize;
    entry.file_mime = entry.fileMime;
    entry.updated_at = entry.updatedAt;
    if (reviewPayload) {
      entry.reviewed_at = reviewPayload.reviewedAt;
      entry.reviewed_by = reviewPayload.reviewerId;
      entry.denial_reason = reviewPayload.decision === 'denied' ? reviewPayload.reason : '';
    } else {
      entry.reviewed_at = '';
      entry.reviewed_by = '';
      entry.denial_reason = '';
    }

    cl[item.key] = entry;
  });
}

function createEmptyChecklistProgress() {
  return {
    items: [],
    verified: 0,
    total: 0,
    uploaded: 0
  };
}

function ensureChecklistProgress(progress) {
  if (!progress || typeof progress !== 'object') {
    return createEmptyChecklistProgress();
  }

  if (!Array.isArray(progress.items)) {
    progress.items = [];
  }

  if (!Number.isFinite(progress.total)) {
    progress.total = progress.items.length;
  }

  if (!Number.isFinite(progress.uploaded)) {
    progress.uploaded = 0;
  }

  if (!Number.isFinite(progress.verified)) {
    progress.verified = progress.uploaded;
  }

  return progress;
}

function recalcVisaChecklistProgress(cl) {
  const progress = ensureChecklistProgress(cl);
  const includeMinor = getIsMinor();
  const allowedKeys = getChecklistAllowedKeys();
  const visibleItems = Array.isArray(progress.items)
    ? progress.items.filter(item => isChecklistItemVisible(item, includeMinor) && allowedKeys.includes(item.key))
    : [];
  const total = visibleItems.length;
  const verified = visibleItems.filter(item => normalizeChecklistStatus(item.status) === 'verified').length;
  progress.total = total;
  progress.uploaded = verified;
  progress.verified = verified;
  return { total, verified, percent: total > 0 ? Math.round((verified / total) * 100) : 0 };
}

function getProgressCountsForMode(mode) {
  const cl = getChecklistState();
  const includeMinor = getIsMinor();
  const allowedKeys = getChecklistDefinitionForMode(mode)
    .filter((entry) => includeMinor || entry.minor !== true)
    .map((entry) => entry.key)
    .filter((key) => key !== 'eture-docs');
  const items = Array.isArray(cl.items)
    ? cl.items
        .filter((item) => item.key !== 'eture-docs')
        .filter((item) => isChecklistItemVisible(item, includeMinor) && allowedKeys.includes(item.key))
    : [];
  const verified = items.filter(item => normalizeChecklistStatus(item.status) === 'verified').length;
  return { verified, total: items.length };
}

function getChecklistItem(key) {
  const cl = getChecklistState();
  const normalizedKey = normalizeChecklistKeyInput(key);
  return cl.items.find(item => item.key === normalizedKey) || null;
}

function renderVisaChecklistProgress(stateOverride = null) {
  const mode = typeof getSubmissionMode === 'function' ? getSubmissionMode() : 'usa';
  const definition = typeof getChecklistDefinitionForMode === 'function' ? getChecklistDefinitionForMode(mode) : [];
  const safeDefinition = Array.isArray(definition) ? definition : [];
  const state = stateOverride && typeof stateOverride === 'object' ? stateOverride : getChecklistState();
  const normalizedState = state && typeof state === 'object' ? state : { items: [] };
  const recalculated = recalcVisaChecklistProgress(normalizedState);
  const includeMinor = getIsMinor();
  const filteredKeys = safeDefinition
    .filter((item) => item && item.key)
    .filter((item) => includeMinor || item.minor !== true)
    .map((item) => normalizeChecklistKeyInput(item.key));
  const keySet = new Set(filteredKeys);
  let total = keySet.size;
  const stateItems = Array.isArray(normalizedState.items) ? normalizedState.items : [];
  let verified = stateItems
    .filter((item) => keySet.has(normalizeChecklistKeyInput(item?.key)))
    .filter((item) => normalizeChecklistStatus(item?.status) === 'verified')
    .length;

  if (total === 0) {
    total = recalculated.total;
    verified = recalculated.verified;
  } else {
    verified = Math.min(verified, total);
  }

  const percent = total > 0 ? Math.round((verified / total) * 100) : 0;

  const bar = document.getElementById('visa-checklist-progress-bar');
  if (bar) {
    bar.style.width = `${percent}%`;
    bar.setAttribute('aria-valuenow', String(percent));
  }

  const text = document.getElementById('visa-verified-progress');
  if (text) text.textContent = `${verified}/${total} verified`;

  const summaryEl = document.getElementById('visa-checklist-progress');
  if (summaryEl) summaryEl.textContent = `${verified}/${total} verified`;

  visaUiState.checklistProgress = {
    items: Array.isArray(normalizedState.items) ? normalizedState.items.slice() : [],
    verified,
    total,
    uploaded: verified,
    percent
  };

  renderSubmissionProgress({ total, verified, percent });
  renderSubmissionSpainMirror();
  renderVisaEtureDocs();
  updatePortfolioButtonState();
}

function recvVisaChecklistProgress(payload) {
  const base = payload && typeof payload === 'object' ? { ...payload } : {};
  const normalizedItems = Array.isArray(base.items) ? base.items.slice() : [];
  const progress = ensureChecklistProgress({
    ...base,
    items: normalizedItems
  });
  visaUiState.checklistProgress = progress;
  renderVisaChecklistProgress(progress);
}

if (typeof window !== 'undefined') {
  window.recvVisaChecklistProgress = recvVisaChecklistProgress;
}

async function persistEtureDocsToProfile(docs) {
  ensureVisaDefaults();
  userProfileData.visa.etureDocs = docs.map((doc) => ({
    id: doc.id,
    name: doc.name,
    status: doc.status,
    fileMeta: doc.fileMeta ? { ...doc.fileMeta } : null,
    fileUrl: doc.fileMeta?.dataUrl || doc.fileUrl || '',
    uploadedAt: doc.fileMeta?.uploadedAt || doc.uploadedAt || new Date().toISOString()
  }));

  try {
    if (auth.currentUser) {
      await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    }
  } catch (error) {
    console.error('Unable to persist ETURE documents', error);
  }
}

function downloadEtureDoc(doc) {
  if (!doc) return;
  const fileMeta = doc.fileMeta || null;
  const url = fileMeta?.dataUrl || doc.fileUrl || '';
  if (!url) {
    alert('File not available.');
    return;
  }
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.download = (fileMeta?.name || doc.name || 'document').toString();
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function handleEtureDocRemove(id) {
  const confirmed = window.confirm('Remove this ETURE document?');
  if (!confirmed) return;

  const nextState = saveMyVisaState((state) => {
    state.etureDocs = Array.isArray(state.etureDocs)
      ? state.etureDocs.filter((doc) => (doc.id || doc.key) !== id)
      : [];
    return state;
  });
  try {
    await persistEtureDocsToProfile(nextState.etureDocs || []);
  } catch (error) {
    console.error('Unable to remove ETURE document', error);
    alert('Unable to remove the document. Please try again.');
  } finally {
    const clState = getChecklistState();
    renderVisaChecklistProgress(clState);
    renderVisaChecklistList(clState);
    if (currentVisaChecklistKey) {
      renderVisaChecklistDetail(currentVisaChecklistKey);
    }
    renderVisaOverview();
  }
}

function renderVisaChecklistList(cl) {
  const container = document.getElementById('visa-checklist-list');
  if (!container) return;

  const mode = getSubmissionMode();
  const includeMinor = getIsMinor();
  const definition = getChecklistDefinitionForMode(mode);
  const itemsByKey = new Map(Array.isArray(cl.items) ? cl.items.map((item) => [item.key, item]) : []);

  const navItems = [];

  const etureDocs = getEtureDocs();
  const etureStatus = etureDocs.length ? 'uploaded' : 'pending';
  const etureMeta = getChecklistVisualState({ status: etureStatus });
  navItems.push({
    key: 'eture-docs',
    title: 'Eture Acceptance Letters',
    minorPill: '',
    meta: etureMeta
  });

  definition
    .filter((entry) => includeMinor || entry.minor !== true)
    .forEach((entry) => {
      const base = itemsByKey.get(entry.key);
      const item = base ? { ...base } : { key: entry.key, status: 'pending' };
      item.title = entry.label;
      item.minor = entry.minor === true;
      const meta = getChecklistVisualState(item);
      const minorPill = item.minor ? '<span class="badge bg-info text-dark ms-2">Minor</span>' : '';
      navItems.push({
        key: entry.key,
        title: entry.label,
        minorPill,
        meta
      });
    });

  if (!navItems.length) {
    container.innerHTML = '<div class="p-3 text-muted small">No documents configured yet.</div>';
    currentVisaChecklistKey = 'eture-docs';
    return;
  }

  if (!navItems.some(item => item.key === currentVisaChecklistKey)) {
    currentVisaChecklistKey = 'eture-docs';
  }

  container.innerHTML = navItems.map((item) => {
    const isActive = item.key === normalizeChecklistKeyInput(currentVisaChecklistKey);
    const meta = item.meta;
    const badgeClasses = `visa-doc-status ${meta.listClass || ''}`.trim();
    const domId = getChecklistDomIdForKey(item.key);
    const ariaCurrent = isActive ? 'aria-current="true"' : '';
    const ariaLabel = `${item.title} - ${meta.label || ''}`;
    const highlightClass = isActive ? ' border border-primary bg-light text-dark fw-semibold' : '';
    const iconHtml = meta.icon ? `<span aria-hidden="true" class="me-1">${meta.icon}</span>` : '';

    return `
      <button type="button" id="${domId}" class="visa-doc-row list-group-item list-group-item-action d-flex align-items-center justify-content-between gap-2 text-start${highlightClass}" data-doc-key="${item.key}" data-doc-title="${escapeHtml(item.title)}" ${ariaCurrent} aria-label="${ariaLabel}">
        <span class="me-2 flex-grow-1 text-truncate" title="${item.title.replace(/"/g, '&quot;')}">${item.title}${item.minorPill || ''}</span>
        <span class="d-flex align-items-center gap-2 flex-shrink-0">
          <span class="${badgeClasses}" data-state="${meta.key || ''}">${iconHtml}${meta.label || ''}</span>
        </span>
      </button>
    `;
  }).join('');
}

function renderVisaEtureDocs() {
  refreshEtureDocsPanel();
}

function refreshEtureDocsPanel() {
  const detail = document.getElementById('eture-docs-detail');
  const listEl = document.getElementById('eture-docs-list');
  const uploadRow = document.getElementById('eture-upload-row');
  const nameInput = document.getElementById('eture-doc-name-input');
  const fileInput = document.getElementById('eture-doc-file-input');
  const errorEl = document.getElementById('eture-doc-error');
  const lastUpdateEl = document.getElementById('eture-docs-last-update');
  if (!detail || !listEl) return;

  const docs = getEtureDocs();
  const canManage = isCurrentUserStaff() || isDemoModeEnabled();

  if (uploadRow) uploadRow.style.display = canManage ? '' : 'none';
  if (nameInput) {
    nameInput.disabled = !canManage;
    if (!canManage) nameInput.value = '';
  }
  if (fileInput) {
    fileInput.disabled = !canManage;
    if (!canManage) fileInput.value = '';
  }
  if (errorEl) errorEl.classList.add('d-none');

  if (!docs.length) {
    listEl.innerHTML = '<div class="text-muted">No ETURE documents uploaded yet.</div>';
  } else {
    listEl.innerHTML = docs.map((doc) => {
      const fileMeta = doc.fileMeta || {};
      const filename = fileMeta.name || doc.name || 'Document';
      const sizeText = formatSubmissionFileSize(fileMeta.size || 0);
      const uploadedAt = doc.uploadedAt ? formatDateForDisplay(doc.uploadedAt) : '';
      const metaParts = [];
      if (filename) metaParts.push(escapeHtml(filename));
      if (sizeText) metaParts.push(escapeHtml(sizeText));
      if (uploadedAt) metaParts.push(`Uploaded ${escapeHtml(uploadedAt)}`);
    const subtitle = metaParts.length ? metaParts.join(' • ') : '—';
    const removeBtn = canManage
      ? `<button type="button" class="btn btn-outline-danger btn-sm btn-eture-remove" data-id="${escapeHtml(doc.id)}">Remove</button>`
      : '';

    return `
        <div class="list-group-item eture-doc-row d-flex justify-content-between align-items-start gap-3" data-id="${escapeHtml(doc.id)}">
          <div>
            <div class="fw-semibold">${escapeHtml(doc.name)}</div>
            <div class="small text-muted">${subtitle}</div>
          </div>
          <div class="btn-group btn-group-sm">
            <button type="button" class="btn btn-outline-secondary btn-sm btn-eture-download" data-id="${escapeHtml(doc.id)}">Download</button>
            ${removeBtn}
          </div>
        </div>
      `;
  }).join('');
  }

  if (lastUpdateEl) {
    const latest = docs.reduce((acc, doc) => {
      if (!doc.uploadedAt) return acc;
      return !acc || doc.uploadedAt > acc ? doc.uploadedAt : acc;
    }, null);
    lastUpdateEl.textContent = latest ? (formatDateForDisplay(latest) || '—') : '—';
  }

  updatePortfolioButtonState();
}

async function handleEtureDocUpload() {
  const nameInput = document.getElementById('eture-doc-name-input');
  const fileInput = document.getElementById('eture-doc-file-input');
  const errorEl = document.getElementById('eture-doc-error');
  if (!isCurrentUserStaff() && !isDemoModeEnabled()) return;
  if (!nameInput || !fileInput) return;

  const name = nameInput.value.trim();
  const file = fileInput.files?.[0] || null;
  if (!name || !file) {
    if (errorEl) {
      errorEl.textContent = 'Please provide a document name and select a file.';
      errorEl.classList.remove('d-none');
    }
    return;
  }

  if (errorEl) errorEl.classList.add('d-none');

  try {
    const dataUrl = await readFileAsDataUrl(file);
    const fileMeta = buildFileMetaFromFile(file, dataUrl);
    if (!fileMeta) throw new Error('Invalid file');

    const id = `eture-${Date.now()}`;
    const docRecord = {
      id,
      name,
      status: 'uploaded',
      fileMeta,
      fileUrl: fileMeta.dataUrl || '',
      uploadedAt: fileMeta.uploadedAt || new Date().toISOString()
    };

    const nextState = saveMyVisaState((state) => {
      state.etureDocs = Array.isArray(state.etureDocs) ? state.etureDocs.slice() : [];
      state.etureDocs.push(docRecord);
      return state;
    });

    await persistEtureDocsToProfile(nextState.etureDocs || []);
    nameInput.value = '';
    fileInput.value = '';
    currentVisaChecklistKey = 'eture-docs';
    const clState = getChecklistState();
    renderVisaChecklistProgress(clState);
    renderVisaChecklistList(clState);
    renderVisaChecklistDetail(currentVisaChecklistKey);
    renderVisaOverview();
  } catch (error) {
    console.error('Unable to add ETURE document', error);
    if (errorEl) {
      errorEl.textContent = 'Unable to upload the document. Please try again.';
      errorEl.classList.remove('d-none');
    }
  }
}

function buildPortfolioDocuments() {
  const studentDocs = VISA_CHECKLIST_CATALOG.map((catalog) => {
    const item = getChecklistItem(catalog.key);
    const status = normalizeChecklistStatus(item?.status);
    return {
      key: catalog.key,
      title: catalog.title,
      status,
      fileUrl: (item?.fileUrl || '').toString(),
      fileMime: (item?.fileMime || '').toString(),
      fileName: (item?.fileName || '').toString(),
      category: 'Student'
    };
  });

  const etureDocs = getNormalizedEtureDocs().map((doc) => {
    const fileMeta = doc.fileMeta || null;
    const fileUrl = fileMeta?.dataUrl || doc.fileUrl || '';
    return {
      key: doc.id,
      title: doc.name,
      status: normalizeChecklistStatus(doc.status),
      fileUrl,
      fileMime: fileMeta?.type || doc.fileMime || '',
      fileName: fileMeta?.name || doc.fileName || '',
      category: 'ETURE'
    };
  });

  return {
    studentDocs,
    etureDocs,
    allDocs: [...studentDocs, ...etureDocs]
  };
}

function updatePortfolioButtonState() {
  const buttons = [
    document.getElementById('visa-portfolio-download'),
    document.getElementById('eture-docs-download-portfolio')
  ].filter(Boolean);
  if (!buttons.length) return;

  const checklist = getChecklistState();
  const { total, verified } = recalcVisaChecklistProgress(checklist);
  const ready = total > 0 && verified === total;

  buttons.forEach((button) => {
    button.disabled = !ready;
    button.setAttribute('aria-disabled', ready ? 'false' : 'true');
    button.classList.remove('btn-outline-secondary', 'btn-outline-primary', 'btn-primary');
    if (ready) {
      button.classList.add('btn-primary');
    } else {
      button.classList.add('btn-outline-secondary');
      button.textContent = 'Download Portfolio';
    }
  });

  const warningEl = document.getElementById('visa-portfolio-warning');
  if (warningEl) {
    warningEl.classList.add('d-none');
    warningEl.classList.remove('alert-danger');
    warningEl.classList.add('alert-warning');
    warningEl.textContent = '';
  }
}

function wrapTextLines(text, font, fontSize, maxWidth) {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const tentative = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(tentative, fontSize);
    if (width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = tentative;
    }
  });
  if (current) lines.push(current);
  return lines;
}

function resolveMime(mime, url) {
  if (mime) return mime;
  const lower = (url || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return mime || '';
}

function isPdfMime(mime) {
  return typeof mime === 'string' && mime.includes('pdf');
}

function isImageMime(mime) {
  return typeof mime === 'string' && mime.startsWith('image/');
}

async function fetchFileBuffer(url) {
  if (!url) return { buffer: null, mime: '' };
  if (url.startsWith('data:')) {
    const commaIndex = url.indexOf(',');
    const meta = url.substring(0, commaIndex);
    const data = url.substring(commaIndex + 1);
    const base64 = meta.includes(';base64');
    let mime = '';
    const mimeMatch = meta.match(/^data:([^;]+)/);
    if (mimeMatch) mime = mimeMatch[1];
    if (base64) {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return { buffer: bytes.buffer, mime };
    }
    const decoded = decodeURIComponent(data);
    const bytes = new TextEncoder().encode(decoded);
    return { buffer: bytes.buffer, mime };
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to fetch file (${response.status})`);
  }
  const mime = response.headers.get('content-type') || '';
  const buffer = await response.arrayBuffer();
  return { buffer, mime };
}

let pdfLibModule = null;
async function loadPdfLib() {
  if (!pdfLibModule) {
    pdfLibModule = await import('https://cdn.skypack.dev/pdf-lib@1.17.1?min');
  }
  return pdfLibModule;
}

async function generatePortfolioPdf(studentDocs, etureDocs) {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const now = new Date();
  const coverPage = pdfDoc.addPage();
  const coverWidth = coverPage.getWidth();
  const coverHeight = coverPage.getHeight();
  const margin = 72;
  coverPage.drawText('MyVisa Portfolio', {
    x: margin,
    y: coverHeight - margin,
    size: 26,
    font: fontBold
  });
  coverPage.drawText(`Generated on ${now.toLocaleString()}`, {
    x: margin,
    y: coverHeight - margin - 36,
    size: 12,
    font
  });

  const allDocs = [...studentDocs, ...etureDocs];
  let indexPage = pdfDoc.addPage();
  let cursorY = indexPage.getHeight() - margin;
  indexPage.drawText('Index', {
    x: margin,
    y: cursorY,
    size: 18,
    font: fontBold
  });
  cursorY -= 24;

  allDocs.forEach((doc, idx) => {
    const label = `${idx + 1}. [${doc.category}] ${doc.title} — ${doc.status.toUpperCase()}${doc.fileUrl ? '' : ' (missing)'}`;
    const lines = wrapTextLines(label, font, 12, indexPage.getWidth() - margin * 2);
    lines.forEach((line) => {
      if (cursorY < margin) {
        indexPage = pdfDoc.addPage();
        cursorY = indexPage.getHeight() - margin;
      }
      indexPage.drawText(line, {
        x: margin,
        y: cursorY,
        size: 12,
        font
      });
      cursorY -= 16;
    });
  });

  const addHeaderPage = (docIndex, doc) => {
    const page = pdfDoc.addPage();
    const width = page.getWidth();
    const height = page.getHeight();
    let headerY = height - margin;
    const titleLines = wrapTextLines(`${docIndex}. ${doc.title}`, fontBold, 16, width - margin * 2);
    titleLines.forEach((line) => {
      page.drawText(line, {
        x: margin,
        y: headerY,
        size: 16,
        font: fontBold
      });
      headerY -= 18;
    });
    page.drawText(`[${doc.category}] Status: ${doc.status.toUpperCase()}`, {
      x: margin,
      y: headerY - 6,
      size: 12,
      font
    });
    return page;
  };

  for (let i = 0; i < allDocs.length; i += 1) {
    const doc = allDocs[i];
    addHeaderPage(i + 1, doc);
    if (!doc.fileUrl) {
      const missingPage = pdfDoc.addPage();
      missingPage.drawText('No file uploaded for this document.', {
        x: margin,
        y: missingPage.getHeight() - margin - 36,
        size: 12,
        font
      });
      continue;
    }

    try {
      const { buffer, mime } = await fetchFileBuffer(doc.fileUrl);
      if (!buffer) continue;
      const data = new Uint8Array(buffer);
      const resolvedMime = resolveMime(doc.fileMime || mime, doc.fileUrl);
      if (isPdfMime(resolvedMime)) {
        const externalPdf = await PDFDocument.load(data);
        const copiedPages = await pdfDoc.copyPages(externalPdf, externalPdf.getPageIndices());
        copiedPages.forEach((page) => pdfDoc.addPage(page));
      } else if (isImageMime(resolvedMime)) {
        const page = pdfDoc.addPage();
        const image = resolvedMime === 'image/png'
          ? await pdfDoc.embedPng(data)
          : await pdfDoc.embedJpg(data);
        const { width, height } = page.getSize();
        const maxWidth = width - margin * 2;
        const maxHeight = height - margin * 2;
        const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        page.drawImage(image, {
          x: (width - drawWidth) / 2,
          y: (height - drawHeight) / 2,
          width: drawWidth,
          height: drawHeight
        });
      } else {
        const page = pdfDoc.addPage();
        page.drawText('Unsupported file format for this document.', {
          x: margin,
          y: page.getHeight() - margin - 36,
          size: 12,
          font
        });
      }
    } catch (error) {
      console.error('Unable to append document to portfolio', error);
      const page = pdfDoc.addPage();
      page.drawText('Unable to include this file in the portfolio.', {
        x: margin,
        y: page.getHeight() - margin - 36,
        size: 12,
        font
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `MyVisa-Portfolio-${now.toISOString().slice(0, 10)}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function handlePortfolioDownloadClick(event) {
  event.preventDefault();
  const button = event.currentTarget;
  if (!button || button.disabled) return;
  const warningEl = document.getElementById('visa-portfolio-warning');
  const liveRegion = document.getElementById('visa-portfolio-live');
  const { studentDocs, etureDocs, allDocs } = buildPortfolioDocuments();
  if (warningEl) {
    warningEl.classList.add('d-none');
    warningEl.textContent = '';
  }

  button.disabled = true;
  button.textContent = 'Preparing...';

  try {
    await generatePortfolioPdf(studentDocs, etureDocs);
    if (liveRegion) {
      liveRegion.textContent = 'Portfolio downloaded successfully.';
    }
  } catch (error) {
    console.error('Portfolio generation failed', error);
    if (warningEl) {
      warningEl.classList.remove('d-none');
      warningEl.classList.remove('alert-warning');
      warningEl.classList.add('alert-danger');
      warningEl.textContent = 'Unable to generate portfolio. Please try again.';
    } else {
      alert('Unable to generate portfolio. Please try again.');
    }
  } finally {
    button.disabled = false;
    button.textContent = 'Download Portfolio';
    updatePortfolioButtonState();
  }
}

function updateVisaDemoModeNote() {
  const note = document.getElementById('visa-demo-mode-note');
  if (!note) return;
  note.classList.toggle('d-none', !isDemoModeEnabled());
}

function getVisibleChecklistItems() {
  const cl = getChecklistState();
  const includeMinor = getIsMinor();
  const mode = getSubmissionMode();
  const definition = getChecklistDefinitionForMode(mode);
  const itemsByKey = new Map(cl.items.map((item) => [item.key, item]));

  const items = definition
    .filter((entry) => includeMinor || entry.minor !== true)
    .map((entry) => {
      const item = itemsByKey.get(entry.key);
      if (!item) {
        return {
          key: entry.key,
          title: entry.label,
          status: 'pending',
          minor: entry.minor === true
        };
      }
      return item;
    });

  const etureEntry = {
    key: 'eture-docs',
    title: 'Eture Acceptance Letters',
    status: getEtureDocs().length ? 'uploaded' : 'pending',
    minor: false
  };

  return [etureEntry, ...items];
}

function getChecklistNavigationItems() {
  const mode = getSubmissionMode();
  const includeMinor = getIsMinor();
  const items = getChecklistDefinitionForMode(mode)
    .filter((entry) => includeMinor || entry.minor !== true)
    .map((entry) => ({ key: entry.key, title: entry.label }));
  return [{ key: 'eture-docs', title: 'Eture Acceptance Letters' }, ...items];
}

function renderVisaChecklistDetail(key) {
  let normalizedKey = normalizeChecklistKeyInput(key);
  const mode = getSubmissionMode();
  const allowedKeys = getChecklistAllowedKeys(mode);
  const includeMinor = getIsMinor();
  let item = null;
  if (normalizedKey && normalizedKey !== 'eture-docs') {
    if (allowedKeys.includes(normalizedKey)) {
      const candidate = getChecklistItem(normalizedKey);
      if (candidate && isChecklistItemVisible(candidate, includeMinor)) {
        item = candidate;
      }
    }
  }

  const visibleItems = getVisibleChecklistItems();
  if (!item && normalizedKey !== 'eture-docs') {
    const fallback = visibleItems.find((entry) => entry.key !== 'eture-docs');
    if (fallback) {
      normalizedKey = fallback.key;
      item = getChecklistItem(fallback.key) || fallback;
    } else {
      normalizedKey = 'eture-docs';
    }
  }

  if (!normalizedKey) {
    normalizedKey = 'eture-docs';
  }

  const isEture = normalizedKey === 'eture-docs';
  currentVisaChecklistKey = isEture
    ? 'eture-docs'
    : (item ? normalizeChecklistKeyInput(item.key) : 'eture-docs');

  if (!isEture && (!item || item.key !== currentVisaChecklistKey)) {
    item = getChecklistItem(currentVisaChecklistKey) || item;
  }
  let helpTitle = '';
  updateVisaDemoModeNote();
  const titleEl = document.getElementById('visa-doc-title');
  const instructionsEl = document.getElementById('doc-instructions');
  const instructionsMoreBtn = document.getElementById('doc-instructions-more-btn');
  const sampleBtn = document.getElementById('doc-sample-btn');
  const fileInput = document.getElementById('doc-file-input');
  const replaceBtn = document.getElementById('doc-replace-btn');
  const viewBtn = document.getElementById('doc-view-btn');
  const notesEl = document.getElementById('doc-notes');
  const progressEl = document.getElementById('doc-upload-progress');
  const updatedEl = document.getElementById('visa-checklist-updated');
  const prevBtn = document.getElementById('doc-prev-btn');
  const nextBtn = document.getElementById('doc-next-btn');
  const verifiedMessageEl = document.getElementById('doc-verified-message');
  const denialAlert = document.getElementById('doc-denial-alert');
  const denialReasonEl = document.getElementById('doc-denial-reason');
  const staffActions = document.getElementById('visa-doc-review-actions');
  const verifyBtn = document.getElementById('btn-verify');
  const denyBtn = document.getElementById('btn-deny');

  if (!titleEl || !instructionsEl || !sampleBtn || !fileInput || !viewBtn || !notesEl || !prevBtn || !nextBtn) {
    return;
  }
  const headerSection = document.getElementById('visa-doc-header');
  const etureDetail = document.getElementById('eture-docs-detail');
  const standardSections = [
    document.getElementById('doc-instructions-wrapper'),
    document.getElementById('visa-doc-upload'),
    verifiedMessageEl,
    denialAlert,
    staffActions,
    notesEl,
    progressEl
  ].filter(Boolean);

  if (isEture) {
    const etureDocs = getEtureDocs();
    applyChecklistChipForItem({ status: etureDocs.length ? 'uploaded' : 'pending' });
    headerSection?.classList.add('d-none');
    standardSections.forEach((section) => section.classList.add('d-none'));
    if (instructionsMoreBtn) {
      instructionsMoreBtn.disabled = true;
      instructionsMoreBtn.removeAttribute('data-doc-key');
      instructionsMoreBtn.setAttribute('aria-label', 'View more instructions');
    }
    if (sampleBtn) {
      sampleBtn.disabled = true;
      sampleBtn.dataset.sampleUrl = '';
      sampleBtn.setAttribute('aria-label', 'View sample document');
    }
    if (fileInput) {
      fileInput.value = '';
      fileInput.disabled = true;
      fileInput.classList.add('visually-hidden');
    }
    if (replaceBtn) {
      replaceBtn.classList.add('d-none');
      replaceBtn.disabled = true;
    }
    if (viewBtn) {
      viewBtn.classList.add('d-none');
      viewBtn.disabled = true;
    }
    if (notesEl) {
      notesEl.value = '';
      notesEl.disabled = true;
    }
    if (verifiedMessageEl) {
      verifiedMessageEl.classList.add('d-none');
      verifiedMessageEl.textContent = '';
    }
    if (denialAlert) {
      denialAlert.classList.add('d-none');
    }
    if (staffActions) {
      staffActions.classList.add('d-none');
    }
    if (progressEl) {
      progressEl.classList.add('d-none');
      progressEl.textContent = '';
    }
    if (titleEl) {
      titleEl.textContent = 'Eture Acceptance Letters';
      titleEl.setAttribute('tabindex', '-1');
    }
    if (etureDetail) {
      etureDetail.style.display = '';
      renderVisaEtureDocs();
    }
    helpTitle = 'Eture Acceptance Letters';
  } else {
    headerSection?.classList.remove('d-none');
    standardSections.forEach((section) => section.classList.remove('d-none'));
    if (progressEl) progressEl.classList.remove('d-none');
    if (etureDetail) {
      etureDetail.style.display = 'none';
    }

    const catalog = item ? getChecklistCatalogItem(item.key) : null;
    const definitionEntry = normalizedKey
      ? getChecklistDefinitionForMode(mode).find((entry) => entry.key === normalizedKey)
      : null;
    const rawTitleCandidate = definitionEntry?.label || item?.title || catalog?.title || 'Select a document';
    const primaryHelpKey = resolveHelpKey(rawTitleCandidate);
    let helpEntry = primaryHelpKey ? HELP_MAP[primaryHelpKey] : null;
    if (!helpEntry && catalog?.title && catalog.title !== rawTitleCandidate) {
      const catalogHelpKey = resolveHelpKey(catalog.title);
      helpEntry = catalogHelpKey ? HELP_MAP[catalogHelpKey] : null;
    }
    const displayTitle = helpEntry?.title || rawTitleCandidate;
    const isMinorEntry = definitionEntry?.minor === true || item?.minor === true;
    const helpHtml = helpEntry?.fullHtml || helpEntry?.html || catalog?.instructionsHtml || '<p>No instructions available yet.</p>';

    if (item) {
      const minorPill = isMinorEntry ? ' <span class="badge bg-info text-dark ms-2">Minor</span>' : '';
      titleEl.innerHTML = `${displayTitle}${minorPill}`;
      instructionsEl.innerHTML = helpHtml;
      titleEl.setAttribute('tabindex', '-1');
    } else {
      titleEl.innerHTML = displayTitle;
      instructionsEl.innerHTML = '<p>Select a document on the left to view instructions.</p>';
      titleEl.removeAttribute('tabindex');
    }

    if (instructionsMoreBtn) {
      const moreUrl = helpEntry?.moreUrl || '';
      const hasInlineHelp = Boolean(helpEntry?.fullHtml || helpEntry?.html);
      const enableMore = Boolean(item && (moreUrl || hasInlineHelp));
      if ('disabled' in instructionsMoreBtn) {
        instructionsMoreBtn.disabled = !enableMore;
      }
      instructionsMoreBtn.classList.toggle('disabled', !enableMore);
      if (enableMore && normalizedKey) {
        instructionsMoreBtn.dataset.docKey = normalizedKey;
        instructionsMoreBtn.setAttribute('aria-label', `View more instructions for ${displayTitle}`);
      } else {
        instructionsMoreBtn.removeAttribute('data-doc-key');
        instructionsMoreBtn.setAttribute('aria-label', 'View more instructions');
      }
      if (moreUrl) {
        instructionsMoreBtn.removeAttribute('aria-disabled');
        instructionsMoreBtn.dataset.helpUrl = moreUrl;
      } else {
        if (instructionsMoreBtn.dataset) {
          delete instructionsMoreBtn.dataset.helpUrl;
        }
        instructionsMoreBtn.removeAttribute('data-help-url');
        if (enableMore) {
          instructionsMoreBtn.removeAttribute('aria-disabled');
        } else {
          instructionsMoreBtn.setAttribute('aria-disabled', 'true');
        }
      }
    }

    applyChecklistChipForItem(item);

    const sampleUrl = helpEntry?.sampleUrl || catalog?.sampleUrl || '';
    sampleBtn.disabled = !sampleUrl;
    if (sampleUrl) {
      sampleBtn.dataset.sampleUrl = sampleUrl;
    } else if (sampleBtn.dataset) {
      delete sampleBtn.dataset.sampleUrl;
      sampleBtn.removeAttribute('data-sample-url');
    }
    sampleBtn.setAttribute('aria-label', item ? `View sample document for ${displayTitle}` : 'View sample document');

    const status = normalizeChecklistStatus(item?.status);
    const review = item?.review || null;

    const hasFile = Boolean(item?.fileUrl);
    if (hasFile) {
      fileInput.classList.add('visually-hidden');
      replaceBtn.classList.remove('d-none');
      replaceBtn.disabled = false;
    } else {
      fileInput.classList.remove('visually-hidden');
      replaceBtn.classList.add('d-none');
      replaceBtn.disabled = true;
    }

    fileInput.disabled = !item;
    fileInput.value = '';
    fileInput.setAttribute('aria-label', item ? `Upload file for ${displayTitle}` : 'Upload file');
    fileInput.setAttribute('title', 'Upload PDF, JPG or PNG');

    replaceBtn.setAttribute('aria-label', item ? `Replace uploaded file for ${displayTitle}` : 'Replace uploaded file');
    replaceBtn.title = item?.fileName ? `Replace ${item.fileName}` : 'Replace uploaded file';
    replaceBtn.onclick = () => fileInput.click();

    viewBtn.disabled = !hasFile;
    viewBtn.classList.toggle('d-none', !hasFile);
    viewBtn.dataset.fileUrl = hasFile ? item.fileUrl : '';
    viewBtn.setAttribute('aria-label', item ? `View uploaded file for ${displayTitle}` : 'View uploaded file');
    viewBtn.title = item?.fileName || 'Open uploaded file';

    if (notesEl) {
      notesEl.disabled = !item;
      notesEl.value = item?.notes || '';
      notesEl.setAttribute('aria-label', item ? `Notes for ${displayTitle}` : 'Notes');
    }

    if (verifiedMessageEl) {
      if (status === 'verified' && review?.reviewedAt) {
        const formatted = formatDateForDisplay(review.reviewedAt);
        verifiedMessageEl.textContent = formatted
          ? `Verified by admissions on ${formatted}.`
          : 'Verified by admissions.';
        verifiedMessageEl.classList.remove('d-none');
      } else if (status === 'verified') {
        verifiedMessageEl.textContent = 'Verified by admissions.';
        verifiedMessageEl.classList.remove('d-none');
      } else {
        verifiedMessageEl.textContent = '';
        verifiedMessageEl.classList.add('d-none');
      }
    }

    if (denialAlert && denialReasonEl) {
      if (status === 'denied') {
        const reason = (review?.reason || '').trim() || 'No reason provided.';
        denialAlert.classList.remove('d-none');
        denialReasonEl.textContent = `File denied: ${reason}. Please upload a new file to re-submit for review.`;
      } else {
        denialAlert.classList.add('d-none');
        denialReasonEl.textContent = '';
      }
    }

    const canReview = isCurrentUserStaff();
    const shouldShowReviewActions = canReview && item && hasFile;
    if (staffActions) {
      staffActions.classList.toggle('d-none', !shouldShowReviewActions);
    }

    if (verifyBtn) {
      const canVerify = canReview && item && hasFile && status === 'uploaded';
      verifyBtn.disabled = !canVerify;
      const verifyTitle = canVerify
        ? 'Mark as verified'
        : status === 'denied'
          ? 'Upload a new file to reset the review'
          : 'Available when a file is uploaded and pending review';
      verifyBtn.title = verifyTitle;
      verifyBtn.setAttribute('aria-label', item ? `Verify document ${displayTitle}` : 'Verify document');
    }

    if (denyBtn) {
      const canDeny = canReview && item && hasFile && (status === 'uploaded' || status === 'verified');
      denyBtn.disabled = !canDeny;
      const denyTitle = canDeny
        ? 'Mark as denied'
        : hasFile
          ? 'Upload a new file to restart the review'
          : 'Upload a file to manage review decisions';
      denyBtn.title = denyTitle;
      denyBtn.setAttribute('aria-label', item ? `Deny document ${displayTitle}` : 'Deny document');
    }

    if (progressEl) {
      if (!item) {
        progressEl.textContent = '';
      } else if (!hasFile) {
        progressEl.textContent = 'No file uploaded yet.';
      } else if (status === 'verified') {
        progressEl.textContent = 'Verified by staff.';
      } else if (status === 'denied') {
        progressEl.textContent = 'Denied – upload a new file to re-submit for review.';
      } else {
        progressEl.textContent = 'File uploaded. Awaiting review.';
      }
      if (status === 'verified') {
        progressEl.textContent += ' Replacing will send this item back to "Uploaded" for re-review.';
      }
    }
    helpTitle = item ? displayTitle : '';
  }

  setChecklistHelpForTitle(helpTitle);

  const cl = getChecklistState();
  if (updatedEl) {
    const timestamp = cl?._updatedAt;
    updatedEl.textContent = `Last update — ${timestamp ? new Date(timestamp).toLocaleString() : '—'}`;
  }

  const navItems = getChecklistNavigationItems();
  const currentIndex = navItems.findIndex(entry => entry.key === currentVisaChecklistKey);
  const prevKey = navItems[currentIndex - 1]?.key;
  const nextKey = navItems[currentIndex + 1]?.key;
  prevBtn.disabled = !prevKey;
  nextBtn.disabled = !nextKey;
  prevBtn.setAttribute('aria-label', 'Go to previous document');
  nextBtn.setAttribute('aria-label', 'Go to next document');

  prevBtn.onclick = () => {
    if (prevKey) renderVisaChecklistDetail(prevKey);
  };
  nextBtn.onclick = () => {
    if (nextKey) renderVisaChecklistDetail(nextKey);
  };

  const detailCard = document.getElementById('visa-doc-detail');
  const detailBody = detailCard?.querySelector('.card-body');
  if (detailBody && typeof detailBody.scrollTo === 'function') {
    detailBody.scrollTo({ top: 0, behavior: 'auto' });
  } else if (detailBody) {
    detailBody.scrollTop = 0;
  }
  if (detailCard && typeof detailCard.scrollIntoView === 'function') {
    detailCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  if (!isEture && item) {
    setTimeout(() => {
      if (typeof titleEl.focus === 'function') {
        try {
          titleEl.focus({ preventScroll: true });
        } catch (e) {
          titleEl.focus();
        }
      }
      if (typeof titleEl.scrollIntoView === 'function') {
        titleEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
  } else if (isEture) {
    setTimeout(() => {
      const uploadRow = document.getElementById('eture-upload-row');
      const nameInput = document.getElementById('eture-doc-name-input');
      if (uploadRow && uploadRow.style.display !== 'none' && nameInput && typeof nameInput.focus === 'function') {
        try {
          nameInput.focus({ preventScroll: true });
        } catch (error) {
          nameInput.focus();
        }
      }
    }, 50);
  }
}

function openVisaDocInstructionsModal(docKey) {
  const normalizedKey = normalizeChecklistKeyInput(docKey);
  if (!normalizedKey) return;
  const item = getChecklistItem(normalizedKey) || getChecklistCatalogItem(normalizedKey);
  const modalEl = document.getElementById('visa-doc-instructions-modal');
  if (!modalEl) return;
  const titleEl = document.getElementById('visa-doc-instructions-modal-title');
  const bodyEl = document.getElementById('visa-doc-instructions-modal-body');
  const catalog = getChecklistCatalogItem(normalizedKey);
  const rawTitle = catalog?.title || item?.title || '';
  const helpKey = resolveHelpKey(rawTitle);
  let helpEntry = helpKey ? HELP_MAP[helpKey] : null;
  if (!helpEntry && item?.title && item.title !== rawTitle) {
    const itemHelpKey = resolveHelpKey(item.title);
    helpEntry = itemHelpKey ? HELP_MAP[itemHelpKey] : null;
  }
  const instructionsHtml = helpEntry?.fullHtml || helpEntry?.html || catalog?.instructionsHtml || item?.instructionsHtml || '';
  if (!instructionsHtml) return;

  if (titleEl) {
    titleEl.textContent = helpEntry?.title || rawTitle || 'Document instructions';
  }
  if (bodyEl) {
    bodyEl.innerHTML = instructionsHtml;
  }

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

function announceVisaChecklistStatus(message) {
  const region = document.getElementById('visa-checklist-live-region');
  if (!region) return;
  region.textContent = '';
  if (message) {
    window.setTimeout(() => { region.textContent = message; }, 50);
  }
}

async function persistVisaChecklistChange({ announceMsg, toastMsg, toastType = 'success' } = {}) {
  const cl = getChecklistState();
  const timestamp = new Date().toISOString();
  cl._updatedAt = timestamp;
  syncChecklistKeyedState(cl);
  renderVisaChecklistProgress(cl);

  try {
    const user = auth.currentUser;
    if (user) await saveProfileToFirestore(user.uid, userProfileData);

    document.dispatchEvent(new CustomEvent('profile:changed', { detail: userProfileData }));
    renderVisaOverview();
    if (announceMsg) announceVisaChecklistStatus(announceMsg);
    if (toastMsg) showVisaChecklistToast(toastMsg, toastType);

    const updatedEl = document.getElementById('visa-checklist-updated');
    if (updatedEl) {
      updatedEl.textContent = `Last update — ${new Date(cl._updatedAt).toLocaleString()}`;
    }
  } catch (error) {
    console.error('Failed to persist checklist changes', error);
    throw error;
  }
}

function initVisaChecklistUI() {
  const tab = document.getElementById('visa-checklist');
  if (!tab) return;

  const cl = getChecklistState();
  const validKeys = new Set(['eture-docs', ...cl.items.map((item) => item.key)]);
  if (!currentVisaChecklistKey || !validKeys.has(currentVisaChecklistKey)) {
    currentVisaChecklistKey = 'eture-docs';
  }

  renderVisaChecklistProgress(cl);
  renderVisaChecklistList(cl);
  renderVisaChecklistDetail(currentVisaChecklistKey);

  const minorToggle = tab.querySelector('#visa-checklist-minor-toggle');
  if (minorToggle) {
    minorToggle.checked = getIsMinor();
  }

  if (visaChecklistEventsBound) return;

  tab.querySelector('#visa-checklist-list')?.addEventListener('click', handleVisaChecklistListClick);
  const etureUploadBtn = document.getElementById('eture-doc-upload-btn');
  if (etureUploadBtn && etureUploadBtn.dataset.bound !== '1') {
    etureUploadBtn.dataset.bound = '1';
    etureUploadBtn.addEventListener('click', handleEtureDocUpload);
  }
  const etureList = document.getElementById('eture-docs-list');
  if (etureList && etureList.dataset.bound !== '1') {
    etureList.dataset.bound = '1';
    etureList.addEventListener('click', handleEtureDocListClick);
  }
  tab.querySelector('#visa-portfolio-download')?.addEventListener('click', handlePortfolioDownloadClick);
  const eturePortfolioBtn = document.getElementById('eture-docs-download-portfolio');
  if (eturePortfolioBtn && eturePortfolioBtn.dataset.bound !== '1') {
    eturePortfolioBtn.dataset.bound = '1';
    eturePortfolioBtn.addEventListener('click', handlePortfolioDownloadClick);
  }
  tab.querySelector('#doc-file-input')?.addEventListener('change', handleVisaDocFileChange);
  tab.querySelector('#doc-view-btn')?.addEventListener('click', handleVisaDocViewClick);
  tab.querySelector('#doc-instructions-more-btn')?.addEventListener('click', handleVisaDocInstructionsMoreClick);
  tab.querySelector('#doc-sample-btn')?.addEventListener('click', handleVisaDocSampleClick);
  tab.querySelector('#doc-notes')?.addEventListener('blur', handleVisaDocNotesChange);
  tab.querySelector('#doc-prev-btn')?.addEventListener('click', () => navigateChecklist(-1));
  tab.querySelector('#doc-next-btn')?.addEventListener('click', () => navigateChecklist(1));

  tab.querySelector('#btn-verify')?.addEventListener('click', handleVisaDocVerifyClick);
  tab.querySelector('#btn-deny')?.addEventListener('click', openVisaDocDenyModal);

  const denyModalEl = document.getElementById('denyModal');
  if (denyModalEl && !denyModalEl.dataset.bound) {
    denyModalEl.dataset.bound = '1';
    denyModalEl.addEventListener('hidden.bs.modal', () => {
      const reasonField = document.getElementById('denyReason');
      if (reasonField) {
        reasonField.value = '';
        reasonField.classList.remove('is-invalid');
      }
      visaChecklistDenyTargetKey = null;
    });
  }

  const denySubmitBtn = document.getElementById('denySubmit');
  if (denySubmitBtn && denySubmitBtn.dataset.bound !== '1') {
    denySubmitBtn.dataset.bound = '1';
    denySubmitBtn.addEventListener('click', handleVisaDocDenySubmit);
  }

  if (minorToggle && minorToggle.dataset.bound !== '1') {
    minorToggle.dataset.bound = '1';
    minorToggle.addEventListener('change', handleChecklistMinorToggle);
  }

  const toggleBtn = tab.querySelector('#visa-checklist-toggle');
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', 'true');
    toggleBtn.addEventListener('click', () => {
      const list = document.getElementById('visa-checklist-list');
      if (!list) return;
      list.classList.toggle('d-none');
      const expanded = list.classList.contains('d-none') ? 'false' : 'true';
      toggleBtn.setAttribute('aria-expanded', expanded);
    });
  }

  visaChecklistEventsBound = true;
}

function handleVisaChecklistListClick(event) {
  const trigger = event.target.closest('[data-doc-key]');
  if (!trigger) return;
  const key = normalizeChecklistKeyInput(trigger.getAttribute('data-doc-key'));
  if (!key || key === currentVisaChecklistKey) return;

  currentVisaChecklistKey = key;
  const cl = getChecklistState();
  renderVisaChecklistList(cl);
  renderVisaChecklistDetail(key);
}

function navigateChecklist(direction) {
  const items = getVisibleChecklistItems();
  if (!items.length) return;
  const currentIndex = items.findIndex(item => item.key === currentVisaChecklistKey);
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return;
  currentVisaChecklistKey = items[nextIndex].key;
  renderVisaChecklistList(getChecklistState());
  renderVisaChecklistDetail(currentVisaChecklistKey);
}

// --- Checklist help integration ---
function getChecklistDomRefs() {
  const pane = document.getElementById('visa-checklist');
  if (!pane) return {};

  let helpBox = pane.querySelector('#doc-instructions') || pane.querySelector('#visa-docs-help');
  if (!helpBox) {
    const wrapper = pane.querySelector('#doc-instructions-wrapper');
    helpBox = document.createElement('div');
    helpBox.id = 'visa-docs-help';
    helpBox.className = 'small text-muted';
    if (wrapper) {
      wrapper.insertBefore(helpBox, wrapper.firstChild || null);
    } else {
      pane.appendChild(helpBox);
    }
  }

  const btnMore = pane.querySelector('#doc-instructions-more-btn') || pane.querySelector('#visa-docs-viewmore');
  const btnSample = pane.querySelector('#doc-sample-btn') || pane.querySelector('#visa-docs-sample');

  return { pane, helpBox, btnMore, btnSample };
}

function extractChecklistItemTitle(node) {
  if (!node) return '';
  const attrTitle = node.getAttribute('data-doc-title') || node.getAttribute('data-title');
  if (attrTitle) return attrTitle.trim();

  const titleCandidate = node.querySelector('.flex-grow-1, h6, .title, .label');
  if (titleCandidate) {
    return (titleCandidate.textContent || '').replace(/\s+/g, ' ').trim();
  }

  const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
  return text;
}

function setChecklistHelpForTitle(rawTitle) {
  const { helpBox, btnMore, btnSample } = getChecklistDomRefs();
  if (!helpBox) return;

  const key = resolveHelpKey(rawTitle || '');
  const help = key ? HELP_MAP[key] : undefined;
  const defaultHtml = `<div class="text-muted">Select a document on the left to view instructions.</div>`;

  const contentHtml = help?.fullHtml || help?.html || '';

  if (contentHtml) {
    helpBox.classList.remove('text-muted');
    const titleHtml = help.title ? `<h6 class="fw-semibold mb-2 mb-md-3">${help.title}</h6>` : '';
    helpBox.innerHTML = `${titleHtml}${contentHtml}`;
  } else {
    helpBox.classList.add('text-muted');
    helpBox.innerHTML = defaultHtml;
  }

  if (btnMore) {
    const isAnchor = btnMore.tagName === 'A';
    const moreUrl = help?.moreUrl || '';
    const hasInlineHelp = Boolean(contentHtml);
    const enableBtn = Boolean(moreUrl || hasInlineHelp);
    if ('disabled' in btnMore) {
      btnMore.disabled = !enableBtn;
    }
    btnMore.classList.toggle('disabled', !enableBtn);
    if (moreUrl) {
      btnMore.removeAttribute('aria-disabled');
      if (isAnchor) {
        btnMore.href = moreUrl;
        btnMore.target = '_blank';
        btnMore.rel = 'noopener';
      } else {
        btnMore.dataset.helpUrl = moreUrl;
      }
    } else {
      if (enableBtn) {
        btnMore.removeAttribute('aria-disabled');
      } else {
        btnMore.setAttribute('aria-disabled', 'true');
      }
      if (isAnchor) {
        btnMore.removeAttribute('href');
        btnMore.removeAttribute('target');
        btnMore.removeAttribute('rel');
      } else if (btnMore.dataset) {
        delete btnMore.dataset.helpUrl;
      }
      btnMore.removeAttribute('data-help-url');
    }
  }

  if (btnSample) {
    const isAnchor = btnSample.tagName === 'A';
    const sampleUrl = help?.sampleUrl || '';
    if ('disabled' in btnSample) {
      btnSample.disabled = !sampleUrl;
    }
    btnSample.classList.toggle('disabled', !sampleUrl);
    if (sampleUrl) {
      btnSample.removeAttribute('aria-disabled');
      if (isAnchor) {
        btnSample.href = sampleUrl;
        btnSample.target = '_blank';
        btnSample.rel = 'noopener';
      } else {
        btnSample.dataset.sampleUrl = sampleUrl;
      }
    } else {
      btnSample.setAttribute('aria-disabled', 'true');
      if (isAnchor) {
        btnSample.removeAttribute('href');
        btnSample.removeAttribute('target');
        btnSample.removeAttribute('rel');
      } else if (btnSample.dataset) {
        delete btnSample.dataset.sampleUrl;
      }
      btnSample.removeAttribute('data-sample-url');
    }
  }
}

document.addEventListener('click', (event) => {
  const item = event.target.closest('#visa-checklist-list [data-doc-title]');
  if (!item) return;
  const title = extractChecklistItemTitle(item);
  setChecklistHelpForTitle(title);
});

window.addEventListener('app:state-updated', () => {
  const current = document.querySelector('#visa-checklist-list [aria-current="true"], #visa-checklist-list .active');
  const title = extractChecklistItemTitle(current);
  setChecklistHelpForTitle(title);
});

document.addEventListener('DOMContentLoaded', () => {
  setChecklistHelpForTitle('');
}, { once: true });

async function handleVisaDocFileChange(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  const key = currentVisaChecklistKey;
  const item = key ? getChecklistItem(key) : null;
  if (!item) return;

  const previousStatus = normalizeChecklistStatus(item.status);
  const hadFile = Boolean(item.fileUrl);
  if (previousStatus === 'verified') {
    const proceed = window.confirm('Replacing will send this item back to "Uploaded" for re-review. Continue?');
    if (!proceed) {
      input.value = '';
      return;
    }
  }

  if (!auth.currentUser) {
    alert('You need to be signed in to upload files.');
    input.value = '';
    return;
  }

  const progressEl = document.getElementById('doc-upload-progress');
  const snapshot = cloneChecklistItem(item);

  try {
    input.disabled = true;
    if (progressEl) progressEl.textContent = 'Uploading … 0%';

    const uploaded = await uploadUserFile(auth.currentUser.uid, file, {
      folder: `visa/checklist/${key}/${Date.now()}_${encodeURIComponent(file.name)}`,
      onProgress: (pct) => {
        const percent = Math.round(Number(pct) || 0);
        if (progressEl) progressEl.textContent = `Uploading … ${percent}%`;
      }
    });

    item.fileUrl = uploaded.url || '';
    item.fileName = file.name;
    item.fileSize = typeof file.size === 'number' ? file.size : null;
    item.fileMime = file.type || '';
    item.status = 'uploaded';
    item.review = null;
    item.updatedAt = new Date().toISOString();

    await persistVisaChecklistChange({ announceMsg: 'File uploaded', toastMsg: 'File uploaded successfully.' });

    input.value = '';
    input.disabled = false;
    if (progressEl) progressEl.textContent = 'File uploaded. Awaiting review.';

    const cl = getChecklistState();
    renderVisaChecklistList(cl);
    renderVisaChecklistDetail(key);
    document.getElementById('doc-view-btn')?.focus();
  } catch (error) {
    console.error('Error uploading checklist document', error);
    restoreChecklistItem(item, snapshot);
    input.disabled = false;
    input.value = '';
    if (progressEl) progressEl.textContent = 'Something went wrong. Please try again.';
    announceVisaChecklistStatus('Upload failed');
    showVisaChecklistToast('Something went wrong. Please try again.', 'danger');
    const cl = getChecklistState();
    renderVisaChecklistList(cl);
    renderVisaChecklistDetail(currentVisaChecklistKey);
  }
}

async function handleVisaDocVerifyClick() {
  if (!isCurrentUserStaff()) return;
  const key = currentVisaChecklistKey;
  const item = key ? getChecklistItem(key) : null;
  if (!item || !item.fileUrl) return;

  const status = normalizeChecklistStatus(item.status);
  if (status !== 'uploaded') return;

  const snapshot = cloneChecklistItem(item);
  const timestamp = new Date().toISOString();
  const reviewer = getVisaReviewerMetadata();

  item.status = 'verified';
  item.review = {
    reviewerId: reviewer.id,
    reviewerName: reviewer.name,
    reviewedAt: timestamp,
    decision: 'verified',
    reason: ''
  };
  item.updatedAt = timestamp;

  try {
    await persistVisaChecklistChange({ announceMsg: 'Document verified', toastMsg: 'Marked as verified.' });
  } catch (error) {
    console.error('Error verifying checklist document', error);
    restoreChecklistItem(item, snapshot);
    showVisaChecklistToast('Something went wrong. Please try again.', 'danger');
    const cl = getChecklistState();
    renderVisaChecklistList(cl);
    renderVisaChecklistDetail(key);
    return;
  }

  const cl = getChecklistState();
  renderVisaChecklistList(cl);
  renderVisaChecklistDetail(key);
}

function openVisaDocDenyModal() {
  if (!isCurrentUserStaff()) return;
  const item = currentVisaChecklistKey ? getChecklistItem(currentVisaChecklistKey) : null;
  const status = normalizeChecklistStatus(item?.status);
  if (!item || !item.fileUrl || (status !== 'uploaded' && status !== 'verified')) return;

  const modalEl = document.getElementById('denyModal');
  const reasonField = document.getElementById('denyReason');
  if (!modalEl || !reasonField) return;

  visaChecklistDenyTargetKey = item.key;
  reasonField.value = (item.review?.reason || '').trim();
  reasonField.classList.remove('is-invalid');

  visaChecklistDenyModal = bootstrap.Modal.getOrCreateInstance(modalEl);
  visaChecklistDenyModal.show();
  setTimeout(() => reasonField.focus(), 150);
}

async function handleVisaDocDenySubmit() {
  if (!isCurrentUserStaff()) return;
  const reasonField = document.getElementById('denyReason');
  if (!reasonField) return;

  const reason = reasonField.value.trim();
  if (reason.length < 5) {
    reasonField.classList.add('is-invalid');
    reasonField.focus();
    return;
  }

  reasonField.classList.remove('is-invalid');

  const key = visaChecklistDenyTargetKey || currentVisaChecklistKey;
  const item = key ? getChecklistItem(key) : null;
  if (!item || !item.fileUrl) return;

  const snapshot = cloneChecklistItem(item);
  const timestamp = new Date().toISOString();
  const reviewer = getVisaReviewerMetadata();

  item.status = 'denied';
  item.review = {
    reviewerId: reviewer.id,
    reviewerName: reviewer.name,
    reviewedAt: timestamp,
    decision: 'denied',
    reason
  };
  item.updatedAt = timestamp;

  try {
    await persistVisaChecklistChange({ announceMsg: 'Document denied', toastMsg: 'Marked as denied.', toastType: 'danger' });
  } catch (error) {
    console.error('Error denying checklist document', error);
    restoreChecklistItem(item, snapshot);
    showVisaChecklistToast('Something went wrong. Please try again.', 'danger');
    const cl = getChecklistState();
    renderVisaChecklistList(cl);
    renderVisaChecklistDetail(item.key);
    return;
  }

  const cl = getChecklistState();
  renderVisaChecklistList(cl);
  renderVisaChecklistDetail(item.key);

  if (visaChecklistDenyModal) {
    visaChecklistDenyModal.hide();
  }
}

function handleVisaDocViewClick() {
  const key = currentVisaChecklistKey;
  const item = key ? getChecklistItem(key) : null;
  if (item?.fileUrl) {
    window.open(item.fileUrl, '_blank', 'noopener');
  }
}

function handleVisaDocInstructionsMoreClick(event) {
  const button = event.currentTarget;
  if (button?.dataset?.helpUrl) {
    event.preventDefault();
    window.open(button.dataset.helpUrl, '_blank', 'noopener');
    return;
  }
  const key = normalizeChecklistKeyInput(button?.dataset?.docKey || currentVisaChecklistKey);
  if (!key) return;
  openVisaDocInstructionsModal(key);
}

function handleVisaDocSampleClick(event) {
  const button = event.currentTarget;
  const url = button?.dataset?.sampleUrl;
  if (url) {
    window.open(url, '_blank', 'noopener');
  }
}

async function handleEtureDocListClick(event) {
  const removeBtn = event.target.closest('.btn-eture-remove');
  if (removeBtn) {
    const removeId = removeBtn.getAttribute('data-id');
    if (removeId) {
      await handleEtureDocRemove(removeId);
    }
    return;
  }

  const downloadBtn = event.target.closest('.btn-eture-download');
  if (!downloadBtn) return;
  event.preventDefault();
  const id = downloadBtn.getAttribute('data-id');
  if (!id) return;
  const doc = getEtureDocs().find((item) => item.id === id);
  if (!doc) return;
  downloadEtureDoc(doc);
}

async function handleVisaDocNotesChange(event) {
  const key = currentVisaChecklistKey;
  const item = key ? getChecklistItem(key) : null;
  if (!item) return;

  const snapshot = cloneChecklistItem(item);
  item.notes = event.target.value || '';
  item.updatedAt = new Date().toISOString();
  try {
    await persistVisaChecklistChange({ announceMsg: 'Notes updated', toastMsg: 'Notes saved' });
  } catch (error) {
    console.error('Error saving notes for checklist document', error);
    restoreChecklistItem(item, snapshot);
    showVisaChecklistToast('Something went wrong. Please try again.', 'danger');
    const cl = getChecklistState();
    renderVisaChecklistList(cl);
    renderVisaChecklistDetail(key);
  }
}

async function saveVisaOverview() {
  ensureVisaDefaults();
  const ov = userProfileData.visa.overview;

  const $ = (id) => document.getElementById(id);

  // Lee solo lo que existe en tu HTML
  ov.consulateCity    = $('visa-consulate')?.value || '';
  ov.appointmentDate  = $('visa-appointment')?.value || '';
  ov.status           = $('visa-status')?.value || '';
  ov.issuedDate       = $('visa-issued')?.value || '';
  ov.entryBy          = $('visa-entryBy')?.value || '';

  ov.acceptanceStatus = $('visa-acceptance')?.value || '';
  ov.insuranceStatus  = $('visa-insurance')?.value || '';
  ov.fundsStatus      = $('visa-funds')?.value || '';
  ov.fbiStatus        = $('visa-fbi')?.value || '';
  ov.medicalStatus    = $('visa-medical')?.value || '';
  ov.formStatus       = $('visa-form')?.value || '';

  ov.tieOffice        = $('visa-tieOffice')?.value || '';
  ov.tieDate          = $('visa-tieDate')?.value || '';
  ov.tieStatus        = $('visa-tieStatus')?.value || '';

  ov.lastUpdate       = new Date().toISOString();

  // Recalcular y repintar
  renderVisaOverview();

  // Persistir
  const user = auth.currentUser;
  if (user) await saveProfileToFirestore(user.uid, userProfileData);

  // feedback en botón
  const btn = $('visa-overview-save');
  if (btn) {
    const old = btn.innerHTML;
    btn.innerHTML = 'Saved ✓';
    btn.disabled = true;
    setTimeout(() => { btn.innerHTML = old; btn.disabled = false; }, 1200);
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

  emitAppStateUpdated();
  evaluateTripUnlockFromState();

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

  if (typeof window !== 'undefined' && window.location.hash === '#my-program') {
    handleHashNavigation();
  }
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
      statusEl.textContent = "Saved!";
      setTimeout(() => { statusEl.textContent = ""; }, 2000);
    }
  }  
});

// ✅ Delegación global para Universities (añadir/editar/eliminar/timeline/aceptar/rechazar + nota + nextStep)
document.body.addEventListener('click', async (e) => {
  // Añadir universidad
  const addBtn = e.target.closest('#proceso-content .add-university-btn');
  if (addBtn) {
    e.preventDefault();
    const name = (prompt('University name') || '').trim();
    if (!name) return;

    if (!Array.isArray(userProfileData.universityInterest)) {
      userProfileData.universityInterest = [];
    }
    userProfileData.universityInterest.unshift({
      id: 'uni_' + Date.now(),
      name,
      status: 'Pending',
      offerDetails: { costs: [], scholarships: [], documentUrl: '' },
      timeline: [],
      nextStep: null
    });

    renderUniversityInterest();
    document.dispatchEvent(new Event('profile:changed'));
    if (auth.currentUser) await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    return;
  }

  // Edit nombre
  const editBtn = e.target.closest('#proceso-content .edit-university-btn');
  if (editBtn) {
    e.preventDefault();
    const id = editBtn.dataset.universityId;
    const uni = (userProfileData.universityInterest || []).find(u => u.id === id);
    if (!uni) return;

    const newName = (prompt('New university name', uni.name) || '').trim();
    if (!newName) return;

    uni.name = newName;
    renderUniversityInterest();
    if (auth.currentUser) await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    return;
  }

  // Delete (papelera a la izquierda del nombre)
  const delBtn = e.target.closest('#proceso-content .delete-university-btn');
  if (delBtn) {
    e.preventDefault();
    const id = delBtn.dataset.universityId;
    if (!confirm('Delete this university?')) return;

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

  // Add note rápida (inline)
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

  // Accept oferta
  const acceptBtn = e.target.closest('#proceso-content .accept-university-btn');
  if (acceptBtn) {
    e.preventDefault();
    const id = acceptBtn.dataset.universityId;
    const uni = (userProfileData.universityInterest || []).find(u => u.id === id);
    if (!uni) return;

    if (!hasOffer(uni)) { alert('Record an offer first.'); return; }

    uni.status = 'Accepted';
    uni.timeline = uni.timeline || [];
    uni.timeline.unshift({ id:'tl_'+Date.now(), at:new Date().toISOString(), author:auth.currentUser?.email||'', text:'Offer accepted' });

    // Close próximo paso/tarea si existía
    await completeNextStepTask(auth.currentUser?.uid, uni);
    if (uni.nextStep) uni.nextStep.done = true;

    renderUniversityInterest();
    if (auth.currentUser) await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
    return;
  }

  // Reject oferta
  const rejectBtn = e.target.closest('#proceso-content .reject-university-btn');
  if (rejectBtn) {
    e.preventDefault();
    const id = rejectBtn.dataset.universityId;
    const uni = (userProfileData.universityInterest || []).find(u => u.id === id);
    if (!uni) return;

    if (!hasOffer(uni)) { alert('Record an offer first.'); return; }

    if (!confirm('Reject this offer?')) return;
    uni.status = 'Rejected';
    uni.timeline = uni.timeline || [];
    uni.timeline.unshift({ id:'tl_'+Date.now(), at:new Date().toISOString(), author:auth.currentUser?.email||'', text:'Offer rejected' });

    // Close próximo paso/tarea si existía
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
    if (!type || !dateStr) { alert('Select a type and date.'); return; }

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
  const newStatus = normalizeUniversityStatus(statusSel.value);
  const uni = (userProfileData.universityInterest || []).find(u => u.id === id);
  if (!uni) return;

  uni.status = newStatus;
  renderUniversityInterest();
  document.dispatchEvent(new Event('profile:changed'));
  if (auth.currentUser) await saveProfileToFirestore(auth.currentUser.uid, userProfileData);
});

// Accept scholarship offer (button in Actions)
document.body.addEventListener('click', async (e) => {
  const acceptBtn = e.target.closest('#proceso-content .accept-offer-btn');
  if (!acceptBtn) return;

  const id = acceptBtn.dataset.universityId;
  const uni = (userProfileData.universityInterest || []).find(u => u.id === id);
  if (!uni) return;

  uni.status = 'Accepted';
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


  console.log('Signing out…');
  signOut(auth)
    .then(() => {
      console.log('✅ Signed out');
      window.location.href = 'login.html';
    })
    .catch((err) => {
      console.error('Error signing out:', err);
      window.location.href = 'login.html';
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
      const whenTxt = new Date(whenISO).toLocaleString('en-US');
      const type = inferActionType(t);
      const typeLabel = nextStepTypeLabel(type);
      const note = (t.notes || '').trim();

      // Añadir al historial de esa universidad (arriba del todo)
      uni.timeline = uni.timeline || [];
      uni.timeline.unshift({
        id: 'tl_' + Date.now(),
        at: new Date().toISOString(),
        author: auth.currentUser?.email || '',
        type: typeLabel,
        text: `${typeLabel} completed (${whenTxt})${note ? `. Notes: ${note}` : ''}`
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
    console.error('Error processing completed tasks for the timeline:', err);
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

// --- Overview anchors -> real tab switch (prefer click on the real tab) ---
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-visa-tab-target]');
  if (!el) return;

  const target = el.getAttribute('data-visa-tab-target');
  if (!target) return;

  ev.preventDefault();

  try {
    const id = target.replace(/^#/, '');

    // 1) Busca el control de tab real (button/link) y haz click
    const tabCtrl =
      document.querySelector(`#${id}-tab`) ||
      document.querySelector(`[data-bs-target="#${id}"]`) ||
      document.querySelector(`[aria-controls="${id}"]`) ||
      document.querySelector(`a[href="#${id}"][role="tab"]`);

    if (tabCtrl && typeof tabCtrl.click === 'function') {
      tabCtrl.click(); // esto ejecuta toda la lógica asociada a la pestaña
      return;
    }

    // 2) Fallback: si no hay control, usa la función directa
    if (typeof window.showTabPane === 'function') {
      window.showTabPane(id);
    } else if (typeof showTabPane === 'function') {
      showTabPane(id);
    }
  } catch (_) { /* noop */ }
});


// app.js - NUEVA LÍNEA AL FINAL
// Integration Notes:
// - Tabs rely on ids tab-paperwork, tab-travel, tab-housing, tab-vinaros for CTA wiring.
// - initMyProgramView is the extension point for Firestore/REST data once services are ready.
// - handleHashNavigation exits early for unknown hashes so existing routes keep control.
// - Bootstrap.Tab usage stays vanilla; no jQuery layer was introduced.
handleAuthState(initApp);

// === My Program: initializer ===
(function myProgramBootstrap() {
  const TRIP_STORAGE_KEY = 'myTrips';
  let tripToastInstance = null;
  const HOUSING_DEMO = window.HOUSING_DEMO || {
    building: 'Residence Vinaròs — North Building',
    floor: '3',
    room: '305B',
    roommates: [
      { name: 'John Miller', country: 'United States', flag: '🇺🇸' },
      { name: 'Diego Pérez', country: 'Mexico',        flag: '🇲🇽' }
    ]
  };
  const LS = Object.assign({
    DINING_NOTES: 'housing-dining-notes',
    DINING_NOTES_LIST: 'housing-dining-notes-list',
    ACK_RULES: 'housing-ack-rules',
    ACK_RULES_AT: 'housing-ack-rules-at',
    ACK_CLEAN: 'housing-ack-cleaning',
    ACK_CLEAN_AT: 'housing-ack-cleaning-at'
  }, (window.LS || {}));

  try {
    if (localStorage.getItem('housing-cleaning-ack') === '1' && !localStorage.getItem(LS.ACK_CLEAN)) {
      localStorage.setItem(LS.ACK_CLEAN, '1');
      localStorage.setItem(LS.ACK_CLEAN_AT, new Date().toISOString());
    }
  } catch (e) {
    // ignore storage access issues
  }

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function norm(value) {
    return (value || '').trim();
  }

  function openMapsUrl(addrOrUrl) {
    const u = norm(addrOrUrl);
    if (!u) return '#';
    if (/^(https?:)?\/\/(maps\.google|goo\.gl)\/|^https?:\/\//i.test(u)) return u;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(u)}`;
  }

  function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text);
      }
      return copyToClipboard(text);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function setText(sel, v) {
    const el = qs(sel);
    if (el) el.textContent = v ?? '—';
  }

  function fillList(listEl, items) {
    if (!listEl) return;
    listEl.innerHTML = '';
    (items || []).forEach((rm) => {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex align-items-center justify-content-between';
      const flag = rm.flag ? `${rm.flag}&thinsp;` : '';
      const contactHref = rm.contactHref || '#';
      const contactTitle = rm.contactTitle || 'PENDING';
      li.innerHTML = `<span>${flag}${rm.name}</span><a href="${contactHref}" class="small text-decoration-none" title="${contactTitle}">Contact</a>`;
      listEl.appendChild(li);
    });
  }

  function fmtTime(value) {
    try {
      const date = new Date(value);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function updateAckBadges() {
    const hasRules = localStorage.getItem(LS.ACK_RULES) === '1';
    const hasClean = localStorage.getItem(LS.ACK_CLEAN) === '1';
    const badgeRules = qs('#badge-ack-rules');
    const badgeClean = qs('#badge-ack-cleaning');
    const msgRulesFooter = qs('#ack-housing-rules-msg');
    const msgCleanFooter = qs('#ack-cleaning-code-msg');
    const msgRulesInline = qs('#ack-housing-rules-inline');
    const msgCleanInline = qs('#ack-cleaning-code-inline');

    const atRules = localStorage.getItem(LS.ACK_RULES_AT);
    const atClean = localStorage.getItem(LS.ACK_CLEAN_AT);
    const lineRules = hasRules && atRules ? `Acknowledged ✓ at ${fmtTime(atRules)}` : '';
    const lineClean = hasClean && atClean ? `Acknowledged ✓ at ${fmtTime(atClean)}` : '';

    if (badgeRules) {
      badgeRules.classList.toggle('d-none', !hasRules);
      if (atRules) {
        badgeRules.title = `Acknowledged at ${fmtTime(atRules)}`;
      } else {
        badgeRules.removeAttribute('title');
      }
    }
    if (badgeClean) {
      badgeClean.classList.toggle('d-none', !hasClean);
      if (atClean) {
        badgeClean.title = `Acknowledged at ${fmtTime(atClean)}`;
      } else {
        badgeClean.removeAttribute('title');
      }
    }
    if (msgRulesFooter) msgRulesFooter.textContent = lineRules;
    if (msgCleanFooter) msgCleanFooter.textContent = lineClean;
    if (msgRulesInline) msgRulesInline.textContent = lineRules;
    if (msgCleanInline) msgCleanInline.textContent = lineClean;
  }

  function ensureDemoAcks() {
    if (localStorage.getItem(LS.ACK_RULES) !== '1') {
      localStorage.setItem(LS.ACK_RULES, '1');
      localStorage.setItem(LS.ACK_RULES_AT, new Date().toISOString());
    }
    if (localStorage.getItem(LS.ACK_CLEAN) !== '1') {
      localStorage.setItem(LS.ACK_CLEAN, '1');
      localStorage.setItem(LS.ACK_CLEAN_AT, new Date().toISOString());
    }
    const badgeRules = qs('#badge-ack-rules');
    const badgeClean = qs('#badge-ack-cleaning');
    if (badgeRules) badgeRules.classList.remove('d-none');
    if (badgeClean) badgeClean.classList.remove('d-none');
    updateAckBadges();
  }

  function wireCopyRoomInfo() {
    const link = qs('#link-copy-roominfo');
    if (!link || link.dataset.copyBound === 'true') return;
    const msg = qs('#copy-roominfo-msg');
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const building = qs('#res-building')?.textContent?.trim() || '';
      const floor = qs('#res-floor')?.textContent?.trim() || '';
      const room = qs('#res-room')?.textContent?.trim() || '';
      const text = `${building} · Floor ${floor} · Room ${room}`;
      const maybePromise = navigator.clipboard?.writeText
        ? navigator.clipboard.writeText(text)
        : copyToClipboard(text);
      Promise.resolve(maybePromise)
        .then(() => {
          if (msg) {
            msg.classList.remove('d-none');
            setTimeout(() => msg.classList.add('d-none'), 1200);
          }
        })
        .catch(() => {});
    });
    link.dataset.copyBound = 'true';
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 0);
  }

  function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function debounce(fn, delay) {
    let t = null;
    return function debounced(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function normText(value) {
    return (value || '').trim();
  }

  function getFullAddressText() {
    const el = document.getElementById('full-address-text');
    if (!el) return '';
    const source = el.innerText || el.textContent || '';
    return source.replace(/\n+/g, ', ').replace(/\s+/g, ' ').trim();
  }

  function openMapsUrlFromAddress(addr) {
    try {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
    } catch (_) {
      return '#';
    }
  }

  function toKey(value) {
    return normText(value).toLowerCase();
  }

  function getNotesList() {
    try {
      const raw = localStorage.getItem(LS.DINING_NOTES_LIST);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  function setNotesList(arr) {
    localStorage.setItem(LS.DINING_NOTES_LIST, JSON.stringify(Array.isArray(arr) ? arr : []));
  }

  function migrateNotesIfNeeded() {
    const list = getNotesList();
    const legacy = normText(localStorage.getItem(LS.DINING_NOTES) || '');
    if (!list.length && legacy) {
      setNotesList([legacy]);
    }
  }

  function showSavedStamp() {
    const savedMsg = qs('#dining-saved-msg');
    const shared = qs('#dining-shared');
    const list = getNotesList();
    if (savedMsg) {
      savedMsg.textContent = `Saved ✓  Last saved at ${fmtTime(new Date())}`;
    }
    if (shared) {
      shared.textContent = list.length
        ? `Shared with kitchen: “${list.join(', ')}”`
        : 'Shared with kitchen: —';
    }
  }

  function renderNotesUI() {
    const listEl = qs('#dining-notes-list');
    if (!listEl) return;

    const list = getNotesList();
    listEl.innerHTML = '';
    list.forEach((note, idx) => {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex align-items-center justify-content-between';
      li.innerHTML = `<span>${note}</span>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-remove="${idx}" aria-label="Remove ${note}">×</button>`;
      listEl.appendChild(li);
    });

    listEl.querySelectorAll('button[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number.parseInt(btn.getAttribute('data-remove') || '-1', 10);
        if (Number.isNaN(idx)) return;
        const current = getNotesList();
        if (idx < 0 || idx >= current.length) return;
        current.splice(idx, 1);
        setNotesList(current);
        showSavedStamp();
        renderNotesUI();
      });
    });
  }

  function addNoteFromInput() {
    const input = qs('#dining-note-input');
    const hint = qs('#dining-input-hint');
    if (!input) return;
    const value = normText(input.value);
    if (!value) {
      if (hint) hint.textContent = 'Please enter a note before adding.';
      return;
    }

    const list = getNotesList();
    const existing = new Set(list.map(toKey));
    if (existing.has(toKey(value))) {
      if (hint) hint.textContent = 'This note is already in the list.';
      return;
    }

    list.push(value);
    setNotesList(list);
    input.value = '';
    if (hint) hint.textContent = '';
    showSavedStamp();
    renderNotesUI();
  }

  function bindDiningNotes(panelBound) {
    migrateNotesIfNeeded();
    renderNotesUI();

    if (!panelBound) {
      const btnAdd = qs('#btn-add-note');
      const input = qs('#dining-note-input');
      if (btnAdd) {
        btnAdd.addEventListener('click', addNoteFromInput);
      }
      if (input) {
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            addNoteFromInput();
          }
        });
      }
    }
  }

  function bindAddressModal() {
    const modalEl = document.getElementById('modal-full-address');
    const copyBtn = document.getElementById('btn-copy-address');
    const mapsLink = document.getElementById('link-open-maps');
    if (modalEl && !modalEl.dataset.bound) {
      modalEl.addEventListener('shown.bs.modal', () => {
        const addr = getFullAddressText();
        if (mapsLink) {
          mapsLink.href = openMapsUrlFromAddress(addr);
        }
      });
      modalEl.dataset.bound = 'true';
    }

    if (copyBtn && !copyBtn.dataset.bound) {
      copyBtn.addEventListener('click', () => {
        const addr = getFullAddressText();
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(addr).catch(() => {});
        }
      });
      copyBtn.dataset.bound = 'true';
    }
  }

  function refreshAckBadges() {
    ['ack-conduct', 'ack-safety', 'ack-rules'].forEach(key => {
      const ok = localStorage.getItem(key) === '1';
      const badge = document.querySelector(`[data-badge="${key}"]`);
      if (badge) badge.classList.toggle('d-none', !ok);
    });
  }

  function bindAcknowledge() {
    document.querySelectorAll('[data-action="ack"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-key');
        const chk = document.getElementById(key + '-check');
        if (!chk || !chk.checked) {
          alert('Please read and check the agreement box first.');
          return;
        }
        localStorage.setItem(key, '1');
        refreshAckBadges();

        // Close modal robustly
        const modalEl = btn.closest('.modal');
        if (modalEl) {
          try {
            // BS5 global
            const inst = (window.bootstrap && window.bootstrap.Modal)
              ? window.bootstrap.Modal.getOrCreateInstance(modalEl)
              : null;
            if (inst) {
              inst.hide();
              return;
            }
          } catch (_) { /* ignore */ }
          // Fallback: manual hide
          modalEl.classList.remove('show');
          modalEl.setAttribute('aria-hidden', 'true');
          modalEl.style.display = 'none';
          document.body.classList.remove('modal-open');
          document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
        }
      }, { once: false });
    });
  }

  function bindTravelOther() {
    const sel = document.getElementById('trip-location');
    const wrap = document.getElementById('trip-location-other-wrap');
    if (!sel || !wrap) return;
    const toggle = () => wrap.classList.toggle('d-none', sel.value !== 'other');
    sel.addEventListener('change', toggle);
    toggle();
    // Re-bind when Travel tab is shown (ensures correct state after switching tabs)
    const travelTab = document.getElementById('tab-travel');
    if (travelTab) {
      travelTab.addEventListener('shown.bs.tab', toggle, { once: false });
    }
  }

  function bindShipmentsList() {
    const addBtn = document.getElementById('btn-add-tracking');
    const list = document.getElementById('trk-list');
    const carrier = document.getElementById('trk-carrier');
    const number = document.getElementById('trk-number');
    if (!addBtn || !list || !carrier || !number) return;

    addBtn.addEventListener('click', () => {
      const c = carrier.value.trim();
      const n = number.value.trim();
      if (!c && !n) return;
      const empty = list.querySelector('[data-empty="true"]');
      if (empty) empty.remove();
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center';
      li.innerHTML = `<span>${c || '—'} — ${n || '—'}</span>
                      <button class="btn btn-sm btn-outline-secondary">Remove</button>`;
      li.querySelector('button').addEventListener('click', () => li.remove());
      list.appendChild(li);
      carrier.value = '';
      number.value = '';
      carrier.focus();
    });
  }

  // === City Guide ===
  const CG = {
    ACTIVE_CITY_KEY: 'city-guide:active-city',
    ACTIVE_SECTION_KEY: 'city-guide:active-section',
    stateKey(city) {
      return `city-guide:${city}:v1`;
    }
  };

  function cgLoad(city) {
    try {
      const raw = localStorage.getItem(CG.stateKey(city));
      return raw ? JSON.parse(raw) : { accommodation: [], restaurants: [], cultural: [], airports: [] };
    } catch (_) {
      return { accommodation: [], restaurants: [], cultural: [], airports: [] };
    }
  }

  function cgSave(city, state) {
    try {
      localStorage.setItem(CG.stateKey(city), JSON.stringify(state));
    } catch (_) {
      // noop — storage might be unavailable (private mode, etc.)
    }
  }

  function cgGetActiveCity() {
    try {
      return localStorage.getItem(CG.ACTIVE_CITY_KEY) || 'Vinaròs';
    } catch (_) {
      return 'Vinaròs';
    }
  }

  function cgSetActiveCity(city) {
    try {
      localStorage.setItem(CG.ACTIVE_CITY_KEY, city);
    } catch (_) {
      // ignore storage issues
    }
  }

  function cgGetActiveSection() {
    try {
      return localStorage.getItem(CG.ACTIVE_SECTION_KEY) || 'accommodation';
    } catch (_) {
      return 'accommodation';
    }
  }

  function cgSetActiveSection(section) {
    try {
      localStorage.setItem(CG.ACTIVE_SECTION_KEY, section);
    } catch (_) {
      // ignore storage issues
    }
  }

  function cgRenderPills() {
    const city = cgGetActiveCity();
    const sec = cgGetActiveSection();
    qsa('#cg-city-pills .nav-link').forEach((link) => {
      link.classList.toggle('active', link.dataset.city === city);
    });
    qsa('#cg-section-pills .nav-link').forEach((link) => {
      link.classList.toggle('active', link.dataset.section === sec);
    });
  }

  function cgBadgeReco(val) {
    const v = (val || '').toLowerCase();
    if (v === 'recommended') return '<span class="badge bg-success">Recommended</span>';
    if (v === 'alternative') return '<span class="badge bg-secondary">Alternative</span>';
    return val || '';
  }

  function cgEmptyRow(colspan, msg) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="text-muted" colspan="${colspan}">${msg}</td>`;
    return tr;
  }

  function cgNormalizeLink(u) {
    let s = (u || '').trim().toLowerCase();
    if (!s) return '';
    s = s.replace(/[\/\s]+$/, '');
    s = s.replace(/(\?|#).*$/, '');
    return s;
  }

  function cgDedupe(list, keyFn) {
    const seen = new Set(); const out = [];
    for (const x of list) {
      const k = keyFn(x);
      if (!seen.has(k)) { seen.add(k); out.push(x); }
    }
    return out;
  }

  function cgRender() {
    const city = cgGetActiveCity();
    const sec = cgGetActiveSection();
    const state = cgLoad(city);
    cgRenderPills();

    ['accommodation', 'restaurants', 'cultural', 'airports'].forEach((sectionKey) => {
      const sectionEl = qs(`#cg-section-${sectionKey}`);
      if (sectionEl) {
        sectionEl.classList.toggle('d-none', sectionKey !== sec);
      }
    });

    const safe = (value) => escapeHtml(value || '');

    if (sec === 'accommodation') {
      const tbody = qs('#cg-acc-tbody');
      if (tbody) {
        tbody.innerHTML = '';
        const rows = Array.isArray(state.accommodation) ? state.accommodation : [];
        rows.forEach((item, index) => {
          const tr = document.createElement('tr');
          const mapUrl = escapeHtml(openMapsUrl(item.address || item.link));
          const webUrl = escapeHtml(item.link || '#');
          const copyVal = escapeHtml(norm(item.address || item.name));
          tr.innerHTML = `
            <td>${safe(item.name)}</td>
            <td>${safe(item.type)}</td>
            <td class="small">
              <a class="me-2" href="${mapUrl}" target="_blank" rel="noopener">Map</a>
              <a class="me-2" href="${webUrl}" target="_blank" rel="noopener">Web</a>
              <a class="me-2" href="#" data-cgcopy="${copyVal}">Copy</a>
              <a class="me-2" href="#" data-cgedit="${index}">Edit</a>
              <a class="text-danger" href="#" data-cgdel="${index}">Delete</a>
            </td>
            <td>${safe(item.notes)}</td>
          `;
          tbody.appendChild(tr);
        });
      }
    }

    if (sec === 'restaurants') {
      const tbody = qs('#cg-rest-tbody');
      if (tbody) {
        tbody.innerHTML = '';
        const rows = Array.isArray(state.restaurants) ? state.restaurants : [];
        rows.forEach((item, index) => {
          const tr = document.createElement('tr');
          const mapUrl = escapeHtml(openMapsUrl(item.address || item.link));
          const webUrl = escapeHtml(item.link || '#');
          const copyVal = escapeHtml(norm(item.address || item.name));
          tr.innerHTML = `
            <td>${safe(item.name)}</td>
            <td>${safe(item.area)}</td>
            <td class="small">
              <a class="me-2" href="${mapUrl}" target="_blank" rel="noopener">Map</a>
              <a class="me-2" href="${webUrl}" target="_blank" rel="noopener">Web</a>
              <a class="me-2" href="#" data-cgcopy="${copyVal}">Copy</a>
              <a class="me-2" href="#" data-cgedit="${index}">Edit</a>
              <a class="text-danger" href="#" data-cgdel="${index}">Delete</a>
            </td>
            <td>${safe(item.notes)}</td>
          `;
          tbody.appendChild(tr);
        });
      }
    }

    if (sec === 'cultural') {
      const tbody = qs('#cg-cul-tbody');
      if (tbody) {
        tbody.innerHTML = '';
        const rows = Array.isArray(state.cultural) ? state.cultural : [];
        rows.forEach((item, index) => {
          const tr = document.createElement('tr');
          const mapUrl = escapeHtml(openMapsUrl(item.address || item.link));
          const webUrl = escapeHtml(item.link || '#');
          const copyVal = escapeHtml(norm(item.address || item.name));
          const notesHours = [norm(item.notes), norm(item.hours)].filter(Boolean).join(' · ');
          tr.innerHTML = `
            <td>${safe(item.section)}</td>
            <td>${safe(item.name)}</td>
            <td>${safe(item.area)}</td>
            <td class="small">
              <a class="me-2" href="${mapUrl}" target="_blank" rel="noopener">Map</a>
              <a class="me-2" href="${webUrl}" target="_blank" rel="noopener">Web</a>
              <a class="me-2" href="#" data-cgcopy="${copyVal}">Copy</a>
              <a class="me-2" href="#" data-cgedit="${index}">Edit</a>
              <a class="text-danger" href="#" data-cgdel="${index}">Delete</a>
            </td>
            <td>${safe(notesHours)}</td>
          `;
          tbody.appendChild(tr);
        });
      }
    }

    if (sec === 'airports') {
      const tbody = qs('#cg-air-tbody');
      if (tbody) {
        tbody.innerHTML = '';
        const rows = Array.isArray(state.airports) ? state.airports : [];
        rows.forEach((item, index) => {
          const tr = document.createElement('tr');
          const mapUrl = escapeHtml(openMapsUrl(item.address || item.link));
          const webUrl = escapeHtml(item.link || '#');
          const copyVal = escapeHtml(norm(item.address || item.airport));
          tr.innerHTML = `
            <td>${safe(item.iata)}</td>
            <td>${safe(item.airport)}</td>
            <td>${safe(item.recommendation)}</td>
            <td>${safe(item.distanceTime)}</td>
            <td class="small">
              <a class="me-2" href="${mapUrl}" target="_blank" rel="noopener">Map</a>
              <a class="me-2" href="${webUrl}" target="_blank" rel="noopener">Web</a>
              <a class="me-2" href="#" data-cgcopy="${copyVal}">Copy</a>
              <a class="me-2" href="#" data-cgedit="${index}">Edit</a>
              <a class="text-danger" href="#" data-cgdel="${index}">Delete</a>
            </td>
            <td>${safe(item.notes)}</td>
          `;
          tbody.appendChild(tr);
        });
      }
    }

    qsa('[data-cgcopy]').forEach((anchor) => {
      anchor.onclick = (event) => {
        event.preventDefault();
        const txt = anchor.getAttribute('data-cgcopy') || '';
        copyText(txt);
      };
    });
    qsa('[data-cgedit]').forEach((anchor) => {
      anchor.onclick = (event) => {
        event.preventDefault();
        const idx = Number(anchor.getAttribute('data-cgedit') || '-1');
        if (!Number.isNaN(idx)) {
          cgOpenModal('edit', idx);
        }
      };
    });
    qsa('[data-cgdel]').forEach((anchor) => {
      anchor.onclick = (event) => {
        event.preventDefault();
        const idx = Number(anchor.getAttribute('data-cgdel') || '-1');
        if (!Number.isNaN(idx)) {
          cgDelete(idx);
        }
      };
    });
  }

  const _cgRenderOrig = typeof cgRender === 'function' ? cgRender : null;
  if (_cgRenderOrig) {
    cgRender = function () {
      const city = cgGetActiveCity();
      const sec = cgGetActiveSection();
      const st = cgLoad(city);
      cgRenderPills();

      const btnImp = document.getElementById('cg-btn-import');
      if (btnImp) {
        const pack = (CG_SAMPLES?.[city]?.[sec]) || [];
        const has = Array.isArray(pack) && pack.length > 0;
        btnImp.disabled = !has;
        btnImp.title = has ? 'Import sample' : 'No sample for this section (yet)';
      }

      ['accommodation', 'restaurants', 'cultural', 'airports'].forEach((sectionKey) => {
        const panel = qs('#cg-section-' + sectionKey);
        if (panel) {
          panel.classList.toggle('d-none', sectionKey !== sec);
        }
      });

      if (sec === 'accommodation') {
        const tbody = qs('#cg-acc-tbody');
        if (tbody) {
          tbody.innerHTML = '';
          const arr = Array.isArray(st.accommodation)
            ? st.accommodation.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
            : [];
          if (!arr.length) {
            tbody.appendChild(cgEmptyRow(4, 'No places yet - click "Add place".'));
          } else {
            arr.forEach((item, index) => {
              const tr = document.createElement('tr');
              tr.innerHTML = `
                <td>${item.name || ''}</td>
                <td>${item.type || ''}</td>
                <td class="small">
                  <a class="me-2" href="${openMapsUrl(item.address || item.link)}" target="_blank" rel="noopener">Map</a>
                  <a class="me-2" href="${item.link || '#'}" target="_blank" rel="noopener">Web</a>
                  <a class="me-3" href="#" data-cgcopy="${norm(item.address || item.name)}">Copy</a>
                  <a class="me-2" href="#" data-cgedit="${index}">Edit</a>
                  <a class="ms-1 text-danger" href="#" data-cgdel="${index}">Delete</a>
                </td>
                <td>${item.notes || ''}</td>`;
              tbody.appendChild(tr);
            });
          }
        }
      }

      if (sec === 'restaurants') {
        const tbody = qs('#cg-rest-tbody');
        if (tbody) {
          tbody.innerHTML = '';
          const arr = Array.isArray(st.restaurants)
            ? st.restaurants.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
            : [];
          if (!arr.length) {
            tbody.appendChild(cgEmptyRow(4, 'No places yet - click "Add place".'));
          } else {
            arr.forEach((item, index) => {
              const tr = document.createElement('tr');
              tr.innerHTML = `
                <td>${item.name || ''}</td>
                <td>${item.area || ''}</td>
                <td class="small">
                  <a class="me-2" href="${openMapsUrl(item.address || item.link)}" target="_blank" rel="noopener">Map</a>
                  <a class="me-2" href="${item.link || '#'}" target="_blank" rel="noopener">Web</a>
                  <a class="me-3" href="#" data-cgcopy="${norm(item.address || item.name)}">Copy</a>
                  <a class="me-2" href="#" data-cgedit="${index}">Edit</a>
                  <a class="ms-1 text-danger" href="#" data-cgdel="${index}">Delete</a>
                </td>
                <td>${item.notes || ''}</td>`;
              tbody.appendChild(tr);
            });
          }
        }
      }

      if (sec === 'cultural') {
        const tbody = qs('#cg-cul-tbody');
        if (tbody) {
          tbody.innerHTML = '';
          const arr = Array.isArray(st.cultural)
            ? st.cultural.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
            : [];
          if (!arr.length) {
            tbody.appendChild(cgEmptyRow(5, 'No places yet - click "Add place".'));
          } else {
            arr.forEach((item, index) => {
              const tr = document.createElement('tr');
              tr.innerHTML = `
                <td>${item.section || ''}</td>
                <td>${item.name || ''}</td>
                <td>${item.area || ''}</td>
                <td class="small">
                  <a class="me-2" href="${openMapsUrl(item.address || item.link)}" target="_blank" rel="noopener">Map</a>
                  <a class="me-2" href="${item.link || '#'}" target="_blank" rel="noopener">Web</a>
                  <a class="me-3" href="#" data-cgcopy="${norm(item.address || item.name)}">Copy</a>
                  <a class="me-2" href="#" data-cgedit="${index}">Edit</a>
                  <a class="ms-1 text-danger" href="#" data-cgdel="${index}">Delete</a>
                </td>
                <td>${[item.notes || '', item.hours || ''].filter(Boolean).join(' · ')}</td>`;
              tbody.appendChild(tr);
            });
          }
        }
      }

      if (sec === 'airports') {
        const tbody = qs('#cg-air-tbody');
        if (tbody) {
          tbody.innerHTML = '';
          const arr = Array.isArray(st.airports)
            ? st.airports.slice().sort((a, b) => (a.airport || '').localeCompare(b.airport || '', undefined, { sensitivity: 'base' }))
            : [];
          if (!arr.length) {
            tbody.appendChild(cgEmptyRow(6, 'No airports yet - click "Add place".'));
          } else {
            arr.forEach((item, index) => {
              const tr = document.createElement('tr');
              tr.innerHTML = `
                <td>${item.iata || ''}</td>
                <td>${item.airport || ''}</td>
                <td>${cgBadgeReco(item.recommendation)}</td>
                <td>${item.distanceTime || ''}</td>
                <td class="small">
                  <a class="me-2" href="${openMapsUrl(item.address || item.link)}" target="_blank" rel="noopener">Map</a>
                  <a class="me-2" href="${item.link || '#'}" target="_blank" rel="noopener">Web</a>
                  <a class="me-3" href="#" data-cgcopy="${norm(item.address || item.airport)}">Copy</a>
                  <a class="me-2" href="#" data-cgedit="${index}">Edit</a>
                  <a class="ms-1 text-danger" href="#" data-cgdel="${index}">Delete</a>
                </td>
                <td>${item.notes || ''}</td>`;
              tbody.appendChild(tr);
            });
          }
        }
      }

      qsa('[data-cgcopy]').forEach((anchor) => {
        anchor.onclick = (event) => {
          event.preventDefault();
          const txt = anchor.getAttribute('data-cgcopy') || '';
          copyText(txt);
        };
      });
      qsa('[data-cgedit]').forEach((anchor) => {
        anchor.onclick = (event) => {
          event.preventDefault();
          const idx = Number(anchor.getAttribute('data-cgedit') || '-1');
          if (!Number.isNaN(idx)) {
            cgOpenModal('edit', idx);
          }
        };
      });
      qsa('[data-cgdel]').forEach((anchor) => {
        anchor.onclick = (event) => {
          event.preventDefault();
          const idx = Number(anchor.getAttribute('data-cgdel') || '-1');
          if (!Number.isNaN(idx)) {
            cgDelete(idx);
          }
        };
      });
    };
  }

  function cgIsPresent() {
    return !!document.getElementById('cg-filters');
  }

  function cgBootOnce() {
    if (!cgIsPresent()) return;
    if (window.__cgBooted) return;
    window.__cgBooted = true;
    try {
      if (!localStorage.getItem(CG.ACTIVE_CITY_KEY)) {
        localStorage.setItem(CG.ACTIVE_CITY_KEY, 'Vinaròs');
      }
      if (!localStorage.getItem(CG.ACTIVE_SECTION_KEY)) {
        localStorage.setItem(CG.ACTIVE_SECTION_KEY, 'accommodation');
      }
    } catch (_) {
      // ignore storage access issues
    }
    if (typeof cgRenderPills === 'function') cgRenderPills();
    if (typeof cgRender === 'function') cgRender();
  }

  const CG_SAMPLES = {
    'Vinaròs': {
      accommodation: [
        { name: 'Hotel RH Vinaròs Aura', type: 'Hotel', link: 'https://goo.gl/maps/xxx', address: 'Av. Sebastià, Vinaròs', notes: 'Near beach' },
        { name: 'Airbnb Centro', type: 'Airbnb', link: 'https://airbnb.com/rooms/xxx', address: 'Carrer Major, Vinaròs', notes: '' }
      ],
      restaurants: [
        { name: 'Restaurante Bergantín', area: 'Vinaròs', link: 'https://goo.gl/maps/xxx', notes: 'Seafood' },
        { name: 'Casa Lina', area: 'Peñíscola', link: 'https://goo.gl/maps/xxx', notes: '' }
      ],
      cultural: [
        { section: 'Trip', name: 'Castillo de Peñíscola', area: 'Peñíscola', link: 'https://goo.gl/maps/xxx', hours: 'Daily', notes: '' },
        { section: 'Trip', name: 'Morella (ciudad amurallada)', area: 'Morella', link: 'https://goo.gl/maps/xxx', notes: '' }
      ],
      airports: [
        { iata: 'CDT', airport: 'Castellón–Costa Azahar', recommendation: 'Recommended', distanceTime: '60 km / 45 min', link: 'https://goo.gl/maps/xxx', notes: '' },
        { iata: 'VLC', airport: 'Valencia', recommendation: 'Alternative', distanceTime: '160 km / 1h45', link: 'https://goo.gl/maps/xxx', notes: '' }
      ]
    },
    'Valencia': {
      accommodation: [
        { name: 'Hotel Barceló Valencia', type: 'Hotel', link: 'https://goo.gl/maps/xxx', address: 'Av. de França, Valencia', notes: '' }
      ],
      restaurants: [
        { name: 'Casa Carmela', area: 'Valencia', link: 'https://goo.gl/maps/xxx', notes: 'Paella' }
      ],
      cultural: [
        { section: 'Museum', name: 'Ciutat de les Arts i les Ciències', area: 'Valencia', link: 'https://goo.gl/maps/xxx', hours: '10:00–19:00', notes: '' }
      ],
      airports: [
        { iata: 'VLC', airport: 'Valencia', recommendation: 'Recommended', distanceTime: '10 km / 20 min', link: 'https://goo.gl/maps/xxx', notes: '' }
      ]
    },
    'Madrid': {
      accommodation: [
        { name: 'Hotel Riu Plaza España', type: 'Hotel', link: 'https://goo.gl/maps/xxxRiu', address: 'C/ Gran Vía 84, Madrid', notes: '' }
      ],
      restaurants: [
        { name: 'Restaurante Botín', area: 'Centro', link: 'https://goo.gl/maps/xxxBotin', notes: 'Cochinillo' },
        { name: 'Mercado de San Miguel', area: 'Centro', link: 'https://goo.gl/maps/xxxSanMiguel', notes: '' }
      ],
      cultural: [
        { section: 'Museum', name: 'Museo del Prado', area: 'Recoletos', link: 'https://goo.gl/maps/xxxPrado', hours: '10:00–20:00', notes: '' },
        { section: 'Park', name: 'Parque del Retiro', area: 'Retiro', link: 'https://goo.gl/maps/xxxRetiro', notes: '' },
        { section: 'Trip', name: 'Toledo (day trip)', area: 'Toledo', link: 'https://goo.gl/maps/xxxToledo', notes: '' }
      ],
      airports: [
        { iata: 'MAD', airport: 'Adolfo Suárez Madrid-Barajas', recommendation: 'Recommended', distanceTime: '—', link: 'https://goo.gl/maps/xxxMAD' }
      ]
    },
    'Barcelona': {
      accommodation: [
        { name: 'Hotel Jazz', type: 'Hotel', link: 'https://goo.gl/maps/xxxJazz', address: 'C/ Pelai 3, Barcelona', notes: '' }
      ],
      restaurants: [
        { name: 'Can Culleretes', area: 'Gòtic', link: 'https://goo.gl/maps/xxxCulleretes', notes: '' },
        { name: 'La Paradeta', area: 'Eixample', link: 'https://goo.gl/maps/xxxParadeta', notes: 'Seafood' }
      ],
      cultural: [
        { section: 'Monument', name: 'Sagrada Família', area: 'Eixample', link: 'https://goo.gl/maps/xxxSagrada', notes: '' },
        { section: 'Park', name: 'Park Güell', area: 'Gràcia', link: 'https://goo.gl/maps/xxxGuell', notes: '' },
        { section: 'Trip', name: 'Montserrat (day trip)', area: 'Montserrat', link: 'https://goo.gl/maps/xxxMontserrat', notes: '' }
      ],
      airports: [
        { iata: 'BCN', airport: 'Barcelona–El Prat', recommendation: 'Recommended', distanceTime: '—', link: 'https://goo.gl/maps/xxxBCN' }
      ]
    }
  };

  function cgImportSample() {
    const city = cgGetActiveCity();
    const section = cgGetActiveSection();
    const pack = CG_SAMPLES[city]?.[section] || [];
    if (!pack.length) return;
    const state = cgLoad(city);
    const additions = pack.map((item) => ({ ...item }));
    const next = (state[section] || []).concat(additions);
    state[section] = next;
    cgSave(city, state);
    cgRender();
  }

  const _cgImportSampleOrig = (typeof cgImportSample === 'function') ? cgImportSample : null;
  cgImportSample = function () {
    const city = cgGetActiveCity();
    const sec = cgGetActiveSection();
    const st = cgLoad(city);
    const pack = (CG_SAMPLES?.[city]?.[sec]) || [];
    const curr = Array.isArray(st[sec]) ? st[sec] : [];
    const merged = cgDedupe(curr.concat(pack), (x) => ((x.name || '').trim().toLowerCase() + '|' + cgNormalizeLink(x.link)));
    st[sec] = merged;
    cgSave(city, st);
    if (typeof cgRender === 'function') cgRender();

    // Tiny notice next to the Import button
    const btn = document.getElementById('cg-btn-import');
    if (btn) {
      let badge = document.getElementById('cg-imported-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.id = 'cg-imported-badge';
        badge.className = 'ms-2 text-success small';
        btn.parentElement.appendChild(badge);
      }
      badge.textContent = 'Imported ✓';
      setTimeout(() => { if (badge) badge.textContent = ''; }, 1500);
    }
  };

  function cgUpdateModalMapsLink() {
    const addressEl = qs('#cg-f-address');
    const linkEl = qs('#cg-f-link');
    const anchor = qs('#cg-f-openmaps');
    if (!anchor) return;
    const addr = addressEl ? norm(addressEl.value) : '';
    const link = linkEl ? norm(linkEl.value) : '';
    anchor.href = openMapsUrl(addr || link);
  }

  function cgValidateModal() {
    const section = cgGetActiveSection();
    const nameEl = qs('#cg-f-name');
    const linkEl = qs('#cg-f-link');
    const iataEl = qs('#cg-f-iata');
    const airportEl = qs('#cg-f-airport');
    const saveBtn = qs('#cg-f-save');
    let ok = !!(nameEl && norm(nameEl.value)) && !!(linkEl && norm(linkEl.value));
    if (section === 'airports') {
      ok = ok && !!(iataEl && norm(iataEl.value)) && !!(airportEl && norm(airportEl.value));
    }
    if (saveBtn) saveBtn.disabled = !ok;
    return ok;
  }

  function cgDelete(index) {
    const city = cgGetActiveCity();
    const section = cgGetActiveSection();
    if (!window.confirm('Delete this item?')) return;
    const state = cgLoad(city);
    if (!Array.isArray(state[section])) return;
    state[section].splice(index, 1);
    cgSave(city, state);
    cgRender();
  }

  function cgOpenModal(mode, index) {
    const section = cgGetActiveSection();
    const city = cgGetActiveCity();
    const state = cgLoad(city);
    const modalEl = qs('#cg-modal');
    const ModalCtor = window.bootstrap?.Modal;
    if (!modalEl || !ModalCtor) return;
    const modal = ModalCtor.getOrCreateInstance(modalEl);
    const titleEl = qs('#cgModalLabel');
    const fieldSelectors = [
      '#cg-f-name',
      '#cg-f-type',
      '#cg-f-area',
      '#cg-f-section',
      '#cg-f-iata',
      '#cg-f-airport',
      '#cg-f-link',
      '#cg-f-address',
      '#cg-f-reco',
      '#cg-f-dist',
      '#cg-f-hours',
      '#cg-f-notes'
    ];
    fieldSelectors.forEach((selector) => {
      const el = qs(selector);
      if (el) el.value = '';
    });

    qsa('.cg-f-only-acc').forEach((el) => el.classList.toggle('d-none', section !== 'accommodation'));
    qsa('.cg-f-only-rest').forEach((el) => el.classList.toggle('d-none', section !== 'restaurants'));
    qsa('.cg-f-only-cul').forEach((el) => el.classList.toggle('d-none', section !== 'cultural'));
    qsa('.cg-f-only-air').forEach((el) => el.classList.toggle('d-none', section !== 'airports'));

    let current = null;
    if (mode === 'edit') {
      current = state[section]?.[index];
      if (current) {
        const set = (sel, val) => {
          const el = qs(sel);
          if (el) el.value = val || '';
        };
        set('#cg-f-name', current.name);
        if (section === 'accommodation') set('#cg-f-type', current.type);
        if (section === 'restaurants') set('#cg-f-area', current.area);
        if (section === 'cultural') {
          set('#cg-f-section', current.section);
          set('#cg-f-area', current.area);
          set('#cg-f-hours', current.hours);
        }
        if (section === 'airports') {
          set('#cg-f-iata', current.iata);
          set('#cg-f-airport', current.airport);
          set('#cg-f-reco', current.recommendation);
          set('#cg-f-dist', current.distanceTime);
        }
        set('#cg-f-link', current.link);
        set('#cg-f-address', current.address);
        set('#cg-f-notes', current.notes);
      }
    }

    if (titleEl) {
      const prettySection = section.charAt(0).toUpperCase() + section.slice(1);
      titleEl.textContent = `${mode === 'edit' ? 'Edit' : 'Add'} — ${prettySection}`;
    }

    const nameInput = qs('#cg-f-name');
    const linkInput = qs('#cg-f-link');
    const addressInput = qs('#cg-f-address');
    const copyBtn = qs('#cg-f-copyaddr');
    const mapBtn = qs('#cg-f-openmaps');
    const saveBtn = qs('#cg-f-save');

    const refreshMapLink = () => {
      if (mapBtn) {
        const addrOrLink = addressInput?.value || linkInput?.value;
        mapBtn.href = openMapsUrl(addrOrLink);
      }
    };

    if (linkInput) {
      linkInput.oninput = refreshMapLink;
    }
    if (addressInput) {
      addressInput.oninput = refreshMapLink;
    }
    refreshMapLink();

    if (nameInput) {
      setTimeout(() => nameInput.focus(), 50);
    }

    if (copyBtn) {
      copyBtn.onclick = () => copyText(addressInput?.value || '');
    }
    if (mapBtn) {
      mapBtn.target = '_blank';
      mapBtn.rel = 'noopener';
    }

    const formEl = qs('#cg-form');
    if (formEl && saveBtn) {
      if (formEl.__cgEnterHandler) {
        formEl.removeEventListener('keydown', formEl.__cgEnterHandler);
      }
      const handler = (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          const tag = (ev.target?.tagName || '').toLowerCase();
          if (tag !== 'textarea') {
            ev.preventDefault();
            if (!saveBtn.disabled) saveBtn.click();
          }
        }
      };
      formEl.addEventListener('keydown', handler);
      formEl.__cgEnterHandler = handler;
    }

    if (saveBtn) {
      saveBtn.onclick = () => {
        const name = norm(nameInput?.value);
        const link = norm(linkInput?.value);
        if (!name) {
          alert('Name is required');
          return;
        }
        if (!link) {
          alert('Link is required');
          return;
        }
        const notes = norm(qs('#cg-f-notes')?.value);
        const address = norm(addressInput?.value);
        const record = { name, link, address, notes };
        if (section === 'accommodation') {
          record.type = qs('#cg-f-type')?.value || '';
        } else if (section === 'restaurants') {
          record.area = norm(qs('#cg-f-area')?.value);
        } else if (section === 'cultural') {
          record.section = qs('#cg-f-section')?.value || '';
          record.area = norm(qs('#cg-f-area')?.value);
          record.hours = norm(qs('#cg-f-hours')?.value);
        } else if (section === 'airports') {
          record.iata = norm(qs('#cg-f-iata')?.value);
          record.airport = norm(qs('#cg-f-airport')?.value);
          record.recommendation = qs('#cg-f-reco')?.value || '';
          record.distanceTime = norm(qs('#cg-f-dist')?.value);
        }
        const freshState = cgLoad(city);
        if (!Array.isArray(freshState[section])) {
          freshState[section] = [];
        }
        if (mode === 'edit' && current) {
          freshState[section][index] = record;
        } else {
          freshState[section].push(record);
        }
        cgSave(city, freshState);
        modal.hide();
        cgRender();
      };
    }

    modal.show();
  }

  const _cgOpenModalOrig = typeof cgOpenModal === 'function' ? cgOpenModal : null;
  if (_cgOpenModalOrig) {
    cgOpenModal = function (mode, index) {
      _cgOpenModalOrig(mode, index);

      const section = cgGetActiveSection();
      if (section === 'cultural') {
        const sel = qs('#cg-f-section');
        if (sel && !sel.value) sel.value = 'Trip';
      }

      const handleInput = () => {
        cgUpdateModalMapsLink();
        cgValidateModal();
      };

      ['#cg-f-address', '#cg-f-link'].forEach((selector) => {
        const el = qs(selector);
        if (el) el.oninput = handleInput;
      });
      ['#cg-f-name', '#cg-f-iata', '#cg-f-airport'].forEach((selector) => {
        const el = qs(selector);
        if (el) el.oninput = () => cgValidateModal();
      });

      cgUpdateModalMapsLink();
      cgValidateModal();

      const saveBtn = qs('#cg-f-save');
      if (saveBtn) {
        const originalHandler = saveBtn.onclick;
        saveBtn.onclick = function (event) {
          if (!cgValidateModal()) return;
          if (cgGetActiveSection() === 'airports') {
            const iataEl = qs('#cg-f-iata');
            if (iataEl) iataEl.value = norm(iataEl.value).toUpperCase();
          }
          if (typeof originalHandler === 'function') {
            originalHandler.call(this, event);
          }
          [
            '#cg-f-name',
            '#cg-f-type',
            '#cg-f-area',
            '#cg-f-section',
            '#cg-f-iata',
            '#cg-f-airport',
            '#cg-f-link',
            '#cg-f-address',
            '#cg-f-reco',
            '#cg-f-dist',
            '#cg-f-hours',
            '#cg-f-notes'
          ].forEach((selector) => {
            const el = qs(selector);
            if (el) {
              el.value = '';
            }
          });
          cgUpdateModalMapsLink();
          cgValidateModal();
        };
        cgValidateModal();
      }
    };
  }

  let cgBound = false;
  function bindCityGuide() {
    const filters = document.getElementById('cg-filters');
    if (!filters) return;
    cgRender();
    if (cgBound) return;
    cgBound = true;

    qsa('#cg-city-pills .nav-link').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const city = link.dataset.city;
        if (!city) return;
        cgSetActiveCity(city);
        cgRender();
      });
    });

    qsa('#cg-section-pills .nav-link').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const section = link.dataset.section;
        if (!section) return;
        cgSetActiveSection(section);
        cgRender();
      });
    });

    const btnAdd = qs('#cg-btn-add');
    if (btnAdd) {
      btnAdd.addEventListener('click', () => cgOpenModal('add'));
    }
    const btnImport = qs('#cg-btn-import');
    if (btnImport) {
      btnImport.addEventListener('click', () => cgImportSample());
    }
  }

  if (!window.__cgDelegated) {
    window.__cgDelegated = true;
    document.addEventListener('click', (e) => {
      const cityLink = e.target.closest('#cg-city-pills .nav-link');
      if (cityLink) {
        e.preventDefault();
        if (typeof cgSetActiveCity === 'function') cgSetActiveCity(cityLink.dataset.city);
        if (typeof cgRenderPills === 'function') cgRenderPills();
        if (typeof cgRender === 'function') cgRender();
        return;
      }
      const secLink = e.target.closest('#cg-section-pills .nav-link');
      if (secLink) {
        e.preventDefault();
        if (typeof cgSetActiveSection === 'function') cgSetActiveSection(secLink.dataset.section);
        if (typeof cgRenderPills === 'function') cgRenderPills();
        if (typeof cgRender === 'function') cgRender();
        return;
      }
      const addBtn = e.target.closest('#cg-btn-add');
      if (addBtn) {
        e.preventDefault();
        if (typeof cgOpenModal === 'function') cgOpenModal('add');
        return;
      }
      const impBtn = e.target.closest('#cg-btn-import');
      if (impBtn) {
        e.preventDefault();
        if (typeof cgImportSample === 'function') cgImportSample();
      }
    }, true);
  }

  document.addEventListener('DOMContentLoaded', cgBootOnce);
  if (typeof MutationObserver !== 'undefined' && !window.__cgMO) {
    window.__cgMO = new MutationObserver((mutList, mo) => {
      if (cgIsPresent()) {
        cgBootOnce();
        try { mo.disconnect(); } catch (_) {}
        window.__cgMO = null;
      }
    });
    if (document.body) {
      window.__cgMO.observe(document.body, { childList: true, subtree: true });
    }
  }
  cgBootOnce();

  function bindHousing() {
    const panel = document.getElementById('panel-housing');
    if (!panel) return;

    setText('#res-building', HOUSING_DEMO.building);
    setText('#res-floor', HOUSING_DEMO.floor);
    setText('#res-room', HOUSING_DEMO.room);
    fillList(qs('#res-roommates'), HOUSING_DEMO.roommates);

    ensureDemoAcks();
    wireCopyRoomInfo();
    bindAddressModal();
    document.querySelectorAll('#res-roommates a[title="PENDING"]').forEach((link) => {
      if (link.dataset.bound === 'true') return;
      link.addEventListener('click', (event) => event.preventDefault());
      link.dataset.bound = 'true';
    });

    const panelBound = panel.dataset.housingBound === 'true';
    const chkRules = qs('#ack-housing-rules');
    const chkClean = qs('#ack-cleaning-code');
    const btnDLRules = qs('#btn-download-housing-rules');
    const btnDLClean = qs('#btn-download-cleaning-code');

    const rulesAcked = localStorage.getItem(LS.ACK_RULES) === '1';
    const cleanAcked = localStorage.getItem(LS.ACK_CLEAN) === '1';
    if (chkRules) chkRules.checked = rulesAcked;
    if (chkClean) chkClean.checked = cleanAcked;
    if (btnDLRules) btnDLRules.disabled = !rulesAcked;
    if (btnDLClean) btnDLClean.disabled = !cleanAcked;
    updateAckBadges();

    if (!panelBound && chkRules) {
      chkRules.addEventListener('change', () => {
        if (chkRules.checked) {
          localStorage.setItem(LS.ACK_RULES, '1');
          localStorage.setItem(LS.ACK_RULES_AT, new Date().toISOString());
          if (btnDLRules) btnDLRules.disabled = false;
        } else {
          localStorage.removeItem(LS.ACK_RULES);
          localStorage.removeItem(LS.ACK_RULES_AT);
          if (btnDLRules) btnDLRules.disabled = true;
        }
        updateAckBadges();
      });
    }

    if (!panelBound && chkClean) {
      chkClean.addEventListener('change', () => {
        if (chkClean.checked) {
          localStorage.setItem(LS.ACK_CLEAN, '1');
          localStorage.setItem(LS.ACK_CLEAN_AT, new Date().toISOString());
          if (btnDLClean) btnDLClean.disabled = false;
        } else {
          localStorage.removeItem(LS.ACK_CLEAN);
          localStorage.removeItem(LS.ACK_CLEAN_AT);
          if (btnDLClean) btnDLClean.disabled = true;
        }
        updateAckBadges();
      });
    }

    if (!panelBound && btnDLRules) {
      btnDLRules.addEventListener('click', () => {
        const at = localStorage.getItem(LS.ACK_RULES_AT) || new Date().toISOString();
        const text = [
          'ETURE — Housing Rules',
          '',
          '1) Quiet hours from 22:00 to 08:00.',
          '2) No guests after 21:00 without prior permission.',
          '3) Keep common areas clean and tidy.',
          '4) Report damages immediately to staff.',
          '',
          `Acknowledged at: ${at}`
        ].join('\n');
        downloadText('HousingRules.txt', text);
      });
    }

    if (!panelBound && btnDLClean) {
      btnDLClean.addEventListener('click', () => {
        const at = localStorage.getItem(LS.ACK_CLEAN_AT) || new Date().toISOString();
        const text = [
          'ETURE — Cleaning Code',
          '',
          '• Daily: make your bed and keep your room organized.',
          '• Weekly: take out trash and clean surfaces.',
          '• Bathroom: leave it clean after every use.',
          '• Kitchen: wash dishes and wipe counters after cooking.',
          '',
          `Acknowledged at: ${at}`
        ].join('\n');
        downloadText('CleaningCode.txt', text);
      });
    }

    bindDiningNotes(panelBound);

    if (!panelBound) {
      panel.dataset.housingBound = 'true';
    }
  }

  function parseISO(d) {
    if (!d) return null;
    const parts = d.split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
    const dt = new Date(parts[0], parts[1] - 1, parts[2]);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
const fmtMonth = new Intl.DateTimeFormat('en-US', { month: 'short' });
const fmtMD = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const fmtY = new Intl.DateTimeFormat('en-US', { year: 'numeric' });

function toYMD(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const clone = new Date(date.getTime());
  clone.setHours(12, 0, 0, 0);
  return clone.toISOString().slice(0, 10);
}

function ymdToDate(ymd) {
  if (!ymd || typeof ymd !== 'string') return null;
  const parts = ymd.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(`${parts[0].toString().padStart(4, '0')}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}T12:00:00`);
}

function dmyToYmd(dmy) {
  if (!dmy || typeof dmy !== 'string') return '';
  const [dd = '', mm = '', yy = ''] = dmy.split(/[-\/.]/).map((chunk) => chunk.trim());
  if (!dd || !mm || !yy) return '';
  const year = yy.length === 2 ? `20${yy}` : yy.padStart(4, '0');
  return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function prettyRange(startYMD, endYMD) {
  if (!startYMD || !endYMD) return `${startYMD || '—'} – ${endYMD || '—'}`;
  const partsA = startYMD.split('-').map(Number);
  const partsB = endYMD.split('-').map(Number);
    if (partsA.length !== 3 || partsB.length !== 3 || partsA.some(Number.isNaN) || partsB.some(Number.isNaN)) {
      return `${startYMD} – ${endYMD}`;
    }
    const dA = new Date(partsA[0], partsA[1] - 1, partsA[2]);
    const dB = new Date(partsB[0], partsB[1] - 1, partsB[2]);
    const fmt = (date, opts) => date.toLocaleDateString(undefined, opts);
    const sameYear = dA.getFullYear() === dB.getFullYear();
    const sameMonth = sameYear && dA.getMonth() === dB.getMonth();
    if (sameMonth) {
      return `${fmt(dA, { month: 'short', day: 'numeric' })}–${fmt(dB, { day: 'numeric' })}, ${fmt(dA, { year: 'numeric' })}`;
    }
    if (sameYear) {
      return `${fmt(dA, { month: 'short', day: 'numeric' })} – ${fmt(dB, { month: 'short', day: 'numeric' })}, ${fmt(dA, { year: 'numeric' })}`;
    }
    return `${fmt(dA, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmt(dB, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  function findNextIndex(ranges) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!Array.isArray(ranges)) return -1;
    for (let i = 0; i < ranges.length; i += 1) {
      const item = ranges[i] || {};
      if (item.date) {
        const d = parseISO(item.date);
        if (d && d >= today) return i;
      } else {
        const s = parseISO(item.start);
        const e = parseISO(item.end);
        if (e && e >= today) return i;
      }
    }
    return -1;
  }

  window.parseISO = parseISO;
  window.prettyRange = prettyRange;
  window.addDaysISO = addDaysISO;

  const CAL_STORAGE_KEY = 'calendar_demo';
  // TODO: paste the official list of Game Weeks and Breaks here (CSV-to-JSON ok).
  const CAL_SAMPLE_GAME_WEEKS = [
    { start: '2025-09-13', end: '2025-09-14', note: 'Jornada 1 – Eture FC vs TBD' },
    { start: '2025-09-20', end: '2025-09-21', note: 'Jornada 2 – Away' },
    { start: '2025-09-27', end: '2025-09-28', note: 'Jornada 3 – Home' }
  ];
  const CAL_SAMPLE_BREAKS = [
    { start: '2025-12-21', end: '2026-01-05', note: 'Winter break' },
    { start: '2026-03-28', end: '2026-03-30', note: 'Easter break' },
    { start: '2026-05-01', end: '2026-05-03', note: 'Free weekend' }
  ];
  const CAL_SAMPLE_CLASSES = [
    'Spanish class every day 2–3 p.m. at Resi 2'
  ];
  // TODO(SHOWCASE): adjust dates/location if edition changes.
  const CAL_SAMPLE_SHOWCASE = {
    start: '2026-02-09',
    end: '2026-02-11',
    when: 'Feb 9–11, 2026',
    where: 'Eture Sports Campus, Valencia, Spain',
    mapsUrl: 'https://maps.google.com/?q=Eture+Sports,Valencia',
    agenda: [
      'Mon 9: Coaches reception & hotel check-in',
      'Mon 9: Inaugural Cocktail 8:30–11:30 PM',
      'Tue 10: Showcase games 8:00 AM–5:00 PM (lunch on field) • Dinner: MasFerrat',
      'Wed 11: Showcase games 8:00 AM–5:00 PM (lunch on field)',
      'Wed 11: Transfer to ETURE FC Stadium 5:00 PM • ETURE FC Game 7:00 PM • Dinner: BBQ',
      'Thu 12: 1:1 coach meetings 10:30 AM–2:00 PM • Lunch downtown • Meetings continue'
    ]
  };

  function emptyShowcase() {
    return { start: '', end: '', when: '', where: '', mapsUrl: '', agenda: [] };
  }

  function calDefaults() {
    return {
      gameWeeks: [],
      breaks: [],
      classes: CAL_SAMPLE_CLASSES.slice(),
      showcase: emptyShowcase()
    };
  }

  let calendarState = calDefaults();
  let calendarBound = false;

  function sanitizeGameWeeks(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const modern = [];
    const legacy = [];

    list.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      if (typeof item.date === 'string' || typeof item.md === 'number' || item.opponent || item.field) {
        const date = (item.date || '').trim().slice(0, 10);
        if (!date) return;
        const mdVal = Number(item.md);
        const opponent = typeof item.opponent === 'string' ? item.opponent.trim() : '';
        const fieldRaw = item.field && typeof item.field === 'object' ? item.field : {};
        const field = {
          side: fieldRaw.side === 'Away' ? 'Away' : 'Home',
          name: typeof fieldRaw.name === 'string' ? fieldRaw.name.trim() : ''
        };
        const key = `new|${date}|${field.side}|${field.name}|${opponent}`.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        modern.push({
          md: Number.isFinite(mdVal) && mdVal > 0 ? mdVal : 0,
          date,
          opponent,
          field
        });
      } else {
        const start = toISODate(item.start || '');
        const end = toISODate(item.end || '');
        const note = typeof item.note === 'string' ? item.note.trim() : '';
        if (!start && !end && !note) return;
        const key = `legacy|${start}|${end}|${note}`.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        legacy.push({ start, end, note });
      }
    });

    if (modern.length) {
      modern.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      modern.forEach((entry, idx) => {
        entry.md = idx + 1;
      });
      return modern;
    }

    return legacy;
  }

  function sanitizeBreaks(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    list.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const start = toISODate(item.start || '');
      const end = toISODate(item.end || '');
      const note = typeof item.note === 'string' ? item.note.trim() : '';
      const holiday = typeof item.holiday === 'string' ? item.holiday.trim() : '';
      const label = holiday || note;
      if (!start && !end && !label) return;
      const key = `${start}|${end}|${label}`.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ start, end, holiday: label, note: label });
    });
    out.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    return out;
  }

  function sanitizeStringList(list) {
    const seen = new Set();
    const out = [];
    if (!Array.isArray(list)) return out;
    list.forEach((value) => {
      const str = typeof value === 'string' ? value.trim() : '';
      if (!str) return;
      const key = str.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(str);
    });
    return out;
  }

  function sanitizeShowcase(data) {
    const base = emptyShowcase();
    if (!data || typeof data !== 'object') return base;
    base.start = toISODate(data.start || '');
    base.end = toISODate(data.end || '');
    base.when = typeof data.when === 'string' ? data.when.trim() : '';
    base.where = typeof data.where === 'string' ? data.where.trim() : '';
    base.mapsUrl = typeof data.mapsUrl === 'string' ? data.mapsUrl.trim() : '';
    base.agenda = sanitizeStringList(data.agenda);
    return base;
  }

  function getCal() {
    try {
      const raw = localStorage.getItem(CAL_STORAGE_KEY);
      if (!raw) return calDefaults();
      const parsed = JSON.parse(raw) || {};
      const hasClassesProp = Object.prototype.hasOwnProperty.call(parsed, 'classes');
      return {
        gameWeeks: sanitizeGameWeeks(parsed.gameWeeks),
        breaks: sanitizeBreaks(parsed.breaks),
        classes: hasClassesProp ? sanitizeStringList(parsed.classes) : CAL_SAMPLE_CLASSES.slice(),
        showcase: sanitizeShowcase(parsed.showcase)
      };
    } catch (_) {
      return calDefaults();
    }
  }

  function setCal(next) {
    const sanitized = {
      gameWeeks: sanitizeGameWeeks(next && next.gameWeeks),
      breaks: sanitizeBreaks(next && next.breaks),
      classes: sanitizeStringList(next && next.classes),
      showcase: sanitizeShowcase(next && next.showcase)
    };
    localStorage.setItem(CAL_STORAGE_KEY, JSON.stringify(sanitized));
    calendarState = sanitized;
    return calendarState;
  }

  function wipeSection(sectionKey) {
    const next = { ...calendarState };
    if (sectionKey === 'gameWeeks') {
      next.gameWeeks = [];
    } else if (sectionKey === 'breaks') {
      next.breaks = [];
    } else if (sectionKey === 'classes') {
      next.classes = [];
    } else if (sectionKey === 'showcase') {
      next.showcase = emptyShowcase();
    }
    setCal(next);
  }

  function formatCalRange(start, end) {
    if (!start || !end) {
      const s = (start || '').trim() || '—';
      const e = (end || '').trim() || '—';
      return `${s}→${e}`;
    }
    return prettyRange(start, end);
  }

  function yyyymmdd(iso) {
    const d = parseISO(iso);
    if (!d) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }

  function addDaysISO(iso, n) {
    const d = parseISO(iso);
    if (!d) return '';
    d.setDate(d.getDate() + Number(n || 0));
    return toISODate(d);
  }

  function exportShowcaseICS(sc) {
    if (!sc || !sc.start || !sc.end) {
      alert('Showcase dates not set');
      return;
    }
    const dtstamp = toISODate(new Date()).replace(/-/g, '') + 'T000000Z';
    const dtStart = yyyymmdd(sc.start);
    const dtEndExclusive = yyyymmdd(addDaysISO(sc.end, 1));
    if (!dtStart || !dtEndExclusive) {
      alert('Showcase dates not set');
      return;
    }
    const agenda = Array.isArray(sc.agenda) ? sc.agenda : [];
    const desc = agenda.join(' • ').replace(/\r?\n/g, ' ');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Eture//Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${dtStart}`,
      `DTEND;VALUE=DATE:${dtEndExclusive}`,
      'SUMMARY:Eture Showcase',
      `LOCATION:${sc.where || ''}`,
      `DESCRIPTION:${desc}`,
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Eture-Showcase.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function makeDeleteButton(index) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-link text-danger';
    btn.dataset.del = String(index);
    btn.textContent = 'Delete';
    return btn;
  }

  function renderEmptyMessage(listEl, text) {
    const li = document.createElement('li');
    li.className = 'text-muted small fst-italic py-1';
    li.textContent = text;
    listEl.appendChild(li);
  }

  function renderGameWeeks() {
    (function () {
      const fmtDate = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return String(iso);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      };
      const venueLabel = (side) => {
        const s = String(side || '').toLowerCase();
        return s.includes('away') ? '✈️ Away' : '🏠 Home';
      };
      const normalizeWeeks = (weeks) => {
        if (!Array.isArray(weeks)) return [];
        return weeks.map((w, idx) => {
          const md = Number.isFinite(Number(w.md)) && Number(w.md) > 0 ? Number(w.md) : (idx + 1);
          const iso = (w.date || w.start || '').toString();
          const opp = (w.opponent || '').toString().trim();
          let side = '';
          if (w.field && typeof w.field === 'object') side = w.field.side || '';
          else side = String(w.field || '').toLowerCase();
          return { md, date: fmtDate(iso), opponent: opp, venue: venueLabel(side) };
        });
      };

      const container =
        document.getElementById('cal-gw-list') ||
        document.querySelector('#game-weeks') ||
        document.querySelector('[data-card="game-weeks"]') ||
        (typeof getGameWeeksContainer === 'function' ? getGameWeeksContainer() : null);

      const state = (typeof getCalSafe === 'function') ? (getCalSafe() || {}) :
        (typeof calendarState === 'object' ? calendarState : {});
      const weeks = normalizeWeeks(state.gameWeeks);

      const wrapper =
        (container && container.querySelector && container.querySelector('.card-body'))
          ? container.querySelector('.card-body')
          : container;

      if (!wrapper) return;

      const tableHtml = `
        <table class="table table-sm mb-0">
          <thead>
            <tr>
              <th style="width:90px;">Matchday</th>
              <th style="width:170px;">Date</th>
              <th>Opponent</th>
              <th style="width:130px;">Venue</th>
            </tr>
          </thead>
          <tbody>
            ${
              !weeks.length
                ? `<tr><td colspan="4" class="text-muted small">No items yet.</td></tr>`
                : weeks.map(r => `
                    <tr>
                      <td>${r.md}</td>
                      <td>${r.date}</td>
                      <td>${r.opponent || ''}</td>
                      <td>${r.venue}</td>
                    </tr>
                  `).join('')
            }
          </tbody>
        </table>
      `;

      wrapper.innerHTML = tableHtml;
    })();
  }

  function renderBreaks() {
    (function () {
      const getState = () => {
        if (typeof getCalSafe === 'function') return getCalSafe() || {};
        if (typeof calendarState === 'object' && calendarState) return calendarState;
        try { return JSON.parse(localStorage.getItem('calendar_demo') || '{}') || {}; } catch { return {}; }
      };
      const normalizeBreaks = (list) => {
        if (!Array.isArray(list)) return [];
        return list.map(b => ({
          start: (b.start || '').toString(),
          end: (b.end || '').toString(),
          holiday: (b.holiday || b.note || '').toString()
        }));
      };

      const container =
        document.getElementById('cal-breaks-list') ||
        document.querySelector('#breaks-card') ||
        document.querySelector('[data-card="breaks"]') ||
        document.querySelector('#breaks-and-holidays') ||
        (typeof getBreaksContainer === 'function' ? getBreaksContainer() : null);

      const state = getState();
      const rows = normalizeBreaks(state.breaks);

      const wrapper = (container && container.querySelector?.('.card-body')) ? container.querySelector('.card-body') : container;
      if (!wrapper) return;

      const tableHtml = `
        <table class="table table-sm mb-0">
          <thead>
            <tr>
              <th style="width:170px;">Start</th>
              <th style="width:170px;">End</th>
              <th>Holiday</th>
            </tr>
          </thead>
          <tbody>
            ${
              !rows.length
                ? `<tr><td colspan="3" class="text-muted small">No items yet.</td></tr>`
                : rows.map(r => `
                  <tr>
                    <td>${r.start}</td>
                    <td>${r.end}</td>
                    <td>${r.holiday}</td>
                  </tr>
                `).join('')
            }
          </tbody>
        </table>
      `;
      wrapper.innerHTML = tableHtml;
    })();
  }

  function renderClasses() {
    const listEl = document.getElementById('cal-classes-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    const rows = Array.isArray(calendarState.classes) ? calendarState.classes : [];
    if (!rows.length) {
      renderEmptyMessage(listEl, 'No class hours saved yet.');
      return;
    }
    rows.forEach((entry, index) => {
      const li = document.createElement('li');
      li.className = 'd-flex align-items-center justify-content-between border-bottom py-1';
      const span = document.createElement('span');
      span.className = 'flex-grow-1 me-2 text-break';
      span.textContent = entry;
      li.appendChild(span);
      li.appendChild(makeDeleteButton(index));
      listEl.appendChild(li);
    });
  }

  function renderShowcase() {
    const data = calendarState.showcase || emptyShowcase();
    const infoEl = document.getElementById('sc-when-where');
    if (infoEl) {
      infoEl.innerHTML = '';
      const autoWhen = (!data.when && data.start && data.end) ? prettyRange(data.start, data.end) : '';
      const whenText = data.when || autoWhen;
      const hasWhen = Boolean(whenText);
      const hasWhere = Boolean(data.where);
      if (!hasWhen && !hasWhere) {
        const p = document.createElement('p');
        p.className = 'text-muted small mb-0';
        p.textContent = 'No showcase details saved yet.';
        infoEl.appendChild(p);
      } else {
        if (hasWhen) {
          const whenEl = document.createElement('div');
          whenEl.className = 'fw-semibold';
          whenEl.textContent = whenText;
          infoEl.appendChild(whenEl);
        }
        if (hasWhere) {
          const whereEl = document.createElement('div');
          whereEl.className = 'text-muted';
          whereEl.textContent = data.where;
          infoEl.appendChild(whereEl);
        }
      }
    }
    const agendaEl = document.getElementById('sc-agenda-list');
    if (agendaEl) {
      agendaEl.innerHTML = '';
      const agenda = Array.isArray(data.agenda) ? data.agenda : [];
      if (!agenda.length) {
        const li = document.createElement('li');
        li.className = 'text-muted small fst-italic';
        li.textContent = 'Agenda coming soon.';
        agendaEl.appendChild(li);
      } else {
        agenda.forEach((line) => {
          const li = document.createElement('li');
          li.textContent = line;
          agendaEl.appendChild(li);
        });
      }
    }
    const mapsBtn = document.getElementById('sc-maps-link');
    if (mapsBtn) {
      const hasUrl = Boolean(data.mapsUrl);
      mapsBtn.href = hasUrl ? data.mapsUrl : '#';
      mapsBtn.classList.toggle('disabled', !hasUrl);
      mapsBtn.setAttribute('aria-disabled', hasUrl ? 'false' : 'true');
      mapsBtn.tabIndex = hasUrl ? 0 : -1;
      mapsBtn.target = hasUrl ? '_blank' : '_self';
      mapsBtn.title = hasUrl ? 'Open in Google Maps' : 'No showcase location yet.';
    }
  }

  function renderCalendarAll() {
    renderGameWeeks();
    renderBreaks();
    renderClasses();
    renderShowcase();
  }

  window.renderCalendarAll = function () {
    calendarState = getCal();
    renderCalendarAll();
  };
  window.renderGameWeeks = function () {
    calendarState = getCal();
    renderGameWeeks();
  };
  window.renderBreaks = function () {
    calendarState = getCal();
    renderBreaks();
  };
  window.renderShowcase = function () {
    calendarState = getCal();
    renderShowcase();
  };

  function attachDeleteHandler(listId, sectionKey, renderFn) {
    const listEl = document.getElementById(listId);
    if (!listEl || listEl.dataset.calBound === 'true') return;
    listEl.addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-del]');
      if (!btn) return;
      event.preventDefault();
      const idx = Number(btn.dataset.del || '-1');
      if (Number.isNaN(idx)) return;
      const next = { ...calendarState };
      const arr = Array.isArray(next[sectionKey]) ? next[sectionKey].slice() : [];
      if (idx < 0 || idx >= arr.length) return;
      arr.splice(idx, 1);
      next[sectionKey] = arr;
      setCal(next);
      renderFn();
    });
    listEl.dataset.calBound = 'true';
  }

  function importGameWeeks() {
    const next = { ...calendarState };
    next.gameWeeks = sanitizeGameWeeks([...calendarState.gameWeeks, ...CAL_SAMPLE_GAME_WEEKS]);
    setCal(next);
    renderGameWeeks();
  }

  function importBreaks() {
    const next = { ...calendarState };
    next.breaks = sanitizeBreaks([...calendarState.breaks, ...CAL_SAMPLE_BREAKS]);
    setCal(next);
    renderBreaks();
  }

  function clearGameWeeks() {
    wipeSection('gameWeeks');
    renderGameWeeks();
  }

  function clearBreaks() {
    wipeSection('breaks');
    renderBreaks();
  }

  function clearClasses() {
    wipeSection('classes');
    renderClasses();
  }

  function addClassEntry() {
    const input = document.getElementById('cls-text');
    if (!input) return;
    const value = (input.value || '').trim();
    if (!value) {
      if (typeof markInvalid === 'function') markInvalid(input);
      return;
    }
    const next = { ...calendarState };
    next.classes = sanitizeStringList([value, ...calendarState.classes]);
    setCal(next);
    input.value = '';
    renderClasses();
  }

  function importShowcase() {
    const next = { ...calendarState };
    next.showcase = sanitizeShowcase(CAL_SAMPLE_SHOWCASE);
    setCal(next);
    renderShowcase();
  }

  function clearShowcase() {
    wipeSection('showcase');
    renderShowcase();
  }

  function bindCalendar() {
    const panel = document.getElementById('panel-calendar');
    if (!panel) return;
    calendarState = getCal();
    renderCalendarAll();

    if (calendarBound) return;

    const btnGwImport = document.getElementById('btn-gw-import');
    if (btnGwImport) btnGwImport.addEventListener('click', importGameWeeks);
    const btnGwClear = document.getElementById('btn-gw-clear');
    if (btnGwClear) btnGwClear.addEventListener('click', clearGameWeeks);

    const btnBreaksImport = document.getElementById('btn-breaks-import');
    if (btnBreaksImport) btnBreaksImport.addEventListener('click', importBreaks);
    const btnBreaksClear = document.getElementById('btn-breaks-clear');
    if (btnBreaksClear) btnBreaksClear.addEventListener('click', clearBreaks);

    const btnClsAdd = document.getElementById('btn-cls-add');
    if (btnClsAdd) btnClsAdd.addEventListener('click', addClassEntry);
    const clsInput = document.getElementById('cls-text');
    if (clsInput) {
      clsInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (btnClsAdd) {
            btnClsAdd.click();
          } else {
            addClassEntry();
          }
        }
      });
    }
    const btnClsClear = document.getElementById('btn-cls-clear');
    if (btnClsClear) btnClsClear.addEventListener('click', clearClasses);

    const btnScImport = document.getElementById('btn-sc-import');
    if (btnScImport) btnScImport.addEventListener('click', importShowcase);
    const btnScIcs = document.getElementById('btn-sc-ics');
    if (btnScIcs) btnScIcs.addEventListener('click', () => exportShowcaseICS(calendarState.showcase));
    const btnScClear = document.getElementById('btn-sc-clear');
    if (btnScClear) btnScClear.addEventListener('click', clearShowcase);

    attachDeleteHandler('cal-gw-list', 'gameWeeks', renderGameWeeks);
    attachDeleteHandler('cal-breaks-list', 'breaks', renderBreaks);
    attachDeleteHandler('cal-classes-list', 'classes', renderClasses);

    calendarBound = true;

    if (typeof window.initCalendarImporters === 'function') {
      window.initCalendarImporters();
    }
  }

  function getTrips() {
    try {
      const raw = localStorage.getItem(TRIP_STORAGE_KEY) || '[]';
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(item => item && typeof item === 'object' && typeof item.id === 'string');
    } catch (_) {
      return [];
    }
  }

  function setTrips(arr) {
    const value = Array.isArray(arr) ? arr : [];
    localStorage.setItem(TRIP_STORAGE_KEY, JSON.stringify(value));
  }

  function getTripToast() {
    if (tripToastInstance) return tripToastInstance;
    const toastEl = document.getElementById('trip-saved-toast');
    if (!toastEl || !(window.bootstrap && window.bootstrap.Toast)) return null;
    tripToastInstance = window.bootstrap.Toast.getOrCreateInstance(toastEl);
    return tripToastInstance;
  }

  function resolveLocation(value, otherText) {
    switch (value) {
      case 'cdt':
        return 'CDT';
      case 'vlc':
        return 'VLC';
      case 'bcn-t1':
        return 'BCN T1';
      case 'bcn-t2':
        return 'BCN T2';
      case 'vln-train':
        return 'Valencia Train';
      case 'other':
        return otherText.trim() || 'Other';
      default:
        return value || 'Other';
    }
  }

  function normalizeTimestamp(dateISO, time) {
    const date = dateISO || '';
    const t = time || '00:00';
    const candidate = Date.parse(`${date}T${t}`);
    return Number.isFinite(candidate) ? candidate : Date.now();
  }

  function fmtMMDDYYYY(ts) {
    const numericTs = Number(ts);
    const base = Number.isFinite(numericTs) ? new Date(numericTs) : new Date();
    const validDate = Number.isNaN(base.getTime()) ? new Date() : base;
    const mm = String(validDate.getMonth() + 1).padStart(2, '0');
    const dd = String(validDate.getDate()).padStart(2, '0');
    const yyyy = validDate.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }

  function renderTripList(listEl, trips, { emptyText = 'No trips yet — saved trips will appear here.', disableRide = false } = {}) {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!trips.length) {
      const empty = document.createElement('li');
      empty.className = 'list-group-item text-muted small';
      empty.textContent = emptyText;
      listEl.appendChild(empty);
      return;
    }

    trips.forEach(trip => {
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-start gap-3';

      const left = document.createElement('div');

      const badgeRow = document.createElement('div');
      badgeRow.className = 'mb-1';

      const typeBadge = document.createElement('span');
      typeBadge.className = 'badge bg-primary me-1 text-capitalize';
      typeBadge.textContent = trip.type || 'arrival';
      badgeRow.appendChild(typeBadge);

      const locationBadge = document.createElement('span');
      locationBadge.className = 'badge bg-secondary';
      locationBadge.textContent = trip.location || '—';
      badgeRow.appendChild(locationBadge);

      left.appendChild(badgeRow);

      const summary = document.createElement('div');
      const summaryStrong = document.createElement('strong');
      const dateLabel = fmtMMDDYYYY(trip.ts);
      const timeLabel = trip.time || '';
      summaryStrong.textContent = timeLabel ? `${dateLabel} ${timeLabel}` : dateLabel;
      summary.appendChild(summaryStrong);
      summary.append(' · ');
      summary.append(trip.number ? trip.number : '—');

      left.appendChild(summary);

      const actions = document.createElement('div');
      actions.className = 'd-flex flex-column gap-1';

      const rideBtn = document.createElement('button');
      rideBtn.className = 'btn btn-sm btn-outline-primary w-100';
      rideBtn.type = 'button';
      rideBtn.dataset.act = 'ride';
      rideBtn.dataset.id = trip.id;
      if (disableRide) {
        rideBtn.textContent = 'Request Ride';
        rideBtn.disabled = true;
        rideBtn.title = 'Not available for past trips';
      } else {
        const rideRequested = Boolean(trip.rideRequested);
        rideBtn.textContent = rideRequested ? 'Ride Requested' : 'Request Ride';
        if (rideRequested) {
          rideBtn.disabled = true;
        }
      }

      const msgBtn = document.createElement('button');
      msgBtn.className = 'btn btn-sm btn-outline-secondary w-100';
      msgBtn.type = 'button';
      msgBtn.dataset.act = 'msg';
      msgBtn.dataset.id = trip.id;
      msgBtn.disabled = true;
      msgBtn.title = 'Driver not assigned yet';
      msgBtn.textContent = 'Message Driver';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-sm btn-outline-danger w-100';
      removeBtn.type = 'button';
      removeBtn.dataset.act = 'remove';
      removeBtn.dataset.id = trip.id;
      removeBtn.textContent = 'Remove';

      actions.appendChild(rideBtn);
      actions.appendChild(msgBtn);
      actions.appendChild(removeBtn);

      li.appendChild(left);
      li.appendChild(actions);

      listEl.appendChild(li);
    });
  }

  function renderTrips() {
    const upcomingList = document.getElementById('trips-upcoming-list');
    const pastList = document.getElementById('trips-past-list');
    if (!upcomingList && !pastList) return;

    const trips = getTrips().map(trip => {
      const numericTs = Number(trip.ts);
      return {
        id: trip.id,
        type: trip.type === 'departure' ? 'departure' : 'arrival',
        location: trip.location || '—',
        dateISO: trip.dateISO || '',
        time: trip.time || '',
        number: trip.number || '',
        ts: Number.isFinite(numericTs) ? numericTs : normalizeTimestamp(trip.dateISO, trip.time),
        rideRequested: Boolean(trip.rideRequested),
        driverAssigned: Boolean(trip.driverAssigned)
      };
    });

    const now = Date.now();
    const upcoming = [];
    const past = [];

    trips.forEach(trip => {
      if ((trip.ts || 0) >= now) {
        upcoming.push(trip);
      } else {
        past.push(trip);
      }
    });

    upcoming.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    past.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    if (upcomingList) {
      renderTripList(upcomingList, upcoming, {
        emptyText: 'No trips yet — saved trips will appear here.'
      });
    }
    if (pastList) {
      renderTripList(pastList, past, {
        emptyText: 'No past trips.',
        disableRide: true
      });
    }
  }

  function markInvalid(el) {
    if (!el) return;
    el.classList.add('is-invalid');
    window.setTimeout(() => el.classList.remove('is-invalid'), 2000);
  }

  function saveTripFromForm() {
    const typeSel = document.getElementById('trip-type');
    const locationSel = document.getElementById('trip-location');
    const otherInput = document.getElementById('trip-location-other');
    const dateInput = document.getElementById('trip-date');
    const timeInput = document.getElementById('trip-time');
    const numberInput = document.getElementById('trip-number');

    if (!typeSel || !locationSel || !dateInput || !timeInput || !numberInput) return;

    const type = typeSel.value === 'departure' ? 'departure' : 'arrival';
    const locationValue = locationSel.value || '';
    const otherValue = otherInput ? otherInput.value : '';
    const dateISO = dateInput.value || '';
    const time = timeInput.value || '';
    const number = numberInput.value ? numberInput.value.trim() : '';

    let hasError = false;
    if (!dateISO) {
      markInvalid(dateInput);
      hasError = true;
    }
    if (!time) {
      markInvalid(timeInput);
      hasError = true;
    }
    if (!locationValue) {
      markInvalid(locationSel);
      hasError = true;
    }

    if (hasError) {
      alert('Please select date, time, and location.');
      return;
    }

    const location = resolveLocation(locationValue, otherValue || '');
    const ts = normalizeTimestamp(dateISO, time);
    const newTrip = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      location,
      dateISO,
      time,
      number,
      ts,
      rideRequested: false,
      driverAssigned: false
    };

    const trips = getTrips();
    trips.push(newTrip);
    setTrips(trips);
    renderTrips();

    const toast = getTripToast();
    if (toast) toast.show();

    dateInput.value = '';
    timeInput.value = '';
    numberInput.value = '';
    numberInput.focus();
  }

  function hideExtraTripButtons() {
    const form = document.getElementById('future-trip-form');
    if (!form) return;
    form.querySelectorAll('button').forEach(btn => {
      if (btn.id !== 'btn-save-trip') {
        btn.style.display = 'none';
      }
    });
  }

  function bindTripForm() {
    const saveBtn = document.getElementById('btn-save-trip');
    if (!saveBtn) return;
    saveBtn.addEventListener('click', saveTripFromForm);
  }

  function handleTripsClick(ev) {
    const btn = ev.target.closest('button[data-act][data-id]');
    if (!btn || btn.disabled) return;
    const id = btn.dataset.id;
    if (!id) return;

    const action = btn.dataset.act;
    if (action === 'msg') {
      ev.preventDefault();
      return;
    }

    const trips = getTrips();
    const idx = trips.findIndex(item => item && item.id === id);
    if (idx === -1) return;

    if (action === 'remove') {
      trips.splice(idx, 1);
      setTrips(trips);
      renderTrips();
      return;
    }

    if (action === 'ride') {
      if (!trips[idx].rideRequested) {
        trips[idx].rideRequested = true;
        setTrips(trips);
        renderTrips();
      }
    }
  }

  function bindTripActions() {
    const upcomingList = document.getElementById('trips-upcoming-list');
    const pastList = document.getElementById('trips-past-list');
    if (upcomingList) {
      upcomingList.addEventListener('click', handleTripsClick);
    }
    if (pastList) {
      pastList.addEventListener('click', handleTripsClick);
    }
  }

  function updateInitialArrivalBanner() {
    const banner = document.getElementById('travel-initial-banner');
    if (!banner) return;
    const infoContainer = banner.querySelector('.d-flex.align-items-center.gap-2 span');
    const button = banner.querySelector('a');
    if (!infoContainer || !button) return;

    const done = localStorage.getItem('initialArrivalDone') === '1';
    const info = localStorage.getItem('initialArrivalInfo');

    if (done && info) {
      infoContainer.innerHTML = '';
      const strong = document.createElement('strong');
      strong.textContent = 'Initial arrival saved —';
      infoContainer.appendChild(strong);
      infoContainer.append(' ');
      infoContainer.append(info);
      button.textContent = 'View in My Visa';
    } else {
      infoContainer.innerHTML = '';
      const strong = document.createElement('strong');
      strong.textContent = 'Initial arrival:';
      infoContainer.appendChild(strong);
      infoContainer.append(' Set your first trip in ');
      const em = document.createElement('em');
      em.textContent = 'My Visa';
      infoContainer.appendChild(em);
      infoContainer.append(' (no duplication here).');
      button.textContent = 'Edit in My Visa';
    }
  }

  // --- Prepare Your Trip (Sizes + Packing) ---
  const PREP_SIZES_KEY = 'prepare_trip_sizes';
  const PREP_PACK_KEY = 'prepare_trip_checklist';
  const prep$ = (sel) => document.querySelector(sel);
  const prepAll = (sel) => Array.from(document.querySelectorAll(sel));

  function prepGetSizes() {
    try {
      return JSON.parse(localStorage.getItem(PREP_SIZES_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function prepSaveSizes(obj) {
    localStorage.setItem(PREP_SIZES_KEY, JSON.stringify(obj || {}));
  }

  function prepGetPack() {
    try {
      return JSON.parse(localStorage.getItem(PREP_PACK_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function prepSavePack(obj) {
    localStorage.setItem(PREP_PACK_KEY, JSON.stringify(obj || {}));
    prepUpdatePackCounter();
  }

  function prepToggleGK() {
    const box = prep$('#is-gk');
    const wrap = prep$('#gk-sizes');
    if (wrap) wrap.classList.toggle('d-none', !box?.checked);
  }

  function prepFillSizesForm() {
    const state = prepGetSizes();
    const setSelect = (sel, value) => {
      const el = prep$(sel);
      if (el && value) el.value = value;
    };
    setSelect('#sz-shirt', state.shirt);
    setSelect('#sz-shorts', state.shorts);
    setSelect('#sz-pants', state.pants);
    setSelect('#sz-socks', state.socks);
    setSelect('#sz-hoodie', state.hoodie);
    setSelect('#sz-jacket', state.jacket);
    const shoes = prep$('#sz-shoes');
    if (shoes) shoes.value = state.shoes || '';
    const gk = prep$('#is-gk');
    if (gk) gk.checked = Boolean(state.isGK);
    const gloves = prep$('#sz-gloves');
    if (gloves) gloves.value = state.gloves || '';
    const confirm = prep$('#sizes-confirm');
    if (confirm) confirm.checked = Boolean(state.confirm);
    prepToggleGK();
  }

  function prepBindSizes() {
    const form = prep$('#prep-sizes-form');
    if (!form || form.dataset.prepBound === 'true') return;
    form.dataset.prepBound = 'true';

    prep$('#is-gk')?.addEventListener('change', prepToggleGK);
    prep$('#btn-save-sizes')?.addEventListener('click', () => {
      const next = {
        shirt: prep$('#sz-shirt')?.value || '',
        shorts: prep$('#sz-shorts')?.value || '',
        pants: prep$('#sz-pants')?.value || '',
        socks: prep$('#sz-socks')?.value || '',
        hoodie: prep$('#sz-hoodie')?.value || '',
        jacket: prep$('#sz-jacket')?.value || '',
        shoes: prep$('#sz-shoes')?.value || '',
        isGK: Boolean(prep$('#is-gk')?.checked),
        gloves: prep$('#sz-gloves')?.value || '',
        confirm: Boolean(prep$('#sizes-confirm')?.checked)
      };
      prepSaveSizes(next);
      alert('Sizes saved');
    });
    prep$('#btn-sizes-summary')?.addEventListener('click', () => {
      prepShowSummary();
    });
  }

  function prepComputePackProgress() {
    const items = prepAll('.pack-item');
    const labels = [];
    let checked = 0;
    items.forEach((cb) => {
      const labelEl = cb.nextElementSibling;
      const labelText = labelEl ? labelEl.textContent.trim() : (cb.dataset.id || '');
      if (cb.checked) {
        checked += 1;
        if (labelText) labels.push(labelText);
      }
    });
    return { total: items.length, checked, labels };
  }

  function prepUpdatePackCounter() {
    const counter = prep$('#pack-counter');
    if (!counter) return;
    const { total, checked } = prepComputePackProgress();
    counter.textContent = `Progress: ${checked} / ${total} items packed`;
  }

  function prepBindPacking() {
    const items = prepAll('.pack-item');
    if (!items.length) return;
    const data = prepGetPack();
    items.forEach((cb) => {
      const id = cb.dataset.id;
      if (id) {
        cb.checked = Boolean(data[id]);
      }
      if (cb.dataset.prepBound === 'true') return;
      cb.dataset.prepBound = 'true';
      cb.addEventListener('change', () => {
        const next = prepGetPack();
        if (id) {
          next[id] = cb.checked;
        }
        prepSavePack(next);
      });
    });
    prepUpdatePackCounter();
  }

  function prepRenderSummary() {
    const sizesList = prep$('#prep-summary-sizes');
    const progressText = prep$('#prep-summary-progress');
    const packedList = prep$('#prep-summary-packed');
    if (sizesList) {
      sizesList.innerHTML = '';
      const sizes = prepGetSizes();
      const entries = [
        { label: 'Training T-shirt size', value: sizes.shirt || '-' },
        { label: 'Training Shorts size', value: sizes.shorts || '-' },
        { label: 'Sweatpants size', value: sizes.pants || '-' },
        { label: 'Socks size', value: sizes.socks || '-' },
        { label: 'Hoodie size', value: sizes.hoodie || '-' },
        { label: 'Jacket size', value: sizes.jacket || '-' },
        { label: 'Shoe size (US/EU)', value: sizes.shoes || '-' },
        { label: 'Goalkeeper', value: sizes.isGK ? 'Yes' : 'No' }
      ];
      if (sizes.isGK) {
        entries.push({ label: 'Gloves size', value: sizes.gloves || '-' });
      }
      entries.push({ label: 'Sizes confirmed', value: sizes.confirm ? 'Yes' : 'No' });

      entries.forEach(({ label, value }) => {
        const li = document.createElement('li');
        li.className = 'mb-1';
        li.innerHTML = `<strong>${label}:</strong> ${value || '-'}`;
        sizesList.appendChild(li);
      });
    }
    const { total, checked, labels } = prepComputePackProgress();
    if (progressText) {
      progressText.textContent = `Progress: ${checked} / ${total} items packed`;
    }
    if (packedList) {
      packedList.innerHTML = '';
      if (labels.length) {
        labels.forEach((label) => {
          const li = document.createElement('li');
          li.textContent = label;
          packedList.appendChild(li);
        });
      } else {
        const li = document.createElement('li');
        li.className = 'text-muted small';
        li.textContent = 'No items packed yet.';
        packedList.appendChild(li);
      }
    }
  }

  function prepShowSummary() {
    prepRenderSummary();
    const modalEl = prep$('#prep-summary-modal');
    if (!modalEl) return;
    if (window.bootstrap?.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
      return;
    }
    modalEl.classList.add('show');
    modalEl.style.display = 'block';
    modalEl.setAttribute('aria-hidden', 'false');
  }

  function prepBindSummaryModal() {
    const modal = prep$('#prep-summary-modal');
    if (!modal || modal.dataset.prepBound === 'true') return;
    modal.dataset.prepBound = 'true';
    const printBtn = prep$('#prep-summary-print');
    if (printBtn) {
      printBtn.addEventListener('click', () => window.print());
    }
    if (!window.bootstrap?.Modal) {
      modal.querySelectorAll('[data-bs-dismiss="modal"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          modal.classList.remove('show');
          modal.style.display = '';
          modal.setAttribute('aria-hidden', 'true');
        });
      });
    }
  }

  function renderPrepareTrip() {
    prepFillSizesForm();
    prepBindSizes();
    prepBindPacking();
    prepBindSummaryModal();
  }

  function initMyProgramOnce() {
    if (window.__myProgramInit) return;
    const view = document.getElementById('my-program');
    if (!view) return;
    window.__myProgramInit = true;
    refreshAckBadges();
    bindAcknowledge();
    bindTravelOther();
    bindShipmentsList();
    hideExtraTripButtons();
    bindTripForm();
    bindTripActions();
    updateInitialArrivalBanner();
    renderTrips();
    bindCityGuide();
    bindHousing();
    bindCalendar();
    const housingTab = document.getElementById('tab-housing');
    if (housingTab) {
      housingTab.addEventListener('shown.bs.tab', bindHousing);
    }
    const guideTab = document.getElementById('tab-guide');
    if (guideTab) {
      guideTab.addEventListener('shown.bs.tab', bindCityGuide);
    }
    const calendarTab = document.getElementById('tab-calendar');
    if (calendarTab) {
      calendarTab.addEventListener('shown.bs.tab', bindCalendar);
      if (calendarTab.classList.contains('active')) {
        bindCalendar();
      }
    }
    const prepareTab = document.getElementById('tab-prepare-trip');
    if (prepareTab) {
      prepareTab.addEventListener('shown.bs.tab', renderPrepareTrip);
      if (!window.bootstrap?.Tab) {
        prepareTab.addEventListener('click', () => window.setTimeout(renderPrepareTrip, 0));
      }
      if (prepareTab.classList.contains('active')) {
        renderPrepareTrip();
      }
    }
    const preparePanel = document.getElementById('panel-prepare-trip');
    if (preparePanel && preparePanel.classList.contains('show')) {
      renderPrepareTrip();
    }
    // Optional: simple deeplink visual
    document.querySelectorAll('[data-deeplink="true"]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        location.hash = '#my-visa-trip';
      });
    });
  }

  // Run now if present
  if (document.getElementById('my-program')) initMyProgramOnce();

  // Observe future injections (innerHTML render)
  const mo = new MutationObserver(() => {
    if (document.getElementById('my-program')) {
      initMyProgramOnce();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();

// === Help Center (FAQ, search, ask form) ===
(() => {
  const STORAGE_KEY = 'help_questions';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const CATEGORY_ORDER = [
    { id: 'program', label: 'My Program & Campus' },
    { id: 'visa', label: 'Visa & Travel' },
    { id: 'payments', label: 'Payments & Scholarships' },
    { id: 'football', label: 'Football & Training' }
  ];
  const BASE_FAQS = [
    {
      id: 'program-1',
      category: 'program',
      question: 'What are the additional costs?',
      answer: 'Plan for visa fees, flights, insurance upgrades, and personal expenses such as laundry, phone plans, and weekend activities.'
    },
    {
      id: 'program-2',
      category: 'program',
      question: 'What happens if my grades drop?',
      answer: 'Your academic advisor will reach out immediately. You will be placed on an improvement plan and risk losing playing time if progress is not shown.'
    },
    {
      id: 'visa-1',
      category: 'visa',
      question: 'When should I apply for my visa?',
      answer: 'Submit your visa application as soon as you receive your admission letter. Embassy appointments can fill up fast, so we recommend applying 90 days before departure.'
    },
    {
      id: 'visa-2',
      category: 'visa',
      question: 'What happens if my flight is delayed?',
      answer: 'Notify the travel hotline listed in My Program. We will track your new arrival time and coordinate housing and transport adjustments.'
    },
    {
      id: 'payments-1',
      category: 'payments',
      question: 'How do I pay tuition fees?',
      answer: 'You can pay securely through the Finance portal using bank transfer or card. Payment links and due dates are listed in your Finance dashboard.'
    },
    {
      id: 'payments-2',
      category: 'payments',
      question: 'Are scholarships deducted automatically?',
      answer: 'Yes. Approved scholarships appear as credits in your payment plan and reduce the remaining balance before each installment is due.'
    },
    {
      id: 'football-1',
      category: 'football',
      question: 'Can I bring my own cleats?',
      answer: 'Absolutely. Bring both natural grass and AG/turf cleats. We recommend labeling your gear and packing additional insoles if you prefer them.'
    },
    {
      id: 'football-2',
      category: 'football',
      question: 'How many training sessions per week?',
      answer: 'Expect 5 structured training sessions plus recovery and strength blocks. Match weeks can add a sixth session for tactical preparation.'
    }
  ];

  const state = {
    root: null,
    accordion: null,
    search: null,
    noResults: null,
    form: null,
    feedback: null,
    questionsList: null,
    categoryContainers: {},
    categoryHeadings: {},
    items: [],
    currentQuery: '',
    questions: [],
    adminMode: false,
    feedbackTimer: null
  };

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyHighlight(target, text, query) {
    if (!target) return;
    target.textContent = '';
    const trimmed = (query || '').trim();
    if (!trimmed) {
      target.textContent = text;
      return;
    }
    const regex = new RegExp(escapeRegExp(trimmed), 'ig');
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const before = text.slice(lastIndex, match.index);
      if (before) target.appendChild(document.createTextNode(before));
      const mark = document.createElement('mark');
      mark.textContent = match[0];
      target.appendChild(mark);
      lastIndex = match.index + match[0].length;
    }
    const after = text.slice(lastIndex);
    if (after) target.appendChild(document.createTextNode(after));
    if (!target.firstChild) target.textContent = text;
  }

  function buildFaqItem(entry) {
    const item = document.createElement('div');
    item.className = 'accordion-item';
    item.dataset.category = entry.category;
    item.dataset.originalQuestion = entry.question;
    item.dataset.originalAnswer = entry.answer;
    const idBase = `help-faq-${entry.id || Math.random().toString(16).slice(2)}`;
    const headerId = `${idBase}-header`;
    const collapseId = `${idBase}-collapse`;

    const header = document.createElement('h2');
    header.className = 'accordion-header';
    header.id = headerId;

    const button = document.createElement('button');
    button.className = 'accordion-button collapsed';
    button.type = 'button';
    button.setAttribute('data-bs-toggle', 'collapse');
    button.setAttribute('data-bs-target', `#${collapseId}`);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', collapseId);

    const questionSpan = document.createElement('span');
    questionSpan.dataset.role = 'question';
    button.appendChild(questionSpan);
    header.appendChild(button);

    const collapse = document.createElement('div');
    collapse.id = collapseId;
    collapse.className = 'accordion-collapse collapse';
    collapse.setAttribute('data-bs-parent', '#help-accordion');
    collapse.setAttribute('aria-labelledby', headerId);

    const body = document.createElement('div');
    body.className = 'accordion-body';
    const answerWrap = document.createElement('div');
    answerWrap.dataset.role = 'answer';
    body.appendChild(answerWrap);
    collapse.appendChild(body);

    item.appendChild(header);
    item.appendChild(collapse);

    applyHighlight(questionSpan, entry.question, state.currentQuery);
    applyHighlight(answerWrap, entry.answer, state.currentQuery);

    return item;
  }

  function addFaqItem(entry, { prepend = false } = {}) {
    const container = state.categoryContainers[entry.category];
    if (!container) return null;
    const item = buildFaqItem(entry);
    if (prepend && container.firstChild) {
      container.insertBefore(item, container.firstChild);
    } else {
      container.appendChild(item);
    }
    state.items.push(item);
    return item;
  }

  function filterFaqs(query) {
    state.currentQuery = query || '';
    const normalized = state.currentQuery.trim().toLowerCase();
    let visibleCount = 0;

    state.items.forEach((item) => {
      const question = item.dataset.originalQuestion || '';
      const answer = item.dataset.originalAnswer || '';
      const haystack = `${question} ${answer}`.toLowerCase();
      const matches = !normalized || haystack.includes(normalized);
      item.classList.toggle('d-none', !matches);
      applyHighlight(item.querySelector('[data-role="question"]'), question, state.currentQuery);
      applyHighlight(item.querySelector('[data-role="answer"]'), answer, state.currentQuery);
      if (matches) visibleCount += 1;
    });

    CATEGORY_ORDER.forEach(({ id }) => {
      const heading = state.categoryHeadings[id];
      if (!heading) return;
      const hasVisible = state.items.some(
        (item) => item.dataset.category === id && !item.classList.contains('d-none')
      );
      heading.classList.toggle('d-none', !hasVisible);
    });

    if (state.accordion) {
      state.accordion.classList.toggle('d-none', visibleCount === 0);
    }
    if (state.noResults) {
      state.noResults.classList.toggle('d-none', visibleCount !== 0);
    }
  }

  function loadStoredQuestions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveStoredQuestions(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list || []));
    } catch (_) {
      /* ignore quota issues */
    }
  }

  function showFeedback(message, type = 'success') {
    if (!state.feedback) return;
    window.clearTimeout(state.feedbackTimer);
    state.feedback.textContent = message;
    state.feedback.className = `alert alert-${type} mt-3 mb-0`;
    state.feedback.classList.remove('d-none');
    state.feedbackTimer = window.setTimeout(() => {
      state.feedback?.classList.add('d-none');
    }, 3000);
  }

  function showHelpToast(message) {
    const cont = document.getElementById('help-toast-container');
    if (!cont || !window.bootstrap?.Toast) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'toast align-items-center text-bg-primary border-0';
    wrapper.setAttribute('role', 'status');
    wrapper.setAttribute('aria-live', 'polite');
    wrapper.setAttribute('aria-atomic', 'true');
    wrapper.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${message}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>`;
    cont.appendChild(wrapper);
    const toast = bootstrap.Toast.getOrCreateInstance(wrapper, { autohide: true, delay: 3500 });
    toast.show();
    wrapper.addEventListener('hidden.bs.toast', () => wrapper.remove());
  }

  function setFieldValidity(field, isValid) {
    if (!field) return;
    field.classList.toggle('is-invalid', !isValid);
  }

  function renderStoredQuestions() {
    const host = state.questionsList;
    if (!host) return;
    host.innerHTML = '';
    if (!state.questions.length) {
      host.innerHTML = '<p class="text-muted small mb-0">No questions submitted yet.</p>';
      return;
    }

    const heading = document.createElement('h5');
    heading.className = 'mt-4 border-bottom pb-1';
    heading.textContent = 'Recent questions from students';
    host.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'list-group';
    state.questions.forEach((entry, index) => {
      const item = document.createElement('div');
      item.className = 'list-group-item';

      const topRow = document.createElement('div');
      topRow.className = 'd-flex align-items-center justify-content-between';
      const title = document.createElement('div');
      title.className = 'fw-semibold';
      title.textContent = entry.question;
      topRow.appendChild(title);

      if (state.adminMode) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-outline-primary';
        btn.textContent = 'Promote to FAQ';
        btn.setAttribute('data-action', 'promote');
        btn.setAttribute('data-index', String(index));
        topRow.appendChild(btn);
      }

      item.appendChild(topRow);

      const meta = document.createElement('div');
      meta.className = 'text-muted small mb-2';
      const categoryLabel = CATEGORY_ORDER.find((cat) => cat.id === entry.category)?.label || 'General';
      const createdAt = entry.createdAt ? new Date(entry.createdAt) : null;
      const when = createdAt && !Number.isNaN(createdAt.valueOf())
        ? createdAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : '';
      meta.textContent = when ? `${categoryLabel} • ${when}` : categoryLabel;
      item.appendChild(meta);

      if (entry.details) {
        const details = document.createElement('p');
        details.className = 'mb-2';
        details.textContent = entry.details;
        item.appendChild(details);
      }

      if (entry.email) {
        const emailLine = document.createElement('p');
        emailLine.className = 'mb-0 small text-muted';
        emailLine.textContent = `Reply to: ${entry.email}`;
        item.appendChild(emailLine);
      }

      list.appendChild(item);
    });

    host.appendChild(list);
  }

  function promoteQuestion(index) {
    const entry = state.questions[index];
    if (!entry) return;
    const answer = entry.details
      ? entry.details
      : 'Thanks for your question. Our staff will add a full answer shortly.';
    addFaqItem({
      id: `user-${index}-${Date.now()}`,
      category: entry.category,
      question: entry.question,
      answer
    });
    filterFaqs(state.currentQuery);
    showFeedback('Question promoted to the FAQ (demo).');
  }

  function handleQuestionsListClick(event) {
    if (!state.adminMode) return;
    const btn = event.target.closest('[data-action="promote"]');
    if (!btn) return;
    const idx = Number(btn.getAttribute('data-index'));
    if (Number.isNaN(idx)) return;
    promoteQuestion(idx);
  }

  function setupForm(container) {
    const form = container.querySelector('#help-question-form');
    if (!form) return;
    state.form = form;

    const catInput = form.querySelector('#help-question-category');
    const questionInput = form.querySelector('#help-question-text');
    const detailsInput = form.querySelector('#help-question-details');
    const emailInput = form.querySelector('#help-question-email');

    const clearInvalidOnInput = (field) => field?.addEventListener('input', () => setFieldValidity(field, true));
    clearInvalidOnInput(catInput);
    clearInvalidOnInput(questionInput);
    clearInvalidOnInput(detailsInput);
    clearInvalidOnInput(emailInput);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const category = catInput?.value || '';
      const question = (questionInput?.value || '').trim();
      const details = (detailsInput?.value || '').trim();
      const email = (emailInput?.value || '').trim();

      let valid = true;
      if (!category) {
        setFieldValidity(catInput, false);
        valid = false;
      } else {
        setFieldValidity(catInput, true);
      }

      if (question.length < 8 || question.length > 100) {
        setFieldValidity(questionInput, false);
        valid = false;
      } else {
        setFieldValidity(questionInput, true);
      }

      if (details.length > 500) {
        setFieldValidity(detailsInput, false);
        valid = false;
      } else {
        setFieldValidity(detailsInput, true);
      }

      if (email && !EMAIL_RE.test(email)) {
        setFieldValidity(emailInput, false);
        valid = false;
      } else {
        setFieldValidity(emailInput, true);
      }

      if (!valid) {
        showFeedback('Please review the highlighted fields.', 'danger');
        return;
      }

      const entry = {
        category,
        question,
        details,
        email,
        createdAt: new Date().toISOString()
      };

      state.questions.unshift(entry);
      saveStoredQuestions(state.questions);
      renderStoredQuestions();
      showFeedback('Thanks! We’ll get back to you soon.');
      showHelpToast('Thanks! Your question has been received.');
      form.reset();
      setFieldValidity(catInput, true);
      setFieldValidity(questionInput, true);
      setFieldValidity(detailsInput, true);
      setFieldValidity(emailInput, true);
    });
  }

  function setupSearch(container) {
    const searchInput = container.querySelector('#help-search');
    state.search = searchInput;
    if (!searchInput) return;
    searchInput.addEventListener('input', () => {
      filterFaqs(searchInput.value || '');
    });
  }

  function renderBaseFaqs() {
    BASE_FAQS.forEach((faq) => addFaqItem(faq));
  }

  function initHelpCenter(root) {
    const host = root?.querySelector?.('#help-center-root') || document.getElementById('help-center-root');
    if (!host || host.dataset.helpReady === 'true') return;
    host.dataset.helpReady = 'true';

    state.root = host;
    state.accordion = host.querySelector('#help-accordion');
    state.noResults = host.querySelector('#help-no-results');
    state.feedback = host.querySelector('#help-form-feedback');
    state.questionsList = host.querySelector('#help-questions-list');
    state.items = [];
    state.categoryContainers = {};
    state.categoryHeadings = {};
    state.currentQuery = '';
    state.questions = loadStoredQuestions();
    state.adminMode = new URLSearchParams(window.location.search).get('admin') === '1';

    CATEGORY_ORDER.forEach(({ id }) => {
      state.categoryContainers[id] = host.querySelector(`[data-category-list="${id}"]`);
      state.categoryHeadings[id] = host.querySelector(`[data-category-heading="${id}"]`);
    });

    renderBaseFaqs();
    setupSearch(host);
    setupForm(host);
    if (state.questionsList) {
      state.questionsList.addEventListener('click', handleQuestionsListClick);
    }
    renderStoredQuestions();
    filterFaqs('');
  }

  window.initHelpCenter = initHelpCenter;
})();


// === Calendar Editors & Showcase ===
(function () {
  const $ = (sel) => document.querySelector(sel);
  const hasBootstrap = Boolean(window.bootstrap && window.bootstrap.Modal);
  let wired = false;

  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t && (t.id === 'ffcv-open' || t.getAttribute?.('data-action') === 'import-ffcv')) {
      ev.preventDefault();
      alert('Coming soon');
    }
  });

  const CAL_KEY =
    (typeof window.CALENDAR_LOCAL_KEY === 'string' && window.CALENDAR_LOCAL_KEY) ||
    (typeof window.CALENDAR_KEY === 'string' && window.CALENDAR_KEY) ||
    'calendar_demo';

  const getCalSafe = () => {
    if (typeof getCal === 'function') return getCal();
    if (typeof getCalendarState === 'function') return getCalendarState();
    try {
      const stored = JSON.parse(localStorage.getItem(CAL_KEY) || '{}') || {};
      const result = {
        gameWeeks: sanitizeGameWeeks(stored.gameWeeks),
        breaks: sanitizeBreaks(stored.breaks),
        classes: Array.isArray(stored.classes) ? sanitizeStringList(stored.classes) : [],
        showcase: sanitizeShowcase(stored.showcase)
      };
      return result;
    } catch (err) {
      return { gameWeeks: [], breaks: [], classes: [], showcase: { agenda: [] } };
    }
  };

  const setCalSafe = (state) => {
    if (typeof setCal === 'function') return setCal(state);
    localStorage.setItem(CAL_KEY, JSON.stringify(state));
    return state;
  };

  const openModal = (sel) => {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (!el) return;
    if (hasBootstrap) {
      window.bootstrap.Modal.getOrCreateInstance(el).show();
    } else {
      el.style.display = 'block';
    }
  };

  const closeModal = (sel) => {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (!el) return;
    if (hasBootstrap) {
      const instance = window.bootstrap.Modal.getOrCreateInstance(el);
      if (instance) instance.hide();
    } else {
      el.style.display = 'none';
    }
  };

  function safeRerender() {
    if (typeof window.renderCalendarAll === 'function') {
      window.renderCalendarAll();
      return;
    }
    const hasRenderers =
      typeof window.renderGameWeeks === 'function' ||
      typeof window.renderBreaks === 'function' ||
      typeof window.renderShowcase === 'function';
    if (hasRenderers) {
      if (typeof window.renderGameWeeks === 'function') window.renderGameWeeks();
      if (typeof window.renderBreaks === 'function') window.renderBreaks();
      if (typeof window.renderShowcase === 'function') window.renderShowcase();
    } else {
      window.location.reload();
    }
  }

  function openShowcaseEditor() {
    const cal = getCalSafe();
    const sc = cal.showcase || {};
    const startInput = document.querySelector('#sc-start');
    const endInput = document.querySelector('#sc-end');
    const whereInput = document.querySelector('#sc-where');
    const mapsInput = document.querySelector('#sc-maps');
    const agendaInput = document.querySelector('#sc-agenda');
    if (startInput) startInput.value = sc.start || '';
    if (endInput) endInput.value = sc.end || '';
    if (whereInput) whereInput.value = sc.where || '';
    if (mapsInput) mapsInput.value = sc.mapsUrl || '';
    if (agendaInput) agendaInput.value = Array.isArray(sc.agenda) ? sc.agenda.join('\n') : '';
    const msg = $('#sc-msg');
    if (msg) {
      msg.textContent = 'Update showcase details and click Save.';
      msg.classList.remove('text-danger', 'text-success');
      msg.classList.add('text-muted');
    }
    openModal('#scEditModal');
  }

  function saveShowcaseFromModal() {
    const start = (document.querySelector('#sc-start')?.value || '').trim();
    const end = (document.querySelector('#sc-end')?.value || '').trim();
    const where = (document.querySelector('#sc-where')?.value || '').trim();
    const maps = (document.querySelector('#sc-maps')?.value || '').trim();
    const agendaRaw = (document.querySelector('#sc-agenda')?.value || '').trim();
    const agenda = agendaRaw ? agendaRaw.split('\n').map((line) => line.trim()).filter(Boolean) : [];
    const reYMD = /^\d{4}-\d{2}-\d{2}$/;
    if (!reYMD.test(start) || !reYMD.test(end)) {
      alert('Please use YYYY-MM-DD for Start and End.');
      return;
    }
    const existing = getCalSafe() || {};
    const next = { ...existing };
    if (!Array.isArray(next.gameWeeks)) next.gameWeeks = [];
    if (!Array.isArray(next.breaks)) next.breaks = [];
    if (!Array.isArray(next.classes)) next.classes = [];
    next.showcase = { start, end, where, mapsUrl: maps, agenda };
    if (typeof sanitizeShowcase === 'function') {
      next.showcase = sanitizeShowcase(next.showcase);
    }
    const stored = setCalSafe(next);
    const updatedState = stored || getCalSafe() || next;
    if (typeof getCal === 'function') {
      calendarState = getCal();
    } else if (typeof sanitizeShowcase === 'function') {
      calendarState = { ...updatedState, showcase: sanitizeShowcase(updatedState.showcase) };
    } else {
      calendarState = updatedState;
    }
    closeModal('#scEditModal');
    if (typeof renderShowcase === 'function') {
      renderShowcase();
    } else if (typeof safeRerender === 'function') {
      safeRerender();
    } else {
      window.location.reload();
    }
  }

  window.initCalendarImporters = function () {
    if (wired) return;
    wired = true;

    const btnEditShowcase = $('#btn-sc-edit');
    if (btnEditShowcase) btnEditShowcase.addEventListener('click', openShowcaseEditor);

    const btnSaveShowcase = $('#sc-save');
    if (btnSaveShowcase) btnSaveShowcase.addEventListener('click', saveShowcaseFromModal);
  };

  // --- Auto render Calendar when the page (re)enters or gains focus ---
  window.renderCalendarAll = function () {
    if (typeof window.renderGameWeeks === 'function') window.renderGameWeeks();
    if (typeof window.renderBreaks === 'function') window.renderBreaks();
    if (typeof window.renderShowcase === 'function') window.renderShowcase();
  };

  // Initial paint on load / SPA restores / tab refocus
  document.addEventListener('DOMContentLoaded', window.renderCalendarAll);
  window.addEventListener('pageshow', window.renderCalendarAll); // bfcache/back/forward
  window.addEventListener('focus', window.renderCalendarAll);

  // Repaint when user clicks the Calendar tab/link
  document.addEventListener('click', (ev) => {
    const hit = ev.target?.closest?.('[data-tab="calendar"], [data-section="calendar"], a[href*="Calendar"], a[href*="#calendar"]');
    if (hit) setTimeout(window.renderCalendarAll, 0);
  });
})();

// File: app.js — Append-only MyFinance Step 1 — Build: 2025-10-30T12:50:00Z
(() => {
  // Helpers
  const toCents = (eur) => Math.round((Number(eur) || 0) * 100);
  const fromCents = (c) => (c || 0) / 100;
  const fmtEUR = (c) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(fromCents(c));
  const fmtUSD = (c, fx) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(fromCents(c) * (fx || 0));
  const byId  = (id) => document.getElementById(id);
  const setTxt = (id, v) => { const el = byId(id); if (el) el.textContent = v; };
  const show   = (el, v) => el && el.classList.toggle('d-none', !v);
  const today  = () => new Date(new Date().toDateString());
  const dstr   = (d) => new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });

  // Demo due dates
  const Y = new Date().getFullYear();
  const dueDates = {
    deposit:   new Date(Date.now() - 86400000), // yesterday
    prearrival:new Date(Y, 5, 15),  // 15-Jun
    november:  new Date(Y,10, 15),  // 15-Nov
    december:  new Date(Y,11, 15),  // 15-Dec
    january:   new Date(Y+1,0, 15), // 15-Jan next year
  };

  // Demo state (42k) + fixed USD rate
  const state = {
    fx: 1.1655,                       // 1 EUR = 1.1655 USD (fixed demo)
    tuition: toCents(42000),
    fees: [], scholarships: [], payments: [],
    plan: [
      { id:'deposit',    label:'Deposit',         baseline:toCents(6000), paid:0, due:dueDates.deposit },
      { id:'prearrival', label:'Pre-arrival',     baseline:toCents(9000), paid:0, due:dueDates.prearrival },
      { id:'november',   label:'November',        baseline:toCents(9000), paid:0, due:dueDates.november },
      { id:'december',   label:'December',        baseline:toCents(9000), paid:0, due:dueDates.december },
      { id:'january',    label:'January (Final)', baseline:toCents(9000), paid:0, due:dueDates.january },
    ],
  };

  // Math helpers
  const sum = (arr, key) => arr.reduce((a, it) => a + (key ? (it[key] || 0) : (it || 0)), 0);

  function computeSummary(s){
    const fees = sum(s.fees, 'amount');
    const sch  = sum(s.scholarships, 'amount');
    const paid = sum(s.payments, 'amount');
    const outstanding = Math.max(0, s.tuition + fees - sch - paid);
    return { fees, sch, paid, outstanding };
  }

  function projectedPlan(s){
    const proj = s.plan.map(p => ({ ...p, amount:p.baseline, status:'due' }));
    const now = today();
    for (const p of proj) {
      if (p.amount === 0) p.status = 'paid';
      else if (p.due && new Date(p.due) < now) p.status = 'overdue';
      else p.status = 'due';
    }
    return proj;
  }

  function amountToPayNow(s, includeNext7){
    const proj = projectedPlan(s);
    const now = today();
    const limit = new Date(now.getTime() + (includeNext7 ? 7 : 0) * 86400000);
    return proj
      .filter(p => p.status !== 'paid' && p.due && new Date(p.due) <= limit)
      .reduce((a, p) => a + p.amount, 0);
  }

  // Summary + pill + USD
  function renderSummary(s){
    const S = computeSummary(s);
    setTxt('sum-tuition-eur', fmtEUR(s.tuition));
    setTxt('sum-fees-eur', fmtEUR(S.fees));
    setTxt('sum-scholarships-eur', fmtEUR(-S.sch)); // show as negative using formatter
    setTxt('sum-paid-eur', fmtEUR(S.paid));
    setTxt('sum-outstanding-eur', fmtEUR(S.outstanding));

    [['sum-tuition-usd', s.tuition],
     ['sum-fees-usd', S.fees],
     ['sum-scholarships-usd', -S.sch],
     ['sum-paid-usd', S.paid],
     ['sum-outstanding-usd', S.outstanding]]
     .forEach(([id, c]) => { const el = byId(id); if (el) { show(el, true); el.textContent = '≈ ' + fmtUSD(c, state.fx); } });

    const include7 = byId('toggle-next7') ? byId('toggle-next7').checked : true;
    const nowC = amountToPayNow(s, include7);
    setTxt('amount-now-eur', fmtEUR(nowC));
    setTxt('amount-now-eur-small', fmtEUR(nowC));
    const pillUsd = byId('amount-now-usd'); if (pillUsd) pillUsd.textContent = '≈ ' + fmtUSD(nowC, state.fx);
  }

  // Plan rows
  function renderPlan(s){
    const proj = projectedPlan(s);
    const map = {
      deposit:    { amtE:'amt-deposit-eur',    amtU:'amt-deposit-usd',    due:'due-deposit',    st:'status-deposit' },
      prearrival: { amtE:'amt-prearrival-eur', amtU:'amt-prearrival-usd', due:'due-prearrival', st:'status-prearrival' },
      november:   { amtE:'amt-november-eur',   amtU:'amt-november-usd',   due:'due-november',   st:'status-november' },
      december:   { amtE:'amt-december-eur',   amtU:'amt-december-usd',   due:'due-december',   st:'status-december' },
      january:    { amtE:'amt-january-eur',    amtU:'amt-january-usd',    due:'due-january',    st:'status-january' },
    };
    proj.forEach(p => {
      const ids = map[p.id]; if (!ids) return;
      setTxt(ids.amtE, fmtEUR(p.amount));
      const usdEl = byId(ids.amtU); if (usdEl) usdEl.textContent = '≈ ' + fmtUSD(p.amount, state.fx);
      setTxt(ids.due, dstr(p.due));
      const st = byId(ids.st);
      if (st) {
        st.textContent = (p.status === 'paid') ? 'Paid' : (p.status === 'overdue' ? 'Overdue' : 'Due');
        st.className = 'badge ' + (p.status === 'paid' ? 'bg-success' : p.status === 'overdue' ? 'bg-danger' : 'bg-secondary');
      }
    });
  }

  // Donut (clean rebuild)
  let donut = null;
  function renderDonut(s){
    const S = computeSummary(s);
    const ctx = document.getElementById('financial-chart')?.getContext('2d');
    if (!ctx) return;
    if (donut) { try { donut.destroy(); } catch(e){} }
    donut = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: ['Paid','Pending'], datasets: [{ data:[fromCents(S.paid), fromCents(S.outstanding)], backgroundColor:['#28a745','#dc3545'] }] },
      options: { plugins:{ legend:{ display:false } }, cutout:'60%' }
    });
    const include7 = byId('toggle-next7') ? byId('toggle-next7').checked : true;
    setTxt('amount-now-eur-small', fmtEUR(amountToPayNow(s, include7)));
  }

  // Minimal ledger (will expand later)
  function renderLedger(s){
    const S = computeSummary(s);
    setTxt('ledger-tuition-eur', fmtEUR(s.tuition));
    setTxt('ledger-fees-eur', fmtEUR(S.fees));
    setTxt('ledger-scholarships-eur', fmtEUR(-S.sch));
    setTxt('ledger-subtotal-eur', fmtEUR(s.tuition + S.fees - S.sch));
    setTxt('ledger-paid-eur', fmtEUR(S.paid));
    setTxt('ledger-outstanding-eur', fmtEUR(S.outstanding));
    setTxt('ledger-outofpocket-eur', fmtEUR(S.outstanding));
    if (byId('ledger-tuition-usd')) setTxt('ledger-tuition-usd', fmtUSD(s.tuition, state.fx));
    if (byId('ledger-fees-usd')) setTxt('ledger-fees-usd', fmtUSD(S.fees, state.fx));
    if (byId('ledger-scholarships-usd')) setTxt('ledger-scholarships-usd', fmtUSD(-S.sch, state.fx));
    if (byId('ledger-paid-usd')) setTxt('ledger-paid-usd', fmtUSD(S.paid, state.fx));
    const include7 = byId('toggle-next7') ? byId('toggle-next7').checked : true;
    setTxt('ledger-amount-now-eur', fmtEUR(amountToPayNow(s, include7)));
  }

  function renderAll(){
    renderSummary(state);
    renderPlan(state);
    renderDonut(state);
    if (!byId('view-ledger')?.classList.contains('d-none')) renderLedger(state);
  }

  // Delegated wiring
  function wire(){
    document.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t.id === 'btn-view-summary') {
        byId('btn-view-summary')?.classList.add('active');
        byId('btn-view-ledger')?.classList.remove('active');
        byId('view-summary')?.classList.remove('d-none');
        byId('view-ledger')?.classList.add('d-none');
      }
      if (t.id === 'btn-view-ledger') {
        byId('btn-view-ledger')?.classList.add('active');
        byId('btn-view-summary')?.classList.remove('active');
        byId('view-ledger')?.classList.remove('d-none');
        byId('view-summary')?.classList.add('d-none');
        renderLedger(state);
      }
      if (t.classList?.contains('pay-installment')) {
        const id = t.getAttribute('data-plan');
        const map = { deposit:'amt-deposit-eur', prearrival:'amt-prearrival-eur', november:'amt-november-eur', december:'amt-december-eur', january:'amt-january-eur' };
        const txt = byId(map[id])?.textContent || '€0.00';
        const num = Number(txt.replace(/[^0-9.]/g,'')) || 0;
        state.payments.push({ id:'p'+(state.payments.length+1), amount:toCents(num), method:'card', createdAt:new Date().toISOString() });
        const p = state.plan.find(x => x.id === id); if (p) p.paid = p.baseline; // demo visual only
        renderAll();
      }
      if (t.id === 'btn-pay-remaining') {
        const S = computeSummary(state);
        if (S.outstanding > 0) {
          state.payments.push({ id:'p'+(state.payments.length+1), amount:S.outstanding, method:'card', createdAt:new Date().toISOString() });
          state.plan.forEach(p => p.paid = p.baseline); // demo: mark all paid
          renderAll();
        }
      }
    });
    const tog = byId('toggle-next7'); if (tog) tog.addEventListener('change', renderAll);
  }

  // SPA hook
  window.renderFinancialChart = function () {
    wire();
    renderAll();
  };
})();
