/**
 * Bring-your-own-chatbot handoff.
 *
 * The escape hatch for when the deterministic parser gets a layout wrong and
 * there is no on-device model. It costs nothing and needs no API key: the
 * extension puts a complete prompt on the clipboard, the user pastes it into
 * whichever free assistant they already use, and pastes the answer back.
 *
 * Everything here is built around the fact that the reply will be messy. It
 * may be fenced, wrapped in an apology, use different key names, or come back
 * as the whole chat transcript because the user pressed select-all. The
 * reader accepts all of that, and the normaliser coerces enum values to the
 * nearest allowed one rather than rejecting the import.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});
  const S = () => NA.schema;

  /* --------------------------------------------------------------- prompt */

  function buildPrompt(resumeText) {
    const E = S().ENUMS;
    const shape = {
      identity: {
        firstName: '', lastName: '', email: '', phone: '',
        address: { street: '', line2: '', city: '', state: 'two-letter', zip: '' }
      },
      nursingCredentials: { npiNumber: '', nclex: { passDate: 'YYYY-MM', state: '' } },
      licenses: [{ type: E.licenseType, state: 'two-letter', number: '',
                   issueDate: 'YYYY-MM-DD', expirationDate: 'YYYY-MM-DD', isCompact: false }],
      certifications: [{ name: E.certName, otherName: '', issuingBody: E.issuingBody,
                         issueDate: 'YYYY-MM-DD', expirationDate: 'YYYY-MM-DD' }],
      education: [{ degree: E.degree, major: '', school: '', city: '', state: '',
                    graduationDate: 'YYYY-MM', gpa: '' }],
      experience: [{ employer: '', title: '', facilityType: E.facilityType,
                     traumaLevel: E.traumaLevel, unit: '', bedCount: '', typicalRatio: '',
                     startDate: 'YYYY-MM', endDate: 'YYYY-MM', isCurrent: false,
                     supervisorName: '', supervisorPhone: '', reasonForLeaving: '',
                     responsibilities: 'one duty per line' }],
      clinicalSkills: { emrSystems: E.emrSystems, procedures: [''],
                        languages: [{ language: '', proficiency: E.proficiency }] }
    };

    return [
      'You are converting a nursing resume into JSON so it can fill in job applications.',
      '',
      'Rules:',
      '1. Reply with JSON only. No explanation before or after it.',
      '2. Use exactly the keys below. Where a list of values is shown, pick one of them.',
      '3. Dates are YYYY-MM-DD when a day is given, otherwise YYYY-MM. Never guess a day.',
      '4. Leave a field as "" when the resume does not say. Do not invent a license',
      '   number, an expiration date, an NPI, a GPA or a graduation date.',
      '5. List every job, most recent first. employer is the organisation, title is',
      '   the role. Do not put a duty in either of them.',
      '6. bedCount, typicalRatio and traumaLevel come from phrases like "24-bed",',
      '   "1:2 ratio" and "Level II Trauma Center". Leave them "" when not stated.',
      '',
      'Shape:',
      JSON.stringify(shape, null, 1),
      '',
      'Resume:',
      '"""',
      String(resumeText || '').slice(0, 60000),
      '"""'
    ].join('\n');
  }

  /* ---------------------------------------------------------------- reply */

  /**
   * Pulls the richest JSON object out of an arbitrary chat reply.
   *
   * Richest, not first: assistants like to write "I used {} for missing
   * values" above the answer, and taking the first balanced brace pair returns
   * that empty object and silently imports nothing.
   */
  function extractJson(text) {
    const raw = String(text || '');
    const chunks = [];

    const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
    let m;
    while ((m = fence.exec(raw)) !== null) chunks.push(m[1]);
    chunks.push(raw);

    const found = [];
    chunks.forEach((chunk) => {
      const direct = tryParse(chunk);
      if (direct) found.push(direct);
      balancedAll(chunk).forEach((o) => found.push(o));
    });
    if (!found.length) return null;

    found.sort((a, b) => richness(b) - richness(a));
    return found[0];
  }

  /** How much of the shape we asked for this object actually carries. */
  function richness(obj) {
    if (!obj || typeof obj !== 'object') return -1;
    const target = obj.profile && typeof obj.profile === 'object' ? obj.profile : obj;
    let score = 0;
    Object.keys(KEY_ALIASES).forEach((key) => {
      const v = pick(target, KEY_ALIASES[key]);
      if (v === undefined || v === null) return;
      score += 10;
      if (Array.isArray(v)) score += Math.min(v.length, 20);
      else if (typeof v === 'object') score += Math.min(Object.keys(v).length, 20);
    });
    return score + Math.min(JSON.stringify(target).length / 500, 10);
  }

  function tryParse(t) {
    try {
      const v = JSON.parse(String(t).trim());
      return v && typeof v === 'object' ? v : null;
    } catch (e) { return null; }
  }

  /** Every balanced {...} run in the text, tolerating prose around them. */
  function balancedAll(text) {
    const s = String(text || '');
    const out = [];
    let start = -1;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') { if (depth === 0) start = i; depth++; }
      else if (c === '}' && depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          const parsed = tryParse(s.slice(start, i + 1));
          if (parsed) out.push(parsed);
          start = -1;
        }
      }
    }
    return out;
  }

  function balanced(text) {
    const all = balancedAll(text);
    if (!all.length) return null;
    all.sort((a, b) => richness(b) - richness(a));
    return all[0];
  }

  /* ------------------------------------------------------------ normalise */

  const KEY_ALIASES = {
    experience: ['experience', 'workExperience', 'work_experience', 'employment',
                 'employmentHistory', 'jobs', 'positions', 'work'],
    education: ['education', 'schools', 'degrees', 'educationHistory'],
    licenses: ['licenses', 'licences', 'licensure', 'license'],
    certifications: ['certifications', 'certs', 'certificates'],
    identity: ['identity', 'personal', 'personalInfo', 'contact', 'contactInfo', 'basics'],
    clinicalSkills: ['clinicalSkills', 'skills', 'clinical_skills'],
    nursingCredentials: ['nursingCredentials', 'credentials', 'nursing_credentials']
  };

  const FIELD_ALIASES = {
    employer: ['employer', 'company', 'organisation', 'organization', 'facility', 'name'],
    title: ['title', 'jobTitle', 'position', 'role'],
    startDate: ['startDate', 'start', 'from', 'startdate'],
    endDate: ['endDate', 'end', 'to', 'enddate'],
    isCurrent: ['isCurrent', 'current', 'present'],
    school: ['school', 'institution', 'university', 'college', 'name'],
    graduationDate: ['graduationDate', 'graduated', 'endDate', 'completion', 'year'],
    firstName: ['firstName', 'first', 'givenName'],
    lastName: ['lastName', 'last', 'surname', 'familyName'],
    expirationDate: ['expirationDate', 'expires', 'expiry', 'expiration'],
    number: ['number', 'licenseNumber', 'licenceNumber', 'no', 'id']
  };

  function pick(obj, names) {
    if (!obj || typeof obj !== 'object') return undefined;
    for (let i = 0; i < names.length; i++) {
      if (obj[names[i]] !== undefined) return obj[names[i]];
    }
    const lower = {};
    Object.keys(obj).forEach((k) => { lower[k.toLowerCase().replace(/[_\s]/g, '')] = obj[k]; });
    for (let i = 0; i < names.length; i++) {
      const k = names[i].toLowerCase().replace(/[_\s]/g, '');
      if (lower[k] !== undefined) return lower[k];
    }
    return undefined;
  }

  function section(obj, key) {
    const v = pick(obj, KEY_ALIASES[key] || [key]);
    return v === undefined ? null : v;
  }

  function str(v) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) return v.map(str).filter(Boolean).join('\n');
    return '';
  }

  function bool(v) {
    if (typeof v === 'boolean') return v;
    return /^(true|yes|y|1|present|current)$/i.test(String(v || '').trim());
  }

  /**
   * Spelled-out synonyms for the abbreviations the schema uses. Assistants
   * write "Basic Life Support" and "American Heart Association" far more often
   * than "BLS" and "AHA", and neither string contains the other, so no amount
   * of substring matching will connect them.
   */
  const ENUM_SYNONYMS = {
    RN: ['registered nurse', 'rn'],
    LPN: ['licensed practical nurse', 'licensed vocational nurse', 'lpn', 'lvn'],
    APRN: ['advanced practice registered nurse', 'advanced practice nurse', 'aprn'],
    NP: ['nurse practitioner', 'np'],
    CRNA: ['certified registered nurse anesthetist', 'nurse anesthetist', 'crna'],
    CNS: ['clinical nurse specialist', 'cns'],

    BLS: ['basic life support', 'basic cardiac life support', 'cpr', 'bls'],
    ACLS: ['advanced cardiac life support', 'advanced cardiovascular life support', 'acls'],
    PALS: ['pediatric advanced life support', 'paediatric advanced life support', 'pals'],
    NRP: ['neonatal resuscitation program', 'neonatal resuscitation', 'nrp'],
    TNCC: ['trauma nursing core course', 'trauma nursing core', 'tncc'],
    CCRN: ['critical care registered nurse', 'ccrn'],
    CEN: ['certified emergency nurse', 'cen'],
    PCCN: ['progressive care certified nurse', 'pccn'],
    NIHSS: ['nih stroke scale', 'national institutes of health stroke scale', 'nihss'],
    STABLE: ['s.t.a.b.l.e', 'stable program', 'stable'],
    CPN: ['certified pediatric nurse', 'cpn'],

    AHA: ['american heart association', 'aha'],
    ARC: ['american red cross', 'red cross', 'arc'],
    AACN: ['american association of critical care nurses', 'american association of critical-care nurses', 'aacn'],
    ENA: ['emergency nurses association', 'ena'],
    AWHONN: ['association of womens health obstetric and neonatal nurses', 'awhonn'],

    BSN: ['bachelor of science in nursing', 'bachelors of science in nursing', 'bachelor of nursing', 'bsn'],
    MSN: ['master of science in nursing', 'masters of science in nursing', 'msn'],
    DNP: ['doctor of nursing practice', 'dnp'],
    ADN: ['associate degree in nursing', 'associate of science in nursing', 'associates degree in nursing', 'adn', 'asn'],
    Diploma: ['diploma in nursing', 'nursing diploma', 'diploma'],

    SNF: ['skilled nursing facility', 'nursing home', 'long term care', 'long-term care', 'ltc', 'snf'],
    'Home Health': ['home health', 'home care', 'home health agency'],
    Corrections: ['corrections', 'correctional', 'jail', 'prison'],
    Telehealth: ['telehealth', 'telemedicine', 'virtual care', 'remote'],
    'Urgent Care': ['urgent care', 'walk in clinic'],
    Ambulatory: ['ambulatory', 'outpatient', 'surgery center', 'surgical center'],
    Clinic: ['clinic', 'physician office', 'primary care'],
    Hospital: ['hospital', 'medical center', 'medical centre', 'health system', 'acute care'],

    'Level I': ['level i', 'level 1', 'level one'],
    'Level II': ['level ii', 'level 2', 'level two'],
    'Level III': ['level iii', 'level 3', 'level three'],
    'Level IV': ['level iv', 'level 4', 'level four'],
    'Non-Trauma': ['non trauma', 'not a trauma center', 'none'],

    Epic: ['epic', 'epic systems'],
    Cerner: ['cerner', 'oracle cerner'],
    Meditech: ['meditech'],
    PointClickCare: ['pointclickcare', 'point click care', 'pcc'],
    Athena: ['athena', 'athenahealth'],
    Allscripts: ['allscripts', 'veradigm'],
    MatrixCare: ['matrixcare'],
    eClinicalWorks: ['eclinicalworks', 'ecw'],

    Native: ['native', 'first language', 'mother tongue'],
    Fluent: ['fluent', 'advanced', 'bilingual'],
    Professional: ['professional', 'medical interpreter', 'conversational', 'working proficiency']
  };

  const flatten = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');

  const SYNONYM_INDEX = (function () {
    const map = new Map();
    Object.keys(ENUM_SYNONYMS).forEach((canonical) => {
      ENUM_SYNONYMS[canonical].forEach((syn) => {
        const k = flatten(syn);
        if (!map.has(k)) map.set(k, canonical);
      });
    });
    return map;
  })();

  /** Coerces to the nearest allowed enum value instead of dropping the field. */
  function toEnum(value, allowed, fallback) {
    const v = str(value);
    if (!v) return fallback;
    const exact = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
    if (exact) return exact;

    const flat = flatten(v);
    const viaSynonym = SYNONYM_INDEX.get(flat);
    if (viaSynonym && allowed.indexOf(viaSynonym) !== -1) return viaSynonym;

    // A longer phrase that contains a known synonym, e.g. "BLS (AHA), current".
    let best = '';
    let bestLen = 0;
    SYNONYM_INDEX.forEach((canonical, syn) => {
      if (syn.length <= bestLen) return;
      if (allowed.indexOf(canonical) === -1) return;
      if (syn.length >= 3 && flat.indexOf(syn) !== -1) { best = canonical; bestLen = syn.length; }
    });
    if (best) return best;

    const contained = allowed.find((a) => flatten(a) === flat) ||
                      allowed.find((a) => flatten(a).length >= 3 && flat.indexOf(flatten(a)) !== -1) ||
                      allowed.find((a) => flat.length >= 3 && flatten(a).indexOf(flat) !== -1);
    return contained || fallback;
  }

  function isoDate(value, monthOnly) {
    const v = str(value);
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return monthOnly ? v.slice(0, 7) : v;
    if (/^\d{4}-\d{2}$/.test(v)) return monthOnly ? v : v + '-01';
    if (/^\d{4}$/.test(v)) return monthOnly ? v + '-01' : v + '-01-01';
    const mdy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(v);
    if (mdy) {
      const iso = `${mdy[3]}-${String(mdy[1]).padStart(2, '0')}-${String(mdy[2]).padStart(2, '0')}`;
      return monthOnly ? iso.slice(0, 7) : iso;
    }
    const my = /^(\d{1,2})[\/\-](\d{4})$/.exec(v);
    if (my) {
      const iso = `${my[2]}-${String(my[1]).padStart(2, '0')}`;
      return monthOnly ? iso : iso + '-01';
    }
    const parsedMonth = NA.resumeParse ? NA.resumeParse.toIsoMonth(v) : '';
    if (parsedMonth) return monthOnly ? parsedMonth : parsedMonth + '-01';
    return '';
  }

  function arr(v) { return Array.isArray(v) ? v : (v ? [v] : []); }

  /**
   * Turns an arbitrary reply into a profile fragment plus a list of what had to
   * be corrected, so the user can see the import was not taken on faith.
   */
  function normalise(raw) {
    const E = S().ENUMS;
    const issues = [];
    if (!raw || typeof raw !== 'object') {
      return { profile: null, issues: [{ level: 'warn', msg: 'That did not contain any JSON. Copy the assistant\'s whole reply and paste it again.' }] };
    }

    const src = raw.profile && typeof raw.profile === 'object' ? raw.profile : raw;
    const profile = {};

    const identity = section(src, 'identity') || {};
    const address = pick(identity, ['address', 'location']) || {};
    profile.identity = {
      firstName: str(pick(identity, FIELD_ALIASES.firstName)),
      lastName: str(pick(identity, FIELD_ALIASES.lastName)),
      email: str(pick(identity, ['email', 'emailAddress'])),
      phone: S().normalizePhone(str(pick(identity, ['phone', 'phoneNumber', 'mobile', 'cell']))),
      address: {
        street: str(pick(address, ['street', 'line1', 'address1'])),
        line2: str(pick(address, ['line2', 'address2', 'apt', 'unit'])),
        city: str(pick(address, ['city', 'town'])),
        state: S().normalizeState(str(pick(address, ['state', 'region', 'province']))),
        zip: str(pick(address, ['zip', 'postalCode', 'postcode']))
      }
    };

    const creds = section(src, 'nursingCredentials') || {};
    const nclex = pick(creds, ['nclex', 'nclexRn']) || {};
    const npi = str(pick(creds, ['npiNumber', 'npi']));
    if (npi && !S().isValidNpi(npi)) {
      issues.push({ level: 'warn', msg: `The NPI ${npi} fails its check digit, so it was left out.` });
    }
    profile.nursingCredentials = {
      npiNumber: npi && S().isValidNpi(npi) ? npi.replace(/\D/g, '') : '',
      nclex: {
        passDate: isoDate(pick(nclex, ['passDate', 'date', 'passed']), true),
        state: S().normalizeState(str(pick(nclex, ['state'])))
      }
    };

    profile.licenses = arr(section(src, 'licenses')).map((l) => ({
      type: toEnum(pick(l, ['type', 'licenseType']), E.licenseType, 'RN'),
      state: S().normalizeState(str(pick(l, ['state', 'issuingState']))),
      number: str(pick(l, FIELD_ALIASES.number)),
      issueDate: isoDate(pick(l, ['issueDate', 'issued', 'effective'])),
      expirationDate: isoDate(pick(l, FIELD_ALIASES.expirationDate)),
      isCompact: bool(pick(l, ['isCompact', 'compact', 'multistate'])),
      isPrimaryState: false,
      disciplinaryAction: false,
      disciplinaryExplanation: ''
    })).filter((l) => l.state || l.number || l.expirationDate);
    if (profile.licenses.length) profile.licenses[0].isPrimaryState = true;

    profile.certifications = arr(section(src, 'certifications')).map((c) => {
      const rawName = str(pick(c, ['name', 'certification', 'title']));
      const name = toEnum(rawName, E.certName, 'Other');
      return {
        name,
        otherName: name === 'Other' ? rawName : str(pick(c, ['otherName'])),
        issuingBody: toEnum(pick(c, ['issuingBody', 'issuer', 'body', 'organization']), E.issuingBody, 'Other'),
        issueDate: isoDate(pick(c, ['issueDate', 'issued'])),
        expirationDate: isoDate(pick(c, FIELD_ALIASES.expirationDate)),
        verificationUrlOrCertId: str(pick(c, ['verificationUrlOrCertId', 'certId', 'id']))
      };
    }).filter((c) => c.name !== 'Other' || c.otherName);

    profile.education = arr(section(src, 'education')).map((e) => ({
      degree: toEnum(pick(e, ['degree', 'qualification']), E.degree, 'Other'),
      major: str(pick(e, ['major', 'fieldOfStudy', 'field'])) || 'Nursing',
      school: str(pick(e, FIELD_ALIASES.school)),
      city: str(pick(e, ['city'])),
      state: S().normalizeState(str(pick(e, ['state']))),
      graduationDate: isoDate(pick(e, FIELD_ALIASES.graduationDate), true),
      gpa: str(pick(e, ['gpa']))
    })).filter((e) => e.school || e.degree !== 'Other');

    profile.experience = arr(section(src, 'experience')).map((x) => {
      const isCurrent = bool(pick(x, FIELD_ALIASES.isCurrent)) ||
                        /^(present|current)$/i.test(str(pick(x, FIELD_ALIASES.endDate)));
      return {
        employer: str(pick(x, FIELD_ALIASES.employer)),
        facilityType: toEnum(pick(x, ['facilityType', 'settingType', 'setting']), E.facilityType, 'Hospital'),
        traumaLevel: toEnum(pick(x, ['traumaLevel', 'trauma']), E.traumaLevel, 'Non-Trauma'),
        unit: str(pick(x, ['unit', 'department', 'specialty', 'speciality'])),
        bedCount: str(pick(x, ['bedCount', 'beds'])),
        typicalRatio: str(pick(x, ['typicalRatio', 'ratio', 'nurseToPatientRatio'])),
        title: str(pick(x, FIELD_ALIASES.title)),
        startDate: isoDate(pick(x, FIELD_ALIASES.startDate), true),
        endDate: isCurrent ? '' : isoDate(pick(x, FIELD_ALIASES.endDate), true),
        isCurrent,
        supervisorName: str(pick(x, ['supervisorName', 'supervisor', 'manager'])),
        supervisorTitle: str(pick(x, ['supervisorTitle'])),
        supervisorPhone: S().normalizePhone(str(pick(x, ['supervisorPhone']))),
        supervisorEmail: str(pick(x, ['supervisorEmail'])),
        mayContact: true,
        reasonForLeaving: str(pick(x, ['reasonForLeaving', 'reason'])),
        responsibilities: str(pick(x, ['responsibilities', 'duties', 'description', 'highlights']))
      };
    }).filter((x) => x.employer || x.title);

    const skills = section(src, 'clinicalSkills') || {};
    const emrRaw = arr(pick(skills, ['emrSystems', 'emr', 'ehr', 'charting']));
    profile.clinicalSkills = {
      emrSystems: emrRaw.map((e) => toEnum(e, E.emrSystems, '')).filter(Boolean)
        .filter((e, i, a) => a.indexOf(e) === i),
      procedures: arr(pick(skills, ['procedures', 'clinicalSkills', 'competencies'])).map(str).filter(Boolean),
      languages: arr(pick(skills, ['languages'])).map((l) => (typeof l === 'string'
        ? { language: l, proficiency: 'Fluent' }
        : { language: str(pick(l, ['language', 'name'])),
            proficiency: toEnum(pick(l, ['proficiency', 'level']), E.proficiency, 'Fluent') }))
        .filter((l) => l.language)
    };

    const dropped = arr(section(src, 'experience')).length - profile.experience.length;
    if (dropped > 0) {
      issues.push({ level: 'info', msg: `${dropped} job entr${dropped === 1 ? 'y' : 'ies'} had neither an employer nor a title and were skipped.` });
    }
    if (!profile.experience.length) {
      issues.push({ level: 'warn', msg: 'No jobs were found in that reply. Check you pasted the whole answer.' });
    }
    return { profile, issues };
  }

  function read(replyText) {
    const json = extractJson(replyText);
    return normalise(json);
  }

  NA.handoff = { buildPrompt, extractJson, balanced, balancedAll, richness,
                 normalise, read, toEnum, isoDate, ENUM_SYNONYMS };
})(typeof self !== 'undefined' ? self : this);
