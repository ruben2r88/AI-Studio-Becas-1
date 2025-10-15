// src/state/profileState.js
const emptyTripState = {
  departureDate: null,
  arrivalDate: null,
  arrivalTime: '',
  arrivalPlace: '',
  itineraryFileUrl: '',
  confirmed: false,
  updatedAt: null
};

export const emptyProfileData = {
  personal:  { name:'', surname:'', email:'', nationality:'', birthDate:'', passportNumber:'', passportExpiry:'' },
  contact:   { phoneCode:'', phoneNumber:'', address1:'', address2:'', city:'', postalCode:'', province:'', country:'' },
  parent:    { name:'', relation:'', email:'', phone:'' },
  academic:  { status:'', gpa: null, englishLevel:'', studyOptions:[], exams:[] },
  athletic:  { height: null, weight: null, dominantFoot:'', mainPosition:'', secondaryPositions:[], currentTeam:'', currentDivision:'', stats:{} },
  media:     { social:[], highlights:[], matches:[], profilePicture:'', banner:'', videoThumbnail:'' },
  promotion: { universityType:[], locationType:[], sportsDivision:[], budget:'', objectives:'' },
  universityInterest: [],
  academicHistory: [],
  teamHistory: [],
  trip: { ...emptyTripState }
};

// Simple global state (single source of truth in memory)
export const profileState = {
  // clone to avoid mutating the constant by accident
  data: JSON.parse(JSON.stringify(emptyProfileData)),
};

export function getTrip(stateOverride) {
  if (stateOverride && typeof stateOverride === 'object') {
    const root = stateOverride.data || stateOverride.profile || stateOverride;
    const trip = root && typeof root === 'object' ? root.trip : null;
    return { ...emptyTripState, ...(trip && typeof trip === 'object' ? trip : {}) };
  }

  if (!profileState.data.trip || typeof profileState.data.trip !== 'object') {
    profileState.data.trip = { ...emptyTripState };
  } else {
    profileState.data.trip = { ...emptyTripState, ...profileState.data.trip };
  }

  if (typeof window !== 'undefined' && window.profileState?.data) {
    window.profileState.data.trip = profileState.data.trip;
  }

  return profileState.data.trip;
}

export function setTrip(partial = {}) {
  const current = getTrip();
  if (partial && typeof partial === 'object') {
    Object.assign(current, partial);
  }
  current.updatedAt = partial && Object.prototype.hasOwnProperty.call(partial, 'updatedAt')
    ? partial.updatedAt
    : new Date().toISOString();

  if (typeof window !== 'undefined' && window.profileState?.data) {
    window.profileState.data.trip = current;
  }

  return current;
}
