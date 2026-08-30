/**
 * Autopilot: fill the leftovers with a model.
 *
 * The rule engine is exact and free, so it goes first and handles the fields it
 * knows. Autopilot exists for everything else, which on a real application is
 * most of it: the questions each hospital invents, the dropdowns whose options
 * no rule table anticipated, the free-text boxes.
 *
 * Two invariants, both enforced here rather than trusted to the model:
 *
 *  1. Anything the knockout guard blocks is never sent and never filled. The
 *     model does not get the chance to answer a question about discipline,
 *     termination, criminal history or exclusions.
 *  2. For a control with a fixed set of options, a returned value that is not
 *     one of those options is discarded rather than typed in.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});

  const SYSTEM = [
    'You fill in nursing job application forms from a nurse\'s stored profile.',
    '',
    'Reply with a single JSON object mapping field id to the value to enter.',
    'JSON only, no explanation.',
    '',
    'Rules:',
    '1. Where a field lists options, the value MUST be exactly one of them,',
    '   copied character for character. Never invent an option.',
    '2. Omit a field entirely when the profile does not answer it. A missing',
    '   answer is correct; a guessed one is not. Never invent a licence number,',
    '   a date, an employer, a certification or a number of years.',
    '3. Dates use the format shown on the field.',
    '4. A yes/no question maps to whichever option matches the profile.',
    '5. Free-text answers must be built from the profile\'s own wording. Do not',
    '   write marketing prose and do not claim experience it does not list.',
    '6. If a question asks about wrongdoing, discipline, termination, criminal',
    '   history, exclusion from federal programmes, malpractice or drug testing',
    '   history, omit it. Those are never yours to answer.'
  ].join('\n');

  /** What the model is allowed to see about one control. */
  function describeField(field) {
    const out = {
      id: field.naId,
      type: field.kind,
      label: (field.label || '').split(' | ').slice(0, 2).join(' — ').slice(0, 180)
    };
    const options = (field.options || []).filter(Boolean).slice(0, 40);
    if (options.length) out.options = options;
    if (field.required) out.required = true;

    const el = field.el;
    if (el) {
      if (el.type === 'date') out.format = 'YYYY-MM-DD';
      else if (el.type === 'month') out.format = 'YYYY-MM';
      else {
        const hint = el.getAttribute && el.getAttribute('placeholder');
        if (hint && /y{2,4}|m{2}|d{2}/i.test(hint)) out.format = hint;
      }
      if (el.maxLength && el.maxLength > 0 && el.maxLength < 200) out.maxLength = el.maxLength;
    }
    return out;
  }

  /**
   * The profile, trimmed to what a form could plausibly ask for. The resume
   * text and the base64 file are stripped: they are large, and nothing on a
   * form is answered from them that is not already structured elsewhere.
   */
  function payloadProfile(profile) {
    const clone = JSON.parse(JSON.stringify(profile || {}));
    if (clone.documents) {
      delete clone.documents.resumeBase64;
      delete clone.documents.resumeText;
    }
    delete clone.schemaVersion;
    return clone;
  }

  function extractJson(text) {
    if (!text) return null;
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const candidate = fenced ? fenced[1] : text;
    try { return JSON.parse(candidate.trim()); } catch (e) { /* keep digging */ }
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { return JSON.parse(candidate.slice(start, end + 1)); } catch (e) { return null; }
  }

  /**
   * A value for a control with fixed options has to BE one of those options.
   * Small models paraphrase, so an exact match is tried first and a close one
   * second; anything further away is dropped rather than typed.
   */
  function validate(field, value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') {
      value = value ? 'Yes' : 'No';
    }
    const text = String(value).trim();
    if (!text || /^(n\/?a|none|unknown|null|undefined)$/i.test(text)) return null;

    const options = (field.options || []).filter(Boolean);
    if (!options.length) return text;

    const exact = options.find((o) => o === text);
    if (exact) return exact;
    const insensitive = options.find((o) => o.toLowerCase() === text.toLowerCase());
    if (insensitive) return insensitive;

    const best = NA.dom.bestMatch(options.map((o) => ({ text: o })), text, 0.72);
    return best ? best.match.text : null;
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {
            return resolve({ ok: false, error: chrome.runtime.lastError.message });
          }
          resolve(res || { ok: false, error: 'No response from the extension.' });
        });
      } catch (e) { resolve({ ok: false, error: e.message }); }
    });
  }

  /**
   * plan() has already decided what the rules can do. Everything it left as
   * unresolved, and every field it could only suggest, is offered to the model.
   * Blocked attestations are excluded by construction: they are never in this
   * list, because plan() marks them 'skip' with reason 'knockout'.
   */
  function candidates(planItems) {
    return planItems.filter((item) => {
      if (item.action === 'unresolved') return true;
      if (item.action === 'suggest') return true;
      // A freeform question with no saved cover-letter template ends up as a
      // plain skip, which meant "why do you want to work here" was never even
      // offered to the model. That question is the whole reason autopilot
      // exists, so it belongs here.
      if (item.action === 'skip' && item.reason === 'essay') return true;
      return false;
    }).map((item) => item.field)
      .filter((f) => f && f.el && !NA.dom.hasUserContent(f.el))
      .filter((f) => NA.knockout.classify(f.label).action !== 'block');
  }

  /**
   * Asks the model for values and applies the ones that survive validation.
   * Returns {filled, offered, error}.
   */
  async function run(planItems, profile, opts) {
    const fields = candidates(planItems);
    if (!fields.length) return { filled: [], offered: 0 };

    const batches = [];
    const size = (opts && opts.batchSize) || 18;
    for (let i = 0; i < fields.length; i += size) batches.push(fields.slice(i, i + size));

    const filled = [];
    let error = '';

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const res = await send({
        type: 'llm:fillStep',
        profile: payloadProfile(profile),
        fields: batch.map(describeField),
        context: NA.pageContext || {}
      });

      if (!res.ok) { error = res.error || 'The model could not be reached.'; break; }

      const answers = extractJson(res.text);
      if (!answers || typeof answers !== 'object') continue;

      for (let i = 0; i < batch.length; i++) {
        const field = batch[i];
        const value = validate(field, answers[field.naId]);
        if (value === null) continue;
        const outcome = await NA.dom.applyValue(field, value, opts && opts.comboOptions);
        if (outcome.ok) {
          filled.push({ naId: field.naId, label: (field.label || '').split(' | ')[0], value });
        }
        await NA.dom.sleep(field.kind === 'combobox' ? 60 : 15);
      }
      if (opts && opts.onProgress) opts.onProgress(filled.length, fields.length);
    }

    return { filled, offered: fields.length, error };
  }

  NA.autopilot = { run, candidates, describeField, validate, extractJson, payloadProfile, SYSTEM };
})(typeof self !== 'undefined' ? self : this);
