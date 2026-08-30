/**
 * Chrome's built-in on-device model, used silently when it happens to be there.
 *
 * Chrome 138 and later expose `LanguageModel` to extensions. It runs Gemini
 * Nano locally: no API key, no account, no network, and nothing about the
 * resume leaves the machine. It is not universally available, since it wants
 * roughly 22 GB of free disk and either a GPU with more than 4 GB of VRAM or
 * 16 GB of RAM, so every entry point here is written to fail quietly and let
 * the caller carry on with the deterministic parser.
 *
 * Deliberately never advertised in the UI. A nurse on a five-year-old laptop
 * should not be shown a feature she cannot have.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});

  const api = () => (typeof root.LanguageModel !== 'undefined' ? root.LanguageModel : null);

  /**
   * Returns 'available', 'downloadable', 'downloading' or 'unavailable'.
   * Never throws.
   */
  async function availability() {
    const lm = api();
    if (!lm || typeof lm.availability !== 'function') return 'unavailable';
    try { return await lm.availability(); } catch (e) { return 'unavailable'; }
  }

  /** True only when the model can answer right now without a download. */
  async function ready() {
    return (await availability()) === 'available';
  }

  async function createSession(opts) {
    const lm = api();
    if (!lm) return null;
    try {
      return await lm.create(Object.assign({
        initialPrompts: [{
          role: 'system',
          content:
            'You extract structured data from nursing resumes. You answer with JSON only. ' +
            'You never invent a value that is not present in the text: a licence number, an ' +
            'expiration date, an NPI or a graduation date that the document does not state ' +
            'must be left as an empty string.'
        }]
      }, opts || {}));
    } catch (e) {
      return null;
    }
  }

  /**
   * Asks the local model to correct the employer/title split for the roles the
   * parser was least sure about. It is given the source lines and returns an
   * index into them, never free text, so it cannot invent an employer.
   */
  async function refineRoles(roles, sources, opts) {
    if (!roles.length || !(await ready())) return null;
    const session = await createSession();
    if (!session) return null;

    const out = [];
    try {
      for (let i = 0; i < roles.length; i++) {
        const src = sources[i];
        if (!src || !src.lines.length) { out.push(null); continue; }
        const lines = src.lines.slice(0, 6);
        const prompt =
          'These lines come from one job on a nursing resume:\n' +
          lines.map((l, n) => n + ': ' + l.slice(0, 160)).join('\n') +
          '\n\nWhich line number holds the EMPLOYER name, and which holds the JOB TITLE? ' +
          'Answer with JSON only, in the form {"employer": <number or null>, "title": <number or null>}. ' +
          'Use null when no line holds it. Do not answer with text from the lines.';

        let raw = '';
        try { raw = await session.prompt(prompt); } catch (e) { out.push(null); continue; }
        const parsed = extractJson(raw);
        if (!parsed) { out.push(null); continue; }

        const pick = (n) => (Number.isInteger(n) && n >= 0 && n < lines.length ? lines[n] : '');
        out.push({ employer: pick(parsed.employer), title: pick(parsed.title) });
        if (opts && opts.onProgress) opts.onProgress(i + 1, roles.length);
      }
    } finally {
      try { session.destroy(); } catch (e) { /* noop */ }
    }
    return out;
  }

  function extractJson(text) {
    if (!text) return null;
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const candidate = fenced ? fenced[1] : text;
    try { return JSON.parse(candidate); } catch (e) { /* keep digging */ }
    const start = candidate.search(/[[{]/);
    if (start === -1) return null;
    const closer = candidate[start] === '[' ? ']' : '}';
    const end = candidate.lastIndexOf(closer);
    if (end <= start) return null;
    try { return JSON.parse(candidate.slice(start, end + 1)); } catch (e) { return null; }
  }

  NA.localModel = { availability, ready, createSession, refineRoles, extractJson };
})(typeof self !== 'undefined' ? self : this);
