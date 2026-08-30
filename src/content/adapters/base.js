/**
 * Adapter contract.
 *
 * An adapter is additive. It supplies platform-specific hints: which DOM node
 * marks a repeating block, what the current wizard step is, where the job title
 * and employer live, and direct field overrides keyed on stable platform
 * attributes. If an adapter returns nothing for a field, the mapper falls
 * through to the heuristic tier. An adapter can never block a fill.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});

  const text = (node) => (node ? NA.dom.cleanText(node.textContent) : '');

  function metaContent(doc, selectors) {
    for (let i = 0; i < selectors.length; i++) {
      const n = doc.querySelector(selectors[i]);
      if (n) {
        const v = n.getAttribute('content') || n.getAttribute('value') || text(n);
        if (v) return NA.dom.cleanText(v);
      }
    }
    return '';
  }

  /** Best-effort job context from schema.org markup, then OG tags, then title. */
  function genericJobContext(doc, loc) {
    const ctx = { company: '', role: '', location: '', url: loc.href };

    const ld = doc.querySelectorAll('script[type="application/ld+json"]');
    for (let i = 0; i < ld.length; i++) {
      try {
        const parsed = JSON.parse(ld[i].textContent);
        const nodes = Array.isArray(parsed) ? parsed : [parsed];
        for (let j = 0; j < nodes.length; j++) {
          const n = nodes[j];
          if (!n || n['@type'] !== 'JobPosting') continue;
          ctx.role = ctx.role || NA.dom.cleanText(n.title);
          if (n.hiringOrganization) {
            ctx.company = ctx.company || NA.dom.cleanText(n.hiringOrganization.name);
          }
          const jl = n.jobLocation && (Array.isArray(n.jobLocation) ? n.jobLocation[0] : n.jobLocation);
          if (jl && jl.address) {
            ctx.location = ctx.location ||
              [jl.address.addressLocality, jl.address.addressRegion].filter(Boolean).join(', ');
          }
        }
      } catch (e) { /* malformed ld+json is common, ignore */ }
    }

    ctx.role = ctx.role || metaContent(doc, ['meta[property="og:title"]', 'h1', '[data-automation-id="jobPostingHeader"]']);
    ctx.company = ctx.company || metaContent(doc, ['meta[property="og:site_name"]', 'meta[name="application-name"]']);

    if (!ctx.company) {
      const host = loc.hostname.split('.');
      ctx.company = titleCase(host[0].replace(/[-_]/g, ' '));
    }
    ctx.role = (ctx.role || doc.title || '').slice(0, 160);
    return ctx;
  }

  function titleCase(s) {
    return String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * Groups fields into repeating blocks (work experience #1, #2, ...).
   * Strategy: find the nearest ancestor shared by an anchor field (employer,
   * school, reference name, license number) and index those ancestors in
   * document order. Fields inside block N get ctx.index = N.
   */
  function assignRepeatIndexes(fields, containerSelector) {
    const groups = {
      experience: /\b(employer|company|supervisor|reason\s+for\s+leaving|job\s*title|position\s+held)\b/i,
      education: /\b(school|university|college|degree|major|gpa|graduat)\b/i,
      licenses: /\b(licen[cs]e)\b/i,
      certifications: /\b(cert\w*)\b/i,
      references: /\breference\b/i
    };

    const containers = new Map();
    fields.forEach((f) => {
      const el = f.el;
      if (!el) return;
      let container = null;
      if (containerSelector) container = el.closest(containerSelector);
      if (!container) {
        container = el.closest(
          '[data-automation-id*="Section" i], fieldset, [class*="repeat" i], ' +
          '[class*="entry" i], [class*="panel" i], [class*="card" i], section'
        );
      }
      f._container = container || null;
      Object.keys(groups).forEach((g) => {
        if (groups[g].test(f.label || '')) {
          f._group = f._group || g;
        }
      });
      if (f._group && container) {
        if (!containers.has(f._group)) containers.set(f._group, []);
        const list = containers.get(f._group);
        if (list.indexOf(container) === -1) list.push(container);
      }
    });

    // Order each group's containers by document position, then stamp indexes.
    containers.forEach((list) => {
      list.sort((a, b) => {
        const pos = a.compareDocumentPosition(b);
        return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
    });

    fields.forEach((f) => {
      if (f._group && f._container && containers.has(f._group)) {
        const idx = containers.get(f._group).indexOf(f._container);
        f.repeatIndex = idx === -1 ? 0 : idx;
      } else {
        f.repeatIndex = 0;
      }
    });
    return fields;
  }

  /** Builds a field-override lookup from a table of {test, resolve} entries. */
  function overrideTable(entries) {
    return function (field, profile, ctx) {
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const hay = [field.automationId, field.name, field.id, field.label]
          .filter(Boolean).join(' ');
        if (!e.test.test(hay)) continue;
        if (e.not && e.not.test(hay)) continue;
        if (e.kinds && e.kinds.indexOf(field.kind) === -1) continue;
        let value;
        try { value = e.resolve(profile, field, ctx); } catch (err) { value = undefined; }
        if (value === undefined || value === null || value === '') continue;
        return { ruleId: 'adapter:' + (e.id || i), value, score: 100, tier: 1 };
      }
      return null;
    };
  }

  function waitFor(fn, timeoutMs, intervalMs) {
    const deadline = Date.now() + (timeoutMs || 4000);
    return new Promise((resolve) => {
      const tick = () => {
        let v = null;
        try { v = fn(); } catch (e) { v = null; }
        if (v) return resolve(v);
        if (Date.now() > deadline) return resolve(null);
        setTimeout(tick, intervalMs || 150);
      };
      tick();
    });
  }

  const BaseAdapter = {
    id: 'generic',
    label: 'Generic form',
    containerSelector: null,
    matches: () => false,
    jobContext: (doc, loc) => genericJobContext(doc, loc),
    detectStep: () => null,
    fieldOverride: () => null,
    comboboxOptions: { openDelay: 150, searchDelay: 300, settleDelay: 120 },
    beforeFill: () => Promise.resolve(),
    afterFill: () => Promise.resolve()
  };

  function defineAdapter(spec) {
    return Object.assign({}, BaseAdapter, spec);
  }

  NA.adapters = NA.adapters || {};
  NA.adapterBase = {
    BaseAdapter, defineAdapter, genericJobContext, assignRepeatIndexes,
    overrideTable, waitFor, metaContent, text, titleCase
  };
})(typeof self !== 'undefined' ? self : this);
