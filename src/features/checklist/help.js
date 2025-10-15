export function normalizeTitle(txt = "") {
  return String(txt)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s/g, " ");
}

/**
 * HELP_MAP keys must be normalized titles (use normalizeTitle(titleFromLeftList))
 * Each entry:
 *  - title: Visible heading (canonical name)
 *  - fullHtml: Main instructional HTML
 *  - moreUrl: (optional) URL for "View More"
 *  - sampleUrl: (optional) URL for "Show Sample"
 */
export const HELP_MAP = {
  [normalizeTitle("Visa Application")]: {
    title: "Visa Application",
    fullHtml: `
      <p><strong>Form:</strong> Complete and sign the visa application form (either electronically or handwritten in capital letters).</p>
      <p><strong>Guidance:</strong> Click on "Show Example" for guidance on how to fill it out.</p>
      <p><strong>Download:</strong> Download the template from the ETURE Download Forms section or use the provided link.</p>
    `
  },

  [normalizeTitle("Original Passport")]: {
    title: "Original Passport",
    fullHtml: `
      <p><strong>Validity:</strong> It must have at least 2 blank pages and be valid for the entire duration of your stay, plus an additional 3 months after your intended stay in Spain.</p>
      <p>It needs to expire 3 months after the end date of the program.</p>
      <p><strong>Issuance Date:</strong> Passports issued more than 10 years ago are not accepted.</p>
      <p><strong>Emergency Passports:</strong> Emergency passports are not accepted.</p>
      <p><strong>Photocopy:</strong> Include a photocopy (not notarized) of your passport.</p>
    `
  },

  [normalizeTitle("ID - Proof of Jurisdiction")]: {
    title: "ID - Proof of Jurisdiction",
    fullHtml: `
      <p><strong>Requirement:</strong> You must provide a notarized copy of proof of residence within the consular jurisdiction (original and photocopy).</p>
      <p><strong>Accepted Forms:</strong></p>
      <ul>
        <li>Driver's license with current address</li>
        <li>State-issued ID card</li>
        <li>Voter registration card</li>
        <li>Current student ID</li>
      </ul>
      <p><strong>Validity:</strong> The proof must be valid on the day of your consulate appointment.</p>
    `
  },

  [normalizeTitle("U.S. immigration status")]: {
    title: "U.S. immigration status",
    fullHtml: `
      <p><strong>Applicability:</strong> This is not applicable for U.S. citizens.</p>
      <p><strong>Document Types:</strong> Green card, valid U.S. student visa, work permit (stamp in passport), or parole status.</p>
      <p><strong>Copy:</strong> Provide a notarized copy of your immigration status document.</p>
    `
  },

  [normalizeTitle("Disclaimer Form")]: {
    title: "Disclaimer Form",
    fullHtml: `
      <p><strong>Requirement:</strong> Ensure the Disclaimer Form is signed and uploaded as part of your visa application.</p>
    `
  },

  [normalizeTitle("Two Recent Passport-sized photos.")]: {
    title: "Two Recent Passport-sized photos.",
    fullHtml: `
      <p><strong>Size:</strong> U.S. passport size (2"x2").</p>
      <p><strong>Date:</strong> Must be recent (not more than 6 months old) and should not have been used previously in the passport.</p>
      <p><strong>Requirements:</strong></p>
      <ul>
        <li>In color.</li>
        <li>Taken against a white background.</li>
        <li>Clear quality and with the face in focus.</li>
        <li>Printed on normal photographic paper (camera print).</li>
        <li>Full face, non-smiling (without sunglasses, a hat/cap, or other head covering, unless due to religious belief or ethnic background).</li>
      </ul>
      <p><strong>Placement:</strong> Stick the photograph on the Visa Application Form.</p>
    `
  },

  [normalizeTitle("VISA Fee & BLS Fee")]: {
    title: "VISA Fee & BLS Fee",
    fullHtml: `
      <p><strong>Payment Methods:</strong> Can be paid in different forms depending on the consulate.</p>
      <p><strong>Consulate Fees:</strong> Typically paid by money order in the name of "Consulate General of Spain in [city]".</p>
      <p><strong>BLS Service Fees:</strong> Generally paid by debit card or cash.</p>
      <p><strong>Information:</strong> Check the BLS website for specific information.</p>
    `
  },

  [normalizeTitle("Medical Certificate")]: {
    title: "Medical Certificate",
    fullHtml: `
      <p><strong>Content:</strong> Must confirm you are not suffering from drug addiction, mental health issues, or any other diseases that could pose a threat to public health in accordance with the International Health Regulations of 2005.</p>
      <p><strong>Template:</strong> Use the template provided on the BLS website or download the version from ETURE Download Forms.</p>
      <p><strong>Translation:</strong> If using the model from the BLS website, the Spanish translation is not necessary.</p>
      <p><strong>Certificate Requirements:</strong></p>
      <ul>
        <li>Issued within the last 3 months.</li>
        <li>Must include the doctor's name, signature, license number, and the hospital/doctor's stamp.</li>
        <li>Must be written on the official letterhead of the hospital or doctor's office.</li>
      </ul>
    `
  },

  [normalizeTitle("FBI Check")]: {
    title: "FBI Check",
    fullHtml: `
      <p><strong>Accepted Check:</strong> Only FBI background checks are accepted; state or local police checks are not valid.</p>
      <p><strong>Issuance Date:</strong> Must be issued within 6 months of your visa application.</p>
      <p><strong>Other Countries:</strong> If you have lived in another country for more than 6 months in the past 5 years, you must also provide a criminal background check from that country, authenticated with the Hague Apostille and translated into Spanish.</p>
      <p><strong>Processing Services (FBI Check/FBI Channeling):</strong> Can be processed through PrintScan or Monument Visa.</p>
    `
  },

  [normalizeTitle("Apostille of FBI")]: {
    title: "Apostille of FBI",
    fullHtml: `
      <p><strong>Requirement:</strong> Must be authenticated with the Hague Apostille (certifying the signature on the criminal record, not other signatures such as notaries).</p>
      <p><strong>Processing:</strong> Recommended to use Monument Visa.</p>
    `
  },

  [normalizeTitle("Financial Means")]: {
    title: "Financial Means",
    fullHtml: `
      <p><strong>Requirement:</strong> A notarized letter from your parents or legal guardians confirming their financial responsibility for you during your stay in Spain (at least $700 per month for room and board).</p>
      <p><strong>Suggested Wording:</strong> &quot;I hereby certify that I am the [father/mother/other] of [name], and will support him/her with a monthly allowance of at least $700 while he/she is in Spain, and I am financially responsible for any emergency that may arise&quot;.</p>
      <p><strong>Attachments:</strong> Attach supporting bank statements and your birth certificate.</p>
    `
  },

  [normalizeTitle("Notarized copy of Birth Certificate")]: {
    title: "Notarized copy of Birth Certificate",
    fullHtml: `
      <p><strong>Requirement:</strong> Provide the original (which will be returned) and a notarized copy of the birth certificate issued in the last 12 months.</p>
    `
  },

  [normalizeTitle("Apostille of Birth Certificate")]: {
    title: "Apostille of Birth Certificate",
    fullHtml: `
      <p><strong>Authentication:</strong> Must be authenticated with the Hague Apostille.</p>
      <p><strong>Processing:</strong> Process the Apostille through Monument Visa.</p>
    `
  },

  [normalizeTitle("Translation of FBI")]: {
    title: "Translation of FBI",
    fullHtml: `
      <p><strong>Requirement:</strong> Must include an official or certified Spanish translation.</p>
      <p><strong>Service Providers:</strong></p>
      <ul>
        <li><a href="https://www.travelvisapro.com/translations?client_id=832612178" target="_blank" rel="noopener noreferrer">Travel Visa Pro</a></li>
        <li>Monument Visa: Can also handle the translation and Apostille process.</li>
      </ul>
      <p><strong>Translators based in Spain:</strong></p>
      <ul>
        <li>Maria Jose Loureiro Sumay | <a href="mailto:mariasumay@gmail.com">mariasumay@gmail.com</a> | +34 616 22 58 70</li>
        <li>Maria Ortuno | <a href="mailto:info@meibuntraducciones.com">info@meibuntraducciones.com</a> | +34 623 033 797</li>
      </ul>
    `
  },

  [normalizeTitle("Translation of Apostille of FBI")]: {
    title: "Translation of Apostille of FBI",
    fullHtml: `
      <p><strong>Requirement:</strong> Must be translated into Spanish.</p>
    `
  },

  [normalizeTitle("Translation of Birth Certificate")]: {
    title: "Translation of Birth Certificate",
    fullHtml: `
      <p><strong>Requirement:</strong> Must be translated into Spanish.</p>
    `
  },

  [normalizeTitle("Translation of Apostille of Birth Certificate")]: {
    title: "Translation of Apostille of Birth Certificate",
    fullHtml: `
      <p><strong>Requirement:</strong> Must be translated into Spanish.</p>
    `
  },

  [normalizeTitle("If you are under 18")]: {
    title: "If you are under 18",
    fullHtml: `
      <p><strong>Notarized Parental Authorization:</strong></p>
      <ul>
        <li>Must be from both parents or guardians for the trip to Spain.</li>
        <li>Must identify the person who will take care of the minor in Spain, the center/organization responsible, and the planned period of stay.</li>
        <li>Must expressly include the name, surnames, DNI or NIE numbers, and address of the caregivers in Spain.</li>
        <li>If the document is in another language, it must be translated into Spanish.</li>
        <li>Download the template.</li>
      </ul>
      <p><strong>Registry of Crimes of Sexual Nature:</strong> Print it out and present it at the appointment (no further action needed).</p>
      <p><strong>Notarized copy of both parents' passports.</strong></p>
      <p><strong>Notarized Letter of Acceptance for Minor Responsibility:</strong> Print it out and present it at the appointment (no further action needed).</p>
    `
  },

  [normalizeTitle("Eture Acceptance Letters")]: {
    title: "Eture Acceptance Letters",
    fullHtml: `
      <p><strong>Requirement:</strong> Print out the following letters and bring them to your appointment.</p>
      <p><strong>Review:</strong> Review your personal information to ensure it is correct.</p>
      <p><strong>Letters to Submit:</strong></p>
      <ul>
        <li>ETURE Acceptance Letter.</li>
        <li>GM Football Academy Letter.</li>
        <li>Certificate of Enrollment.</li>
        <li>ETURE Financial Responsibility Letter.</li>
      </ul>
    `
  },

  [normalizeTitle("Templates and Forms")]: {
    title: "Templates and Forms",
    fullHtml: `
      <p><strong>Forms available for download:</strong></p>
      <ul>
        <li>National Visa Application form.</li>
        <li>Disclaimer Form.</li>
        <li>Medical Certificate Form.</li>
        <li>Notarized Letter of Financial Responsibility.</li>
        <li>Notarized Parental Letter of Minor Authorization.</li>
      </ul>
    `
  }
};

export const HELP_ALIASES = {
  [normalizeTitle("Visa Application Form")]: normalizeTitle("Visa Application"),
  [normalizeTitle("Original Valid Passport")]: normalizeTitle("Original Passport"),
  [normalizeTitle("Valid Passport (scan + copy)")]: normalizeTitle("Original Passport"),
  [normalizeTitle("ID / Proof of Residence")]: normalizeTitle("ID - Proof of Jurisdiction"),
  [normalizeTitle("Proof of Residence (ID)")]: normalizeTitle("ID - Proof of Jurisdiction"),
  [normalizeTitle("U.S. Immigration Status")]: normalizeTitle("U.S. immigration status"),
  [normalizeTitle("Disclaimer Form (signed)")]: normalizeTitle("Disclaimer Form"),
  [normalizeTitle("Recent Photograph (2x2)")]: normalizeTitle("Two Recent Passport-sized photos."),
  [normalizeTitle("Two Recent Passport-sized Photos")]: normalizeTitle("Two Recent Passport-sized photos."),
  [normalizeTitle("Consular & BLS Fee (receipt)")]: normalizeTitle("VISA Fee & BLS Fee"),
  [normalizeTitle("VISA Fee & BLS Fee (Consular & BLS Fee)")]: normalizeTitle("VISA Fee & BLS Fee"),
  [normalizeTitle("Medical certificate")]: normalizeTitle("Medical Certificate"),
  [normalizeTitle("FBI Background Check")]: normalizeTitle("FBI Check"),
  [normalizeTitle("FBI Background Check (report)")]: normalizeTitle("FBI Check"),
  [normalizeTitle("FBI Background Check / Criminal Record Requirements")]: normalizeTitle("FBI Check"),
  [normalizeTitle("Proof of Financial Means")]: normalizeTitle("Financial Means"),
  [normalizeTitle("Translation of Financial Means")]: normalizeTitle("If you are under 18"),
  [normalizeTitle("Notarized Copy of Birth Certificate")]: normalizeTitle("Notarized copy of Birth Certificate"),
  [normalizeTitle("Birth Certificate (+ apostille + translation)")]: normalizeTitle("Notarized copy of Birth Certificate"),
  [normalizeTitle("Apostille of Birth")]: normalizeTitle("Apostille of Birth Certificate"),
  [normalizeTitle("Translation of FBI Report")]: normalizeTitle("Translation of FBI"),
  [normalizeTitle("Translation of Apostille")]: normalizeTitle("Translation of Apostille of FBI"),
  [normalizeTitle("Parents' Passports (notarized copies)")]: normalizeTitle("Apostille of Birth Certificate"),
  [normalizeTitle("Parents’ Passports (notarized copies)")]: normalizeTitle("Apostille of Birth Certificate"),
  [normalizeTitle("Parental Authorization (notarized)")]: normalizeTitle("Translation of Birth Certificate"),
  [normalizeTitle("Sex Crimes Registry Authorization")]: normalizeTitle("Translation of Apostille of Birth Certificate"),
  [normalizeTitle("Sex Crimes Registry")]: normalizeTitle("Translation of Apostille of Birth Certificate"),
  [normalizeTitle("If you are under 18 (Minor Requirements)")]: normalizeTitle("If you are under 18"),
  [normalizeTitle("ETURE Documents")]: normalizeTitle("Eture Acceptance Letters"),
  [normalizeTitle("ETURE Acceptance Letters")]: normalizeTitle("Eture Acceptance Letters"),
  [normalizeTitle("Templates & Forms")]: normalizeTitle("Templates and Forms")
};

export function resolveHelpKey(rawTitle) {
  const normalized = normalizeTitle(rawTitle || "");
  if (!normalized) return null;
  if (Object.prototype.hasOwnProperty.call(HELP_MAP, normalized)) {
    return normalized;
  }
  return HELP_ALIASES[normalized] || null;
}
