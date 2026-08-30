/**
 * LinkedIn Easy Apply.
 *
 * The form lives in a modal that rebuilds between steps. Fields are generated
 * with ids like single-line-text-form-component-formElement-... so the label
 * text is the only reliable handle; this adapter mostly supplies the modal
 * scope and the job context.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});
  const B = NA.adapterBase;

  NA.adapters.linkedin = B.defineAdapter({
    id: 'linkedin',
    label: 'LinkedIn Easy Apply',
    containerSelector: '.jobs-easy-apply-form-section__grouping, fieldset',
    comboboxOptions: { openDelay: 200, searchDelay: 300, settleDelay: 150 },

    matches(loc, doc) {
      if (!/linkedin\.com/i.test(loc.hostname)) return false;
      try {
        return !!(doc && doc.querySelector(
          '.jobs-easy-apply-modal, [data-test-modal][role="dialog"], .jobs-easy-apply-content'
        ));
      } catch (e) { return false; }
    },

    scopeRoot(doc) {
      return doc.querySelector('.jobs-easy-apply-modal, [data-test-modal][role="dialog"]') || doc;
    },

    detectStep(doc) {
      const h = doc.querySelector('.jobs-easy-apply-content h3, .artdeco-modal__header h2');
      const label = NA.dom.cleanText(h && h.textContent);
      return label ? { id: label.toLowerCase().replace(/\W+/g, '-').slice(0, 40), label } : null;
    },

    jobContext(doc, loc) {
      const ctx = B.genericJobContext(doc, loc);
      const t = doc.querySelector('.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1');
      if (t) ctx.role = NA.dom.cleanText(t.textContent);
      const c = doc.querySelector('.job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name');
      if (c) ctx.company = NA.dom.cleanText(c.textContent);
      const l = doc.querySelector('.job-details-jobs-unified-top-card__bullet, .jobs-unified-top-card__bullet');
      if (l) ctx.location = NA.dom.cleanText(l.textContent);
      return ctx;
    }
  });
})(typeof self !== 'undefined' ? self : this);
