// src/state/profileState.js
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
  teamHistory: []
};

// Estado global sencillo (única fuente de verdad en memoria)
export const profileState = {
  // clon para no mutar la constante por accidente
  data: JSON.parse(JSON.stringify(emptyProfileData)),
};
