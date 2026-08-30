/**
 * Workday (myworkdayjobs.com, myworkdaysite.com).
 *
 * Multi-step React wizard. Two things break naive autofillers here:
 *  1. Date inputs are three separate spinbutton inputs (month / day / year)
 *     inside one wrapper, not a single field. Writing "03/14/2021" into the
 *     first one puts 03142021 in the month box.
 *  2. Nearly every dropdown is a button + popup listbox, not a <select>.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});
  const B = NA.adapterBase;
  const S = () => NA.schema;

  const STEPS = [
    { id: 'my-information', re: /my\s+information|personal\s+information/i, label: 'My Information' },
    { id: 'my-experience', re: /my\s+experience|work\s+experience/i, label: 'My Experience' },
    { id: 'questions', re: /application\s+questions?|additional\s+information/i, label: 'Application Questions' },
    { id: 'voluntary', re: /voluntary\s+disclosures?|self\s*-?\s*identify|equal\s+employment/i, label: 'Voluntary Disclosures' },
    { id: 'review', re: /review/i, label: 'Review' }
  ];

  /** Fills Workday's three-part date widget. Returns true if all parts landed. */
  async function fillSplitDate(wrapper, iso) {
    if (!wrapper || !iso) return false;
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(iso));
    if (!m) return false;
    const [, year, month, day] = m;

    const part = (kind) =>
      wrapper.querySelector(`[data-automation-id="dateSection${kind}-input"]`) ||
      wrapper.querySelector(`input[aria-label*="${kind}" i]`);

    const monthEl = part('Month');
    const dayEl = part('Day');
    const yearEl = part('Year');
    if (!monthEl && !yearEl) return false;

    let ok = true;
    if (monthEl) ok = NA.dom.setNativeValue(monthEl, month) && ok;
    if (dayEl) ok = NA.dom.setNativeValue(dayEl, day || '01') && ok;
    if (yearEl) ok = NA.dom.setNativeValue(yearEl, year) && ok;
    await NA.dom.sleep(80);
    [monthEl, dayEl, yearEl].forEach((el) => { if (el) NA.dom.markFilled(el); });
    return ok;
  }

  function dateWrapperFor(el) {
    return el.closest('[data-automation-id*="date" i], [data-automation-id="formField-startDate"], ' +
                      '[data-automation-id="formField-endDate"], .css-dateWidget') ||
           (el.parentElement && el.parentElement.closest('div'));
  }

  const overrides = B.overrideTable([
    { id: 'firstName', test: /legalNameSection_firstName|\bfirstName\b/i,
      resolve: (p) => p.identity.firstName },
    { id: 'lastName', test: /legalNameSection_lastName|\blastName\b/i,
      resolve: (p) => p.identity.lastName },
    { id: 'preferredName', test: /preferredNameSection_firstName/i,
      resolve: (p) => p.identity.preferredName || p.identity.firstName },
    { id: 'email', test: /^email$|contactInformation.*email|\bemail\b/i,
      resolve: (p) => p.identity.email },
    { id: 'phone', test: /phone-?number|phoneNumber/i,
      resolve: (p) => S().normalizePhone(p.identity.phone) },
    { id: 'phoneType', test: /phone-device-type|phoneType/i,
      resolve: () => 'Mobile' },
    { id: 'countryPhoneCode', test: /country-?phone-?code/i,
      resolve: () => 'United States of America (+1)' },
    { id: 'addr1', test: /addressSection_addressLine1/i,
      resolve: (p) => p.identity.address.street },
    { id: 'addr2', test: /addressSection_addressLine2/i,
      resolve: (p) => p.identity.address.line2 },
    { id: 'city', test: /addressSection_city/i,
      resolve: (p) => p.identity.address.city },
    { id: 'region', test: /addressSection_countryRegion|addressSection_state/i,
      resolve: (p) => S().stateName(p.identity.address.state) },
    { id: 'postal', test: /addressSection_postalCode/i,
      resolve: (p) => p.identity.address.zip },
    { id: 'country', test: /addressSection_country\b|country--country/i,
      resolve: () => 'United States of America' },

    { id: 'expCompany', test: /workExperience.*\bcompany\b|formField-company/i,
      resolve: (p, f, c) => (p.experience[c.index] || {}).employer },
    { id: 'expTitle', test: /workExperience.*jobTitle|formField-jobTitle/i,
      resolve: (p, f, c) => (p.experience[c.index] || {}).title },
    { id: 'expLocation', test: /workExperience.*\blocation\b/i,
      resolve: (p) => [p.identity.address.city, p.identity.address.state].filter(Boolean).join(', ') },
    { id: 'expCurrent', test: /currentlyWorkHere/i, kinds: ['checkbox'],
      resolve: (p, f, c) => !!(p.experience[c.index] || {}).isCurrent },
    { id: 'expDescription', test: /roleDescription|workExperience.*description/i,
      resolve: (p, f, c) => (p.experience[c.index] || {}).responsibilities },

    { id: 'eduSchool', test: /education.*\bschool\b|schoolItem|formField-school/i,
      resolve: (p, f, c) => (p.education[c.index] || {}).school },
    { id: 'eduDegree', test: /education.*\bdegree\b|formField-degree/i,
      resolve: (p, f, c) => NA.heuristics.expandDegree((p.education[c.index] || {}).degree, f) },
    { id: 'eduField', test: /fieldOfStudy|field-of-study/i,
      resolve: (p, f, c) => (p.education[c.index] || {}).major || 'Nursing' },
    { id: 'eduGpa', test: /gradeAverage|\bgpa\b/i,
      resolve: (p, f, c) => (p.education[c.index] || {}).gpa },
    { id: 'eduFirstYear', test: /firstYearAttended/i,
      resolve: (p, f, c) => {
        const e = p.education[c.index] || {};
        if (!e.graduationDate) return '';
        return String(Number(e.graduationDate.slice(0, 4)) - 2);
      } },
    { id: 'eduLastYear', test: /lastYearAttended/i,
      resolve: (p, f, c) => ((p.education[c.index] || {}).graduationDate || '').slice(0, 4) },

    { id: 'skills', test: /formField-skills|\bskillsSection\b/i,
      resolve: (p) => (p.clinicalSkills.procedures || [])[0] },
    { id: 'source', test: /formField-source|\bsourceSection\b/i,
      resolve: () => 'Company Website' },

    { id: 'gender', test: /formField-gender|personalInfoUS--gender/i,
      resolve: (p) => p.identity.gender },
    { id: 'ethnicity', test: /formField-ethnicity|personalInfoUS--ethnicity|hispanicOrLatino/i,
      resolve: (p) => p.identity.raceEthnicity },
    { id: 'veteran', test: /veteranStatus|selfIdentifiedDisabilityData--veteran/i,
      resolve: (p) => p.identity.veteranStatus },
    { id: 'disability', test: /disability|selfIdentifiedDisabilityData/i,
      resolve: (p) => p.identity.disabilityStatus }
  ]);

  NA.adapters.workday = B.defineAdapter({
    id: 'workday',
    label: 'Workday',
    containerSelector: '[data-automation-id^="workExperience-"], [data-automation-id^="education-"], ' +
                       '[data-automation-id^="licenses-"], [data-automation-id^="certification-"], ' +
                       '[data-automation-id^="reference-"]',
    comboboxOptions: { openDelay: 220, searchDelay: 420, settleDelay: 200 },

    matches(loc) {
      return /myworkdayjobs\.com|myworkdaysite\.com/i.test(loc.hostname);
    },

    detectStep(doc) {
      const active = doc.querySelector('[data-automation-id="progressBarActiveStep"], [aria-current="step"]');
      const heading = doc.querySelector('h2[data-automation-id], h1, [data-automation-id="pageHeader"]');
      const label = NA.dom.cleanText((active && active.textContent) || (heading && heading.textContent) || '');
      const hit = STEPS.find((s) => s.re.test(label));
      return hit ? { id: hit.id, label: hit.label } : (label ? { id: 'other', label } : null);
    },

    jobContext(doc, loc) {
      const ctx = B.genericJobContext(doc, loc);
      const sub = loc.hostname.split('.')[0];
      if (sub && sub !== 'www') ctx.company = B.titleCase(sub.replace(/[-_]/g, ' '));
      const title = doc.querySelector('[data-automation-id="jobPostingHeader"], h2[data-automation-id="jobTitle"]');
      if (title) ctx.role = NA.dom.cleanText(title.textContent);
      const loc2 = doc.querySelector('[data-automation-id="locations"], [data-automation-id="jobPostingLocation"]');
      if (loc2) ctx.location = NA.dom.cleanText(loc2.textContent);
      return ctx;
    },

    fieldOverride: overrides,

    /**
     * Handles the split date widget before the generic writer gets a chance to
     * mangle it. Returning null hands the field back to the normal path.
     */
    async customFill(field, value, ctx) {
      const el = field.el;
      if (!el) return null;
      const isDatePart = /dateSection(Month|Day|Year)-input/i.test(
        el.getAttribute('data-automation-id') || ''
      );
      if (!isDatePart) return null;

      // Recover the ISO value the resolver started from, not the formatted one.
      const iso = (ctx && ctx.isoValue) || toIso(value);
      if (!iso) return { ok: false, reason: 'date-unparseable' };
      const ok = await fillSplitDate(dateWrapperFor(el), iso);
      return { ok, reason: ok ? '' : 'split-date-failed' };
    }
  });

  function toIso(v) {
    const s = String(v || '');
    let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (m) return `${m[3]}-${m[1]}-${m[2]}`;
    m = /^(\d{2})\/(\d{4})$/.exec(s);
    if (m) return `${m[2]}-${m[1]}-01`;
    m = /^(\d{4})-(\d{2})(-(\d{2}))?$/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[4] || '01'}`;
    return '';
  }

  NA.adapters.workday.fillSplitDate = fillSplitDate;
})(typeof self !== 'undefined' ? self : this);
