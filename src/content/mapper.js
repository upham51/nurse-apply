/**
 * Resolution engine.
 *
 * Tier 1  adapter override, keyed on a stable platform attribute
 * Tier 2  heuristic regex rules over the resolved label
 * Tier 3  model-assisted mapping, metadata only, cached per form layout
 *
 * The knockout guard sits in front of all three. Nothing that looks like a
 * legal attestation is ever filled, whatever tier claims to know the answer.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});

  /** Canonical keys the model is allowed to return: the heuristic rule ids. */
  function allowedKeys() {
    return NA.heuristics.RULES.map((r) => r.id);
  }

  function ruleById(id) {
    return NA.heuristics.RULES.find((r) => r.id === id) || null;
  }

  /** Stable across page loads, unlike the per-session naId. */
  function fieldSignature(f) {
    const basis = f.kind + '::' + (f.automationId || f.name || f.id || f.label || '').slice(0, 120);
    let h = 5381;
    for (let i = 0; i < basis.length; i++) h = ((h << 5) + h + basis.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function scopeRoot(adapter, doc) {
    if (adapter && typeof adapter.scopeRoot === 'function') {
      try { return adapter.scopeRoot(doc) || doc; } catch (e) { return doc; }
    }
    return doc;
  }

  /** Collects and annotates every fillable field in this frame. */
  function scan(adapter, doc) {
    const rootNode = scopeRoot(adapter, doc || document);
    const fields = NA.dom.collectFields(rootNode);
    NA.adapterBase.assignRepeatIndexes(fields, adapter && adapter.containerSelector);
    fields.forEach((f) => { f.signature = fieldSignature(f); });
    return fields;
  }

  /**
   * Decides what to do with every field without touching the page.
   * Returns { plan: [...], unresolved: [...] }.
   */
  function plan(fields, profile, settings, adapter) {
    const out = [];
    const unresolved = [];

    fields.forEach((field) => {
      if (field.userContent) {
        out.push({ field, action: 'skip', reason: 'user-typed',
          note: 'You already typed something here.' });
        return;
      }
      if (field.filled) {
        out.push({ field, action: 'skip', reason: 'already-filled', silent: true });
        return;
      }

      const verdict = NA.knockout.classify(field.label);

      if (verdict.action === 'block') {
        out.push({ field, action: 'skip', reason: 'knockout',
          family: verdict.family, note: verdict.reason });
        return;
      }

      if (verdict.action === 'allow') {
        const answer = NA.knockout.answerAttestation(verdict.key, profile);
        if (answer === undefined) {
          out.push({ field, action: 'skip', reason: 'no-profile-answer',
            note: 'Set this in your NurseApply profile and it will fill next time.' });
          return;
        }
        out.push({
          field, action: 'fill', tier: 1, ruleId: 'attestation:' + verdict.key,
          value: NA.heuristics.boolValue(answer, field)
        });
        return;
      }

      const ctx = {
        index: field.repeatIndex || 0,
        fillDemographics: settings.fillDemographics !== false
      };

      let hit = null;
      if (adapter && typeof adapter.fieldOverride === 'function') {
        try { hit = adapter.fieldOverride(field, profile, ctx); } catch (e) { hit = null; }
      }
      if (!hit) hit = NA.heuristics.matchField(field, profile, ctx);

      if (hit) {
        if (verdict.action === 'essay' && hit.essay !== true && verdict.family !== 'compensation') {
          // A rule matched an essay prompt; offer it rather than committing.
          out.push({ field, action: 'suggest', reason: 'essay', family: verdict.family,
            value: hit.value, note: 'Freeform question. Review before inserting.' });
          return;
        }
        out.push({ field, action: 'fill', tier: hit.tier || 2, ruleId: hit.ruleId,
          value: hit.value, isoValue: isoBehind(hit) });
        return;
      }

      if (verdict.action === 'essay') {
        const suggestion = essaySuggestion(verdict.family, profile);
        out.push({ field, action: suggestion ? 'suggest' : 'skip',
          reason: 'essay', family: verdict.family, value: suggestion,
          note: suggestion ? 'Draft only. Read it before you use it.' : 'Freeform question, needs your words.' });
        return;
      }

      out.push({ field, action: 'unresolved', reason: 'no-match' });
      unresolved.push(field);
    });

    return { plan: out, unresolved };
  }

  function isoBehind(hit) {
    const v = String(hit.value || '');
    let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
    if (m) return `${m[3]}-${m[1]}-${m[2]}`;
    m = /^(\d{2})\/(\d{4})$/.exec(v);
    if (m) return `${m[2]}-${m[1]}-01`;
    if (/^\d{4}-\d{2}(-\d{2})?$/.test(v)) return v.length === 7 ? v + '-01' : v;
    return '';
  }

  function essaySuggestion(family, profile) {
    if (family === 'cover-letter' || family === 'motivation') {
      return NA.schema.renderCoverLetter(profile, NA.pageContext || {});
    }
    if (family === 'compensation') {
      const rate = ((profile || {}).preferences || {}).minHourlyRate;
      return rate ? String(rate) : '';
    }
    if (family === 'referral') return 'Company website';
    return '';
  }

  /* ------------------------------------------------------------- tier 3 */

  /**
   * Asks the model to map leftover fields to canonical profile keys.
   * The payload is form structure only: label, control type, options. No value
   * from the profile is ever included, and the model never returns user data,
   * only a key name that this file resolves locally.
   */
  async function resolveWithModel(unresolved, hostname, settings) {
    if (!settings.enableLlmFallback || !settings.apiKey) return {};
    if (!unresolved.length) return {};

    const payload = unresolved.map(NA.dom.serializeField);
    const fingerprint = NA.dom.fingerprintForm(unresolved);

    const cached = await sendMessage({
      type: 'cache:get', hostname, fingerprint
    });
    if (cached && cached.mapping) return applyCachedMapping(cached.mapping, unresolved);

    const res = await sendMessage({
      type: 'llm:mapFields',
      hostname,
      fingerprint,
      fields: payload,
      allowedKeys: allowedKeys()
    });

    if (!res || !res.ok) return {};
    const mapping = res.mapping || {};
    return applyCachedMapping(mapping, unresolved);
  }

  /** mapping is { fieldSignature: ruleId }. Values are resolved here, locally. */
  function applyCachedMapping(mapping, fields) {
    const result = {};
    fields.forEach((f) => {
      const ruleId = mapping[f.signature];
      if (!ruleId) return;
      const rule = ruleById(ruleId);
      if (!rule) return;
      let value;
      try {
        value = rule.resolve(NA.currentProfile, f, { index: f.repeatIndex || 0 });
      } catch (e) { value = undefined; }
      if (value === undefined || value === null || value === '') return;
      result[f.naId] = { value, ruleId, tier: 3 };
    });
    return result;
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res);
        });
      } catch (e) { resolve(null); }
    });
  }

  /* --------------------------------------------------------------- fill */

  /**
   * Executes a plan. Sequential on purpose: comboboxes open popups, and two
   * open popups at once is how you end up selecting Alaska for everything.
   */
  async function execute(planItems, profile, settings, adapter, onProgress) {
    const results = { filled: [], skipped: [], suggested: [], total: planItems.length };
    const comboOpts = (adapter && adapter.comboboxOptions) || {};

    for (let i = 0; i < planItems.length; i++) {
      const item = planItems[i];

      if (item.action === 'suggest') {
        results.suggested.push(describe(item));
        NA.dom.markSkipped(item.field.el);
        if (onProgress) onProgress(results);
        continue;
      }
      if (item.action === 'skip' || item.action === 'unresolved') {
        if (!item.silent) {
          results.skipped.push(describe(item));
          if (item.reason === 'knockout' || item.reason === 'no-profile-answer') {
            NA.dom.markSkipped(item.field.el);
          }
          if (onProgress) onProgress(results);
        }
        continue;
      }

      const opts = Object.assign({}, comboOpts, {
        fileName: profile.documents.resumeFileName,
        base64: profile.documents.resumeBase64,
        mimeType: profile.documents.resumeMimeType,
        isoValue: item.isoValue
      });

      let outcome = null;
      if (adapter && typeof adapter.customFill === 'function') {
        try { outcome = await adapter.customFill(item.field, item.value, opts); }
        catch (e) { outcome = null; }
      }
      if (!outcome) {
        outcome = await NA.dom.applyValue(item.field, item.value, opts);
      }

      if (outcome.ok) {
        results.filled.push(describe(item));
      } else {
        results.skipped.push(describe(item, outcome.reason));
        NA.dom.markSkipped(item.field.el);
      }

      if (onProgress) onProgress(results);
      // A short yield keeps React's scheduler from batching our writes away.
      await NA.dom.sleep(item.field.kind === 'combobox' ? 60 : 15);
    }
    return results;
  }

  function describe(item, overrideReason) {
    return {
      naId: item.field.naId,
      label: (item.field.label || '').split(' | ')[0].slice(0, 120) || '(unlabelled field)',
      kind: item.field.kind,
      required: !!item.field.required,
      reason: overrideReason || item.reason || '',
      family: item.family || '',
      note: item.note || '',
      tier: item.tier || 0,
      ruleId: item.ruleId || '',
      value: item.action === 'suggest' ? item.value : undefined
    };
  }

  NA.mapper = {
    scan, plan, execute, resolveWithModel, applyCachedMapping,
    allowedKeys, ruleById, fieldSignature, essaySuggestion
  };
})(typeof self !== 'undefined' ? self : this);
