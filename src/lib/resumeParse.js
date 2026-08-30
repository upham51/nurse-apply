/**
 * Deterministic nursing resume parser. No model, no network, no API key.
 *
 * The reason this works without AI is that most of what a nursing application
 * needs is drawn from closed vocabularies. Certifications are an eight-item
 * list. EMR systems are an eight-item list. Units, degrees, license types,
 * trauma levels and facility types are all enumerated. Dates, phone numbers,
 * ZIP codes, license numbers and nurse-to-patient ratios have shapes. Those
 * parts are a matching problem, not a comprehension problem.
 *
 * The genuinely ambiguous part is the employment block: which line is the
 * employer and which is the job title, and which bullets belong to which role.
 * That is handled with layout heuristics and scored keyword lists, and where
 * the score is close the parser records the ambiguity in its report rather
 * than picking silently.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});
  const S = () => NA.schema;

  /* --------------------------------------------------------- vocabularies */

  const UNIT_LEXICON = [
    ['MICU', /\bM\.?I\.?C\.?U\b|\bmedical\s+icu\b/i],
    ['SICU', /\bS\.?I\.?C\.?U\b|\bsurgical\s+icu\b/i],
    ['CVICU', /\bCV\.?I\.?C\.?U\b|\bcardiovascular\s+icu\b|\bCTICU\b/i],
    ['NICU', /\bN\.?I\.?C\.?U\b|\bneonatal\s+intensive\b/i],
    ['PICU', /\bP\.?I\.?C\.?U\b|\bpediatric\s+intensive\b/i],
    ['Neuro ICU', /\bneuro\s*(icu|critical)\b|\bNSICU\b/i],
    ['ICU', /\bI\.?C\.?U\b|\bintensive\s+care\b|\bcritical\s+care\b/i],
    ['Emergency', /\b(emergency\s+(department|room|services)|\bE\.?D\b(?!\w)|\bE\.?R\b(?!\w))/i],
    ['Med-Surg', /\bmed[\s\-\/]*surg\w*\b|\bmedical[\s\-]surgical\b/i],
    ['Telemetry', /\btelemetry\b|\bstep[\s\-]?down\b|\bPCU\b|\bprogressive\s+care\b/i],
    ['PACU', /\bP\.?A\.?C\.?U\b|\bpost[\s\-]?anesthesia\b|\brecovery\s+room\b/i],
    ['Operating Room', /\boperating\s+room\b|\bperi[\s\-]?operative\b|\bOR\s+nurse\b|\bcirculat(or|ing)\s+nurse\b/i],
    ['Labor & Delivery', /\blabor\s*(&|and)\s*delivery\b|\bL\s*&\s*D\b|\bobstetric\w*\b|\bOB\b(?!\w)/i],
    ['Postpartum', /\bpost[\s\-]?partum\b|\bmother[\s\-]baby\b|\bcouplet\s+care\b/i],
    ['Oncology', /\boncolog\w*\b|\binfusion\s+center\b|\bchemotherap\w*\b/i],
    ['Behavioral Health', /\bbehavioral\s+health\b|\bpsychiatr\w*\b|\bmental\s+health\s+unit\b/i],
    ['Rehabilitation', /\brehabilitation\b|\brehab\b|\bacute\s+rehab\b/i],
    ['Cath Lab', /\bcath(eterization)?\s+lab\b|\binterventional\s+radiolog\w*\b/i],
    ['Float Pool', /\bfloat\s+pool\b|\bresource\s+team\b/i],
    ['Home Health', /\bhome\s+health\b|\bhome\s+care\b/i],
    ['Hospice', /\bhospice\b|\bpalliative\b/i],
    ['Dialysis', /\bdialysis\b|\bnephrolog\w*\b|\bCRRT\s+unit\b/i],
    ['Wound Care', /\bwound\s+(care|ostomy)\b|\bWOCN\b/i],
    ['Case Management', /\bcase\s+manage\w*\b|\butilization\s+review\b/i],
    ['Triage', /\btriage\b|\bnurse\s+advice\s+line\b/i],
    ['Long Term Care', /\blong[\s\-]term\s+care\b|\bskilled\s+nursing\b|\bLTC\b|\bSNF\b/i],
    ['Pediatrics', /\bpediatric\w*\b|\bpeds\b/i]
  ];

  const FACILITY_HINTS = [
    ['SNF', /\bskilled\s+nursing\b|\bSNF\b|\bnursing\s+(home|center|facility)\b|\blong[\s\-]term\s+care\b/i],
    ['Home Health', /\bhome\s+health\b|\bhome\s+care\b|\bvisiting\s+nurse\b/i],
    ['Corrections', /\bcorrection\w*\b|\bjail\b|\bprison\b|\bdetention\b/i],
    ['Telehealth', /\btelehealth\b|\btelemedicine\b|\bnurse\s+advice\s+line\b|\bvirtual\s+care\b/i],
    ['Urgent Care', /\burgent\s+care\b|\bwalk[\s\-]?in\s+clinic\b/i],
    ['Ambulatory', /\bambulatory\b|\bsurgery\s+center\b|\boutpatient\s+surg\w*\b/i],
    ['Clinic', /\bclinic\b|\bphysician\s+(group|office)\b|\bprimary\s+care\b/i],
    ['Hospital', /\bhospital\b|\bmedical\s+cent(er|re)\b|\bhealth\s+system\b|\bregional\s+medical\b|\bmemorial\b/i]
  ];

  const EMPLOYER_TOKENS = /\b(hospital|medical\s+cent(er|re)|health(care)?(\s+system)?|clinic|cent(er|re)|regional|memorial|saint|st\.|university|county|community|kaiser|providence|hca|tenet|sutter|trinity|ascension|banner|mercy|baptist|methodist|presbyterian|aurora|va\b|veterans|children'?s|group|associates|llc|inc\.?|corporation|home\s+health|hospice|rehabilitation|school\s+system|schools?\b|district|network|agency|jail|prison|correctional|advocacy|infirmary|institute|academy|partners|dialysis|surgery\s+cent(er|re)|imaging|laborator(y|ies)|pharmacy|urgent\s+care|transcription)\b/i;

  /** A nursing role noun is the single strongest signal that a line is a title. */
  const ROLE_NOUN = /\b(nurse|rn|lpn|lvn|aprn|np|crna|cns|nursing)\b/i;

  const TITLE_TOKENS = /\b(registered\s+nurse|nurse|rn\b|lpn\b|lvn\b|aprn|np\b|crna|cns\b|charge|staff|clinical|preceptor|supervisor|manager|director|coordinator|educator|specialist|practitioner|technician|tech\b|assistant|lead|per\s+diem|travel(er)?|float)\b/i;

  const DEGREE_PATTERNS = [
    ['DNP', /\bD\.?N\.?P\b|\bdoctor\s+of\s+nursing\s+practice\b/i],
    ['MSN', /\bM\.?S\.?N\b|\bmasters?\s+of\s+science\s+in\s+nursing\b|\bmaster'?s\s+.{0,12}nursing\b/i],
    ['BSN', /\bB\.?S\.?N\b|\bbachelors?\s+of\s+science\s+in\s+nursing\b|\bbachelor'?s\s+.{0,12}nursing\b/i],
    ['ADN', /\bA\.?D\.?N\b|\bA\.?S\.?N\b|\bassociates?\s+(degree|of\s+science)\s+in\s+nursing\b|\bassociate'?s\s+.{0,12}nursing\b/i],
    ['Diploma', /\bdiploma\s+in\s+nursing\b|\bnursing\s+diploma\b/i]
  ];

  const CERT_PATTERNS = [
    ['BLS', /\bB\.?L\.?S\b|\bbasic\s+(cardiac\s+)?life\s+support\b|\bCPR\s+certif\w*\b/i],
    ['ACLS', /\bA\.?C\.?L\.?S\b|\badvanced\s+cardiac\s+life\s+support\b|\badvanced\s+cardiovascular\s+life\s+support\b/i],
    ['PALS', /\bP\.?A\.?L\.?S\b|\bpediatric\s+advanced\s+life\s+support\b/i],
    ['NRP', /\bN\.?R\.?P\b|\bneonatal\s+resuscitation\b/i],
    ['TNCC', /\bT\.?N\.?C\.?C\b|\btrauma\s+nursing\s+core\b/i],
    ['CCRN', /\bC\.?C\.?R\.?N\b/i],
    ['CEN', /\bC\.?E\.?N\b(?!\w)/i],
    ['PCCN', /\bP\.?C\.?C\.?N\b/i],
    ['NIHSS', /\bN\.?I\.?H\.?S\.?S\b|\bNIH\s+stroke\s+scale\b/i],
    ['STABLE', /\bS\.?T\.?A\.?B\.?L\.?E\b\s*(program)?/, true],
    ['CPN', /\bC\.?P\.?N\b(?!\w)/i]
  ];

  const BODY_PATTERNS = [
    ['AHA', /\bA\.?H\.?A\b|\bamerican\s+heart\s+association\b/i],
    ['ARC', /\bamerican\s+red\s+cross\b|\bA\.?R\.?C\b/i],
    ['AACN', /\bA\.?A\.?C\.?N\b|\bcritical[\s\-]care\s+nurses\b/i],
    ['ENA', /\bE\.?N\.?A\b|\bemergency\s+nurses\s+association\b/i],
    ['AWHONN', /\bA\.?W\.?H\.?O\.?N\.?N\b/i]
  ];

  const PROCEDURE_LEXICON = [
    'IV Insertion', 'PICC Line Care', 'Central Line Care', 'Ventilator Management',
    'Trach Care', 'CRRT', 'Titrating Vasoactive Infusions', 'Chest Tube Management',
    'Wound Care', 'Wound Vac', 'Foley Catheter', 'NG Tube', 'Blood Administration',
    'Conscious Sedation', 'Arterial Line', 'Swan-Ganz', 'ECMO', 'Telemetry Monitoring',
    'EKG Interpretation', 'Code Blue Response', 'Rapid Response', 'Triage',
    'Medication Reconciliation', 'Discharge Planning', 'Patient Education',
    'Restraint Management', 'Isolation Precautions', 'Chemotherapy Administration'
  ];

  const PROCEDURE_PATTERNS = PROCEDURE_LEXICON.map((name) => [
    name,
    new RegExp('\\b' + name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s+/g, '\\s+') + '\\b', 'i')
  ]).concat([
    ['IV Insertion', /\b(iv|intravenous)\s+(insertion|starts?|access|therapy)\b/i],
    ['Ventilator Management', /\bventilat\w*\b|\bmechanical\s+ventilation\b|\bBiPAP\b/i],
    ['Trach Care', /\btrach(eostomy)?\s+care\b/i],
    ['CRRT', /\bC\.?R\.?R\.?T\b|\bcontinuous\s+renal\s+replacement\b/i],
    ['Titrating Vasoactive Infusions', /\b(titrat\w*|vasoactive|vasopressor|pressor)\b/i],
    ['Central Line Care', /\bcentral\s+(line|venous)\b/i],
    ['Wound Care', /\bwound\s+care\b|\bwound\s+vac\b/i]
  ]);

  const LANGUAGES = [
    'Spanish', 'Mandarin', 'Cantonese', 'Tagalog', 'Vietnamese', 'French',
    'German', 'Russian', 'Arabic', 'Korean', 'Japanese', 'Portuguese', 'Hindi',
    'Punjabi', 'Somali', 'Amharic', 'Ukrainian', 'Polish', 'Italian', 'ASL',
    'American Sign Language', 'Hmong', 'Farsi', 'Urdu', 'Nepali', 'Swahili'
  ];

  const SECTION_HEADERS = [
    ['experience', /^(professional|clinical|work|nursing|relevant|employment|additional)?\s*(experience|history|employment|background)\s*:?\s*$/i],
    ['education', /^(education|academic\s+background|academics|degrees?)\s*:?\s*$/i],
    ['licenses', /^(licens\w*|licensure|credentials?|registrations?)\s*(&|and)?\s*(certifications?)?\s*:?\s*$/i],
    ['certifications', /^(certifications?|certificates?)\s*(&|and)?\s*(licens\w*)?\s*:?\s*$/i],
    ['skills', /^(skills?|clinical\s+skills?|core\s+competenc\w*|competenc\w*|technical\s+skills?|proficienc\w*)\s*:?\s*$/i],
    ['summary', /^(summary|profile|objective|professional\s+summary)\s*:?\s*$/i],
    ['references', /^references?\s*:?\s*$/i],
    ['affiliations', /^(affiliations?|memberships?|professional\s+organizations?|awards?|honou?rs?|publications?|volunteer)\s*:?\s*$/i]
  ];

  /**
   * Headers with the spaces removed.
   *
   * Designers love setting section headers in letter-spaced small caps, which
   * a PDF stores as individual glyphs. "PROFESSIONAL EXPERIENCE" comes back as
   * "P R O F E S S I O N A L  E X P E R I E N C E", and no amount of regex on
   * the spaced form will match it. Comparing with all whitespace stripped is
   * immune to both letter spacing and to two headers sharing one line, which
   * happens when a resume puts EDUCATION and LICENSURE side by side.
   */
  const DESPACED_HEADERS = [
    ['experience', ['professionalexperience', 'clinicalexperience', 'workexperience',
                    'nursingexperience', 'relevantexperience', 'additionalexperience',
                    'employmenthistory', 'workhistory', 'experience', 'employment']],
    ['education', ['education', 'educationandtraining', 'academicbackground', 'academics', 'degrees', 'degree']],
    ['licenses', ['licensure', 'licenses', 'license', 'licensesandcertifications',
                  'licensescertifications', 'licensureandcertifications',
                  'credentials', 'registrations']],
    ['certifications', ['certifications', 'certificates', 'certificationsandlicenses',
                        'certificationslicenses', 'certification']],
    ['skills', ['corecompetencies', 'competencies', 'clinicalskills', 'technicalskills',
                'skills', 'proficiencies', 'areasofexpertise']],
    ['summary', ['professionalsummary', 'summary', 'profile', 'objective', 'about']],
    ['references', ['references', 'reference']],
    ['affiliations', ['affiliations', 'memberships', 'professionalorganizations',
                      'awards', 'honors', 'honours', 'publications', 'volunteer']]
  ];

  const DESPACED_INDEX = (function () {
    const map = new Map();
    DESPACED_HEADERS.forEach(([section, tokens]) => tokens.forEach((t) => {
      if (!map.has(t)) map.set(t, section);
    }));
    return map;
  })();

  function despace(s) {
    return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  /**
   * Undoes letter spacing. pdftext marks a genuine word break with a double
   * space, so a run of single-character tokens between those markers is one
   * word that has been exploded into glyphs.
   */
  function collapseLetterSpacing(line) {
    const groups = String(line).split(/\s{2,}/);
    const rebuilt = groups.map((group) => {
      const tokens = group.trim().split(/\s+/);
      if (tokens.length < 3) return group.trim();
      const singles = tokens.filter((t) => t.length === 1).length;
      return singles / tokens.length >= 0.7 ? tokens.join('') : group.trim();
    });
    // The double space is kept deliberately. It is the only surviving record of
    // a wide gap, and inline section labels ("Experience  Jan 2026 - present")
    // are detected from it. Squeezing happens after sectioning, in squeeze().
    return rebuilt.join('  ').replace(/\s{3,}/g, '  ').trim();
  }

  function squeeze(line) {
    return String(line).replace(/\s{2,}/g, ' ').trim();
  }

  /* -------------------------------------------------------------- shapes */

  const RE = {
    email: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/,
    phone: /(?:\+?1[\s.\-]?)?\(?\b([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})\b/,
    cityStateZip: /^(.*?),\s*([A-Z]{2})\.?\s+(\d{5})(?:-\d{4})?\b/,
    cityStateNameZip: /^(.*?),\s*([A-Za-z]{4,20})\.?\s+(\d{5})(?:-\d{4})?\b/,
    cityState: /^([A-Za-z .'\-]+),\s*([A-Z]{2})\b\s*$/,
    street: /^\d{1,6}\s+[A-Za-z0-9 .'#\-]{3,}$/,
    zip: /\b\d{5}(?:-\d{4})?\b/,
    monthYear: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/i,
    numericMonthYear: /\b(0?[1-9]|1[0-2])\s*[\/\-]\s*((?:19|20)\d{2})\b/,
    fullDate: /\b(0?[1-9]|1[0-2])\s*[\/\-]\s*(0?[1-9]|[12]\d|3[01])\s*[\/\-]\s*((?:19|20)\d{2})\b/,
    isoDate: /\b((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/,
    year: /\b((?:19|20)\d{2})\b/,
    present: /\b(present|current(ly)?|now|ongoing)\b/i,
    ratio: /\b(\d)\s*:\s*(\d(?:\s*[-–]\s*\d)?)\b/,
    beds: /\b(\d{2,4})\s*[-–\s]?\s*bed\b/i,
    trauma: /\blevel\s+(I{1,3}V?|IV|[1-4])\s+trauma\b/i,
    npiLabelled: /\bnpi\b[^0-9]{0,20}(\d{10})\b/i,
    licenseNumber: /\b(?:licen[cs]e|lic\.?|#)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z]{0,4}[-\s]?\d[\d-]{3,14}[A-Z]?)\b/i,
    bareLicenseNumber: /\b([A-Z]{2,3}\s?\d{5,10})\b/,
    gpa: /\bgpa\b\s*:?\s*(\d\.\d{1,2})\b/i
  };

  const MONTHS = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12'
  };

  /* -------------------------------------------------------- date helpers */

  function toIsoMonth(text) {
    if (!text) return '';
    let m = RE.isoDate.exec(text);
    if (m) return `${m[1]}-${m[2]}`;
    m = RE.fullDate.exec(text);
    if (m) return `${m[3]}-${pad(m[1])}`;
    m = RE.monthYear.exec(text);
    if (m) return `${m[2]}-${MONTHS[m[1].toLowerCase().slice(0, 4).replace(/[^a-z]/g, '')] || MONTHS[m[1].toLowerCase().slice(0, 3)]}`;
    m = RE.numericMonthYear.exec(text);
    if (m) return `${m[2]}-${pad(m[1])}`;
    m = RE.year.exec(text);
    if (m) return `${m[1]}-01`;
    return '';
  }

  function toIsoDay(text) {
    if (!text) return '';
    let m = RE.isoDate.exec(text);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = RE.fullDate.exec(text);
    if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
    const month = toIsoMonth(text);
    return month ? month + '-01' : '';
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  /** Pulls a start and end out of a line like "Mar 2019 - Present". */
  function dateRange(line) {
    const parts = line.split(/\s*(?:[-–—]{1,2}|\bto\b|\bthrough\b)\s*/i);
    if (parts.length < 2) return null;
    for (let i = 0; i < parts.length - 1; i++) {
      const start = toIsoMonth(parts[i]);
      if (!start) continue;
      const tail = parts.slice(i + 1).join(' ');
      if (RE.present.test(tail)) return { start, end: '', isCurrent: true };
      const end = toIsoMonth(tail);
      if (end) return { start, end, isCurrent: false };
    }
    return null;
  }

  function hasDateRange(line) { return !!dateRange(line); }

  /* ------------------------------------------------------------ sections */

  /**
   * Removes page furniture.
   *
   * A three-page resume repeats its name and a page number on every page, and
   * those lines land in the middle of the work history where they are
   * indistinguishable from a job title. Anything that repeats across the
   * document, or reads as a page number, is furniture.
   */
  function stripRunningHeaders(lines) {
    const counts = new Map();
    lines.forEach((l) => {
      const key = l.trim().toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    // Anything from the contact block that turns up again later is a page
    // header. It only needs to appear twice to be furniture, and left in place
    // it competes with the real employer on the role that follows it.
    const headerKeys = new Set();
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
      const k = lines[i].trim().toLowerCase();
      if (k.length > 3) headerKeys.add(k);
    }
    let seenPastHeader = 0;
    return lines.filter((l, i) => {
      const key0 = l.trim().toLowerCase();
      if (i >= 8 && headerKeys.has(key0)) { seenPastHeader++; return false; }
      return keep(l);
    });

    function keep(l) {
      const t = l.trim();
      if (/\bpage\s+\d+\s*(of|\/)\s*\d+\b/i.test(t)) return false;
      if (/^\d{1,2}\s*(of|\/)\s*\d{1,2}$/i.test(t)) return false;
      const key = t.toLowerCase();
      return !(counts.get(key) >= 3 && t.length < 90);
    }
  }

  function splitSections(lines) {
    const sections = { header: [] };
    let current = 'header';
    lines.forEach((line) => {
      const name = headerName(line);
      if (name) { current = name; sections[current] = sections[current] || []; return; }

      // Older Word resumes put the section label in a left-hand column, which
      // extracts as a prefix on the first line of content:
      // "Experience  Jan 2026 - present  Daleville City Schools  Daleville, AL".
      // Without this the whole document lands in one unlabelled bucket.
      const inline = inlineHeader(line);
      if (inline) {
        current = inline.section;
        sections[current] = sections[current] || [];
        if (inline.rest) sections[current].push(squeeze(inline.rest));
        return;
      }
      (sections[current] = sections[current] || []).push(squeeze(line));
    });
    return sections;
  }

  function inlineHeader(line) {
    const m = /^([A-Za-z][A-Za-z &]{2,28}?)\s*(?::|\s{2,})\s*(\S.*)$/.exec(line);
    if (!m) return null;
    const section = DESPACED_INDEX.get(despace(m[1]));
    if (!section) return null;
    return { section, rest: m[2].trim() };
  }

  function headerName(line) {
    const bare = line.replace(/[^A-Za-z&\s:]/g, '').trim();
    if (!bare || bare.length > 60) return null;
    for (let i = 0; i < SECTION_HEADERS.length; i++) {
      if (SECTION_HEADERS[i][1].test(bare)) return SECTION_HEADERS[i][0];
    }
    const flat = despace(bare);
    if (!flat || flat.length > 44) return null;
    if (DESPACED_INDEX.has(flat)) return DESPACED_INDEX.get(flat);
    // Two headers sharing one line, e.g. "EDUCATION   LICENSURE". Take the
    // first, so the content that follows lands somewhere sensible.
    const keys = Array.from(DESPACED_INDEX.keys()).sort((a, b) => b.length - a.length);
    for (let i = 0; i < keys.length; i++) {
      if (flat.indexOf(keys[i]) !== 0) continue;
      const rest = flat.slice(keys[i].length);
      if (!rest || DESPACED_INDEX.has(rest)) return DESPACED_INDEX.get(keys[i]);
    }
    return null;
  }

  /* ------------------------------------------------------------- helpers */

  function firstMatch(patterns, text) {
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i][1].test(text)) return patterns[i][0];
    }
    return '';
  }

  function isBullet(line) {
    return /^[•●▪‣⁃*\-–—o]\s+/.test(line) || /^\s{2,}\S/.test(line);
  }

  function stripBullet(line) {
    return line.replace(/^[•●▪‣⁃*\-–—o]\s+/, '').trim();
  }

  /**
   * Distinguishes a role header from a duty line.
   *
   * Bullet characters cannot be relied on. Many PDF layouts draw the bullet as
   * a vector shape or a list marker rather than a text glyph, so the extracted
   * line arrives with nothing in front of it and looks exactly like a title.
   * Length is the signal that survives: a job title and an employer line are
   * short, and a duty is a sentence.
   */
  function isProse(line) {
    const t = String(line || '').trim();
    if (!t) return false;
    if (/^EMR\s*:/i.test(t)) return true;
    // A wrapped duty line is short but starts lower case, because it is the
    // tail of the sentence above it. A job title or employer never does.
    if (/^[a-z]/.test(t)) return true;
    // An employer line can be long when it carries a description, for example
    // "Enloe Medical Center, 264-bed Level II Trauma Center (the only one
    // between Sacramento and Redding) · Chico, CA". Word count alone would call
    // that a duty and throw the employer away, so structural markers win: a
    // middot separator, or a trailing city and state.
    if (/\s[·•|]\s/.test(t)) return false;
    if (/,\s*[A-Z]{2}\.?$/.test(t) || /\s[·•]\s*(Remote|Onsite|Hybrid)\s*$/i.test(t)) return false;
    // A duty ends in a full stop. A job title and an employer do not, with the
    // narrow exception of an abbreviation.
    if (/\.\s*$/.test(t) && !/\b(Inc|LLC|L\.L\.C|Ltd|Co|Corp|St|Dr|Jr|Sr)\.\s*$/i.test(t)) return true;
    // A sentence boundary inside the line: "…Registered Nurse. Responsible for…".
    // Neither a job title nor an employer contains one.
    if (/[a-z]{2}\.\s+[A-Z]/.test(t)) return true;
    const words = t.split(/\s+/).length;
    if (words >= 16) return true;
    if (words >= 8 && /[.;,]\s*$/.test(t)) return true;
    return false;
  }

  // Words that look like a name to a shape test but never are one.
  const NOT_A_NAME = /\b(summary|profile|objective|experience|education|licens\w*|certificat\w*|skills?|references?|employment|history|professional|clinical|curriculum|vitae|resume|contact|qualifications?|competenc\w*|affiliations?|awards?|nurse|registered)\b/i;

  function looksLikeName(line) {
    if (!line || line.length > 60) return false;
    if (RE.email.test(line) || RE.phone.test(line)) return false;
    if (/\d/.test(line.replace(/,.*$/, ''))) return false;
    if (headerName(line)) return false;
    const namePart = line.split(',')[0].trim();
    if (NOT_A_NAME.test(namePart)) return false;
    const words = namePart.split(/\s+/);
    if (words.length < 2 || words.length > 4) return false;
    return words.every((w) => /^[A-Z][A-Za-z.'\-]*$/.test(w) || /^[A-Z.'\-]+$/.test(w));
  }

  function titleCaseName(s) {
    return s.split(/\s+/).map((w) =>
      w.length > 2 && w === w.toUpperCase()
        ? w[0] + w.slice(1).toLowerCase()
        : w
    ).join(' ');
  }

  /* ------------------------------------------------------------ identity */

  function parseIdentity(lines, blob, report) {
    const id = {
      firstName: '', lastName: '', preferredName: '', email: '', phone: '',
      address: { street: '', line2: '', city: '', state: '', zip: '' }
    };

    const email = RE.email.exec(blob);
    if (email) id.email = email[0];

    const phone = RE.phone.exec(blob);
    if (phone) id.phone = `${phone[1]}-${phone[2]}-${phone[3]}`;

    const head = lines.slice(0, 12);
    const nameLines = head.filter(looksLikeName);
    // "Jordan M. Reyes, BSN, RN" is a stronger signal than a bare pair of
    // capitalised words further down the page, so credentialled lines win.
    const credentialled = nameLines.find((l) =>
      /,\s*(RN|LPN|LVN|APRN|NP|CRNA|CNS|BSN|ADN|ASN|MSN|DNP)\b/i.test(l));
    const chosen = credentialled || nameLines[0];
    if (chosen) {
      const namePart = titleCaseName(chosen.split(',')[0].trim());
      const words = namePart.split(/\s+/);
      id.firstName = words[0];
      id.lastName = words[words.length - 1];
    }
    if (!id.firstName) report.push({ level: 'warn', msg: 'Could not identify a name in the header. Type it in.' });

    for (let i = 0; i < head.length; i++) {
      const csz = RE.cityStateZip.exec(head[i]);
      if (csz) {
        const before = csz[1].trim();
        // "412 NW Clark St, Portland, OR 97209" puts the street in the same line.
        const streetInline = /^(\d{1,6}\s+[^,]+),\s*(.+)$/.exec(before);
        if (streetInline) {
          id.address.street = streetInline[1].trim();
          id.address.city = streetInline[2].trim();
        } else {
          id.address.city = before.replace(/^.*\|\s*/, '').trim();
          const prev = head[i - 1];
          if (prev && RE.street.test(prev)) id.address.street = prev.trim();
        }
        id.address.state = csz[2];
        id.address.zip = csz[3];
        break;
      }
      const named = RE.cityStateNameZip.exec(head[i]);
      if (named && !id.address.city) {
        const abbr = S().STATES.find((a) =>
          S().STATE_NAMES[a].toLowerCase() === named[2].toLowerCase());
        if (abbr) {
          id.address.city = named[1].trim();
          id.address.state = abbr;
          id.address.zip = named[3];
          const prev = head[i - 1];
          if (prev && RE.street.test(prev)) id.address.street = prev.trim();
          break;
        }
      }
      const cs = RE.cityState.exec(head[i]);
      if (cs && !id.address.city) {
        id.address.city = cs[1].trim();
        id.address.state = cs[2];
      }
    }

    // Many resumes tuck the location on the end of the headline rather than
    // giving it a line: "REGISTERED NURSE · CRITICAL CARE  Seattle, WA".
    if (!id.address.city) {
      for (let i = 0; i < head.length; i++) {
        const m = /([A-Za-z .'\-]{2,40}),\s*([A-Z]{2})\.?\s*$/.exec(head[i]);
        if (!m || S().STATES.indexOf(m[2]) === -1) continue;
        // Keep only the trailing title-case words. A headline like
        // "REGISTERED NURSE · CRITICAL CARE & BEHAVIORAL HEALTH  Seattle, WA"
        // otherwise yields a city of "BEHAVIORAL HEALTH Seattle".
        const words = m[1].trim().split(/\s+/);
        const city = [];
        for (let j = words.length - 1; j >= 0 && city.length < 3; j--) {
          if (!/^[A-Z][a-z'.\-]+$/.test(words[j])) break;
          city.unshift(words[j]);
        }
        if (!city.length) continue;
        id.address.city = city.join(' ');
        id.address.state = m[2];
        break;
      }
    }
    if (!id.address.city) report.push({ level: 'info', msg: 'No mailing address found. Portals ask for one.' });

    return id;
  }

  /* ----------------------------------------------------------- licensure */

  function parseCredentials(sections, blob, report) {
    const creds = { npiNumber: '', nclex: { passDate: '', state: '' } };

    const npi = RE.npiLabelled.exec(blob);
    if (npi && S().isValidNpi(npi[1])) {
      creds.npiNumber = npi[1];
    } else if (npi) {
      report.push({ level: 'warn', msg: `Found an NPI (${npi[1]}) that fails its check digit. Left blank.` });
    }

    const nclexLine = findLine(blob, /\bnclex\b/i);
    if (nclexLine) {
      creds.nclex.passDate = toIsoMonth(nclexLine);
      const st = /\b([A-Z]{2})\b/.exec(nclexLine.replace(/\bNCLEX(-RN)?\b/gi, ''));
      if (st && S().STATES.indexOf(st[1]) !== -1) creds.nclex.state = st[1];
    }
    return creds;
  }

  function findLine(blob, re) {
    const lines = blob.split('\n');
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return lines[i];
    return '';
  }

  function parseLicenses(sections, blob, report) {
    // EDUCATION and LICENSURE often share a header line in a two-column
    // layout, so the licence text can land in either bucket.
    const pool = (sections.licenses || []).concat(sections.certifications || [],
      sections.education || [], sections.header || [], sections.summary || []);
    const candidates = pool.filter((l) => /\blicen[cs]e|licensure|\bRN\b|\bLPN\b|\bAPRN\b|\bCRNA\b|\bCNS\b/i.test(l));

    const out = [];
    const assumedExpiry = [];
    candidates.forEach((line) => {
      if (!/\blicen[cs]e|licensure|#|\bno\.?\b|\bnumber\b/i.test(line)) return;

      const type = /\bAPRN\b/i.test(line) ? 'APRN'
        : /\bCRNA\b/i.test(line) ? 'CRNA'
        : /\bCNS\b/i.test(line) ? 'CNS'
        : /\bNP\b/i.test(line) ? 'NP'
        : /\bL\.?[PV]\.?N\b/i.test(line) ? 'LPN'
        : 'RN';

      let state = '';
      const named = S().STATES.find((abbr) =>
        new RegExp('\\b' + S().STATE_NAMES[abbr] + '\\b', 'i').test(line));
      if (named) state = named;
      if (!state) {
        const abbrs = line.match(/\b([A-Z]{2})\b/g) || [];
        const hit = abbrs.map((a) => a.trim())
          .filter((a) => S().STATES.indexOf(a) !== -1 && a !== 'RN' && a !== 'NP')[0];
        if (hit) state = hit;
      }

      let number = '';
      const numbered = RE.licenseNumber.exec(line);
      if (numbered) number = numbered[1].replace(/\s+/g, '');
      if (!number) {
        const bare = RE.bareLicenseNumber.exec(line);
        if (bare) number = bare[1].replace(/\s+/g, '');
      }

      const expPart = /\b(exp\w*|until|valid\s+(through|until)|renewal)\b[^\n]{0,30}/i.exec(line);
      let expiration = expPart ? toIsoDay(expPart[0]) : '';
      // "RN License | DSPS | 02/29/2028" states an expiry with no keyword to
      // announce it. On a delimited credential row the trailing date is the
      // expiration; the assumption is reported rather than made silently.
      if (!expiration && /[|,]/.test(line)) {
        const tail = line.split(/[|,]/).pop();
        const guessed = toIsoDay(tail);
        if (guessed) {
          expiration = guessed;
          assumedExpiry.push(line.trim());
        }
      }
      const issuePart = /\b(issued?|effective|since|obtained)\b[^\n]{0,30}/i.exec(line);
      const issueDate = issuePart ? toIsoDay(issuePart[0]) : '';

      // A line can state a real licence with no number on it at all:
      // "RN License | DSPS | 02/29/2028". Recording the expiration and the
      // compact flag is worth more than discarding the whole line, as long as
      // the missing number is reported rather than fabricated.
      if (!state && !number && !expiration) return;

      out.push({
        type, state, number, issueDate, expirationDate: expiration,
        isCompact: /\b(compact|multi[\s\-]?state|nlc)\b/i.test(line),
        isPrimaryState: false,
        disciplinaryAction: false, disciplinaryExplanation: ''
      });
    });

    // "Multi-state Registered Nurse license / California, Oregon, Washington"
    // states real licensure with no numbers on the page. Record the states so
    // the states are right, and say plainly that the numbers are missing.
    const multiLine = pool.find((l) =>
      /\bmulti[\s-]?state\b[^\n]{0,60}\blicens/i.test(l) ||
      /\blicens\w*[^\n]{0,40}\bmulti[\s-]?state\b/i.test(l));
    if (multiLine) {
      const at = pool.indexOf(multiLine);
      const context = pool.slice(at, at + 3).join(' ');
      const states = [];
      S().STATES.forEach((abbr) => {
        const full = new RegExp('\\b' + S().STATE_NAMES[abbr] + '\\b', 'i');
        const short = new RegExp('\\b' + abbr + '\\b');
        if (full.test(context) || short.test(context)) states.push(abbr);
      });
      states.filter((st) => !out.some((l) => l.state === st)).forEach((st) => out.push({
        type: /\bLPN|LVN\b/i.test(multiLine) ? 'LPN' : 'RN',
        state: st, number: '', issueDate: '', expirationDate: '',
        isCompact: true, isPrimaryState: false,
        disciplinaryAction: false, disciplinaryExplanation: ''
      }));
      if (states.length) {
        report.push({ level: 'warn',
          msg: `Multi-state licensure found for ${states.join(', ')}, but the resume gives no license numbers or expiration dates. Every portal asks for both, so add them.` });
      }
    }

    const deduped = [];
    out.forEach((l) => {
      const match = deduped.find((d) =>
        d.type === l.type && d.state === l.state && d.number === l.number);
      if (match) {
        // "RN License" and "Compact State Nurse License" are one licence
        // described twice; keep whichever row carried the compact flag.
        match.isCompact = match.isCompact || l.isCompact;
        match.expirationDate = match.expirationDate || l.expirationDate;
        return;
      }
      deduped.push(l);
    });
    if (deduped.length) deduped[0].isPrimaryState = true;
    if (assumedExpiry.length) {
      report.push({ level: 'info',
        msg: `Took the trailing date as an expiration on ${assumedExpiry.length} license line${assumedExpiry.length === 1 ? '' : 's'}. Check it.` });
    }
    if (!deduped.length) {
      report.push({ level: 'warn', msg: 'No license found. Most portals will not accept an application without one.' });
    } else {
      const numberless = deduped.filter((l) => !l.number);
      if (numberless.length) {
        report.push({ level: 'warn',
          msg: `${numberless.length} license entr${numberless.length === 1 ? 'y has' : 'ies have'} no license number on the resume. Portals require it, so add it.` });
      }
      const stateless = deduped.filter((l) => !l.state);
      if (stateless.length) {
        report.push({ level: 'warn',
          msg: `${stateless.length} license entr${stateless.length === 1 ? 'y is' : 'ies are'} missing the issuing state. Set it yourself rather than letting a portal guess.` });
      }
      deduped.forEach((l) => {
        if (!l.expirationDate) {
          report.push({ level: 'info', msg: `${l.type} ${l.state || ''} license has no expiration date on the resume. Add it.` });
        }
      });
    }
    return deduped;
  }

  /* ------------------------------------------------------ certifications */

  function parseCertifications(sections, lines, report) {
    // People list credentials wherever they like: in a dedicated section, in
    // education, or inline in a summary. Prefer a real section, but fall back
    // to the whole document rather than reporting none.
    let pool = (sections.certifications || []).concat(sections.licenses || [],
      sections.skills || [], sections.header || [], sections.summary || []);
    if (!pool.length || !CERT_PATTERNS.some(([, re]) => pool.some((l) => re.test(l)))) {
      pool = lines;
    }
    const found = new Map();

    pool.forEach((line) => {
      CERT_PATTERNS.forEach(([name, re, caseSensitive]) => {
        const test = caseSensitive ? re : re;
        if (!test.test(line)) return;
        if (found.has(name)) return;
        const expPart = /\b(exp\w*|until|valid\s+(through|until)|renew\w*)\b[^\n]{0,30}/i.exec(line);
        found.set(name, {
          name,
          otherName: '',
          issuingBody: firstMatch(BODY_PATTERNS, line) || defaultBody(name),
          issueDate: '',
          expirationDate: expPart ? toIsoDay(expPart[0]) : toIsoDay(line),
          verificationUrlOrCertId: ''
        });
      });
    });

    const list = Array.from(found.values());
    if (!list.length) {
      report.push({ level: 'warn',
        msg: 'No certifications found on the resume. Nearly every posting requires BLS at minimum, and most acute-care roles want ACLS. Add them with their expiration dates.' });
      return list;
    }
    const undated = list.filter((c) => !c.expirationDate).map((c) => c.name);
    if (undated.length) {
      report.push({ level: 'info',
        msg: `No expiration date on the resume for ${undated.join(', ')}. Add it, an expired card stalls more applications than anything else.` });
    }
    return list;
  }

  const DESPACED_DEGREES = [
    ['DNP', 'doctorofnursingpractice'],
    ['MSN', 'masterofscienceinnursing'],
    ['BSN', 'bachelorofscienceinnursing'],
    ['ADN', 'associatedegreeinnursing'],
    ['ADN', 'associateofscienceinnursing'],
    ['Diploma', 'diplomainnursing']
  ];

  function despacedDegree(line) {
    const flat = despace(line);
    for (let i = 0; i < DESPACED_DEGREES.length; i++) {
      if (flat.indexOf(DESPACED_DEGREES[i][1]) !== -1) return DESPACED_DEGREES[i][0];
    }
    return '';
  }

  function defaultBody(name) {
    if (name === 'BLS' || name === 'ACLS' || name === 'PALS') return 'AHA';
    if (name === 'CCRN' || name === 'PCCN') return 'AACN';
    if (name === 'TNCC' || name === 'CEN') return 'ENA';
    return 'Other';
  }

  /* ----------------------------------------------------------- education */

  function parseEducation(sections, report) {
    const lines = sections.education || [];
    const out = [];
    let current = null;

    lines.forEach((raw) => {
      const line = stripBullet(raw);
      const degree = firstMatch(DEGREE_PATTERNS, line) || despacedDegree(line);
      const schoolish = /\b(university|college|school\s+of\s+nursing|institute|academy)\b/i.test(line);

      if (degree || schoolish) {
        if (!current || (degree && current.degree) || (schoolish && current.school)) {
          current = S().blankEducation();
          current.degree = '';
          current.school = '';
          out.push(current);
        }
        if (degree) current.degree = degree;
        if (schoolish) {
          // "Master of Science in Nursing (AGPCNP) | Walden University" puts
          // the degree and the school on one line. Take the segment that names
          // an institution, not simply the first one.
          const segments = line.split(/\s*[·•|]\s*/).map((x) => x.trim()).filter(Boolean);
          const institution = segments.find((seg) =>
            /\b(university|college|school\s+of\s+nursing|institute|academy)\b/i.test(seg));
          const rawSchool = (institution || segments[0] || line)
            // A leading "1995 - 2001" has to go before the trailing-year rule
            // runs, or that rule truncates the entire line to nothing.
            .replace(/^\s*(?:19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2}|present)\s*/i, '')
            .replace(/^\s*(?:19|20)\d{2}\s+(?=[A-Z])/, '');
          const schoolLocation = locationSuffix(rawSchool);
          if (schoolLocation) {
            if (!current.city) current.city = schoolLocation.city;
            if (!current.state) current.state = schoolLocation.state;
          }
          current.school = stripTrailingLocation(rawSchool)
            .replace(/\bgraduat\w*\b.*$/i, '')
            .replace(/\b(19|20)\d{2}\b.*$/, '')
            .replace(/[,;]\s*(BSN|ADN|ASN|MSN|DNP|RN)\b.*$/i, '')
            .replace(/\s{2,}/g, ' ')
            .trim()
            .replace(/[,\-–|]\s*$/, '');
        }
      }
      if (!current) return;

      const cs = RE.cityState.exec(line) || /,\s*([A-Za-z .'\-]+),\s*([A-Z]{2})\b/.exec(line);
      if (cs && !current.city) {
        current.city = (cs[1] || '').trim();
        current.state = cs[2] || '';
      }
      const grad = toIsoMonth(line);
      if (grad && !current.graduationDate) current.graduationDate = grad;
      const gpa = RE.gpa.exec(line);
      if (gpa && !current.gpa) current.gpa = gpa[1];
      if (!current.major) current.major = 'Nursing';
    });

    const seen = [];
    const clean = out.filter((e) => {
      if (!e.school && !e.degree) return false;
      // The same school can appear twice when a layout repeats a block.
      const school = (e.school || '').toLowerCase().replace(/\W+/g, '');
      // A repeated block can leave a truncated copy ("Troy State University
      // Troy"), so one school name that starts with another counts as the
      // same school. The degree still has to match: two different degrees from
      // one university are two entries, not a duplicate.
      const dup = seen.some(([s2, d2]) => {
        const prefix = s2.indexOf(school) === 0 || school.indexOf(s2) === 0;
        if (!prefix) return false;
        if (d2 === e.degree) return true;
        // A truncated repeat of the same school arrives with no degree on it.
        // Two genuinely different degrees from one university have the same
        // school string exactly, not a prefix of it, so they survive.
        // Dedupe runs before undeclared degrees are labelled 'Other', so an
        // empty degree counts as undeclared here too.
        const undeclared = (d) => !d || d === 'Other';
        const truncated = s2 !== school;
        return truncated && (undeclared(e.degree) || undeclared(d2));
      });
      if (school && dup) return false;
      seen.push([school, e.degree]);
      return true;
    });
    // Never guess the degree. Defaulting to BSN silently turned an MBA into a
    // nursing degree on a resume that listed both.
    const undeclared = clean.filter((e) => !e.degree);
    undeclared.forEach((e) => { e.degree = 'Other'; });
    if (undeclared.length) {
      report.push({ level: 'info',
        msg: `${undeclared.length} school entr${undeclared.length === 1 ? 'y has' : 'ies have'} no degree the parser recognised. Set the degree yourself.` });
    }
    if (!clean.length) report.push({ level: 'warn', msg: 'No education section recognised. Add your nursing school by hand.' });
    return clean;
  }

  /* ---------------------------------------------------------- experience */

  function parseExperience(sections, report, sources) {
    const lines = sections.experience || [];
    if (!lines.length) {
      report.push({ level: 'warn', msg: 'No work history section recognised. Add your roles by hand.' });
      return [];
    }

    // An entry begins at a line carrying a date range. Everything until the
    // next such line belongs to it.
    const blocks = [];
    let block = null;
    lines.forEach((raw) => {
      if (hasDateRange(raw)) {
        block = { dateLine: raw, lines: [], preceding: [] };
        blocks.push(block);
        return;
      }
      if (block) block.lines.push(raw);
      else if (blocks.length === 0) {
        // Header lines can precede the first date; keep the last two.
        (blocks.pending = blocks.pending || []).push(raw);
      }
    });

    // Some resumes put the employer line above the date line rather than on it.
    const flat = lines.slice();
    blocks.forEach((b) => {
      const idx = flat.indexOf(b.dateLine);
      b.preceding = flat.slice(Math.max(0, idx - 2), idx).filter((l) => !isBullet(l));
    });

    const out = blocks.map((b) => buildRole(b, report, sources)).filter(Boolean);
    if (!out.length) {
      report.push({ level: 'warn', msg: 'Found a work history section but no date ranges in it, so no roles were built.' });
    }
    return out;
  }

  function buildRole(block, report, sources) {
    const role = S().blankExperience();
    const range = dateRange(block.dateLine);
    if (!range) return null;
    role.startDate = range.start;
    role.endDate = range.end;
    role.isCurrent = range.isCurrent;

    // Candidate identity lines: the date line minus its dates, the two lines
    // above it, and any non-bullet lines immediately after it.
    let dateStripped = block.dateLine
      .replace(/\b(0?[1-9]|1[0-2])\s*[\/\-]\s*(?:0?[1-9]|[12]\d|3[01])?\s*[\/\-]?\s*(?:19|20)\d{2}\b/g, ' ')
      .replace(new RegExp(RE.monthYear.source, 'gi'), ' ')
      .replace(new RegExp(RE.present.source, 'gi'), ' ')
      .replace(/\b(19|20)\d{2}\b/g, ' ')
      .replace(/\s+(to|through|until)\s+/gi, ' ')
      .replace(/[|,\-–—]+\s*$/g, '')
      .replace(/^\s*[|,\-–—]+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    // "2017 to present" leaves nothing but connective tissue. Treat that as an
    // empty date line so the employer and title are looked for above it.
    if (!/[A-Za-z]{3}/.test(dateStripped.replace(/\b(to|and|the|of|at|in|present|current)\b/gi, ''))) {
      dateStripped = '';
    }

    // Take the lines after the date as header candidates, stopping at the first
    // duty line. When the date line already carries one of the pair, only one
    // more line is needed, and taking a second one just invites the first duty
    // to compete for the employer slot: a duty such as "Coordinated referrals
    // by communicating with external healthcare providers" scores as an
    // employer on the word "healthcare".
    const afterLimit = dateStripped ? 1 : 2;
    const afterLines = [];
    for (let i = 0; i < block.lines.length && afterLines.length < afterLimit; i++) {
      const line = block.lines[i];
      if (isBullet(line) || isProse(line)) break;
      afterLines.push(line);
    }

    // The lines above the date always matter. Layouts disagree about ordering:
    // some put "Employer | City, ST" above "Title | dates", others put
    // "dates  Employer  City, ST" above "Title". Duty lines and page furniture
    // are filtered out below, so keeping both directions is safe.
    const preceding = block.preceding;

    // Candidates carry where they came from. Resumes overwhelmingly put the job
    // title on the line with the dates and the employer on the line beneath, so
    // position is a real signal, and it breaks ties that keyword scoring cannot:
    // neither "AI Consultant" nor "Hood View Adventist School" contains a title
    // or employer keyword, but their positions say which is which.
    //
    // A line is also split on pipe-style separators, because
    // "ED Registered Nurse | Harborview Medical Center | Seattle, WA" carries
    // both facts at once. Commas are left alone: "Registered Nurse III, Medical
    // ICU" is one title, not two candidates.
    const candidates = [];
    const pushLine = (line, origin) => {
      const t = String(line || '')
        .replace(/^\s*\((?:cont(?:inued|\.)?)\)\s*/i, '')
        .replace(/^\s*[|,]\s*/, '')
        .trim();
      if (!t || t.length > 160) return;
      if (isProse(t) || /\bpage\s+\d+\b/i.test(t)) return;
      splitRuns(t).split(/\s*[|·•]\s*|\s+[—–]\s+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((seg) => !isLocationOnly(seg))
        .forEach((seg) => candidates.push({ text: seg, origin }));
    };
    // Two passes. The block's own lines come first, because they cannot belong
    // to a neighbouring role. The lines above the date are consulted only when
    // those are not enough, which keeps the tail of the previous role out of
    // this one while still reading layouts that put the employer above the
    // date. Nearest first, since the line directly above the date is far more
    // often the employer than the one two lines up.
    if (dateStripped) pushLine(dateStripped, 'dateline');
    afterLines.forEach((l) => pushLine(l, 'after'));
    const needsMore = candidates.length < 2 ||
      !candidates.some((c) => scoreEmployer(c.text) >= 2) ||
      !candidates.some((c) => scoreTitle(c.text) >= 2);
    if (needsMore) preceding.slice().reverse().forEach((l) => pushLine(l, 'preceding'));

    // Position is a tiebreaker, not evidence. Resumes disagree on ordering, so
    // a large positional bonus reads one family of layouts correctly and the
    // other backwards. Keyword evidence decides; position only settles ties.
    const scored = candidates.map((c) => ({
      text: c.text,
      origin: c.origin,
      employer: scoreEmployer(c.text) + (c.origin === 'after' ? 0.4 : 0),
      title: scoreTitle(c.text) + (c.origin === 'dateline' ? 0.4 : 0)
    }));

    const employerPick = scored.slice().sort((a, b) => (b.employer - b.title) - (a.employer - a.title))[0];
    const titlePick = scored.filter((s) => s !== employerPick)
      .sort((a, b) => (b.title - b.employer) - (a.title - a.employer))[0];

    if (employerPick) {
      const cleaned = stripScheduleNoise(cleanEntity(employerPick.text));
      const loc = locationSuffix(cleaned);
      role.employer = loc && loc.head ? loc.head : stripTrailingLocation(cleaned);
    }
    // A candidate that scores zero is still better than an empty title, as
    // long as it is not a location or a sentence. "Medical Transcriptionist"
    // contains no nursing vocabulary and would otherwise be dropped.
    // A title that scores zero is still the title when it came from this
    // block's own lines: "Medical Transcriptionist" contains no nursing
    // vocabulary, and the alternative is leaving the field blank.
    const titleIsOwn = titlePick && (titlePick.origin === 'dateline' || titlePick.origin === 'after');
    if (titlePick && (titlePick.title > 0 || !role.employer || titleIsOwn)) {
      role.title = stripScheduleNoise(firstSentence(cleanEntity(titlePick.text)));
    }
    if (role.employer && !role.title) {
      report.push({ level: 'info',
        msg: `No job title found for the role at "${role.employer}" starting ${role.startDate}. Add it.` });
    }

    // Only flag a real ambiguity. Position decides most pairs confidently, and
    // a warning on every role is the same as no warning at all.
    const keywordEvidence = Math.abs(scoreEmployer(role.employer) - scoreTitle(role.employer)) +
                            Math.abs(scoreTitle(role.title) - scoreEmployer(role.title));
    if (role.employer && role.title && keywordEvidence < 2) {
      report.push({ level: 'info',
        msg: `Could not tell employer from job title for "${role.title}" at "${role.employer}". Check that pair.` });
    }

    const context = [block.dateLine].concat(block.lines).join('\n');
    // The unit belongs to the role, so read it from the title and employer
    // lines first. Duty text mentions other units in passing: a corrections
    // nurse who responds to "psychiatric crises" did not work on a psych unit.
    const headerContext = [role.title, role.employer, block.dateLine]
      .concat(afterLines).filter(Boolean).join('\n');

    role.unit = firstMatch(UNIT_LEXICON, headerContext) ||
                firstMatch(UNIT_LEXICON, context) || '';
    role.facilityType = firstMatch(FACILITY_HINTS, context) || 'Hospital';

    const trauma = RE.trauma.exec(context);
    if (trauma) role.traumaLevel = 'Level ' + romanize(trauma[1]);
    else role.traumaLevel = 'Non-Trauma';

    const beds = RE.beds.exec(context);
    if (beds) role.bedCount = beds[1];

    const ratio = RE.ratio.exec(context.replace(/\b\d{1,2}:\d{2}\s*(am|pm)\b/gi, ''));
    if (ratio) role.typicalRatio = `${ratio[1]}:${ratio[2].replace(/\s+/g, '')}`;

    // Duties are whatever in this block reads as a sentence, plus anything
    // explicitly bulleted, minus the lines already used as employer or title.
    const used = new Set([employerPick && employerPick.text, titlePick && titlePick.text]
      .filter(Boolean));
    const duties = block.lines
      .filter((l) => l && (isBullet(l) || isProse(l)))
      .map(stripBullet)
      .filter((l) => l && !used.has(l) && !/^EMR\s*:/i.test(l));
    role.responsibilities = duties.join('\n');

    const emrLine = block.lines.find((l) => /^EMR\s*:/i.test(l.trim()));
    if (emrLine) role.emrNote = emrLine.replace(/^EMR\s*:\s*/i, '').trim();

    if (!role.employer) report.push({ level: 'warn', msg: `A role starting ${role.startDate} has no employer. Fill it in.` });

    // Everything the UI needs to show its work and to offer a correction that
    // applies to the whole document rather than one role at a time.
    if (sources) {
      sources.push({
        lines: [block.dateLine].concat(block.lines).map((l) => String(l).trim()).filter(Boolean),
        candidates: scored.map((c) => ({ text: c.text, origin: c.origin,
                                         employer: round2(c.employer), title: round2(c.title) })),
        employerOrigin: employerPick ? employerPick.origin : '',
        titleOrigin: titlePick ? titlePick.origin : ''
      });
    }
    return role;
  }

  function round2(n) { return Math.round(Number(n) * 100) / 100; }

  function romanize(v) {
    const map = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV' };
    return map[v] || String(v).toUpperCase();
  }

  function scoreEmployer(text) {
    let s = 0;
    if (EMPLOYER_TOKENS.test(text)) s += 3;
    if (/\b(inc|llc|ltd|corp)\b/i.test(text)) s += 1;
    if (hasLocationSuffix(text)) s += 1;
    if (TITLE_TOKENS.test(text)) s -= 2;
    if (ROLE_NOUN.test(text)) s -= 2;
    if (text === text.toUpperCase() && text.length > 6) s += 0.5;
    return s;
  }

  function scoreTitle(text) {
    let s = 0;
    if (TITLE_TOKENS.test(text)) s += 3;
    if (ROLE_NOUN.test(text)) s += 2;
    if (/\b(I{1,3}|IV|[1-4])\b\s*$/.test(text)) s += 0.5;
    if (EMPLOYER_TOKENS.test(text)) s -= 2;
    if (hasLocationSuffix(text)) s -= 1;
    if (/\b(per\s+diem|full[\s\-]time|part[\s\-]time|prn)\b/i.test(text)) s += 1;
    return s;
  }

  /** Matches ", WI" and ", Alabama" alike. */
  function hasLocationSuffix(text) {
    const t = String(text || '').trim();
    if (/,\s*[A-Z]{2}\.?\s*$/.test(t)) return true;
    return S().STATES.some((abbr) =>
      new RegExp(',\\s*' + S().STATE_NAMES[abbr] + '\\s*$', 'i').test(t));
  }

  /**
   * Splits a trailing "City, State" off a string, or returns null.
   *
   * The city is matched at one word first, then two, then three, so
   * "Daleville City School Systems Daleville, Alabama" gives up only
   * "Daleville" rather than swallowing "School Systems Daleville" the way a
   * greedy pattern does. Both "OR" and "Oregon" are accepted, with or without
   * the comma that a merged two-column layout tends to lose.
   */
  function locationSuffix(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const stateAlt = S().STATES.map((a) => S().STATE_NAMES[a].replace(/ /g, '\\s+'))
      .concat(S().STATES).join('|');
    const word = "[A-Z][A-Za-z.'\\-]*";
    for (let n = 1; n <= 3; n++) {
      const cityPattern = Array(n).fill(word).join('\\s+');
      const re = new RegExp('(^|[,\\s])(' + cityPattern + ')\\s*,\\s*(' + stateAlt + ')\\.?\\s*$');
      const m = re.exec(t);
      if (!m) continue;
      const abbr = m[3].length === 2
        ? m[3].toUpperCase()
        : (S().STATES.find((a) => S().STATE_NAMES[a].toLowerCase() === m[3].toLowerCase().replace(/\s+/g, ' ')) || '');
      if (!abbr || S().STATES.indexOf(abbr) === -1) continue;
      let head = t.slice(0, m.index).replace(/[,\s]+$/, '');
      let city = m[2].trim();
      // "Ft. Rucker", "St. Louis", "San Rafael": taking only the final word
      // leaves the prefix stranded on the employer.
      const prefix = /(^|[\s,])((?:Ft|Mt|St|Saint|San|Santa|Los|Las|New|North|South|East|West|Port|Lake|Fort|Mount)\.?)\s*$/.exec(head);
      if (prefix) {
        head = head.slice(0, prefix.index).replace(/[,\s]+$/, '');
        city = prefix[2] + ' ' + city;
      }
      return { head, city, state: abbr };
    }
    return null;
  }

  /**
   * An employer field wants "Providence St Vincent Medical Center", not the
   * same string with the city appended.
   */
  function stripTrailingLocation(text) {
    const t = String(text || '').trim();
    const loc = locationSuffix(t);
    if (loc && loc.head) return loc.head;
    // No city, just a trailing state.
    let out = t.replace(/,\s*[A-Z]{2}\.?\s*$/, '');
    for (let i = 0; i < S().STATES.length; i++) {
      const name = S().STATE_NAMES[S().STATES[i]];
      const stripped = out.replace(new RegExp(',\\s*' + name.replace(/ /g, '\\s+') + '\\.?\\s*$', 'i'), '');
      if (stripped !== out) { out = stripped; break; }
    }
    return out.replace(/[,\s]+$/, '').trim();
  }

  /**
   * Removes payroll detail that rides along with a job title on older resumes:
   * "Lead School Nurse, RN  40 hours/week" is a title plus a schedule.
   */
  function stripScheduleNoise(text) {
    return String(text || '')
      .replace(/[,|\s]*\d{1,2}\s*\+?\s*(hours?|hrs?)\s*(a|per|\/)?\s*(week|wk)?\.?\s*$/i, '')
      .replace(/[,|\s]*(full|part)[\s-]?time\s*(status)?\s*$/i, '')
      .replace(/\s*\((salaried|hourly|per\s*diem|prn)\)\s*$/i, '')
      .replace(/[,\s]+$/, '')
      .trim();
  }

  /**
   * Re-inserts word breaks a PDF lost.
   *
   * Some layout engines emit a heading with no space glyphs at all, so
   * "RN Unit Manager / MDS Coordinator" arrives as
   * "RNUnitManager/MDSCoordinator".
   *
   * Applied only to employer and title candidates, never to the document as a
   * whole: splitting globally turned "PointClickCare" into "Point Click Care"
   * and broke EMR matching. Product and credential names that legitimately
   * carry internal capitals are skipped here too.
   */
  const PROTECTED_RUNS = new Set([
    'pointclickcare', 'eclinicalworks', 'matrixcare', 'healthstream',
    'multicare', 'newgen', 'carefusion', 'medsurg', 'healthsource',
    'allscripts', 'athenahealth', 'medhost', 'cerner', 'meditech'
  ]);

  function splitRuns(line) {
    return String(line || '').split(/(\s+)/).map((token) => {
      if (/^\s*$/.test(token)) return token;
      const capitals = (token.match(/[A-Z]/g) || []).length;
      if (token.length < 14 || capitals < 2) return token;
      if (!/[a-z]/.test(token)) return token;
      if (PROTECTED_RUNS.has(token.replace(/[^A-Za-z]/g, '').toLowerCase())) return token;
      return token
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/\s*\/\s*/g, ' / ')
        .replace(/([a-z])&([A-Z])/g, '$1 & $2')
        .replace(/,(?=\S)/g, ', ')
        .replace(/\s{2,}/g, ' ');
    }).join('');
  }

  /**
   * "Crescent City, CA" is where a job was, never who the employer was.
   *
   * The city part is capped at three words and must not contain employer
   * vocabulary, because "Alabama Care Network Dothan, Alabama" has the shape of
   * a location and is in fact the employer plus its city.
   */
  function isLocationOnly(text) {
    const t = String(text || '').trim();
    if (!t || t.length > 40) return false;
    if (/^(remote|onsite|on-?site|hybrid|nationwide|various\s+locations?)$/i.test(t)) return true;

    const m = /^([A-Za-z .'\-]{2,30}),\s*([A-Za-z]{2,20})\.?$/.exec(t);
    if (!m) return false;
    const city = m[1].trim();
    // Two words at most. "Ridgeline Dialysis Cordele, Georgia" has the shape of a
    // three-word city and is in fact an employer plus its town; discarding it
    // lost the employer entirely.
    if (city.split(/\s+/).length > 2) return false;
    if (EMPLOYER_TOKENS.test(city) || TITLE_TOKENS.test(city)) return false;

    const tail = m[2].toUpperCase();
    if (S().STATES.indexOf(tail) !== -1) return true;
    return S().STATES.some((a) => S().STATE_NAMES[a].toLowerCase() === m[2].toLowerCase());
  }

  /**
   * Some layouts run the first duty on to the end of the title line:
   * "RN Nurse Manager, House Supervisor New Day Behavioral. 40+ hours/week
   * (salaried) Worked in ...". Keep the title, drop the sentence that follows.
   */
  function firstSentence(text) {
    const m = /^(.{6,120}?[a-z]{2})\.\s+\S/.exec(String(text || ''));
    return m ? m[1].trim() : String(text || '').trim();
  }

  function cleanEntity(text) {
    return String(text || '')
      // A stray month abbreviation left behind by a malformed date range.
      .replace(/^\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s*[-–—]\s*/i, '')
      .replace(/\s*[|·•]\s*/g, ', ')
      .replace(/\s*[,;]\s*$/, '')
      .replace(/^\s*[,;\-–]\s*/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /* -------------------------------------------------------------- skills */

  function parseSkills(sections, blob) {
    const skills = { emrSystems: [], procedures: [], languages: [] };

    S().ENUMS.emrSystems.forEach((emr) => {
      const re = new RegExp('\\b' + emr.replace(/\s+/g, '\\s*') + '\\b', 'i');
      if (re.test(blob)) skills.emrSystems.push(emr);
    });

    const seen = new Set();
    PROCEDURE_PATTERNS.forEach(([name, re]) => {
      if (seen.has(name)) return;
      if (re.test(blob)) { seen.add(name); skills.procedures.push(name); }
    });

    const langSection = (sections.skills || []).concat(sections.header || [],
      sections.affiliations || []).join('\n');
    const langBlob = /\blanguages?\b/i.test(blob) ? blob : langSection;
    LANGUAGES.forEach((lang) => {
      const re = new RegExp('\\b' + lang.replace(/\s+/g, '\\s+') + '\\b', 'i');
      if (!re.test(langBlob)) return;
      if (skills.languages.some((l) => l.language === lang)) return;
      const line = findLine(langBlob, re);
      const prof = /\bnative\b/i.test(line) ? 'Native'
        : /\bprofessional|medical\s+interpret\w*|conversational\b/i.test(line) ? 'Professional'
        : 'Fluent';
      skills.languages.push({ language: lang, proficiency: prof });
    });

    return skills;
  }

  /* ------------------------------------------------------------ compliance */

  function parseCompliance(blob) {
    const c = {};
    const tb = findLine(blob, /\b(tb\b|tuberculosis|ppd\b|quantiferon)/i);
    if (tb) {
      const d = toIsoDay(tb);
      if (d) c.tbTestDate = d;
      if (/quantiferon/i.test(tb)) c.tbTestType = 'Quantiferon Gold';
      else if (/ppd|skin\s+test/i.test(tb)) c.tbTestType = 'PPD Skin Test';
      else if (/chest\s+x/i.test(tb)) c.tbTestType = 'Chest X-Ray';
    }
    const flu = findLine(blob, /\b(influenza|flu)\s+(vaccin|shot)/i);
    if (flu) {
      const y = RE.year.exec(flu);
      if (y) c.fluVaccineSeason = `${y[1]}-${Number(y[1]) + 1}`;
    }
    return c;
  }

  /* ---------------------------------------------------------------- main */

  /**
   * parse(text) -> { profile, report, stats }
   * `profile` is a partial: only keys the parser actually found. `report` is a
   * list of what it could not determine, which the options page shows so the
   * gaps are visible rather than silently blank.
   */
  function parse(text) {
    const report = [];
    const wideLines = String(text || '')
      .replace(/\r/g, '')
      .split('\n')
      .map(collapseLetterSpacing)
      // "1995 - 2001Troy State University": some layouts lose the space after
      // a year, which hides both the date and the school.
      .map((l) => l.replace(/\b((?:19|20)\d{2})(?=[A-Z][a-z])/g, '$1 '))
      .filter((l) => l.trim() !== '');
    const lines = wideLines.map(squeeze);
    const blob = lines.join('\n');

    if (lines.length < 5) {
      return {
        profile: {},
        report: [{ level: 'warn', msg: 'Almost no text came out of that file. If it is a scanned PDF, it needs OCR, which NurseApply does not do.' }],
        stats: { lines: lines.length }
      };
    }

    // Sectioning reads the wide-gap form; everything downstream reads the
    // squeezed form, which splitSections produces as it goes.
    const sections = splitSections(stripRunningHeaders(wideLines));
    const profile = {};

    profile.identity = parseIdentity(lines, blob, report);
    profile.nursingCredentials = parseCredentials(sections, blob, report);
    profile.licenses = parseLicenses(sections, blob, report);
    profile.certifications = parseCertifications(sections, lines, report);
    profile.education = parseEducation(sections, report);
    const experienceSources = [];
    profile.experience = parseExperience(sections, report, experienceSources);
    profile.clinicalSkills = parseSkills(sections, blob);
    const compliance = parseCompliance(blob);
    if (Object.keys(compliance).length) profile.compliance = compliance;

    const stats = {
      lines: lines.length,
      sections: Object.keys(sections).filter((k) => k !== 'header'),
      licenses: profile.licenses.length,
      certifications: profile.certifications.length,
      education: profile.education.length,
      experience: profile.experience.length,
      emrSystems: profile.clinicalSkills.emrSystems.length,
      procedures: profile.clinicalSkills.procedures.length
    };

    return { profile, report, stats, sources: experienceSources, lines };
  }

  NA.resumeParse = {
    parse, splitSections, dateRange, toIsoMonth, toIsoDay,
    UNIT_LEXICON, CERT_PATTERNS, DEGREE_PATTERNS, PROCEDURE_LEXICON,
    scoreEmployer, scoreTitle, looksLikeName, stripTrailingLocation, stripScheduleNoise, locationSuffix,
    isLocationOnly, isProse, firstSentence,
    collapseLetterSpacing, squeeze, splitRuns, despace, headerName, inlineHeader
  };
})(typeof self !== 'undefined' ? self : this);
