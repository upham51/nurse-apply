/**
 * NurseApply profile schema, defaults and validation.
 * Loaded as a classic script in content scripts, extension pages and the
 * service worker (via importScripts). Everything hangs off globalThis.NA.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});

  const ENUMS = {
    veteranStatus: ['None', 'Protected', 'Veteran', 'Decline'],
    disabilityStatus: ['Yes', 'No', 'Decline'],
    gender: ['Female', 'Male', 'Non-Binary', 'Decline'],
    raceEthnicity: [
      'Decline', 'White', 'Black/African American', 'Asian',
      'Hispanic/Latino', 'Native American', 'Two or More'
    ],
    licenseType: ['RN', 'LPN', 'APRN', 'NP', 'CRNA', 'CNS'],
    certName: [
      'BLS', 'ACLS', 'PALS', 'NRP', 'TNCC', 'CCRN', 'CEN', 'PCCN',
      'NIHSS', 'STABLE', 'CPN', 'Other'
    ],
    issuingBody: ['AHA', 'ARC', 'AACN', 'ENA', 'AWHONN', 'Other'],
    degree: ['ADN', 'BSN', 'MSN', 'DNP', 'Diploma', 'Other'],
    facilityType: [
      'Hospital', 'SNF', 'Clinic', 'Home Health', 'Corrections',
      'Telehealth', 'Urgent Care', 'Ambulatory'
    ],
    traumaLevel: ['Level I', 'Level II', 'Level III', 'Level IV', 'Non-Trauma'],
    emrSystems: [
      'Epic', 'Cerner', 'Meditech', 'PointClickCare', 'Athena',
      'Allscripts', 'MatrixCare', 'eClinicalWorks'
    ],
    proficiency: ['Native', 'Fluent', 'Professional'],
    shift: ['Days', 'Nights', 'Rotating', 'Evening', 'PRN / Per Diem'],
    shiftLength: ['8 hr', '10 hr', '12 hr', 'Flexible'],
    employmentType: ['Full-Time', 'Part-Time', 'PRN', 'Contract / Travel'],
    relationship: ['Manager', 'Charge Nurse', 'Preceptor', 'Peer RN', 'Physician'],
    tbTestType: ['Quantiferon Gold', 'PPD Skin Test', 'Chest X-Ray'],
    covidVaccineStatus: ['Fully Vaccinated & Boosted', 'Fully Vaccinated', 'Exempt'],
    hepBStatus: ['Series Complete + Titer Reactive', 'Series Complete', 'Declined']
  };

  const STATES = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
    'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
    'NJ','NM','NY','NC','ND','OH','OK','OR','PA','PR','RI','SC','SD','TN','TX',
    'UT','VT','VA','WA','WV','WI','WY'
  ];

  const STATE_NAMES = {
    AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
    CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',
    FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',
    IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
    MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',
    MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',
    NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',
    ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',
    PR:'Puerto Rico',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',
    TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',
    WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'
  };

  /* ---------------------------------------------------------------- blanks */

  function blankLicense() {
    return {
      type: 'RN', state: '', number: '', issueDate: '', expirationDate: '',
      isCompact: false, isPrimaryState: false,
      disciplinaryAction: false, disciplinaryExplanation: ''
    };
  }

  function blankCertification() {
    return {
      name: 'BLS', otherName: '', issuingBody: 'AHA',
      issueDate: '', expirationDate: '', verificationUrlOrCertId: ''
    };
  }

  function blankEducation() {
    return {
      degree: 'BSN', major: 'Nursing', school: '', city: '', state: '',
      graduationDate: '', gpa: ''
    };
  }

  function blankExperience() {
    return {
      employer: '', facilityType: 'Hospital', traumaLevel: 'Non-Trauma',
      unit: '', bedCount: '', typicalRatio: '', title: '',
      startDate: '', endDate: '', isCurrent: false,
      supervisorName: '', supervisorTitle: '', supervisorPhone: '',
      supervisorEmail: '', mayContact: true, reasonForLeaving: '',
      responsibilities: ''
    };
  }

  function blankReference() {
    return {
      name: '', title: '', relationship: 'Manager', employer: '',
      phone: '', email: '', mayContact: true
    };
  }

  function blankLanguage() {
    return { language: '', proficiency: 'Fluent' };
  }

  function emptyProfile() {
    return {
      schemaVersion: 1,
      identity: {
        firstName: '', lastName: '', preferredName: '', email: '', phone: '',
        address: { street: '', line2: '', city: '', state: '', zip: '' },
        workAuthorization: true,
        requiresSponsorship: false,
        veteranStatus: 'Decline',
        disabilityStatus: 'Decline',
        gender: 'Decline',
        raceEthnicity: 'Decline',
        willingToRelocate: false
      },
      nursingCredentials: {
        npiNumber: '',
        nclex: { passDate: '', state: '' }
      },
      licenses: [],
      certifications: [],
      education: [],
      experience: [],
      clinicalSkills: {
        emrSystems: [],
        procedures: [],
        languages: []
      },
      preferences: {
        shift: 'Days',
        shiftLength: '12 hr',
        employmentType: 'Full-Time',
        minHourlyRate: '',
        weekendAvailability: true,
        holidayAvailability: true,
        floatPoolWilling: false,
        travelWilling: false
      },
      references: [],
      compliance: {
        tbTestDate: '', tbTestType: 'Quantiferon Gold',
        fluVaccineSeason: '', covidVaccineStatus: 'Fully Vaccinated',
        hepBStatus: 'Series Complete', mmrTiterDate: '', varicellaTiterDate: '',
        drugScreenWilling: true, backgroundCheckWilling: true
      },
      documents: {
        resumeFileName: '',
        resumeText: '',
        resumeBase64: '',
        resumeMimeType: '',
        coverLetterTemplate:
          'Dear {{hospital}} Hiring Team,\n\n' +
          'I am applying for the {{role}} position on {{unit}}. ' +
          'I hold {{certifications}} and have hands-on experience with ' +
          '{{emr_experience}}.\n\nThank you for your consideration.'
      }
    };
  }

  /* ------------------------------------------------------------ normalizers */

  function normalizePhone(value) {
    if (!value) return '';
    const digits = String(value).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    if (digits.length !== 10) return String(value).trim();
    return digits.slice(0, 3) + '-' + digits.slice(3, 6) + '-' + digits.slice(6);
  }

  function phoneParts(value) {
    const digits = String(value || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    if (digits.length !== 10) return { area: '', prefix: '', line: '', digits };
    return {
      area: digits.slice(0, 3),
      prefix: digits.slice(3, 6),
      line: digits.slice(6),
      digits
    };
  }

  function normalizeState(value) {
    if (!value) return '';
    const raw = String(value).trim();
    const upper = raw.toUpperCase();
    if (STATES.indexOf(upper) !== -1) return upper;
    const match = Object.keys(STATE_NAMES).find(
      (k) => STATE_NAMES[k].toLowerCase() === raw.toLowerCase()
    );
    return match || raw;
  }

  function stateName(abbr) {
    return STATE_NAMES[String(abbr || '').toUpperCase()] || abbr || '';
  }

  /** Accepts YYYY-MM-DD or YYYY-MM and renders it in a target style. */
  function formatDate(value, style) {
    if (!value) return '';
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(value).trim());
    if (!m) return String(value);
    const [, y, mo, d] = m;
    switch (style) {
      case 'MM/DD/YYYY': return d ? `${mo}/${d}/${y}` : `${mo}/01/${y}`;
      case 'MM/YYYY':    return `${mo}/${y}`;
      case 'YYYY-MM-DD': return d ? `${y}-${mo}-${d}` : `${y}-${mo}-01`;
      case 'YYYY-MM':    return `${y}-${mo}`;
      case 'YYYY':       return y;
      case 'MonthYear':  return `${MONTHS[Number(mo) - 1]} ${y}`;
      default:           return d ? `${mo}/${d}/${y}` : `${mo}/${y}`;
    }
  }

  const MONTHS = ['January','February','March','April','May','June','July',
                  'August','September','October','November','December'];

  /**
   * NPI check: 10 digits, Luhn computed over "80840" + first 9 digits.
   */
  function isValidNpi(npi) {
    const s = String(npi || '').replace(/\D/g, '');
    if (s.length !== 10) return false;
    const base = '80840' + s.slice(0, 9);
    let sum = 0;
    let double = true;
    for (let i = base.length - 1; i >= 0; i--) {
      let n = Number(base[i]);
      if (double) { n *= 2; if (n > 9) n -= 9; }
      double = !double;
      sum += n;
    }
    return (10 - (sum % 10)) % 10 === Number(s[9]);
  }

  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
  }

  function isIsoDate(v, allowMonthOnly) {
    if (!v) return true;
    return allowMonthOnly
      ? /^\d{4}-\d{2}(-\d{2})?$/.test(v)
      : /^\d{4}-\d{2}-\d{2}$/.test(v);
  }

  /* ------------------------------------------------------------- validation */

  function validateProfile(profile) {
    const errors = [];
    const warnings = [];
    const p = profile || {};
    const id = p.identity || {};

    const req = (cond, path, msg) => { if (!cond) errors.push({ path, msg }); };
    const warn = (cond, path, msg) => { if (!cond) warnings.push({ path, msg }); };

    req(!!id.firstName, 'identity.firstName', 'First name is required.');
    req(!!id.lastName, 'identity.lastName', 'Last name is required.');
    req(isValidEmail(id.email), 'identity.email', 'A valid email is required.');
    req(
      String(id.phone || '').replace(/\D/g, '').length >= 10,
      'identity.phone',
      'A 10-digit phone number is required.'
    );

    const addr = id.address || {};
    warn(!!addr.city, 'identity.address.city', 'City is blank; many portals require it.');
    warn(!!addr.state, 'identity.address.state', 'State is blank.');
    warn(
      !addr.zip || /^\d{5}(-\d{4})?$/.test(addr.zip),
      'identity.address.zip',
      'Zip should be 5 or 9 digits.'
    );

    Object.keys(ENUMS).forEach(() => {});
    const enumCheck = (val, key, path) => {
      if (val && ENUMS[key] && ENUMS[key].indexOf(val) === -1) {
        errors.push({ path, msg: `"${val}" is not one of: ${ENUMS[key].join(', ')}` });
      }
    };
    enumCheck(id.veteranStatus, 'veteranStatus', 'identity.veteranStatus');
    enumCheck(id.disabilityStatus, 'disabilityStatus', 'identity.disabilityStatus');
    enumCheck(id.gender, 'gender', 'identity.gender');
    enumCheck(id.raceEthnicity, 'raceEthnicity', 'identity.raceEthnicity');

    const npi = (p.nursingCredentials || {}).npiNumber;
    if (npi) {
      req(isValidNpi(npi), 'nursingCredentials.npiNumber',
        'NPI failed the 10-digit check-digit test. Confirm it before applying.');
    }

    const licenses = Array.isArray(p.licenses) ? p.licenses : [];
    warn(licenses.length > 0, 'licenses', 'No nursing license on file. Most portals require one.');
    licenses.forEach((l, i) => {
      const base = `licenses[${i}]`;
      enumCheck(l.type, 'licenseType', `${base}.type`);
      req(!!l.state, `${base}.state`, 'License state is required.');
      req(!!l.number, `${base}.number`, 'License number is required.');
      req(isIsoDate(l.expirationDate), `${base}.expirationDate`, 'Use YYYY-MM-DD.');
      if (l.expirationDate && l.expirationDate < todayIso()) {
        warnings.push({ path: `${base}.expirationDate`, msg: `${l.type} ${l.state} license expired ${l.expirationDate}.` });
      }
      if (l.disciplinaryAction && !l.disciplinaryExplanation) {
        errors.push({ path: `${base}.disciplinaryExplanation`,
          msg: 'Disciplinary action is flagged but no explanation is saved. NurseApply will not answer that question for you without one.' });
      }
    });

    const primary = licenses.filter((l) => l.isPrimaryState);
    if (licenses.length && primary.length !== 1) {
      warnings.push({ path: 'licenses',
        msg: 'Mark exactly one license as your primary state of residence for compact-license questions.' });
    }

    (Array.isArray(p.certifications) ? p.certifications : []).forEach((c, i) => {
      const base = `certifications[${i}]`;
      enumCheck(c.name, 'certName', `${base}.name`);
      enumCheck(c.issuingBody, 'issuingBody', `${base}.issuingBody`);
      if (c.name === 'Other') req(!!c.otherName, `${base}.otherName`, 'Name the certification.');
      req(isIsoDate(c.expirationDate), `${base}.expirationDate`, 'Use YYYY-MM-DD.');
      if (c.expirationDate && c.expirationDate < todayIso()) {
        warnings.push({ path: `${base}.expirationDate`,
          msg: `${c.name === 'Other' ? c.otherName : c.name} expired ${c.expirationDate}.` });
      }
    });

    (Array.isArray(p.education) ? p.education : []).forEach((e, i) => {
      const base = `education[${i}]`;
      enumCheck(e.degree, 'degree', `${base}.degree`);
      req(!!e.school, `${base}.school`, 'School name is required.');
      req(isIsoDate(e.graduationDate, true), `${base}.graduationDate`, 'Use YYYY-MM.');
    });

    (Array.isArray(p.experience) ? p.experience : []).forEach((x, i) => {
      const base = `experience[${i}]`;
      enumCheck(x.facilityType, 'facilityType', `${base}.facilityType`);
      enumCheck(x.traumaLevel, 'traumaLevel', `${base}.traumaLevel`);
      req(!!x.employer, `${base}.employer`, 'Employer is required.');
      req(!!x.title, `${base}.title`, 'Job title is required.');
      req(isIsoDate(x.startDate, true), `${base}.startDate`, 'Use YYYY-MM.');
      if (!x.isCurrent) {
        req(isIsoDate(x.endDate, true), `${base}.endDate`, 'Use YYYY-MM, or mark it current.');
      }
      if (x.startDate && x.endDate && !x.isCurrent && x.endDate < x.startDate) {
        errors.push({ path: `${base}.endDate`, msg: 'End date is before the start date.' });
      }
    });

    const currentRoles = (p.experience || []).filter((x) => x.isCurrent);
    if (currentRoles.length > 1) {
      warnings.push({ path: 'experience',
        msg: `${currentRoles.length} roles are marked current. Portals that ask for "current employer" will take the first one.` });
    }

    (Array.isArray(p.references) ? p.references : []).forEach((r, i) => {
      const base = `references[${i}]`;
      enumCheck(r.relationship, 'relationship', `${base}.relationship`);
      req(!!r.name, `${base}.name`, 'Reference name is required.');
      if (r.email) req(isValidEmail(r.email), `${base}.email`, 'Invalid email.');
    });

    const comp = p.compliance || {};
    enumCheck(comp.tbTestType, 'tbTestType', 'compliance.tbTestType');
    enumCheck(comp.covidVaccineStatus, 'covidVaccineStatus', 'compliance.covidVaccineStatus');
    enumCheck(comp.hepBStatus, 'hepBStatus', 'compliance.hepBStatus');

    const prefs = p.preferences || {};
    enumCheck(prefs.shift, 'shift', 'preferences.shift');
    enumCheck(prefs.shiftLength, 'shiftLength', 'preferences.shiftLength');
    enumCheck(prefs.employmentType, 'employmentType', 'preferences.employmentType');

    return { ok: errors.length === 0, errors, warnings };
  }

  function todayIso() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /** Deep-merge a stored profile over the current defaults, so new schema keys appear. */
  function hydrate(stored) {
    const base = emptyProfile();
    if (!stored || typeof stored !== 'object') return base;
    return mergeInto(base, stored);
  }

  function mergeInto(target, source) {
    Object.keys(source).forEach((key) => {
      const val = source[key];
      if (Array.isArray(val)) {
        target[key] = val.slice();
      } else if (val && typeof val === 'object') {
        target[key] = mergeInto(
          target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
            ? target[key] : {},
          val
        );
      } else if (val !== undefined) {
        target[key] = val;
      }
    });
    return target;
  }

  /* ------------------------------------------------------ derived summaries */

  function fullName(p) {
    const id = (p && p.identity) || {};
    return [id.firstName, id.lastName].filter(Boolean).join(' ');
  }

  function primaryLicense(p) {
    const list = (p && p.licenses) || [];
    return list.find((l) => l.isPrimaryState) || list[0] || null;
  }

  function currentJob(p) {
    const list = (p && p.experience) || [];
    return list.find((x) => x.isCurrent) || list[0] || null;
  }

  function certSummary(p) {
    return ((p && p.certifications) || [])
      .map((c) => (c.name === 'Other' ? c.otherName : c.name))
      .filter(Boolean)
      .join(', ');
  }

  function emrSummary(p) {
    return (((p && p.clinicalSkills) || {}).emrSystems || []).join(', ');
  }

  function renderCoverLetter(p, ctx) {
    const tpl = ((p && p.documents) || {}).coverLetterTemplate || '';
    const job = currentJob(p) || {};
    const tokens = {
      hospital: (ctx && ctx.hospital) || '',
      role: (ctx && ctx.role) || '',
      unit: (ctx && ctx.unit) || job.unit || '',
      certifications: certSummary(p),
      emr_experience: emrSummary(p)
    };
    return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) =>
      Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : m
    );
  }

  NA.schema = {
    ENUMS, STATES, STATE_NAMES, MONTHS,
    emptyProfile, hydrate, mergeInto, validateProfile,
    blankLicense, blankCertification, blankEducation, blankExperience,
    blankReference, blankLanguage,
    normalizePhone, phoneParts, normalizeState, stateName, formatDate,
    isValidNpi, isValidEmail, isIsoDate, todayIso,
    fullName, primaryLicense, currentJob, certSummary, emrSummary,
    renderCoverLetter
  };
})(typeof self !== 'undefined' ? self : this);
