/**
 * Tier 2: label-driven heuristic mapping.
 *
 * Each rule owns a regex over the field's resolved label text (label element,
 * aria-label, placeholder, name, id and data-automation-id concatenated) plus a
 * resolver that pulls the value out of the profile. The highest-scoring rule
 * wins. `weight` breaks ties between rules that both match: more specific
 * nursing language outranks generic form language.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});
  const S = () => NA.schema;

  const P = (profile) => profile || {};
  const ident = (p) => P(p).identity || {};
  const addr = (p) => ident(p).address || {};
  const creds = (p) => P(p).nursingCredentials || {};
  const skills = (p) => P(p).clinicalSkills || {};
  const prefs = (p) => P(p).preferences || {};
  const comp = (p) => P(p).compliance || {};
  const docs = (p) => P(p).documents || {};

  const nth = (arr, i) => (Array.isArray(arr) ? arr[i || 0] : undefined) || {};
  const lic = (p, i) => {
    const list = P(p).licenses || [];
    if (i === undefined || i === null) {
      return S().primaryLicense(p) || list[0] || {};
    }
    return list[i] || {};
  };
  const cert = (p, i) => nth(P(p).certifications, i);
  const edu = (p, i) => nth(P(p).education, i);
  const exp = (p, i) => nth(P(p).experience, i);
  const ref = (p, i) => nth(P(p).references, i);

  const certName = (c) => (c.name === 'Other' ? c.otherName : c.name) || '';

  /**
   * Date fields differ wildly. `dateHint(field)` sniffs the expected format from
   * the input type, placeholder and maxlength so we write 03/2021 where the form
   * wants 03/2021 and 2021-03-01 where it wants an ISO date.
   */
  function dateHint(field, monthOnly) {
    const el = field && field.el;
    if (el && (el.type === 'date')) return 'YYYY-MM-DD';
    if (el && (el.type === 'month')) return 'YYYY-MM';
    const hay = ((field && field.label) || '') + ' ' +
      ((el && el.getAttribute && (el.getAttribute('placeholder') || '')) || '');
    if (/yyyy\s*-\s*mm\s*-\s*dd/i.test(hay)) return 'YYYY-MM-DD';
    if (/mm\s*\/\s*dd\s*\/\s*yyyy/i.test(hay)) return 'MM/DD/YYYY';
    if (/mm\s*\/\s*yyyy/i.test(hay)) return 'MM/YYYY';
    if (/\byyyy\b/i.test(hay) && !/mm/i.test(hay)) return 'YYYY';
    return monthOnly ? 'MM/YYYY' : 'MM/DD/YYYY';
  }

  const d = (value, field, monthOnly) => S().formatDate(value, dateHint(field, monthOnly));

  /**
   * State fields: a two-letter <select> wants "OR", a searchable combobox
   * usually wants "Oregon". Decide from the control's own options.
   */
  function stateValue(abbr, field) {
    if (!abbr) return '';
    const opts = (field && field.options) || [];
    if (opts.length) {
      const wantsFull = opts.some((o) => /^[A-Za-z .]{5,}$/.test(String(o).trim()));
      return wantsFull ? S().stateName(abbr) : String(abbr).toUpperCase();
    }
    if (field && field.kind === 'combobox') return S().stateName(abbr);
    const el = field && field.el;
    if (el && el.maxLength === 2) return String(abbr).toUpperCase();
    return String(abbr).toUpperCase();
  }

  /** Yes/No controls take a boolean; text controls take the word. */
  function boolValue(b, field) {
    if (b === undefined || b === null) return undefined;
    if (!field) return b;
    if (field.kind === 'checkbox') return !!b;
    if (field.kind === 'radio' || field.kind === 'radiogroup') return b ? 'Yes' : 'No';
    if (field.kind === 'select' || field.kind === 'combobox') return b ? 'Yes' : 'No';
    return b ? 'Yes' : 'No';
  }

  const NEG = {
    supervisor: /\b(supervisor|manager|reference|contact\s+person|emergency\s+contact)\b/i,
    school: /\b(school|university|college|institution|campus)\b/i,
    employer: /\b(employer|company|organization|facility|hospital)\b/i
  };

  /* --------------------------------------------------------------- rules */

  const RULES = [
    /* ---- identity ---- */
    { id: 'firstName', weight: 10,
      re: /\b(first\s*name|given\s*name|legal\s+first|fname|forename)\b/i,
      not: /\b(parent|guardian|reference|supervisor|emergency|contact'?s)\b/i,
      resolve: (p) => ident(p).firstName },

    { id: 'lastName', weight: 10,
      re: /\b(last\s*name|surname|family\s*name|legal\s+last|lname)\b/i,
      not: /\b(parent|guardian|reference|supervisor|emergency|contact'?s)\b/i,
      resolve: (p) => ident(p).lastName },

    { id: 'middleName', weight: 8,
      re: /\b(middle\s*(name|initial)|mname|\bmi\b)\b/i,
      resolve: () => '' },

    { id: 'preferredName', weight: 9,
      re: /\b(preferred\s*(first\s*)?name|nick\s*name|goes\s+by|display\s+name)\b/i,
      resolve: (p) => ident(p).preferredName || ident(p).firstName },

    { id: 'fullName', weight: 7,
      re: /\b(full\s*name|your\s+name|applicant\s+name|name\s+of\s+applicant)\b/i,
      not: /\b(reference|supervisor|school|employer|emergency|user\s*name)\b/i,
      resolve: (p) => S().fullName(p) },

    { id: 'email', weight: 12,
      re: /\b(e-?mail|email\s*address)\b/i,
      not: /\b(reference|supervisor|confirm|verify|re-?enter|emergency)\b/i,
      resolve: (p) => ident(p).email },

    { id: 'emailConfirm', weight: 12,
      re: /\b(confirm|verify|re-?enter|repeat)\b.{0,20}\be-?mail\b|\be-?mail\b.{0,20}\b(confirm|again)\b/i,
      resolve: (p) => ident(p).email },

    { id: 'phone', weight: 11,
      re: /\b(phone|telephone|mobile|cell|contact\s+number|primary\s+number)\b/i,
      not: /\b(reference|supervisor|emergency|work\s+phone\s+of|extension|country(\s+phone)?\s+code|device\s+type)\b/i,
      resolve: (p, f) => phoneFor(ident(p).phone, f) },

    { id: 'phoneArea', weight: 12,
      re: /\b(area\s*code)\b/i,
      not: /\bcountry\b/i,
      resolve: (p) => S().phoneParts(ident(p).phone).area },

    { id: 'countryPhoneCode', weight: 14,
      re: /\bcountry\s*(phone\s*)?code\b/i,
      resolve: () => 'United States of America (+1)' },

    { id: 'phoneExtension', weight: 14,
      re: /\b(extension|ext\.?)\b/i,
      not: /\bfile\b/i,
      resolve: () => '' },

    { id: 'phoneDeviceType', weight: 14,
      re: /\b(phone\s*(device\s*)?type|device\s*type)\b/i,
      resolve: () => 'Mobile' },

    { id: 'street', weight: 10,
      re: /\b(street|address\s*(line\s*)?1|address1|addr1|mailing\s+address|home\s+address|street\s+address)\b/i,
      not: /\b(line\s*2|apt|suite|email|employer|school|reference)\b/i,
      resolve: (p) => addr(p).street },

    { id: 'street2', weight: 11,
      re: /\b(address\s*(line\s*)?2|address2|addr2|apt|apartment|suite|unit\s*#|building)\b/i,
      not: /\b(nursing\s+unit|unit\s+worked|hospital\s+unit)\b/i,
      resolve: (p) => addr(p).line2 },

    { id: 'city', weight: 10,
      re: /\b(city|town|municipality)\b/i,
      not: /\b(school|employer|reference|birth|company|facility)\b/i,
      resolve: (p) => addr(p).city },

    { id: 'state', weight: 10,
      re: /\b(state|province|region)\b/i,
      not: /\b(licens|school|employer|reference|nclex|birth|compact|company|united\s+states)\b/i,
      resolve: (p, f) => stateValue(addr(p).state, f) },

    { id: 'zip', weight: 11,
      re: /\b(zip|postal\s*code|post\s*code|zip\s*\/?\s*postal)\b/i,
      resolve: (p) => addr(p).zip },

    { id: 'country', weight: 8,
      re: /\b(country)\b/i,
      not: /\b(citizenship|birth|origin)\b/i,
      resolve: () => 'United States of America' },

    /* ---- demographics (EEO) ---- */
    { id: 'gender', weight: 10, demographic: true,
      re: /\b(gender|sex)\b/i,
      not: /\b(sexual\s+orientation)\b/i,
      resolve: (p) => ident(p).gender },

    { id: 'raceEthnicity', weight: 10, demographic: true,
      re: /\b(race|ethnicity|ethnic\s+(group|background)|hispanic\s+or\s+latino)\b/i,
      resolve: (p) => ident(p).raceEthnicity },

    { id: 'veteranStatus', weight: 10, demographic: true,
      re: /\b(veteran|protected\s+veteran|military\s+service\s+status)\b/i,
      resolve: (p) => ident(p).veteranStatus },

    { id: 'disabilityStatus', weight: 10, demographic: true,
      re: /\b(disability|disabled|section\s+503)\b/i,
      resolve: (p) => ident(p).disabilityStatus },

    /* ---- nursing credentials ---- */
    { id: 'npi', weight: 14,
      re: /\b(npi|national\s+provider\s+identifier)\b/i,
      resolve: (p) => creds(p).npiNumber },

    { id: 'nclexDate', weight: 14,
      re: /\bnclex\b.{0,30}\b(date|pass|taken|exam)\b|\b(date).{0,20}\bnclex\b/i,
      resolve: (p, f) => d(creds(p).nclex && creds(p).nclex.passDate, f, true) },

    { id: 'nclexState', weight: 14,
      re: /\bnclex\b.{0,30}\bstate\b|\bstate\b.{0,20}\bnclex\b/i,
      resolve: (p, f) => stateValue(creds(p).nclex && creds(p).nclex.state, f) },

    /* ---- licensure ---- */
    { id: 'licenseType', weight: 14,
      re: /\b(licens[ec]\s*(type|category)|type\s+of\s+licens|credential\s+type|licensure\s+type)\b/i,
      resolve: (p, f, ctx) => lic(p, ctx.index).type },

    { id: 'licenseNumber', weight: 15,
      re: /\b((nursing|rn|lpn|professional|state)?\s*licen[cs]e\s*(number|no\.?|#|id)|licen[cs]e\s*#|license_?num)\b/i,
      not: /\b(driver'?s?|cdl|vehicle)\b/i,
      resolve: (p, f, ctx) => lic(p, ctx.index).number },

    { id: 'licenseState', weight: 15,
      re: /\b(licen[cs]e\s*(issuing\s*)?state|state\s+of\s+licensure|licensing\s+(state|board|authority)|state\s+licen[cs]e|issuing\s+state)\b/i,
      resolve: (p, f, ctx) => stateValue(lic(p, ctx.index).state, f) },

    { id: 'licenseIssue', weight: 14,
      re: /\blicen[cs]e\b.{0,30}\b(issue|issued|effective|original)\b.{0,10}(date)?|\b(issue|effective)\s*date\b/i,
      not: /\b(cert|bls|acls|expir)/i,
      resolve: (p, f, ctx) => d(lic(p, ctx.index).issueDate, f) },

    { id: 'licenseExpiration', weight: 15,
      re: /\blicen[cs]e\b.{0,30}\bexpir\w*\b|\bexpir\w*\b.{0,20}\blicen[cs]e\b|\blicen[cs]e\s+renewal\s+date\b/i,
      resolve: (p, f, ctx) => d(lic(p, ctx.index).expirationDate, f) },

    { id: 'compactLicense', weight: 15,
      re: /\b(compact|multi-?state|enhanced\s+nurse\s+licensure|nlc\b)\b/i,
      resolve: (p, f, ctx) => boolValue(!!lic(p, ctx.index).isCompact, f) },

    { id: 'primaryStateOfResidence', weight: 14,
      re: /\b(primary\s+state\s+of\s+residence|pspr|home\s+state\s+of\s+licensure)\b/i,
      resolve: (p, f) => stateValue((S().primaryLicense(p) || {}).state || addr(p).state, f) },

    /* ---- certifications ---- */
    { id: 'bls', weight: 15,
      re: /\b(bls|basic\s+life\s+support|cpr\s+certification)\b/i,
      resolve: (p, f) => certField(p, 'BLS', f) },
    { id: 'acls', weight: 15,
      re: /\b(acls|advanced\s+cardiac\s+life\s+support|advanced\s+cardiovascular\s+life)\b/i,
      resolve: (p, f) => certField(p, 'ACLS', f) },
    { id: 'pals', weight: 15,
      re: /\b(pals|pediatric\s+advanced\s+life\s+support)\b/i,
      resolve: (p, f) => certField(p, 'PALS', f) },
    { id: 'nrp', weight: 15,
      re: /\b(nrp|neonatal\s+resuscitation)\b/i,
      resolve: (p, f) => certField(p, 'NRP', f) },
    { id: 'tncc', weight: 15,
      re: /\b(tncc|trauma\s+nursing\s+core)\b/i,
      resolve: (p, f) => certField(p, 'TNCC', f) },
    { id: 'nihss', weight: 15,
      re: /\b(nihss|nih\s+stroke\s+scale)\b/i,
      resolve: (p, f) => certField(p, 'NIHSS', f) },

    { id: 'certificationName', weight: 12,
      re: /\b(certification\s*(name|title)?|certificate\s+name|credential\s+name|specialty\s+certification)\b/i,
      not: /\b(licen[cs]e|expir|issu|number)\b/i,
      resolve: (p, f, ctx) => certName(cert(p, ctx.index)) },

    { id: 'certificationBody', weight: 13,
      re: /\b(issuing\s+(body|organization|authority|agency)|certifying\s+(body|organization)|certification\s+(body|source)|awarded\s+by)\b/i,
      resolve: (p, f, ctx) => expandBody(cert(p, ctx.index).issuingBody, f) },

    { id: 'certificationExpiration', weight: 13,
      re: /\b(cert\w*)\b.{0,30}\bexpir\w*|\bexpir\w*\b.{0,25}\bcert\w*/i,
      resolve: (p, f, ctx) => d(cert(p, ctx.index).expirationDate, f) },

    { id: 'certificationIssue', weight: 12,
      re: /\b(cert\w*)\b.{0,30}\b(issue|issued|completion|obtained)\b/i,
      resolve: (p, f, ctx) => d(cert(p, ctx.index).issueDate, f) },

    { id: 'certificationId', weight: 12,
      re: /\b(cert\w*)\b.{0,25}\b(number|id|#|verification)\b/i,
      resolve: (p, f, ctx) => cert(p, ctx.index).verificationUrlOrCertId },

    /* ---- education ---- */
    { id: 'school', weight: 13,
      re: /\b(school|university|college|institution|nursing\s+program|alma\s+mater|educational\s+institution)\b/i,
      not: /\b(city|state|country|gpa|degree|graduat|address|zip)\b/i,
      resolve: (p, f, ctx) => edu(p, ctx.index).school },

    { id: 'degree', weight: 13,
      re: /\b(degree|level\s+of\s+education|highest\s+(level\s+of\s+)?education|education\s+level|credential\s+earned|diploma\s+type)\b/i,
      resolve: (p, f, ctx) => expandDegree(edu(p, ctx.index).degree, f) },

    { id: 'major', weight: 12,
      re: /\b(major|field\s+of\s+study|course\s+of\s+study|discipline|program\s+of\s+study|concentration)\b/i,
      resolve: (p, f, ctx) => edu(p, ctx.index).major || 'Nursing' },

    { id: 'graduationDate', weight: 13,
      re: /\b(graduat\w*|completion\s+date|date\s+(awarded|conferred|completed)|year\s+graduated|end\s+date)\b.{0,20}|\b(graduation)\b/i,
      not: /\b(employ|work|licen[cs]e|cert)\b/i,
      resolve: (p, f, ctx) => d(edu(p, ctx.index).graduationDate, f, true) },

    { id: 'gpa', weight: 14,
      re: /\b(gpa|grade\s+point\s+average)\b/i,
      resolve: (p, f, ctx) => edu(p, ctx.index).gpa },

    { id: 'schoolCity', weight: 12,
      re: /\b(school|university|college|institution)\b.{0,25}\bcity\b|\bcity\b.{0,20}\b(school|university|college)\b/i,
      resolve: (p, f, ctx) => edu(p, ctx.index).city },

    { id: 'schoolState', weight: 12,
      re: /\b(school|university|college|institution)\b.{0,25}\bstate\b|\bstate\b.{0,20}\b(school|university|college)\b/i,
      resolve: (p, f, ctx) => stateValue(edu(p, ctx.index).state, f) },

    /* ---- experience ---- */
    { id: 'employer', weight: 13,
      re: /\b(employer|company\s*(name)?|organization\s*(name)?|facility\s*(name)?|hospital\s*(name)?|place\s+of\s+employment|worked\s+for)\b/i,
      not: /\b(school|university|reference|supervisor|address|city|state|zip|phone)\b/i,
      resolve: (p, f, ctx) => exp(p, ctx.index).employer },

    { id: 'jobTitle', weight: 13,
      re: /\b(job\s*title|position\s*(title|held)|your\s+title|title\s+held|role\s+title)\b/i,
      not: /\b(supervisor|reference|desired|applying)\b/i,
      resolve: (p, f, ctx) => exp(p, ctx.index).title },

    { id: 'employmentStart', weight: 13,
      re: /\b(start\s*date|from\s*date|date\s+(started|of\s+hire)|hire\s+date|employed\s+from|beginning\s+date)\b/i,
      not: /\b(available|licen[cs]e|cert|school)\b/i,
      resolve: (p, f, ctx) => d(exp(p, ctx.index).startDate, f, true) },

    { id: 'employmentEnd', weight: 13,
      re: /\b(end\s*date|to\s*date|date\s+(ended|of\s+separation)|employed\s+(to|until)|last\s+day\s+worked)\b/i,
      not: /\b(licen[cs]e|cert|school|graduat)\b/i,
      resolve: (p, f, ctx) => {
        const x = exp(p, ctx.index);
        return x.isCurrent ? 'Present' : d(x.endDate, f, true);
      } },

    { id: 'currentlyEmployed', weight: 13,
      re: /\b(current\w*\s+(employ|work|position|role)|i\s+currently\s+work|present\s+employer|still\s+(employed|work))\b/i,
      resolve: (p, f, ctx) => boolValue(!!exp(p, ctx.index).isCurrent, f) },

    { id: 'supervisorName', weight: 14,
      re: /\b(supervisor'?s?\s*(name)?|manager'?s?\s*name|reported\s+to|direct\s+report\s+to|immediate\s+supervisor)\b/i,
      not: /\b(title|phone|email|number)\b/i,
      resolve: (p, f, ctx) => exp(p, ctx.index).supervisorName },

    { id: 'supervisorTitle', weight: 14,
      re: /\b(supervisor'?s?\s*title|manager'?s?\s*title)\b/i,
      resolve: (p, f, ctx) => exp(p, ctx.index).supervisorTitle },

    { id: 'supervisorPhone', weight: 14,
      re: /\b(supervisor'?s?\s*(phone|telephone|number)|manager'?s?\s*phone)\b/i,
      resolve: (p, f, ctx) => phoneFor(exp(p, ctx.index).supervisorPhone, f) },

    { id: 'supervisorEmail', weight: 14,
      re: /\b(supervisor'?s?\s*e-?mail|manager'?s?\s*e-?mail)\b/i,
      resolve: (p, f, ctx) => exp(p, ctx.index).supervisorEmail },

    { id: 'mayContactEmployer', weight: 13,
      re: /\b(may\s+we\s+contact|ok\s+to\s+contact|permission\s+to\s+contact|contact\s+this\s+employer)\b/i,
      resolve: (p, f, ctx) => boolValue(!!exp(p, ctx.index).mayContact, f) },

    { id: 'reasonForLeaving', weight: 14,
      re: /\b(reason\s+for\s+leaving|why\s+did\s+you\s+leave|reason\s+for\s+separation)\b/i,
      resolve: (p, f, ctx) => exp(p, ctx.index).reasonForLeaving },

    { id: 'responsibilities', weight: 12,
      re: /\b(responsibilit\w*|duties|job\s+description|describe\s+your\s+(work|role)|summary\s+of\s+duties|accomplishments)\b/i,
      resolve: (p, f, ctx) => exp(p, ctx.index).responsibilities },

    /* ---- nursing-specific experience detail ---- */
    { id: 'unit', weight: 15,
      re: /\b(unit|clinical\s+specialty|specialty|department|service\s+line|area\s+of\s+practice|nursing\s+specialty|patient\s+population)\b/i,
      not: /\b(address\s*(line)?\s*2|apt|suite)\b/i,
      resolve: (p, f, ctx) => exp(p, ctx.index).unit },

    { id: 'facilityType', weight: 15,
      re: /\b(facility\s+type|type\s+of\s+facility|practice\s+setting|care\s+setting|work\s+setting)\b/i,
      resolve: (p, f, ctx) => exp(p, ctx.index).facilityType },

    { id: 'traumaLevel', weight: 16,
      re: /\b(trauma\s+(level|designation)|level\s+[i1v]{1,4}\s+trauma)\b/i,
      resolve: (p, f, ctx) => exp(p, ctx.index).traumaLevel },

    { id: 'bedCount', weight: 16,
      re: /\b(bed\s*(count|size|s\b)|number\s+of\s+beds|facility\s+size|licensed\s+beds)\b/i,
      resolve: (p, f, ctx) => exp(p, ctx.index).bedCount },

    { id: 'nurseRatio', weight: 16,
      re: /\b(nurse\s*(to|:|-)\s*patient\s+ratio|patient\s+ratio|typical\s+ratio|staffing\s+ratio|patient\s+load|census\s+per\s+nurse)\b/i,
      resolve: (p, f, ctx) => exp(p, ctx.index).typicalRatio },

    { id: 'yearsExperience', weight: 15,
      re: /\b(years?\s+of\s+(experience|nursing|rn)|total\s+years|how\s+(many|long).{0,25}(experience|nursing))\b/i,
      resolve: (p) => String(yearsOfExperience(p) || '') },

    /* ---- skills ---- */
    { id: 'emr', weight: 16,
      re: /\b(emr|ehr|electronic\s+(medical|health)\s+record|charting\s+system|documentation\s+system|epic|cerner|meditech|pointclickcare)\b/i,
      resolve: (p, f) => {
        const list = skills(p).emrSystems || [];
        if (!list.length) return '';
        if (f && (f.kind === 'select' || f.kind === 'combobox' || f.kind === 'multiselect')) return list[0];
        if (f && f.kind === 'checkbox') return true;
        return list.join(', ');
      } },

    { id: 'procedures', weight: 13,
      re: /\b(skills|procedures|competenc\w*|clinical\s+skills|technical\s+skills)\b/i,
      not: /\b(language|computer\s+skills)\b/i,
      resolve: (p) => (skills(p).procedures || []).join(', ') },

    { id: 'languages', weight: 14,
      re: /\b(languages?\s+(spoken|proficiency)?|bilingual|second\s+language)\b/i,
      resolve: (p) => (skills(p).languages || []).map((l) => l.language).filter(Boolean).join(', ') },

    /* ---- preferences ---- */
    { id: 'shift', weight: 15,
      re: /\b(shift\s+(preference|desired|available)|desired\s+shift|preferred\s+shift|day\s*\/\s*night|which\s+shift|shift\s+you\s+(prefer|are\s+applying))\b/i,
      not: /\b(length|hours|8|10|12)\b/i,
      resolve: (p) => prefs(p).shift },

    { id: 'shiftLength', weight: 15,
      re: /\b(shift\s+length|hours\s+per\s+shift|8\s*hour|10\s*hour|12\s*hour)\b/i,
      resolve: (p) => prefs(p).shiftLength },

    { id: 'employmentType', weight: 14,
      re: /\b(employment\s+(type|status)|full-?time|part-?time|per\s+diem|prn\b|type\s+of\s+employment|work\s+schedule\s+type|position\s+type)\b/i,
      resolve: (p) => prefs(p).employmentType },

    { id: 'desiredPay', weight: 14, essay: true,
      re: /\b(desired\s+(pay|salary|rate|compensation)|salary\s+(requirement|expectation)|expected\s+(pay|rate|salary)|hourly\s+rate\s+(desired|expected))\b/i,
      resolve: (p) => prefs(p).minHourlyRate },

    /* ---- compliance ---- */
    { id: 'tbDate', weight: 16,
      re: /\b(tb\b|tuberculosis|ppd\b|quantiferon|t-?spot)\b.{0,30}(date|result|test)?/i,
      resolve: (p, f) => d(comp(p).tbTestDate, f) },

    { id: 'tbType', weight: 15,
      re: /\b(tb|tuberculosis)\b.{0,25}\b(type|method|screening\s+method)\b/i,
      resolve: (p) => comp(p).tbTestType },

    { id: 'flu', weight: 16,
      re: /\b(influenza|flu\s+(vaccine|shot|vaccination))\b/i,
      resolve: (p) => comp(p).fluVaccineSeason },

    { id: 'covid', weight: 16,
      re: /\b(covid|sars-?cov-?2|coronavirus)\b/i,
      resolve: (p) => comp(p).covidVaccineStatus },

    { id: 'hepB', weight: 16,
      re: /\b(hep\s*b|hepatitis\s*b|hbv)\b/i,
      resolve: (p) => comp(p).hepBStatus },

    { id: 'mmr', weight: 16,
      re: /\b(mmr|measles|mumps|rubella)\b/i,
      resolve: (p, f) => d(comp(p).mmrTiterDate, f) },

    { id: 'varicella', weight: 16,
      re: /\b(varicella|chicken\s*pox)\b/i,
      resolve: (p, f) => d(comp(p).varicellaTiterDate, f) },

    /* ---- references ---- */
    { id: 'referenceName', weight: 13,
      re: /\breference\b.{0,25}\bname\b|\bname\b.{0,20}\breference\b/i,
      resolve: (p, f, ctx) => ref(p, ctx.index).name },
    { id: 'referenceTitle', weight: 13,
      re: /\breference\b.{0,25}\b(title|position)\b/i,
      resolve: (p, f, ctx) => ref(p, ctx.index).title },
    { id: 'referenceEmployer', weight: 13,
      re: /\breference\b.{0,25}\b(employer|company|organization|facility)\b/i,
      resolve: (p, f, ctx) => ref(p, ctx.index).employer },
    { id: 'referencePhone', weight: 13,
      re: /\breference\b.{0,25}\b(phone|number|telephone)\b/i,
      resolve: (p, f, ctx) => phoneFor(ref(p, ctx.index).phone, f) },
    { id: 'referenceEmail', weight: 13,
      re: /\breference\b.{0,25}\be-?mail\b/i,
      resolve: (p, f, ctx) => ref(p, ctx.index).email },
    { id: 'referenceRelationship', weight: 13,
      re: /\b(relationship\s+to\s+(you|applicant)|how\s+do\s+you\s+know|reference\s+relationship)\b/i,
      resolve: (p, f, ctx) => ref(p, ctx.index).relationship },

    /* ---- documents ---- */
    { id: 'resumeFile', weight: 16, kinds: ['file'],
      re: /\b(resume|résumé|cv\b|curriculum\s+vitae|upload\s+.{0,20}(resume|cv))\b/i,
      resolve: (p) => docs(p).resumeFileName || 'resume.pdf' },

    { id: 'resumeText', weight: 11, kinds: ['textarea', 'richtext'],
      re: /\b(paste\s+(your\s+)?resume|resume\s+text|copy\s+.{0,15}resume)\b/i,
      resolve: (p) => docs(p).resumeText },

    { id: 'linkedin', weight: 14,
      re: /\b(linked-?in|linkedin\s+(url|profile))\b/i,
      resolve: () => '' },

    { id: 'website', weight: 10,
      re: /\b(website|portfolio|personal\s+url)\b/i,
      resolve: () => '' }
  ];

  /* ------------------------------------------------------------- helpers */

  function phoneFor(raw, field) {
    if (!raw) return '';
    const parts = S().phoneParts(raw);
    const el = field && field.el;
    if (el && el.maxLength === 3 && parts.area) return parts.area;
    if (el && el.maxLength === 4 && parts.line) return parts.line;
    if (el && (el.maxLength === 10 || /\bdigits?\s*only\b/i.test(field.label || ''))) return parts.digits;
    return S().normalizePhone(raw);
  }

  function certField(p, name, field) {
    const c = ((p && p.certifications) || []).find(
      (x) => (x.name === name) || (x.name === 'Other' && x.otherName === name)
    );
    if (!c) return undefined;
    const label = (field && field.label) || '';
    if (/\bexpir/i.test(label)) return d(c.expirationDate, field);
    if (/\b(issue|obtained|completion|effective)/i.test(label)) return d(c.issueDate, field);
    if (/\b(body|organization|issuer|awarded\s+by|certifying)/i.test(label)) return expandBody(c.issuingBody, field);
    if (/\b(number|id|#|verification)/i.test(label)) return c.verificationUrlOrCertId;
    if (field && (field.kind === 'checkbox' || field.kind === 'radio' || field.kind === 'radiogroup')) {
      return boolValue(true, field);
    }
    if (field && (field.kind === 'select' || field.kind === 'combobox')) return 'Yes';
    return d(c.expirationDate, field) || certName(c);
  }

  const BODY_LONG = {
    AHA: 'American Heart Association',
    ARC: 'American Red Cross',
    AACN: 'American Association of Critical-Care Nurses',
    ENA: 'Emergency Nurses Association',
    AWHONN: 'Association of Women’s Health, Obstetric and Neonatal Nurses'
  };

  function expandBody(code, field) {
    if (!code) return '';
    const opts = (field && field.options) || [];
    const long = BODY_LONG[code];
    if (!long) return code;
    if (!opts.length) return field && field.kind === 'combobox' ? long : code;
    const hasLong = opts.some((o) => NA.dom.similarity(o, long) > 0.8);
    return hasLong ? long : code;
  }

  const DEGREE_LONG = {
    ADN: 'Associate Degree in Nursing',
    BSN: 'Bachelor of Science in Nursing',
    MSN: 'Master of Science in Nursing',
    DNP: 'Doctor of Nursing Practice',
    Diploma: 'Diploma in Nursing'
  };

  function expandDegree(code, field) {
    if (!code) return '';
    const opts = (field && field.options) || [];
    const long = DEGREE_LONG[code] || code;
    if (!opts.length) return code;
    const hasCode = opts.some((o) => NA.dom.similarity(o, code) > 0.85);
    if (hasCode) return code;
    const hasLong = opts.some((o) => NA.dom.similarity(o, long) > 0.7);
    if (hasLong) return long;
    // Fall back to a generic level so "Bachelor's Degree" style lists still hit.
    const generic = { ADN: "Associate's Degree", BSN: "Bachelor's Degree",
                      MSN: "Master's Degree", DNP: 'Doctorate', Diploma: 'Diploma' }[code];
    return generic || code;
  }

  function yearsOfExperience(p) {
    const list = (p && p.experience) || [];
    if (!list.length) return 0;
    let earliest = null;
    list.forEach((x) => {
      if (x.startDate && (!earliest || x.startDate < earliest)) earliest = x.startDate;
    });
    if (!earliest) return 0;
    const start = new Date(earliest + '-01');
    const years = (Date.now() - start.getTime()) / (365.25 * 24 * 3600 * 1000);
    return Math.max(0, Math.round(years * 10) / 10);
  }

  /**
   * Scores every rule against one field and returns the winner, or null.
   * `ctx` carries the repeat-block index and the demographics setting.
   */
  function matchField(field, profile, ctx) {
    const context = ctx || {};
    const label = field.label || '';
    if (!label.trim()) return null;

    let best = null;
    for (let i = 0; i < RULES.length; i++) {
      const rule = RULES[i];
      if (rule.kinds && rule.kinds.indexOf(field.kind) === -1) continue;
      if (rule.demographic && context.fillDemographics === false) continue;
      if (!rule.re.test(label)) continue;
      if (rule.not && rule.not.test(label)) continue;

      let value;
      try {
        value = rule.resolve(profile, field, context);
      } catch (e) {
        value = undefined;
      }
      if (value === undefined || value === null || value === '') continue;

      const score = rule.weight + specificityBonus(rule, label, field);
      if (!best || score > best.score) {
        best = { ruleId: rule.id, value, score, tier: 2, essay: !!rule.essay };
      }
    }
    return best;
  }

  /** Longer, more literal matches beat incidental ones. */
  function specificityBonus(rule, label, field) {
    let bonus = 0;
    const m = rule.re.exec(label);
    if (m && m[0]) bonus += Math.min(4, m[0].length / 10);
    if (field.required) bonus += 0.5;
    if (field.automationId && rule.re.test(field.automationId)) bonus += 1.5;
    return bonus;
  }

  NA.heuristics = {
    RULES, matchField, dateHint, stateValue, boolValue,
    expandDegree, expandBody, yearsOfExperience, phoneFor, certField
  };
})(typeof self !== 'undefined' ? self : this);
