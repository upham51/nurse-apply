/**
 * symplr / HealthcareSource.
 *
 * Purpose-built healthcare hiring. Heavier on clinical screening questions than
 * on identity fields, so this adapter leans on the nursing heuristics and adds
 * the credentialing questions those portals ask by name.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});
  const B = NA.adapterBase;
  const S = () => NA.schema;

  const overrides = B.overrideTable([
    { id: 'firstName', test: /first_?name/i, resolve: (p) => p.identity.firstName },
    { id: 'lastName', test: /last_?name/i, resolve: (p) => p.identity.lastName },
    { id: 'email', test: /\bemail\b/i, resolve: (p) => p.identity.email },
    { id: 'phone', test: /\bphone\b/i, resolve: (p) => S().normalizePhone(p.identity.phone) },

    { id: 'rnLicenseNumber', test: /\b(rn|nurse|nursing)[-_ ]?licen[cs]e[-_ ]?(num|no|number)?\b/i,
      resolve: (p) => (S().primaryLicense(p) || {}).number },
    { id: 'rnLicenseState', test: /\b(rn|nurse|nursing)[-_ ]?licen[cs]e[-_ ]?state\b/i,
      resolve: (p, f) => NA.heuristics.stateValue((S().primaryLicense(p) || {}).state, f) },
    { id: 'rnLicenseExp', test: /\b(rn|nurse|nursing)[-_ ]?licen[cs]e[-_ ]?exp/i,
      resolve: (p, f) => S().formatDate((S().primaryLicense(p) || {}).expirationDate,
        NA.heuristics.dateHint(f)) },
    { id: 'yearsRn', test: /years[-_ ]?(of[-_ ])?(rn|nursing)[-_ ]?experience/i,
      resolve: (p) => String(NA.heuristics.yearsOfExperience(p) || '') },
    { id: 'emrPrimary', test: /\b(emr|ehr)\b/i,
      resolve: (p) => (p.clinicalSkills.emrSystems || [])[0] },
    { id: 'specialty', test: /\b(specialty|unit|service[-_ ]?line)\b/i,
      resolve: (p) => (S().currentJob(p) || {}).unit }
  ]);

  NA.adapters.symplr = B.defineAdapter({
    id: 'symplr',
    label: 'symplr / HealthcareSource',
    containerSelector: '.question, .form-group, fieldset, .panel',
    matches(loc) {
      return /symplr\.com|healthcaresource\.com/i.test(loc.hostname);
    },
    detectStep(doc) {
      const n = doc.querySelector('.wizard-step.active, .nav-tabs .active, h1, h2');
      const label = NA.dom.cleanText(n && n.textContent);
      return label ? { id: label.toLowerCase().replace(/\W+/g, '-').slice(0, 40), label } : null;
    },
    fieldOverride: overrides
  });
})(typeof self !== 'undefined' ? self : this);
