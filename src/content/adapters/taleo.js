/**
 * Oracle Taleo (taleo.net).
 *
 * Legacy Oracle ADF. Tab navigation, ids of the form
 * "pageXXXform:pageXXXcontent:...", and dropdowns that are anchors driving a
 * hidden select. Everything is inside an iframe more often than not.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});
  const B = NA.adapterBase;
  const S = () => NA.schema;

  const overrides = B.overrideTable([
    { id: 'firstName', test: /firstName|givenName|\bfname\b/i, resolve: (p) => p.identity.firstName },
    { id: 'lastName', test: /lastName|\bsurname\b|\blname\b/i, resolve: (p) => p.identity.lastName },
    { id: 'email', test: /emailAddress|\bemail\b/i, resolve: (p) => p.identity.email },
    { id: 'phone', test: /(cellPhone|homePhone|phoneNumber|\bphone\b)/i,
      resolve: (p) => S().normalizePhone(p.identity.phone) },
    { id: 'address', test: /address(Line)?1|\bstreet\b/i, resolve: (p) => p.identity.address.street },
    { id: 'city', test: /\bcity\b/i, resolve: (p) => p.identity.address.city },
    { id: 'state', test: /\b(state|province)\b/i,
      resolve: (p, f) => NA.heuristics.stateValue(p.identity.address.state, f) },
    { id: 'zip', test: /zipCode|postalCode/i, resolve: (p) => p.identity.address.zip }
  ]);

  NA.adapters.taleo = B.defineAdapter({
    id: 'taleo',
    label: 'Taleo',
    containerSelector: '.editablesection, .mastercontent, fieldset, tr',
    comboboxOptions: { openDelay: 250, searchDelay: 350, settleDelay: 220 },

    matches(loc, doc) {
      if (/taleo\.net/i.test(loc.hostname)) return true;
      try {
        return !!(doc && doc.querySelector('[id*="taleo" i], form[id^="page"][id*="form"]'));
      } catch (e) { return false; }
    },

    detectStep(doc) {
      const active = doc.querySelector('.progressbar .current, .stepstatus.current, li.selected a');
      const label = NA.dom.cleanText(active && active.textContent);
      return label ? { id: label.toLowerCase().replace(/\W+/g, '-').slice(0, 40), label } : null;
    },

    fieldOverride: overrides,

    /**
     * Taleo renders a link that toggles a list and mirrors the choice into a
     * hidden <select>. Setting the select alone does not update the visible
     * label, so drive the visible widget and fall back to the select.
     */
    async customFill(field, value) {
      const el = field.el;
      if (!el) return null;
      const isTaleoDropdown = el.classList &&
        (el.classList.contains('dropDownButton') || el.getAttribute('role') === 'button') &&
        el.getAttribute('aria-haspopup');
      if (!isTaleoDropdown) return null;
      const ok = await NA.dom.selectCustomCombobox(el, String(value), { openDelay: 250, searchDelay: 350 });
      return { ok, reason: ok ? '' : 'taleo-dropdown-failed' };
    }
  });
})(typeof self !== 'undefined' ? self : this);
