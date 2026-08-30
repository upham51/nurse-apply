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

  let adapter = NA.adapterBase.BaseAdapter;
  let settings = null;
  let profile = null;
  let lastFingerprint = '';
  let filling = false;
  let observer = null;
  let rescanTimer = null;
  let aggregate = { filled: 0, total: 0, skipped: [], suggested: [] };
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
    if (!isTop) return;
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
      return results;
    } finally {
      filling = false;
    }
  }

  function reportProgress(partial) {
    const payload = {
      filled: partial.filled.length,
      total: partial.total,
      skipped: partial.skipped,
      suggested: partial.suggested,
      partial: true
    };
    if (isTop) mergeAggregate(payload, true);
    else send({ type: 'frame:result', result: payload });
  }

  function mergeAggregate(res, isPartial) {
    if (!isPartial) {
      aggregate.filled += res.filled;
      aggregate.total += res.total;
    } else {
      aggregate.filled = Math.max(aggregate.filled, res.filled);
      aggregate.total = Math.max(aggregate.total, res.total);
    }
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
    if (isTop) NA.hud.setState({ status: 'filling', filled: 0, skipped: [], suggested: [] });

    // Ask every frame in this tab, including this one.
    await send({ type: 'fill:broadcast' });

    const own = await fillThisFrame();
    if (own) {
      mergeAggregate({
        filled: own.filled.length, total: own.total,
        skipped: own.skipped, suggested: own.suggested
      }, false);
      if (!isTop) {
        await send({ type: 'frame:result', result: {
          filled: own.filled.length, total: own.total,
          skipped: own.skipped, suggested: own.suggested
        } });
      }
    }

    if (isTop) {
      NA.hud.setState({ status: 'done' });
      await recordApplication();
      await send({ type: 'stats:bump', filled: aggregate.filled, skipped: aggregate.skipped.length });
    }
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
      rescanTimer = setTimeout(() => {
        const fields = NA.mapper.scan(adapter, document);
        const fp = NA.dom.fingerprintForm(fields);
        if (fp === lastFingerprint) return;
        lastFingerprint = fp;
        trackedThisStep = false;
        aggregate = { filled: 0, total: 0, skipped: [], suggested: [] };
        if (isTop) {
          NA.hud.setState({ status: 'idle', filled: 0, skipped: [], suggested: [], drawerOpen: false });
          refreshCounts();
        }
        if (settings && settings.autoFillOnLoad && fields.length) runFill();
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
        if (res && !isTop) {
          send({ type: 'frame:result', result: {
            filled: res.filled.length, total: res.total,
            skipped: res.skipped, suggested: res.suggested
          } });
        }
        respond({ ok: true });
      });
      return true;
    }

    if (msg.type === 'na:aggregate' && isTop) {
      mergeAggregate(msg.result, false);
      respond({ ok: true });
      return false;
    }

    if (msg.type === 'na:command' && isTop) {
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
      loadState().then(() => { if (isTop) refreshCounts(); });
      respond({ ok: true });
      return false;
    }

    return false;
  });

  /* --------------------------------------------------------------- boot */

  async function boot() {
    chooseAdapter();
    const loaded = await loadState();
    if (!loaded) return;

    const fields = NA.mapper.scan(adapter, document);
    lastFingerprint = NA.dom.fingerprintForm(fields);

    if (isTop) {
      // Do not draw the HUD on a page with no form at all.
      if (fields.length === 0 && !document.querySelector('form')) {
        watchForStepChanges();
        return;
      }
      pageContext();
      NA.hud.on({
        onFill: runFill,
        onInserted: () => { aggregate.filled += 1; NA.hud.setState({ filled: aggregate.filled }); }
      });
      NA.hud.build();
      refreshCounts();
    }

    watchForStepChanges();
    if (settings.autoFillOnLoad && fields.length) setTimeout(runFill, 900);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(typeof self !== 'undefined' ? self : this);
