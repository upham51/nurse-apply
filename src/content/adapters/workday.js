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

    if (monthEl) NA.dom.setNativeValue(monthEl, month);
    if (dayEl) NA.dom.setNativeValue(dayEl, day || '01');
    if (yearEl) NA.dom.setNativeValue(yearEl, year);
    await NA.dom.sleep(120);
    // Workday stores "03" as "3", so compare as numbers, not as strings. The
    // old string comparison reported a success as a failure.
    const same = (el, want) => !el || Number(el.value) === Number(want);
    const ok = same(monthEl, month) && same(dayEl, day || '01') && same(yearEl, year);
    [monthEl, dayEl, yearEl].forEach((el) => { if (el) NA.dom.markFilled(el); });
    return ok;
  }

  function dateWrapperFor(el) {
    // The spinbuttons themselves carry data-automation-id="dateSection...", which
    // matched the selector below and made the wrapper the input itself, so the
    // month and year boxes were never found.
    const group = el.closest('[data-automation-id="dateInputWrapper"], [role="group"][id*="Date"]');
    if (group) return group;
    return el.closest('[data-automation-id*="date" i], [data-automation-id="formField-startDate"], ' +
                      '[data-automation-id="formField-endDate"], .css-dateWidget') ||
           (el.parentElement && el.parentElement.closest('div'));
  }

  /**
   * Workday's degree list is Degree in Progress, Diploma, Certificate,
   * Associate, Bachelor's, Master's, Juris Doctor, Doctorate, Medical Doctorate.
   * A profile says BSN or ADN, which matches none of them.
   */
  function workdayDegree(raw) {
    const d = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!d) return '';
    if (/^(adn|asn|aas|as|aa|associate\w*)$/.test(d)) return 'Associate';
    if (/^(bsn|bs|ba|bsc|bachelor\w*)$/.test(d)) return "Bachelor's";
    if (/^(msn|ms|ma|mba|mph|msc|master\w*)$/.test(d)) return "Master's";
    if (/^(dnp|phd|edd|dns|doctor\w*)$/.test(d)) return 'Doctorate';
    if (/^(md|doctorofmedicine|medicaldoctor\w*)$/.test(d)) return 'Medical Doctorate';
    if (/^(jd|jurisdoctor)$/.test(d)) return 'Juris Doctor';
    if (/^diploma|^ged|^highschool/.test(d)) return 'Diploma';
    if (/^certificate/.test(d)) return 'Certificate';
    return '';
  }

  /**
   * School and Field of Study are search boxes: the value only counts once a
   * result is chosen from the list, and Workday ignores scripted clicks and
   * arrow keys on that list. So type the search, press Enter so the matches
   * appear, and hand the final pick to the person rather than claiming a fill.
   */
  async function typeSearchBox(el, text) {
    el.focus();
    try { el.select(); } catch (e) { /* ignore */ }
    const ok = document.execCommand('insertText', false, String(text));
    if (!ok) NA.dom.setNativeValue(el, String(text));
    await NA.dom.sleep(400);
    ['keydown', 'keypress', 'keyup'].forEach((t) => el.dispatchEvent(new KeyboardEvent(t,
      { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })));
    await NA.dom.sleep(900);
  }

  const overrides = B.overrideTable([
    { id: 'firstName', test: /legalNameSection_firstName|\bfirstName\b/i,
      resolve: (p) => p.identity.firstName },
    { id: 'lastName', test: /legalNameSection_lastName|\blastName\b/i,
      resolve: (p) => p.identity.lastName },
    { id: 'middleName', test: /\bmiddleName\b/i, resolve: () => '' },
    { id: 'prefix', test: /legalName--title\b/i, resolve: () => '' },
    { id: 'suffix', test: /legalName--social\b/i, resolve: () => '' },
    { id: 'preferredName', test: /preferredNameSection_firstName/i,
      resolve: (p) => p.identity.preferredName || p.identity.firstName },
    { id: 'email', test: /^email$|contactInformation.*email|\bemail\b/i,
      resolve: (p) => p.identity.email },
    // Order matters, and so do the exclusions. Workday's phone block is four
    // fields whose identifiers all contain "phoneNumber":
    // phoneNumber--countryPhoneCode, phoneNumber--phoneType,
    // phoneNumber--phoneNumber and phoneNumber--extension. A single loose
    // phone rule put the full number into the country code and the extension.
    { id: 'countryPhoneCode', test: /country-?phone-?code/i,
      resolve: () => 'United States of America (+1)' },
    { id: 'phoneExtension', test: /(^|--|\b)extension\b/i, resolve: () => '' },
    { id: 'phoneType', test: /phone-device-type|(^|--|\b)phoneType\b/i,
      resolve: () => 'Mobile' },
    { id: 'phone', test: /phone-?number/i,
      not: /country-?phone-?code|extension|phone-?type|device-?type/i,
      resolve: (p) => S().normalizePhone(p.identity.phone) },
    // Tenants differ: older builds emit addressSection_city, newer ones put
    // formField-city on the wrapper. Match both.
    { id: 'addr1', test: /addressSection_addressLine1|\baddressLine1\b/i,
      resolve: (p) => p.identity.address.street },
    { id: 'addr2', test: /addressSection_addressLine2|\baddressLine2\b/i,
      resolve: (p) => p.identity.address.line2 },
    { id: 'city', test: /addressSection_city|(?:^|[^a-z])city(?:$|[^a-z])/i,
      resolve: (p) => p.identity.address.city },
    { id: 'region', test: /addressSection_countryRegion|addressSection_state|\bcountryRegion\b/i,
      resolve: (p) => S().stateName(p.identity.address.state) },
    { id: 'postal', test: /addressSection_postalCode|\bpostalCode\b/i,
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
      resolve: (p, f, c) => workdayDegree((p.education[c.index] || {}).degree) ||
        NA.heuristics.expandDegree((p.education[c.index] || {}).degree, f) },
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

    /**
     * Confine everything to the application itself. The page chrome carries
     * its own controls, and the signed-in account menu was being collected as
     * a field on every step.
     */
    scopeRoot(doc) {
      return doc.querySelector('[data-automation-id="applyFlowPage"]') ||
             doc.querySelector('[data-automation-id="jobApplyForm"]') ||
             doc.querySelector('form') || doc;
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
     * Workday's experience page opens with no job or school entries, only Add
     * buttons, so there is nothing to fill until entries exist. Press Add until
     * there is one entry per item in the profile. Entries that are already on
     * the page, blank or not, count toward that, so this never piles up extras.
     */
    async prepare(doc, profile) {
      const SECTIONS = [
        { re: /^workExperience-(\d+)--/, heading: /work\s+experience/i,
          want: Math.min(((profile || {}).experience || []).length, 4) },
        { re: /^education-(\d+)--/, heading: /^\s*education/i,
          want: Math.min(((profile || {}).education || []).length, 2) }
      ];
      const page = doc.querySelector('[data-automation-id="applyFlowPage"]') || doc;
      const count = (re) => {
        const seen = new Set();
        page.querySelectorAll('input[id], button[id], textarea[id]').forEach((el) => {
          const m = re.exec(el.id);
          if (m) seen.add(m[1]);
        });
        return seen.size;
      };
      const buttonFor = (heading) => {
        const heads = Array.from(page.querySelectorAll('h1, h2, h3, h4, h5'))
          .filter((h) => heading.test(h.textContent || ''));
        if (!heads.length) return null;
        const head = heads[0];
        const buttons = Array.from(page.querySelectorAll('[data-automation-id="add-button"]'))
          .filter((b) => head.compareDocumentPosition(b) & 4);   // follows the heading
        return buttons[0] || null;
      };

      let pressed = 0;
      for (const sec of SECTIONS) {
        for (let guard = 0; guard < 6 && count(sec.re) < sec.want; guard++) {
          const btn = buttonFor(sec.heading);
          if (!btn) break;
          const before = count(sec.re);
          btn.click();
          pressed++;
          await B.waitFor(() => count(sec.re) > before, 2500, 100);
          await NA.dom.sleep(150);
        }
      }
      return pressed;
    },

    /**
     * Handles the split date widget before the generic writer gets a chance to
     * mangle it. Returning null hands the field back to the normal path.
     */
    async customFill(field, value, ctx) {
      const el = field.el;
      if (!el) return null;
      if (/^education-\d+--(school|fieldOfStudy)$/i.test(el.id || '')) {
        await typeSearchBox(el, value);
        return { ok: false, reason: 'pick-from-list' };
      }
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
