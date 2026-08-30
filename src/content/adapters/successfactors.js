/** SAP SuccessFactors Recruiting. UI5 controls, ids like __xmlview0--firstName. */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});
  const B = NA.adapterBase;
  const S = () => NA.schema;

  const overrides = B.overrideTable([
    { id: 'firstName', test: /firstName|first_?name/i, resolve: (p) => p.identity.firstName },
    { id: 'lastName', test: /lastName|last_?name/i, resolve: (p) => p.identity.lastName },
    { id: 'email', test: /\bemail\b/i, resolve: (p) => p.identity.email },
    { id: 'phone', test: /\b(cellPhone|phone|contactNumber)\b/i,
      resolve: (p) => S().normalizePhone(p.identity.phone) },
    { id: 'address', test: /\b(address1|street)\b/i, resolve: (p) => p.identity.address.street },
    { id: 'city', test: /\bcity\b/i, resolve: (p) => p.identity.address.city },
    { id: 'state', test: /\bstate\b/i,
      resolve: (p, f) => NA.heuristics.stateValue(p.identity.address.state, f) },
    { id: 'zip', test: /\b(zip|postalCode)\b/i, resolve: (p) => p.identity.address.zip }
  ]);

  NA.adapters.successfactors = B.defineAdapter({
    id: 'successfactors',
    label: 'SuccessFactors',
    containerSelector: '.sapMPanel, .sapUiForm, fieldset',
    matches(loc, doc) {
      if (/successfactors\.(com|eu)/i.test(loc.hostname)) return true;
      try { return !!(doc && doc.querySelector('[data-sap-ui], [id^="__xmlview"]')); } catch (e) { return false; }
    },
    detectStep(doc) {
      const n = doc.querySelector('.sapMWizardStepTitle, .sapMITBSelected, h1');
      const label = NA.dom.cleanText(n && n.textContent);
      return label ? { id: label.toLowerCase().replace(/\W+/g, '-').slice(0, 40), label } : null;
    },
    fieldOverride: overrides
  });
})(typeof self !== 'undefined' ? self : this);
