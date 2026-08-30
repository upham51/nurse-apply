/** Indeed Apply. Single-question-per-screen wizard on smartapply.indeed.com. */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});
  const B = NA.adapterBase;
  const S = () => NA.schema;

  const overrides = B.overrideTable([
    { id: 'name', test: /input-applicant\.name|\bapplicant\.name\b/i, resolve: (p) => S().fullName(p) },
    { id: 'firstName', test: /applicant\.firstName/i, resolve: (p) => p.identity.firstName },
    { id: 'lastName', test: /applicant\.lastName/i, resolve: (p) => p.identity.lastName },
    { id: 'email', test: /applicant\.email/i, resolve: (p) => p.identity.email },
    { id: 'phone', test: /applicant\.phoneNumber/i, resolve: (p) => S().normalizePhone(p.identity.phone) },
    { id: 'city', test: /applicant\.location\.city/i, resolve: (p) => p.identity.address.city }
  ]);

  NA.adapters.indeed = B.defineAdapter({
    id: 'indeed',
    label: 'Indeed Apply',
    containerSelector: '.ia-Questions-item, fieldset, .css-Question',
    matches(loc) { return /indeed\.com/i.test(loc.hostname); },
    detectStep(doc) {
      const h = doc.querySelector('h1, [data-testid="page-header"]');
      const label = NA.dom.cleanText(h && h.textContent);
      return label ? { id: label.toLowerCase().replace(/\W+/g, '-').slice(0, 40), label } : null;
    },
    jobContext(doc, loc) {
      const ctx = B.genericJobContext(doc, loc);
      const t = doc.querySelector('[data-testid="jobsearch-JobInfoHeader-title"], h1');
      if (t) ctx.role = NA.dom.cleanText(t.textContent);
      const c = doc.querySelector('[data-testid="inlineHeader-companyName"], [data-company-name]');
      if (c) ctx.company = NA.dom.cleanText(c.textContent);
      return ctx;
    },
    fieldOverride: overrides
  });
})(typeof self !== 'undefined' ? self : this);
