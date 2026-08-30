/**
 * Content orchestrator.
 *
 * Runs in every frame (all_frames), because iCIMS and Taleo put the actual
 * application inside an iframe. Only the top frame draws the HUD; child frames
 * do their own scanning and report results up through the service worker.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});

  const isTop = (function () {
    try { return window.top === window.self; } catch (e) { return false; }
  })();

  /**
   * Which frame draws the pill.
   *
   * Normally the top one. But hospitals routinely put an iCIMS or Taleo
   * application in an iframe on their own careers domain, which the manifest
   * does not match, so the top frame gets no content script at all. Before
   * this, the iframe was filled-capable and silent, and the page looked
   * completely dead. A child frame now asks the top frame whether it has a
   * pill, and draws its own when nothing answers.
   */
  let ownsHud = false;
  const PING = 'nurseapply:hud-present?';
  const PONG = 'nurseapply:hud-present!';

  window.addEventListener('message', (e) => {
    if (e.data === PING && isTop) {
      try { e.source.postMessage(PONG, '*'); } catch (err) { /* noop */ }
    }
  });

  function topFrameHasHud() {
    return new Promise((resolve) => {
      let settled = false;
      const onMessage = (e) => {
        if (e.data !== PONG || settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        resolve(true);
      };
      window.addEventListener('message', onMessage);
      try { window.top.postMessage(PING, '*'); } catch (e) { /* cross-origin is fine */ }
      setTimeout(() => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        resolve(false);
      }, 700);
    });
  }

  let adapter = NA.adapterBase.BaseAdapter;
  let settings = null;
  let profile = null;
  let lastFingerprint = '';
  let filling = false;
  let observer = null;
  let rescanTimer = null;
  let aggregate = { filled: 0, total: 0, skipped: [], suggested: [] };

  // Each frame reports its own running totals, repeatedly. Summing every report
  // counted the same frame's work several times over, so a seven-field form
  // could finish reading "12/14 filled". Contributions are keyed by frame and
  // replaced, then summed.
  const frameKey = 'f' + Math.random().toString(36).slice(2, 10);
  let contributions = new Map();
  let trackedThisStep = false;

  const send = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(res);
      });
    } catch (e) { resolve(null); }
  });

  async function loadState() {
    const res = await send({ type: 'state:get' });
    if (!res || !res.ok) return false;
    profile = res.profile;
    settings = res.settings;
    NA.currentProfile = profile;
    NA.dom.setHighlightColor(settings.highlightColor);
    return true;
  }

  function chooseAdapter() {
    adapter = NA.adapterRegistry.pick(window.location, document);
  }

  function pageContext() {
    let ctx;
    try { ctx = adapter.jobContext(document, window.location); }
    catch (e) { ctx = NA.adapterBase.genericJobContext(document, window.location); }
    NA.pageContext = {
      hospital: ctx.company, role: ctx.role, unit: '',
      company: ctx.company, location: ctx.location, url: window.location.href,
      atsType: adapter.label
    };
    return NA.pageContext;
  }

  function currentStep() {
    try { return adapter.detectStep(document); } catch (e) { return null; }
  }

  /* --------------------------------------------------------------- scan */

  function surveyFrame() {
    const fields = NA.mapper.scan(adapter, document);
    const fillable = fields.filter((f) => !f.userContent);
    return { fields, count: fillable.length };
  }

  function refreshCounts() {
    if (!ownsHud) return;
    const step = currentStep();
    const survey = surveyFrame();
    NA.hud.setState({
      total: Math.max(aggregate.total, survey.count),
      stepLabel: step ? step.label : '',
      adapterLabel: adapter.label
    });
  }

  /* --------------------------------------------------------------- fill */

  async function fillThisFrame() {
    if (filling) return null;
    filling = true;
    try {
      if (!profile && !(await loadState())) return null;

      const fields = NA.mapper.scan(adapter, document);
      if (!fields.length) return { filled: [], skipped: [], suggested: [], total: 0 };

      const planned = NA.mapper.plan(fields, profile, settings, adapter);

      // Tier 3 runs before execution so model-resolved fields join the same pass.
      if (planned.unresolved.length && settings.enableLlmFallback && settings.apiKey) {
        const extra = await NA.mapper.resolveWithModel(
          planned.unresolved, window.location.hostname, settings
        );
        planned.plan.forEach((item) => {
          const hit = extra[item.field.naId];
          if (item.action === 'unresolved' && hit) {
            item.action = 'fill';
            item.value = hit.value;
            item.ruleId = hit.ruleId;
            item.tier = 3;
          }
        });
      }

      const results = await NA.mapper.execute(
        planned.plan, profile, settings, adapter,
        (partial) => reportProgress(partial)
      );

      // Autopilot takes everything the rules could not place. The rules are
      // exact and free, so they go first; this is for the questions each
      // hospital invents, which is most of a real application.
      if (settings.autopilot) {
        if (ownsHud) NA.hud.setState({ status: 'thinking' });
        const auto = await NA.autopilot.run(planned.plan, profile, {
          comboOptions: adapter.comboboxOptions,
          onProgress: () => reportProgress(results)
        });
        if (auto.error) {
          results.modelError = auto.error;
        }
        if (auto.filled.length) {
          const done = new Set(auto.filled.map((f) => f.naId));
          auto.filled.forEach((f) => results.filled.push({
            naId: f.naId, label: f.label, kind: '', reason: '', tier: 4, ruleId: 'autopilot'
          }));
          results.skipped = results.skipped.filter((s) => !done.has(s.naId));
          results.suggested = results.suggested.filter((s) => !done.has(s.naId));
        }
      }
      return results;
    } finally {
      filling = false;
    }
  }

  function reportProgress(partial) {
    const payload = {
      frame: frameKey,
      filled: partial.filled.length,
      total: partial.total,
      skipped: partial.skipped,
      suggested: partial.suggested
    };
    if (ownsHud) mergeAggregate(payload);
    else send({ type: 'frame:result', result: payload });
  }

  function mergeAggregate(res) {
    contributions.set(res.frame || frameKey, {
      filled: Number(res.filled) || 0,
      total: Number(res.total) || 0
    });

    let filled = 0;
    let total = 0;
    contributions.forEach((c) => { filled += c.filled; total += c.total; });
    aggregate.filled = filled;
    aggregate.total = total;

    const seen = new Set(aggregate.skipped.map((s) => s.naId));
    (res.skipped || []).forEach((s) => { if (!seen.has(s.naId)) aggregate.skipped.push(s); });
    const seenS = new Set(aggregate.suggested.map((s) => s.naId));
    (res.suggested || []).forEach((s) => { if (!seenS.has(s.naId)) aggregate.suggested.push(s); });

    NA.hud.setState({
      filled: aggregate.filled,
      total: aggregate.total,
      skipped: aggregate.skipped,
      suggested: aggregate.suggested
    });
  }

  async function runFill() {
    aggregate = { filled: 0, total: 0, skipped: [], suggested: [] };
    contributions = new Map();
    if (ownsHud) NA.hud.setState({ status: 'filling', filled: 0, skipped: [], suggested: [], drawerOpen: false });
    await send({ type: 'fill:broadcast' });
  }

  async function finishFrame(res) {
    if (!res) return;
    const payload = {
      frame: frameKey,
      filled: res.filled.length, total: res.total,
      skipped: res.skipped, suggested: res.suggested
    };
    if (!ownsHud) {
      await send({ type: 'frame:result', result: payload });
      return;
    }
    mergeAggregate(payload);
    NA.hud.setState({ status: 'done', modelError: res.modelError || '' });
    await recordApplication();
    await send({ type: 'stats:bump', filled: aggregate.filled, skipped: aggregate.skipped.length });
  }

  async function recordApplication() {
    if (!settings || settings.enableTracker === false) return;
    if (trackedThisStep) return;
    if (!aggregate.filled) return;
    trackedThisStep = true;
    const ctx = pageContext();
    await send({
      type: 'tracker:upsert',
      entry: {
        company: ctx.company || '(unknown)',
        role: ctx.role || '(unknown role)',
        location: ctx.location || '',
        atsType: adapter.label,
        url: ctx.url,
        fieldsFilled: aggregate.filled,
        fieldsSkipped: aggregate.skipped.length
      }
    });
  }

  /* ----------------------------------------------------------- observer */

  function watchForStepChanges() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      clearTimeout(rescanTimer);
      rescanTimer = setTimeout(async () => {
        const fields = NA.mapper.scan(adapter, document);
        const fp = NA.dom.fingerprintForm(fields);

        // The form may only now have rendered, which is when this frame gets
        // its chance to own the pill.
        const adopted = await ensureHud();

        if (fp === lastFingerprint) {
          if (adopted) refreshCounts();
          return;
        }
        lastFingerprint = fp;
        trackedThisStep = false;
        aggregate = { filled: 0, total: 0, skipped: [], suggested: [] };
        contributions = new Map();
        if (ownsHud) {
          NA.hud.setState({ status: 'idle', filled: 0, skipped: [], suggested: [], drawerOpen: false });
          refreshCounts();
        }
        // With autopilot on, a new step is filled the moment it renders, so
        // the nurse presses Next and nothing else until Submit.
        const shouldAuto = settings && (settings.autopilot ? settings.autoAdvance !== false
                                                           : settings.autoFillOnLoad);
        if (shouldAuto && fields.length) runFill();
      }, 600);
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: false, characterData: false
    });
  }

  /* ---------------------------------------------------------- messaging */

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'na:fill') {
      fillThisFrame().then((res) => {
        finishFrame(res);
        respond({ ok: true });
      });
      return true;
    }

    if (msg.type === 'na:aggregate' && ownsHud) {
      mergeAggregate(msg.result, false);
      respond({ ok: true });
      return false;
    }

    if (msg.type === 'na:command' && ownsHud) {
      if (msg.command === 'fill') runFill();
      if (msg.command === 'clear') { NA.dom.clearMarks(); refreshCounts(); }
      if (msg.command === 'status') {
        respond({ ok: true, state: {
          filled: aggregate.filled, total: aggregate.total,
          skipped: aggregate.skipped.length, adapter: adapter.label,
          step: (currentStep() || {}).label || ''
        } });
        return false;
      }
      respond({ ok: true });
      return false;
    }

    if (msg.type === 'na:settingsChanged') {
      loadState().then(() => { if (ownsHud) refreshCounts(); });
      respond({ ok: true });
      return false;
    }

    return false;
  });

  /* --------------------------------------------------------------- boot */

  /**
   * Decides whether this frame draws the pill, and draws it.
   *
   * Called on load AND on every DOM change, which is the whole point. Workday,
   * iCIMS and Taleo are single-page apps: at load there is no form yet, so a
   * decision made once at boot is always "no". The content script would go on
   * scanning the form as it appeared, marking fields, and never show anything,
   * which looks exactly like the extension being broken.
   */
  async function ensureHud() {
    if (ownsHud) return true;

    const fields = NA.mapper.scan(adapter, document);
    if (!fields.length) return false;

    if (!isTop) {
      // Only adopt the pill if nothing above has one, and only if this frame
      // is big enough to be the application rather than a tracking pixel.
      const big = window.innerHeight > 260 && window.innerWidth > 320;
      if (!big) return false;
      if (await topFrameHasHud()) return false;
    }

    ownsHud = true;
    pageContext();
    NA.hud.on({
      onFill: runFill,
      onInserted: () => { aggregate.filled += 1; NA.hud.setState({ filled: aggregate.filled }); }
    });
    NA.hud.build();
    refreshCounts();
    return true;
  }

  async function boot() {
    chooseAdapter();
    const loaded = await loadState();
    if (!loaded) return;

    const fields = NA.mapper.scan(adapter, document);
    lastFingerprint = NA.dom.fingerprintForm(fields);

    await ensureHud();
    watchForStepChanges();

    const autoOnLoad = settings.autopilot ? settings.autoAdvance !== false : settings.autoFillOnLoad;
    if (autoOnLoad && fields.length) setTimeout(runFill, 900);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(typeof self !== 'undefined' ? self : this);
