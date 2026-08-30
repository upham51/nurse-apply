/**
 * iCIMS (icims.com).
 *
 * The application form is usually inside an iframe on the employer's own
 * domain, which is why the content script declares all_frames. Layout is table
 * based with iCIMS_* class names and field names like fields[first_name].
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});
  const B = NA.adapterBase;
  const S = () => NA.schema;

  const overrides = B.overrideTable([
    { id: 'firstName', test: /\b(first_?name|fname)\b/i, resolve: (p) => p.identity.firstName },
    { id: 'lastName', test: /\b(last_?name|lname)\b/i, resolve: (p) => p.identity.lastName },
    { id: 'middle', test: /\bmiddle_?(name|initial)\b/i, resolve: () => '' },
    { id: 'email', test: /\bemail\b/i, resolve: (p) => p.identity.email },
    { id: 'phone', test: /\b(phone|mobile|cell)\b/i, resolve: (p) => S().normalizePhone(p.identity.phone) },
    { id: 'addr1', test: /\b(address1|addressline1|street)\b/i, resolve: (p) => p.identity.address.street },
    { id: 'addr2', test: /\b(address2|addressline2)\b/i, resolve: (p) => p.identity.address.line2 },
    { id: 'city', test: /\bcity\b/i, resolve: (p) => p.identity.address.city },
    { id: 'state', test: /\b(state|province)\b/i,
      resolve: (p, f) => NA.heuristics.stateValue(p.identity.address.state, f) },
    { id: 'zip', test: /\b(zip|postal)\b/i, resolve: (p) => p.identity.address.zip },
    { id: 'source', test: /\b(source|how_did_you_hear|referral_source)\b/i,
      resolve: () => 'Company Website' }
  ]);

  NA.adapters.icims = B.defineAdapter({
    id: 'icims',
    label: 'iCIMS',
    containerSelector: '.iCIMS_TableRow, .iCIMS_InfoField, tr, fieldset',
    comboboxOptions: { openDelay: 180, searchDelay: 320, settleDelay: 150 },

    matches(loc, doc) {
      if (/icims\.com/i.test(loc.hostname)) return true;
      try {
        return !!(doc && (doc.querySelector('[class^="iCIMS_"], [id^="icims"]') ||
          doc.querySelector('form[action*="icims" i]')));
      } catch (e) { return false; }
    },

    detectStep(doc) {
      const active = doc.querySelector('.iCIMS_Breadcrumb .active, .iCIMS_StepActive, [aria-current="step"]');
      const h = doc.querySelector('.iCIMS_Header, h1, h2');
      const label = NA.dom.cleanText((active && active.textContent) || (h && h.textContent) || '');
      return label ? { id: label.toLowerCase().replace(/\W+/g, '-').slice(0, 40), label } : null;
    },

    jobContext(doc, loc) {
      const ctx = B.genericJobContext(doc, loc);
      const t = doc.querySelector('.iCIMS_JobHeader h1, .iCIMS_Header, h1');
      if (t) ctx.role = NA.dom.cleanText(t.textContent);
      const c = doc.querySelector('.iCIMS_JobsTable a, .iCIMS_Logo img[alt]');
      if (c) ctx.company = ctx.company || NA.dom.cleanText(c.getAttribute('alt') || c.textContent);
      return ctx;
    },

    fieldOverride: overrides
  });
})(typeof self !== 'undefined' ? self : this);
