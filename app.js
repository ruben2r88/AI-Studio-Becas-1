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
  'sex-crimes-registry-authorization'
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

function getDefaultMyVisaState() {
  return {
    submissionLocation: 'USA',
    appointment: {
      dateTime: '',
      blsCenter: '',
      proofFile: null
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

function normalizeMyVisaState(state) {
  const defaults = getDefaultMyVisaState();
  const raw = state && typeof state === 'object' ? state : {};

  const submissionRaw = (raw.submissionLocation || '').toString().trim().toLowerCase();
  const normalizedLocation = submissionRaw === 'spain'
    ? 'Spain'
    : submissionRaw === 'usa'
      ? 'USA'
      : defaults.submissionLocation;

  const appointmentRaw = raw.appointment && typeof raw.appointment === 'object' ? raw.appointment : {};
  const visaApprovalRaw = raw.visaApproval && typeof raw.visaApproval === 'object' ? raw.visaApproval : {};
  const tieRaw = raw.tie && typeof raw.tie === 'object' ? raw.tie : {};

  return {
    submissionLocation: normalizedLocation,
    appointment: {
      dateTime: (appointmentRaw.dateTime || '').toString(),
      blsCenter: (appointmentRaw.blsCenter || '').toString(),
      proofFile: normalizeFileMeta(appointmentRaw.proofFile)
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
  if (!normalized.submissionLocation) {
    const submission = getVisaSubmissionState();
    normalized.submissionLocation = submission.submitChoice === 'spain' ? 'Spain' : 'USA';
  }

  cachedMyVisaState = normalized;
  return JSON.parse(JSON.stringify(normalized));
}

function saveMyVisaState(updater) {
  const current = getMyVisaState();
  const candidate = typeof updater === 'function'
    ? normalizeMyVisaState(updater({ ...current }))
    : normalizeMyVisaState({ ...current, ...updater });

  cachedMyVisaState = candidate;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(MY_VISA_STATE_STORAGE_KEY, JSON.stringify(candidate));
    } catch (error) {
      console.warn('Unable to persist myVisa state', error);
    }
  }

  return JSON.parse(JSON.stringify(candidate));
}

function getSubmissionLocationLabel(myState = null) {
  const state = myState || getMyVisaState();
  return state.submissionLocation === 'Spain' ? 'Spain' : 'USA';
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
let cachedSpainFeeAck = null;

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

function getSpainFeeAck(state = null) {
  if (state && typeof state.spain?.feeAcknowledged === 'boolean') {
    cachedSpainFeeAck = state.spain.feeAcknowledged;
    return cachedSpainFeeAck;
  }

  if (typeof cachedSpainFeeAck === 'boolean') {
    return cachedSpainFeeAck;
  }

  const submission = userProfileData?.visa?.submission;
  if (submission && typeof submission?.spain?.feeAcknowledged === 'boolean') {
    cachedSpainFeeAck = submission.spain.feeAcknowledged === true;
    return cachedSpainFeeAck;
  }

  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage?.getItem(SPAIN_FEE_ACK_STORAGE_KEY);
      if (stored !== null) {
        cachedSpainFeeAck = stored === 'true';
        return cachedSpainFeeAck;
      }
    } catch (error) {
      console.warn('Unable to read Spain fee acknowledgement', error);
    }
  }

  cachedSpainFeeAck = false;
  return cachedSpainFeeAck;
}

function setSpainFeeAck(value) {
  const next = value === true;
  if (cachedSpainFeeAck === next) {
    return next;
  }
  cachedSpainFeeAck = next;
  persistVisaSubmissionState((state) => {
    state.spain = state.spain || { ...SPAIN_SUBMISSION_DEFAULTS };
    state.spain.feeAcknowledged = next;
    return state;
  });
  return next;
}

function recalcVisaProgressAndRender() {
  const cl = getChecklistState();
  renderVisaChecklistProgress(cl);
  renderVisaOverview();
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
    chipClass: 'badge text-primary border border-primary bg-light',
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
    spain: { ...SPAIN_SUBMISSION_DEFAULTS }
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
    state.consulateKey = '';
    state.consulateCity = '';
    state.consulateUrl = '';
    if (!center || !center.requiresRegion) {
      state.caRegion = '';
    }
    return state;
  }

  state.consulateKey = center.slug || toCitySlug(center.city);
  state.consulateCity = center.city;
  state.consulateUrl = center.url || '';
  if (state.stateCode !== 'CA') {
    state.caRegion = '';
  }
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

      let storedAck = window.localStorage?.getItem(SPAIN_FEE_ACK_STORAGE_KEY);
      if (storedAck === null) {
        for (const legacyKey of LEGACY_SPAIN_FEE_ACK_KEYS) {
          const legacyValue = window.localStorage?.getItem(legacyKey);
          if (legacyValue !== null) {
            storedAck = legacyValue;
            break;
          }
        }
      }
      if (storedAck !== null) {
        source = source || {};
        source.spain = source.spain || {};
        source.spain.feeAcknowledged = storedAck === 'true';
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
  cachedVisaSubmissionState = candidate;
  cachedSpainFeeAck = Boolean(candidate.spain?.feeAcknowledged);

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

      try {
        window.localStorage?.setItem(
          SPAIN_FEE_ACK_STORAGE_KEY,
          candidate.spain?.feeAcknowledged ? 'true' : 'false'
        );
        LEGACY_SPAIN_FEE_ACK_KEYS.forEach((legacyKey) => {
          try {
            window.localStorage?.removeItem(legacyKey);
          } catch (_) {
            /* noop */
          }
        });
      } catch (error) {
        console.warn('Unable to persist Spain acknowledgement state', error);
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
  return candidate;
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

function getSpainStatusMeta(status) {
  const normalized = normalizeChecklistStatus(status);
  const visual = (VISA_CHECKLIST_VISUAL_STATES && VISA_CHECKLIST_VISUAL_STATES[normalized])
    || VISA_CHECKLIST_VISUAL_STATES.pending;
  const className = visual.listClass || visual.chipClass || 'badge bg-secondary';
  return {
    key: normalized,
    label: visual.label || 'Pending',
    className
  };
}

function renderSubmissionSpainDocuments(container, items, options = {}) {
  if (!container) return;
  const disableInteractions = options.disableInteractions === true;

  if (!Array.isArray(items) || !items.length) {
    container.innerHTML = '<div class="list-group-item small text-muted">No checklist documents available.</div>';
    return;
  }

  container.innerHTML = items.map((item) => {
    const normalizedKey = normalizeChecklistKeyInput(item.key);
    const statusMeta = getSpainStatusMeta(item.status);
    const statusKey = statusMeta.key;
    const reason = (statusKey === 'denied' && item.review?.reason) ? item.review.reason : '';
    const reasonAttr = reason ? ` title="${escapeHtml(reason)}"` : '';

    const showFixButton = statusKey !== 'verified';
    const fixButtonDisabled = disableInteractions;
    const fixButtonHtml = showFixButton
      ? `<button type="button" class="btn btn-sm btn-outline-primary submission-spain-fix-btn" data-doc-key="${normalizedKey}"${fixButtonDisabled ? ' disabled aria-disabled="true"' : ''}>Upload / Fix in Checklist →</button>`
      : '';

    const normalizedStatus = normalizeChecklistStatus(item.status);
    const sanitizedFileUrl = item.fileUrl ? escapeHtml(item.fileUrl) : '';
    const hasFileLink = ['uploaded', 'verified'].includes(normalizedStatus) && sanitizedFileUrl;
    let fileLinkHtml = '';
    if (hasFileLink) {
      if (disableInteractions) {
        fileLinkHtml = '<span class="small text-muted" aria-disabled="true">View file</span>';
      } else {
        fileLinkHtml = `<a href="${sanitizedFileUrl}" target="_blank" rel="noopener" class="link-secondary link-underline-opacity-0 link-underline-opacity-100-hover">View file</a>`;
      }
    }

    const sampleLink = item.sampleUrl
      ? `<a href="${escapeHtml(item.sampleUrl)}" target="_blank" rel="noopener" class="link-secondary link-underline-opacity-0 link-underline-opacity-100-hover">View sample</a>`
      : '';
    const linkFragments = [];
    if (sampleLink) linkFragments.push(sampleLink);
    if (fileLinkHtml) linkFragments.push(fileLinkHtml);
    const linksHtml = linkFragments.length
      ? `<div class="d-flex flex-wrap align-items-center gap-2 small mt-2">${linkFragments.join('<span class="text-muted">·</span>')}</div>`
      : '';

    const targetDomId = getChecklistDomIdForKey(normalizedKey);

    return `
      <div class="list-group-item d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3" data-doc-key="${normalizedKey}"${targetDomId ? ` data-checklist-target="${targetDomId}"` : ''}>
        <div class="flex-grow-1">
          <div class="d-flex align-items-center gap-2">
            <span class="fw-semibold">${escapeHtml(item.title)}</span>
            <span class="${statusMeta.className}"${reasonAttr}>${statusMeta.label}</span>
          </div>
          ${linksHtml}
        </div>
        <div class="text-md-end">
          ${fixButtonHtml}
        </div>
      </div>
    `;
  }).join('');
}

function renderVisaSubmissionSpain(resolvedState) {
  const spainSection = document.getElementById('submission-spain-section');
  if (!spainSection) return;

  const spainState = resolvedState?.spain && typeof resolvedState.spain === 'object'
    ? { ...SPAIN_SUBMISSION_DEFAULTS, ...resolvedState.spain }
    : { ...SPAIN_SUBMISSION_DEFAULTS };
  const isAcknowledged = getSpainFeeAck(resolvedState);

  const europeYes = document.getElementById('submission-spain-europe-yes');
  const europeNo = document.getElementById('submission-spain-europe-no');
  if (europeYes) europeYes.checked = spainState.europeVisit === 'yes';
  if (europeNo) europeNo.checked = spainState.europeVisit === 'no';

  const europeFieldset = document.getElementById('submission-spain-europe-fieldset');
  toggleSpainControlsDisabled(!isAcknowledged, { fieldset: europeFieldset });

  const ackCheckbox = document.getElementById('spain-acknowledge-fee');
  if (ackCheckbox) ackCheckbox.checked = isAcknowledged;

  const staysWrapper = document.getElementById('submission-spain-stays');
  const staysList = document.getElementById('submission-spain-stays-list');
  const addStayBtn = document.getElementById('submission-spain-add-stay');
  const showStays = spainState.europeVisit === 'yes';
  if (staysWrapper) staysWrapper.classList.toggle('d-none', !showStays);
  if (staysWrapper) {
    staysWrapper.classList.toggle('opacity-50', !isAcknowledged);
    if (!isAcknowledged) {
      staysWrapper.setAttribute('aria-disabled', 'true');
      staysWrapper.style.pointerEvents = 'none';
    } else {
      staysWrapper.removeAttribute('aria-disabled');
      staysWrapper.style.pointerEvents = '';
    }
  }
  if (addStayBtn) {
    addStayBtn.classList.toggle('d-none', !showStays);
    addStayBtn.disabled = !isAcknowledged || !showStays;
    if (addStayBtn.disabled) {
      addStayBtn.setAttribute('aria-disabled', 'true');
    } else {
      addStayBtn.removeAttribute('aria-disabled');
    }
  }
  if (showStays) {
    renderSpainStayRows(spainState.stays || [], { disabled: !isAcknowledged });
  } else if (staysList) {
    staysList.innerHTML = '';
  }

  const minorGroup = document.getElementById('submission-spain-minor-group');
  const showMinorDocs = shouldShowMinorDocs();

  const coreList = document.getElementById('submission-spain-doc-list');
  const checklistState = getChecklistState();
  const includeMinor = shouldShowMinorDocs();
  const visibleItems = Array.isArray(checklistState.items)
    ? checklistState.items.filter(item => isChecklistItemVisible(item, includeMinor))
    : [];
  const coreItems = visibleItems.filter(item => !item.minor);
  const minorItems = visibleItems.filter(item => item.minor);
  renderSubmissionSpainDocuments(coreList, coreItems, { disableInteractions: !isAcknowledged });

  const minorList = document.getElementById('submission-spain-doc-list-minor');
  if (minorList) {
    if (showMinorDocs && minorItems.length) {
      renderSubmissionSpainDocuments(minorList, minorItems, { disableInteractions: !isAcknowledged });
      minorGroup?.classList.remove('d-none');
    } else {
      minorList.innerHTML = '';
      minorGroup?.classList.add('d-none');
    }
  }
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

function toggleSpainControlsDisabled(disabled, options = {}) {
  const fieldset = options.fieldset || document.getElementById('submission-spain-europe-fieldset');
  if (fieldset) {
    fieldset.disabled = disabled;
    if (disabled) {
      fieldset.setAttribute('aria-disabled', 'true');
    } else {
      fieldset.removeAttribute('aria-disabled');
    }
    fieldset.classList.toggle('opacity-50', disabled);
    const inputs = fieldset.querySelectorAll('input');
    inputs.forEach((input) => {
      input.disabled = disabled;
    });
  }

  const docLists = [
    document.getElementById('submission-spain-doc-list'),
    document.getElementById('submission-spain-doc-list-minor')
  ];
  docLists.forEach((list) => {
    if (!list) return;
    list.classList.toggle('opacity-50', disabled);
    if (disabled) {
      list.setAttribute('aria-disabled', 'true');
      list.style.pointerEvents = 'none';
    } else {
      list.removeAttribute('aria-disabled');
      list.style.pointerEvents = '';
    }
  });
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
  const selectedPath = resolvedState.submitChoice || 'usa';
  if (choiceSelect && choiceSelect.value !== selectedPath) {
    choiceSelect.value = selectedPath;
  }
  applySubmissionChoice(selectedPath);
  const submissionLocation = selectedPath === 'spain' ? 'Spain' : 'USA';
  saveMyVisaState((state) => {
    state.submissionLocation = submissionLocation;
    return state;
  });
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
  renderVisaSubmissionSpain(resolvedState);

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

function updateVisaAppointmentUI() {
  const myState = getMyVisaState();
  const locationLabel = getSubmissionLocationLabel(myState);
  const appointment = myState.appointment || {};

  const banner = document.getElementById('visa-appointment-warning');
  const helper = document.getElementById('visa-appointment-helper');
  const dateInput = document.getElementById('visa-appointment-dt');
  const centerInput = document.getElementById('visa-appointment-center');
  const fileMetaEl = document.getElementById('visa-appointment-file-meta');
  const viewBtn = document.getElementById('visa-appointment-view');

  const isSpain = locationLabel === 'Spain';
  if (banner) {
    const content = `<div class="fw-semibold">Last-minute path (Spain)</div><div>If your application will be submitted in Spain, ETURE staff will manage your appointment. Certificates of submission and resolution will appear in My Documents. You don’t need to book a BLS appointment.</div>`;
    banner.innerHTML = content;
    banner.classList.toggle('d-none', !isSpain);
  }
  if (helper) {
    helper.classList.toggle('d-none', !isSpain);
  }

  if (dateInput) {
    dateInput.value = appointment.dateTime || '';
  }
  if (centerInput) {
    centerInput.value = appointment.blsCenter || '';
  }

  const proofFile = appointment.proofFile && normalizeFileMeta(appointment.proofFile);
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
    saveMyVisaState((state) => {
      state.appointment = state.appointment || {};
      state.appointment.proofFile = buildFileMetaFromFile(file, dataUrl);
      return state;
    });
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

function handleVisaAppointmentSave() {
  const dateInput = document.getElementById('visa-appointment-dt');
  const centerInput = document.getElementById('visa-appointment-center');
  saveMyVisaState((state) => {
    state.appointment = state.appointment || {};
    state.appointment.dateTime = dateInput?.value || '';
    state.appointment.blsCenter = centerInput?.value || '';
    return state;
  });
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
  document.getElementById('visa-appointment-save-btn')?.addEventListener('click', handleVisaAppointmentSave);

  updateVisaAppointmentUI();
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
  const europeYes = document.getElementById('submission-spain-europe-yes');
  const europeNo = document.getElementById('submission-spain-europe-no');
  const ackCheckbox = document.getElementById('spain-acknowledge-fee');
  const staysList = document.getElementById('submission-spain-stays-list');
  const addStayBtn = document.getElementById('submission-spain-add-stay');
  const spainSection = document.getElementById('submission-spain-section');

  stateSelect?.addEventListener('change', handleSubmissionStateChange);
  caRegionSelect?.addEventListener('change', handleSubmissionCaRegionChange);
  dateInput?.addEventListener('change', handleSubmissionDateChange);
  fileInput?.addEventListener('change', handleSubmissionProofChange);
  replaceBtn?.addEventListener('click', () => fileInput?.click());
  viewBtn?.addEventListener('click', handleSubmissionProofViewClick);
  verifyBtn?.addEventListener('click', handleSubmissionVerify);
  denyBtn?.addEventListener('click', openSubmissionDenyModal);
  choiceSelect?.addEventListener('change', handleSubmissionChoiceChange);
  europeYes?.addEventListener('change', handleSubmissionSpainEuropeChange);
  europeNo?.addEventListener('change', handleSubmissionSpainEuropeChange);
  ackCheckbox?.addEventListener('change', handleSubmissionSpainAcknowledgementChange);
  addStayBtn?.addEventListener('click', handleSubmissionSpainAddStay);
  staysList?.addEventListener('input', handleSubmissionSpainStayFieldChange);
  staysList?.addEventListener('change', handleSubmissionSpainStayFieldChange);
  staysList?.addEventListener('click', handleSubmissionSpainStayRemove);
  spainSection?.addEventListener('click', handleSubmissionSpainFixClick);

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
  renderVisaSubmissionSpain(getVisaSubmissionState());
}

function applySubmissionChoice(choice) {
  const normalized = choice === 'spain' ? 'spain' : 'usa';
  const usaSection = document.getElementById('submission-usa-section');
  const spainSection = document.getElementById('submission-spain-section');
  if (usaSection) usaSection.classList.toggle('d-none', normalized !== 'usa');
  if (spainSection) spainSection.classList.toggle('d-none', normalized !== 'spain');
  const liveRegion = document.getElementById('submission-choice-live');
  if (liveRegion) {
    if (liveRegion.dataset.choiceValue !== normalized) {
      liveRegion.textContent = normalized === 'spain'
        ? 'Spain (last-minute) submission selected.'
        : 'USA submission selected.';
      liveRegion.dataset.choiceValue = normalized;
    }
  }
}

function shouldShowMinorDocs() {
  return getIsMinor();
}

function getChecklistDomIdForKey(key) {
  if (!key) return '';
  const normalizedKey = normalizeChecklistKeyInput(key);
  const mapped = CHECKLIST_DOM_ID_MAP[normalizedKey];
  if (mapped) return `chk-${mapped}`;
  const fallback = normalizedKey.toString().toUpperCase().replace(/[^A-Z0-9_-]/g, '-');
  return fallback ? `chk-${fallback}` : '';
}

function handleSubmissionChoiceChange(event) {
  const value = (event.target?.value || '').toString().toLowerCase();
  const next = value === 'spain' ? 'spain' : 'usa';
  persistVisaSubmissionState((state) => {
    state.submitChoice = next;
    return state;
  });
  const locationLabel = next === 'spain' ? 'Spain' : 'USA';
  saveMyVisaState((state) => {
    state.submissionLocation = locationLabel;
    return state;
  });
  updateVisaAppointmentUI();
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

function handleSubmissionSpainEuropeChange(event) {
  if (!getSpainFeeAck()) {
    event.preventDefault();
    return;
  }
  const value = (event.target?.value || '').toString().toLowerCase();
  if (!['yes', 'no'].includes(value)) return;
  persistVisaSubmissionState((state) => {
    state.spain = state.spain || { ...SPAIN_SUBMISSION_DEFAULTS };
    state.spain.europeVisit = value;
    return state;
  });
}

function handleSubmissionSpainAcknowledgementChange(event) {
  setSpainFeeAck(Boolean(event.target?.checked));
}

function announceSpainStayChange(message) {
  const region = document.getElementById('submission-spain-stays-live');
  if (region) {
    region.textContent = '';
    region.textContent = message;
  }
}

function isSpainStayInvalid(stay) {
  if (!stay) return false;
  const entry = stay.entryDate || '';
  const exit = stay.exitDate || '';
  return entry && exit && entry > exit;
}

function renderSpainStayRows(stays, options = {}) {
  const list = document.getElementById('submission-spain-stays-list');
  if (!list) return;
  const disabled = Boolean(options.disabled);
  if (!Array.isArray(stays) || !stays.length) {
    list.innerHTML = '<tr class="text-muted"><td colspan="4">No stays added yet.</td></tr>';
    return;
  }

  list.innerHTML = stays.map((stay, index) => {
    const place = escapeHtml(stay.place || '');
    const entryDate = escapeHtml(stay.entryDate || '');
    const exitDate = escapeHtml(stay.exitDate || '');
    const invalid = isSpainStayInvalid(stay);
    const entryClass = invalid ? ' is-invalid' : '';
    const exitClass = invalid ? ' is-invalid' : '';
    const errorId = invalid ? `submission-spain-stay-${index}-error` : '';
    const invalidFeedback = invalid
      ? `<div id="${errorId}" class="invalid-feedback d-block">Exit date must be on or after entry date.</div>`
      : '';
    const disabledAttr = disabled ? ' disabled' : '';

    return `
      <tr data-index="${index}">
        <td>
          <label class="visually-hidden" for="submission-spain-stay-${index}-place">Country or place</label>
          <input type="text" class="form-control form-control-sm" id="submission-spain-stay-${index}-place" data-index="${index}" data-field="place" value="${place}" placeholder="Country / Place"${disabledAttr}>
        </td>
        <td>
          <label class="visually-hidden" for="submission-spain-stay-${index}-entry">Date of entry</label>
          <input type="date" class="form-control form-control-sm${entryClass}" id="submission-spain-stay-${index}-entry" data-index="${index}" data-field="entryDate" value="${entryDate}" ${errorId ? `aria-describedby="${errorId}"` : ''}${disabledAttr}>
        </td>
        <td>
          <label class="visually-hidden" for="submission-spain-stay-${index}-exit">Date of exit</label>
          <input type="date" class="form-control form-control-sm${exitClass}" id="submission-spain-stay-${index}-exit" data-index="${index}" data-field="exitDate" value="${exitDate}" ${errorId ? `aria-describedby="${errorId}"` : ''}${disabledAttr}>
          ${invalidFeedback}
        </td>
        <td class="text-end">
          <button type="button" class="btn btn-link text-danger btn-sm p-0 submission-spain-remove-stay" data-index="${index}" data-remove-stay="1"${disabledAttr}>Remove</button>
        </td>
      </tr>
    `;
  }).join('');
}

function handleSubmissionSpainAddStay(event) {
  event.preventDefault();
  if (!getSpainFeeAck()) {
    return;
  }
  persistVisaSubmissionState((state) => {
    state.spain = state.spain || { ...SPAIN_SUBMISSION_DEFAULTS };
    const current = Array.isArray(state.spain.stays) ? state.spain.stays.slice() : [];
    current.push({ place: '', entryDate: '', exitDate: '' });
    state.spain.stays = current;
    return state;
  });
  announceSpainStayChange('Stay added.');
}

function handleSubmissionSpainStayFieldChange(event) {
  const target = event.target;
  if (!target || target.dataset.index === undefined || !target.dataset.field) return;
  if (target.disabled || !getSpainFeeAck()) return;
  const index = Number(target.dataset.index);
  if (Number.isNaN(index)) return;
  const field = target.dataset.field;
  const value = target.value || '';

  persistVisaSubmissionState((state) => {
    state.spain = state.spain || { ...SPAIN_SUBMISSION_DEFAULTS };
    const current = Array.isArray(state.spain.stays) ? state.spain.stays.slice() : [];
    while (current.length <= index) {
      current.push({ place: '', entryDate: '', exitDate: '' });
    }
    const updated = { ...current[index], [field]: value };
    current[index] = updated;
    state.spain.stays = current;
    return state;
  });
}

function handleSubmissionSpainStayRemove(event) {
  const button = event.target.closest('.submission-spain-remove-stay');
  if (!button) return;
  event.preventDefault();
  if (button.disabled || !getSpainFeeAck()) return;
  const index = Number(button.dataset.index);
  if (Number.isNaN(index)) return;

  persistVisaSubmissionState((state) => {
    state.spain = state.spain || { ...SPAIN_SUBMISSION_DEFAULTS };
    const current = Array.isArray(state.spain.stays) ? state.spain.stays.slice() : [];
    current.splice(index, 1);
    state.spain.stays = current;
    return state;
  });
  announceSpainStayChange('Stay removed.');
}

function handleSubmissionSpainFixClick(event) {
  const button = event.target.closest('.submission-spain-fix-btn');
  if (!button) return;
  if (button.disabled) return;
  const docKey = button.dataset.docKey || button.dataset.checklistTarget;
  if (!docKey) return;
  goToChecklistAndFocus(docKey);
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
  ayuda: 'views/ayuda.html',
  visa: 'views/my-visa.html'    // ← ESTA LÍNEA con coma arriba
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

    // --- My Visa (inicialización de Overview y eventos) ---
    if (pageId === 'visa') {
      // Pintar el dashboard de Overview al entrar a My Visa
      renderVisaOverview();
      initVisaChecklistUI();
      initVisaSubmissionUI();
      initVisaAppointmentUI();
      initVisaApprovalUI();
      initVisaTieUI();

      // Ocultar todos los paneles menos el activo por si el CSS de tabs no aplica
      contentDiv.querySelectorAll('.tab-content .tab-pane').forEach((pane) => {
        if (pane.classList.contains('active')) {
          pane.removeAttribute('hidden');
        } else {
          pane.setAttribute('hidden', '');
        }
      });

      // (opcional) Re-pintar al cambiar de pestañas si vuelves a Overview
      const tabs = document.getElementById('visa-tabs');
      if (tabs) {
        const resolvePane = (btn) => {
          const targetSelector = btn?.getAttribute('data-bs-target');
          return targetSelector ? contentDiv.querySelector(targetSelector) : null;
        };
        const overviewSummary = contentDiv.querySelector('.visa-overview-summary');

        // Aseguramos que el resumen esté visible al cargar Overview por primera vez
        overviewSummary?.classList.remove('d-none');

        tabs.addEventListener('show.bs.tab', (ev) => {
          const paneToShow = resolvePane(ev.target);
          if (!paneToShow) return;

          contentDiv.querySelectorAll('.tab-content .tab-pane').forEach((pane) => {
            if (pane === paneToShow) {
              pane.removeAttribute('hidden');
            } else {
              pane.setAttribute('hidden', '');
            }
          });

          if (overviewSummary) {
            if (paneToShow.id === 'visa-overview') {
              overviewSummary.classList.remove('d-none');
            } else {
              overviewSummary.classList.add('d-none');
            }
          }
        });

        tabs.addEventListener('shown.bs.tab', (ev) => {
          const target = ev.target && ev.target.getAttribute('data-bs-target');
          if (target === '#visa-overview') renderVisaOverview();
          if (target === '#visa-checklist') initVisaChecklistUI();
          if (target === '#visa-submission') initVisaSubmissionUI();
          if (target === '#visa-appointment') initVisaAppointmentUI();
          if (target === '#visa-approval') initVisaApprovalUI();
          if (target === '#visa-tie') initVisaTieUI();
        });
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
    key: 'id-proof',
    legacyKeys: ['idProof'],
    title: 'ID / Proof of Residence',
    instructionsHtml: '<p>Acceptable photo ID that proves jurisdiction (state or region) for consulate assignment.</p>'
  },
  {
    key: 'visa-form',
    legacyKeys: ['visaForm'],
    title: 'Visa Application Form',
    instructionsHtml: '<p>Use the official National Visa Application. Complete all fields and sign. No blanks.</p>'
  },
  {
    key: 'recent-photo',
    legacyKeys: ['photo'],
    title: 'Recent Photograph (2x2)',
    instructionsHtml: '<p>Color, plain white background, taken in the last 6 months.</p><p>No glasses, hats, or filters.</p>'
  },
  {
    key: 'fees',
    title: 'Consular & BLS Fee (receipt)',
    instructionsHtml: '<p>Provide proof of payment of both Consulate fee and BLS service fee (when applicable).</p>'
  },
  {
    key: 'passport',
    title: 'Valid Passport (scan + copy)',
    instructionsHtml: '<ul><li>Passport valid for entire program + 3 extra months.</li><li>At least two blank pages.</li><li>Passports issued over 10 years ago are not accepted.</li><li>Include a photocopy (not notarized).</li><li>Emergency passports are not accepted.</li></ul>'
  },
  {
    key: 'us-status',
    legacyKeys: ['usStatus'],
    title: 'U.S. Immigration Status',
    instructionsHtml: '<p>Proof of lawful status (e.g., Green Card, I-20 + I-94, or valid U.S. visa + I-94).</p>'
  },
  {
    key: 'financial-means',
    legacyKeys: ['funds'],
    title: 'Proof of Financial Means',
    instructionsHtml: '<p>Bank statements, scholarship letters, or sponsor letter showing sufficient funds.</p>'
  },
  {
    key: 'financial-means-translation',
    legacyKeys: ['fundsTrans'],
    title: 'Translation of Financial Means',
    instructionsHtml: '<p>Certified translation to Spanish if originals are not in Spanish.</p>'
  },
  {
    key: 'fbi-report',
    legacyKeys: ['fbiReport'],
    title: 'FBI Background Check (report)',
    instructionsHtml: '<p>Original FBI report, issued within validity window (commonly 180 days).</p>'
  },
  {
    key: 'fbi-report-translation',
    legacyKeys: ['fbiTrans'],
    title: 'Translation of FBI Report',
    instructionsHtml: '<p>Certified Spanish translation of the FBI background report.</p>'
  },
  {
    key: 'fbi-apostille',
    legacyKeys: ['fbiApostille'],
    title: 'Apostille of FBI',
    instructionsHtml: '<p>Apostille of the FBI report (if required by your consulate).</p>'
  },
  {
    key: 'fbi-apostille-translation',
    legacyKeys: ['fbiApostTrans'],
    title: 'Translation of Apostille of FBI',
    instructionsHtml: '<p>Certified Spanish translation of the apostille (if applicable).</p>'
  },
  {
    key: 'medical-certificate',
    legacyKeys: ['medical'],
    title: 'Medical Certificate',
    instructionsHtml: '<p>Doctor’s letter stating you are free of any disease that could have serious public health repercussions.</p>'
  },
  {
    key: 'disclaimer',
    legacyKeys: ['disclaimer'],
    title: 'Disclaimer Form (signed)',
    instructionsHtml: '<p>ETURE/Academy disclaimer signed by the student (and guardian if minor).</p>'
  },
  {
    key: 'birth-certificate',
    legacyKeys: ['birthCert'],
    title: 'Birth Certificate (+ apostille + translation)',
    instructionsHtml: '<p>Original birth certificate with apostille and certified translation.</p>',
    minor: true
  },
  {
    key: 'parents-passports',
    legacyKeys: ['parentsPass'],
    title: 'Parents’ Passports (notarized copies)',
    instructionsHtml: '<p>Notarized copies of both parents’ passports.</p>',
    minor: true
  },
  {
    key: 'parental-authorization',
    legacyKeys: ['parentAuth'],
    title: 'Parental Authorization (notarized)',
    instructionsHtml: '<p>Notarized authorization from both parents for the minor to study abroad.</p>',
    minor: true
  },
  {
    key: 'sex-crimes-registry',
    legacyKeys: ['sexRegistry'],
    title: 'Sex Crimes Registry Authorization',
    instructionsHtml: '<p>Certificate or authorization per consulate instructions.</p>',
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

function recalcVisaChecklistProgress(cl) {
  const includeMinor = getIsMinor();
  const items = Array.isArray(cl.items)
    ? cl.items.filter(item => isChecklistItemVisible(item, includeMinor))
    : [];
  const total = items.length;
  const verified = items.filter(item => normalizeChecklistStatus(item.status) === 'verified').length;
  cl.total = total;
  cl.uploaded = verified;
  return { total, verified, percent: total > 0 ? Math.round((verified / total) * 100) : 0 };
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

function getChecklistItem(key) {
  const cl = getChecklistState();
  const normalizedKey = normalizeChecklistKeyInput(key);
  return cl.items.find(item => item.key === normalizedKey) || null;
}

function renderVisaChecklistProgress(cl) {
  const { total, verified, percent } = recalcVisaChecklistProgress(cl);
  const bar = document.getElementById('visa-checklist-progress-bar');
  if (bar) {
    bar.style.width = `${percent}%`;
    bar.setAttribute('aria-valuenow', String(percent));
  }
  const text = document.getElementById('visa-verified-progress');
  if (text) text.textContent = `${verified}/${total} verified`;
  renderSubmissionProgress({ total, verified, percent });
  renderSubmissionSpainMirror();
}

function renderVisaChecklistList(cl) {
  const container = document.getElementById('visa-checklist-list');
  if (!container) return;

  const includeMinor = getIsMinor();
  const visibleItems = Array.isArray(cl.items)
    ? cl.items.filter(item => isChecklistItemVisible(item, includeMinor))
    : [];

  if (!visibleItems.length) {
    container.innerHTML = '<div class="p-3 text-muted small">No documents configured yet.</div>';
    return;
  }

  if (!visibleItems.some(item => item.key === currentVisaChecklistKey)) {
    currentVisaChecklistKey = visibleItems[0]?.key || null;
  }

  container.innerHTML = visibleItems.map((item) => {
    const normalizedKey = normalizeChecklistKeyInput(item.key);
    const isActive = normalizedKey === normalizeChecklistKeyInput(currentVisaChecklistKey);
    const meta = getChecklistVisualState(item);
    const checkmark = meta.key === 'verified'
      ? '<span class="text-success fw-bold" aria-hidden="true">✓</span>'
      : '';
    const minorPill = item.minor
      ? '<span class="badge bg-info text-dark ms-2">Minor</span>'
      : '';
    const ariaCurrent = isActive ? 'aria-current="true"' : '';
    const highlightClass = isActive ? ' border border-primary bg-light text-dark fw-semibold' : '';
    const iconHtml = meta.icon ? `<span aria-hidden="true" class="me-1">${meta.icon}</span>` : '';
    const ariaLabel = `${item.title} - ${meta.label}`;
    const rowClasses = `visa-doc-row list-group-item list-group-item-action d-flex align-items-center justify-content-between gap-2 text-start${highlightClass}`;
    const badgeClasses = `visa-doc-status ${meta.listClass}`;
    const domId = getChecklistDomIdForKey(normalizedKey);
    return `
      <button type="button" id="${domId}" class="${rowClasses}" data-doc-key="${normalizedKey}" ${ariaCurrent} aria-label="${ariaLabel}">
        <span class="me-2 flex-grow-1 text-truncate" title="${item.title.replace(/"/g, '&quot;')}">${item.title}${minorPill}</span>
        <span class="d-flex align-items-center gap-2 flex-shrink-0">
          <span class="${badgeClasses}" data-state="${meta.key}">${iconHtml}${meta.label}</span>
          ${checkmark}
        </span>
      </button>
    `;
  }).join('');
}

function updateVisaDemoModeNote() {
  const note = document.getElementById('visa-demo-mode-note');
  if (!note) return;
  note.classList.toggle('d-none', !isDemoModeEnabled());
}

function getVisibleChecklistItems() {
  const cl = getChecklistState();
  const includeMinor = getIsMinor();
  return cl.items.filter(item => isChecklistItemVisible(item, includeMinor));
}

function renderVisaChecklistDetail(key) {
  let normalizedKey = normalizeChecklistKeyInput(key);
  let item = normalizedKey ? getChecklistItem(normalizedKey) : null;
  const includeMinor = getIsMinor();
  if (item && !isChecklistItemVisible(item, includeMinor)) {
    item = null;
  }
  if (!item) {
    const visibleItems = getVisibleChecklistItems();
    if (visibleItems.length) {
      item = visibleItems[0];
      normalizedKey = item.key;
      currentVisaChecklistKey = item.key;
    } else {
      normalizedKey = '';
      currentVisaChecklistKey = null;
    }
  } else {
    currentVisaChecklistKey = item.key;
  }
  updateVisaDemoModeNote();
  const titleEl = document.getElementById('visa-doc-title');
  const instructionsEl = document.getElementById('doc-instructions');
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

  const catalog = item ? getChecklistCatalogItem(item.key) : null;

  if (item) {
    const minorPill = item.minor ? ' <span class="badge bg-info text-dark ms-2">Minor</span>' : '';
    titleEl.innerHTML = `${item.title}${minorPill}`;
    instructionsEl.innerHTML = catalog?.instructionsHtml || '<p>No instructions available yet.</p>';
    titleEl.setAttribute('tabindex', '-1');
  } else {
    titleEl.innerHTML = 'Select a document';
    instructionsEl.innerHTML = '<p>Select a document on the left to view instructions.</p>';
    titleEl.removeAttribute('tabindex');
  }

  applyChecklistChipForItem(item);

  const sampleUrl = catalog?.sampleUrl || '';
  sampleBtn.disabled = !sampleUrl;
  sampleBtn.dataset.sampleUrl = sampleUrl;
  sampleBtn.setAttribute('aria-label', item ? `View sample document for ${item.title}` : 'View sample document');

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
  fileInput.setAttribute('aria-label', item ? `Upload file for ${item.title}` : 'Upload file');
  fileInput.setAttribute('title', 'Upload PDF, JPG or PNG');

  replaceBtn.setAttribute('aria-label', item ? `Replace uploaded file for ${item.title}` : 'Replace uploaded file');
  replaceBtn.title = item?.fileName ? `Replace ${item.fileName}` : 'Replace uploaded file';
  replaceBtn.onclick = () => fileInput.click();

  viewBtn.disabled = !hasFile;
  viewBtn.classList.toggle('d-none', !hasFile);
  viewBtn.dataset.fileUrl = hasFile ? item.fileUrl : '';
  viewBtn.setAttribute('aria-label', item ? `View uploaded file for ${item.title}` : 'View uploaded file');
  viewBtn.title = item?.fileName || 'Open uploaded file';

  if (notesEl) {
    notesEl.disabled = !item;
    notesEl.value = item?.notes || '';
    notesEl.setAttribute('aria-label', item ? `Notes for ${item.title}` : 'Notes');
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
    verifyBtn.setAttribute('aria-label', item ? `Verify document ${item.title}` : 'Verify document');
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
    denyBtn.setAttribute('aria-label', item ? `Deny document ${item.title}` : 'Deny document');
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

  const cl = getChecklistState();
  if (updatedEl) {
    const timestamp = cl?._updatedAt;
    updatedEl.textContent = `Last update — ${timestamp ? new Date(timestamp).toLocaleString() : '—'}`;
  }

  const visibleItems = getVisibleChecklistItems();
  const currentIndex = visibleItems.findIndex(i => i.key === currentVisaChecklistKey);
  prevBtn.disabled = currentIndex <= 0;
  nextBtn.disabled = currentIndex === -1 || currentIndex >= visibleItems.length - 1;
  prevBtn.setAttribute('aria-label', 'Go to previous document');
  nextBtn.setAttribute('aria-label', 'Go to next document');

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

  if (item) {
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
  }
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
  if (!currentVisaChecklistKey || !cl.items.find(item => item.key === currentVisaChecklistKey)) {
    const firstPending = cl.items.find(item => item.status !== 'verified');
    currentVisaChecklistKey = (firstPending || cl.items[0])?.key || null;
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
  tab.querySelector('#doc-file-input')?.addEventListener('change', handleVisaDocFileChange);
  tab.querySelector('#doc-view-btn')?.addEventListener('click', handleVisaDocViewClick);
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
  const button = event.target.closest('[data-doc-key]');
  if (!button) return;
  const key = normalizeChecklistKeyInput(button.getAttribute('data-doc-key'));
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

function handleVisaDocSampleClick(event) {
  const button = event.currentTarget;
  const url = button?.dataset?.sampleUrl;
  if (url) {
    window.open(url, '_blank', 'noopener');
  }
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
      // Si tienes login.html, puedes redirigir:
      // window.location.href = 'login.html';
      // Si no, recarga y tu handleAuthState ya te mandará al login:
      window.location.reload();
    })
    .catch((err) => {
      console.error('Error signing out:', err);
      alert('Could not sign out. Please try again.');
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

// app.js - NUEVA LÍNEA AL FINAL
handleAuthState(initApp);
