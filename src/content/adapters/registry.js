/** Picks the adapter for the current frame. Order matters: most specific first. */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});

  const ORDER = ['workday', 'icims', 'taleo', 'successfactors', 'symplr', 'linkedin', 'indeed'];

  function pick(loc, doc) {
    for (let i = 0; i < ORDER.length; i++) {
      const a = NA.adapters[ORDER[i]];
      if (!a) continue;
      let hit = false;
      try { hit = a.matches(loc, doc); } catch (e) { hit = false; }
      if (hit) return a;
    }
    return NA.adapterBase.BaseAdapter;
  }

  NA.adapterRegistry = { ORDER, pick };
})(typeof self !== 'undefined' ? self : this);
