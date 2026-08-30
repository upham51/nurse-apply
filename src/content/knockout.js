/**
 * Knockout guard.
 *
 * Some questions on a nursing application are legal attestations. Getting one
 * wrong is not a typo, it is a false statement on an employment application
 * that a credentialing office will later verify against the state board, the
 * OIG exclusion list and your prior employer's HR file. NurseApply never
 * answers those automatically, no matter how confident the mapper is. They go
 * to the Review Skipped drawer and wait for the user.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});

  // Never auto-answered. Each entry is a family plus the pattern that catches it.
  const BLOCKED = [
    { family: 'termination',
      re: /\b(terminated|termination|discharged|fired|involuntar\w*\s+(separat|resign)|resign\w*\s+in\s+lieu|asked\s+to\s+resign|dismissed\s+for\s+cause)\b/i },
    { family: 'rehire',
      re: /\b(eligible\s+for\s+re-?hire|re-?hire\s+status|would\s+.{0,20}re-?hire\s+you)\b/i },
    { family: 'criminal',
      re: /\b(convict\w*|felony|felonies|misdemeanor|criminal\s+(record|history|charge|offense)|plead\w*\s+(guilty|no\s+contest|nolo)|deferred\s+adjudication|pending\s+charges?|arrest\w*|incarcerat\w*|sex\s+offender|probation\s+or\s+parole)\b/i },
    { family: 'board-discipline',
      re: /\b(discipl\w*\s+(action|proceeding|by\s+any\s+board)|revok\w*|suspend\w*\s+(license|license)|surrender\w*\s+.{0,25}(license|license)|denied\s+.{0,20}licens|censur\w*|reprimand\w*|consent\s+(order|agreement)|license\s+.{0,20}(restrict|encumber|probation))\b/i },
    { family: 'exclusion',
      re: /\b(oig|office\s+of\s+inspector\s+general|excluded?\s+.{0,30}(medicare|medicaid|federal\s+health)|sanction\w*|debarred?|gsa\s+list|sam\.gov|abuse\s+registry|opt\s*-?\s*out\s+of\s+medicare)\b/i },
    { family: 'malpractice',
      re: /\b(malpractice|professional\s+liability\s+(claim|suit)|named\s+.{0,20}(defendant|lawsuit)|npdb|national\s+practitioner\s+data\s+bank|adverse\s+action\s+report)\b/i },
    { family: 'substance',
      re: /\b(fail\w*\s+.{0,25}(drug|substance|alcohol)\s+(screen|test)|refus\w*\s+.{0,25}(drug|substance)\s+(screen|test)|positive\s+drug\s+(screen|test)|impair\w*\s+practice|diversion\s+of\s+(drugs|controlled|narcotic))\b/i },
    { family: 'immigration-detail',
      re: /\b(visa\s+(type|status|number)|i-?9\s+document|alien\s+registration|permanent\s+resident\s+card|green\s+card\s+number|country\s+of\s+citizenship)\b/i },
    { family: 'identifier',
      re: /\b(social\s+security|ssn|\bs\.s\.n\b|date\s+of\s+birth|dob\b|driver'?s?\s+licen[cs]e\s+number|passport\s+number|bank|routing\s+number|account\s+number)\b/i },
    { family: 'non-compete',
      re: /\b(non-?compete|restrictive\s+covenant|non-?solicit)\b/i },
    { family: 'relative-employed',
      re: /\b(relative\w*\s+.{0,25}employ|family\s+member\s+.{0,25}(work|employ)|nepotism)\b/i },
    { family: 'signature',
      re: /\b(electronic\s+signature|type\s+your\s+(full\s+)?name\s+to\s+(sign|certify|attest)|i\s+certify\s+that|initial\s+here|attest\w*\s+that\s+the\s+(information|above))\b/i }
  ];

  // Freeform prompts a template cannot honestly answer. Offered, never forced.
  const ESSAY = [
    { family: 'motivation',
      re: /\b(why\s+(do\s+you\s+want|are\s+you\s+interested)|what\s+(interests|attracts)\s+you|tell\s+us\s+about\s+yourself|describe\s+a\s+time|greatest\s+(strength|weakness)|career\s+goals?)\b/i },
    { family: 'cover-letter',
      re: /\b(cover\s+letter|additional\s+information|anything\s+else\s+.{0,20}(know|share)|personal\s+statement)\b/i },
    { family: 'compensation',
      re: /\b(salary\s+(requirement|expectation|desired)|desired\s+(pay|rate|compensation)|expected\s+(salary|pay)|current\s+salary|pay\s+expectation)\b/i },
    { family: 'referral',
      re: /\b(how\s+did\s+you\s+hear|referred\s+by|source\s+of\s+(referral|application)|who\s+referred)\b/i },
    { family: 'availability-date',
      re: /\b(available\s+(start|to\s+start)|start\s+date|when\s+can\s+you\s+(start|begin)|notice\s+period)\b/i }
  ];

  /**
   * Questions we do answer, because the profile carries an explicit field the
   * user set themselves. Order matters: these are checked before BLOCKED so a
   * phrase like "authorized to work" is not swallowed by the immigration rule.
   */
  const ALLOWED_ATTESTATIONS = [
    { key: 'workAuthorization',
      re: /\b(legally\s+(authorized|entitled)\s+to\s+work|authorized\s+to\s+work\s+in\s+the\s+(us|u\.s\.|united\s+states)|eligible\s+to\s+work\s+in\s+the\s+(us|united\s+states))\b/i },
    { key: 'requiresSponsorship',
      re: /\b(require\s+sponsorship|need\s+sponsorship|will\s+you\s+(now\s+or\s+in\s+the\s+future\s+)?require|sponsorship\s+for\s+(an\s+)?employment\s+visa)\b/i },
    { key: 'over18',
      re: /\b(are\s+you\s+(at\s+least\s+)?18|18\s+years\s+(of\s+age\s+)?or\s+older|of\s+legal\s+working\s+age)\b/i },
    { key: 'willingToRelocate',
      re: /\b(willing\s+to\s+relocate|open\s+to\s+relocation|relocat\w*\s+for\s+(this|the)\s+(role|position))\b/i },
    { key: 'drugScreenWilling',
      re: /\b(willing\s+to\s+(submit\s+to\s+|undergo\s+|complete\s+)?a?\s*(pre-?employment\s+)?(drug|substance)\s+(screen|test)|consent\s+to\s+.{0,20}drug\s+(screen|test))\b/i },
    { key: 'backgroundCheckWilling',
      re: /\b(willing\s+to\s+.{0,25}background\s+(check|investigation|screen)|consent\s+to\s+.{0,25}background\s+(check|screen)|criminal\s+background\s+check\s+.{0,15}(consent|authoriz))\b/i },
    { key: 'weekendAvailability',
      re: /\b(available\s+.{0,15}weekends?|willing\s+to\s+work\s+weekends?|weekend\s+(availability|rotation|requirement))\b/i },
    { key: 'holidayAvailability',
      re: /\b(available\s+.{0,15}holidays?|willing\s+to\s+work\s+holidays?|holiday\s+(availability|rotation))\b/i },
    { key: 'floatPoolWilling',
      re: /\b(willing\s+to\s+float|float\s+(pool|to\s+other\s+units)|cross-?cover\s+other\s+units)\b/i },
    { key: 'travelWilling',
      re: /\b(willing\s+to\s+travel|travel\s+(required|requirement|percentage))\b/i },
    { key: 'previouslyEmployedHere',
      re: /\b(previously\s+(been\s+)?employed\s+by|ever\s+worked\s+(for|at)\s+(us|this)|former\s+employee\s+of)\b/i }
  ];

  /**
   * classify(label) -> { action, family, key }
   *   action: 'allow'  fill it from the profile
   *           'block'  never fill, route to the drawer with a reason
   *           'essay'  offer a draft, do not commit it
   *           'normal' ordinary field, hand back to the mapper
   */
  function classify(label) {
    const text = String(label || '');
    if (!text.trim()) return { action: 'normal' };

    for (let i = 0; i < ALLOWED_ATTESTATIONS.length; i++) {
      if (ALLOWED_ATTESTATIONS[i].re.test(text)) {
        return { action: 'allow', key: ALLOWED_ATTESTATIONS[i].key, family: 'attestation' };
      }
    }
    for (let i = 0; i < BLOCKED.length; i++) {
      if (BLOCKED[i].re.test(text)) {
        return { action: 'block', family: BLOCKED[i].family, reason: reasonFor(BLOCKED[i].family) };
      }
    }
    for (let i = 0; i < ESSAY.length; i++) {
      if (ESSAY[i].re.test(text)) {
        return { action: 'essay', family: ESSAY[i].family };
      }
    }
    return { action: 'normal' };
  }

  const REASONS = {
    termination: 'Employment separation question. Credentialing verifies this against your prior employer, so you answer it.',
    rehire: 'Rehire eligibility is verified with your former HR department. Answer it yourself.',
    criminal: 'Criminal history attestation. Never auto-answered.',
    'board-discipline': 'Board discipline attestation. Verified against the state board of nursing primary source. Answer it yourself.',
    exclusion: 'Federal exclusion or sanction attestation. Never auto-answered.',
    malpractice: 'Malpractice and data bank attestation. Never auto-answered.',
    substance: 'Substance screening history. Never auto-answered.',
    'immigration-detail': 'Immigration document detail. NurseApply does not store these.',
    identifier: 'Government or financial identifier. NurseApply does not store these.',
    'non-compete': 'Contract restriction question. Depends on paperwork only you have.',
    'relative-employed': 'Depends on this specific employer. Answer it yourself.',
    signature: 'Signature or certification field. Signing is yours alone.'
  };

  function reasonFor(family) {
    return REASONS[family] || 'Needs your judgement.';
  }

  /**
   * Resolves an 'allow' attestation to a yes/no from the profile.
   * Returns undefined when the profile has nothing to say, which sends the
   * field to the drawer rather than guessing.
   */
  function answerAttestation(key, profile) {
    const id = (profile && profile.identity) || {};
    const prefs = (profile && profile.preferences) || {};
    const comp = (profile && profile.compliance) || {};
    switch (key) {
      case 'workAuthorization': return bool(id.workAuthorization);
      case 'requiresSponsorship': return bool(id.requiresSponsorship);
      case 'over18': return true;
      case 'willingToRelocate': return bool(id.willingToRelocate);
      case 'drugScreenWilling': return bool(comp.drugScreenWilling);
      case 'backgroundCheckWilling': return bool(comp.backgroundCheckWilling);
      case 'weekendAvailability': return bool(prefs.weekendAvailability);
      case 'holidayAvailability': return bool(prefs.holidayAvailability);
      case 'floatPoolWilling': return bool(prefs.floatPoolWilling);
      case 'travelWilling': return bool(prefs.travelWilling);
      case 'previouslyEmployedHere': return undefined; // employer-specific
      default: return undefined;
    }
  }

  function bool(v) { return v === undefined || v === null ? undefined : !!v; }

  NA.knockout = {
    BLOCKED, ESSAY, ALLOWED_ATTESTATIONS,
    classify, reasonFor, answerAttestation
  };
})(typeof self !== 'undefined' ? self : this);
