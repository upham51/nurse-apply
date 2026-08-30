/**
 * Floating status pill and skipped-field drawer.
 *
 * Rendered into a shadow root so the hospital portal's CSS cannot restyle it
 * and ours cannot leak into their form. The pill actively moves out of the way
 * of the portal's own Next / Submit / Continue buttons: covering the button the
 * user needs to press is the fastest way to get an extension uninstalled.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});

  const HOST_ID = 'nurseapply-hud-host';
  const NAV_RE = /^(next|continue|submit|apply|save\s*(and)?\s*continue|review|finish)\b/i;

  let host = null;
  let shadow = null;
  let els = {};
  let state = {
    filled: 0, total: 0, skipped: [], suggested: [],
    status: 'idle', stepLabel: '', adapterLabel: '', modelError: '', drawerOpen: false
  };
  let handlers = {};

  const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont,
    "Segoe UI", "DM Sans", Roboto, Helvetica, Arial, sans-serif; }

.wrap {
  position: fixed;
  right: 20px; bottom: 20px;
  display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
  transition: transform .18s ease;
}

.pill {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 14px;
  border-radius: 999px;
  background: rgba(9, 13, 22, 0.72);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  border: 1px solid rgba(255,255,255,0.10);
  box-shadow: 0 8px 30px rgba(0,0,0,0.38);
  color: #e6edf6;
  font-size: 13px; line-height: 1;
  user-select: none;
}

.dot { width: 7px; height: 7px; border-radius: 50%; background: #14b8a6; flex: none; }
.dot.busy { background: #06b6d4; animation: pulse 1s ease-in-out infinite; }
.dot.warn { background: #f59e0b; }
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }

.count { font-variant-numeric: tabular-nums; letter-spacing: .2px; white-space: nowrap; }
.count b { font-weight: 600; }
.meta { color: rgba(230,237,246,0.55); font-size: 11px; white-space: nowrap;
        max-width: 190px; overflow: hidden; text-overflow: ellipsis; }

button {
  appearance: none; border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06); color: #e6edf6;
  border-radius: 999px; padding: 6px 12px; font-size: 12px; cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
  white-space: nowrap;
}
button:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.22); }
button.primary { background: rgba(6,182,212,0.18); border-color: rgba(6,182,212,0.45); color: #a5f3fc; }
button.primary:hover { background: rgba(6,182,212,0.28); }
button:disabled { opacity: .45; cursor: default; }
button.icon { padding: 6px 9px; }

.drawer {
  width: 380px; max-width: calc(100vw - 40px);
  max-height: min(60vh, 520px);
  overflow: auto;
  border-radius: 16px;
  background: rgba(9, 13, 22, 0.86);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  border: 1px solid rgba(255,255,255,0.10);
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  color: #e6edf6; padding: 14px 16px 16px;
}
.drawer h3 { margin: 0 0 2px; font-size: 13px; font-weight: 600; letter-spacing: .2px; }
.drawer p.sub { margin: 0 0 12px; font-size: 11.5px; color: rgba(230,237,246,0.5); line-height: 1.5; }

.item { padding: 10px 0; border-top: 1px solid rgba(255,255,255,0.07); }
.item:first-of-type { border-top: none; }
.item .row { display: flex; align-items: baseline; gap: 8px; justify-content: space-between; }
.item .lbl { font-size: 12.5px; font-weight: 500; line-height: 1.4; }
.item .why { font-size: 11.5px; color: rgba(230,237,246,0.55); margin-top: 3px; line-height: 1.5; }
.item .acts { display: flex; gap: 6px; margin-top: 8px; }
.tag { font-size: 10px; letter-spacing: .4px; text-transform: uppercase;
       color: rgba(230,237,246,0.45); border: 1px solid rgba(255,255,255,0.12);
       border-radius: 5px; padding: 2px 6px; white-space: nowrap; flex: none; }
.empty { font-size: 12px; color: rgba(230,237,246,0.5); padding: 8px 0 2px; }
textarea {
  width: 100%; margin-top: 8px; min-height: 90px; resize: vertical;
  background: rgba(255,255,255,0.04); color: #e6edf6; font-size: 12px;
  border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 8px 10px;
  line-height: 1.55;
}
.foot { margin-top: 12px; display: flex; gap: 8px; justify-content: space-between; align-items: center; }
.foot .note { font-size: 11px; color: rgba(230,237,246,0.42); line-height: 1.5; }
`;

  function build() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-na-visible', 'true');
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLE;
    shadow.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `
      <div class="drawer" hidden></div>
      <div class="pill">
        <span class="dot"></span>
        <span class="count">NurseApply</span>
        <span class="meta"></span>
        <button class="primary act-fill">Fill step</button>
        <button class="act-review" hidden>Review</button>
        <button class="icon act-hide" title="Hide until reload">×</button>
      </div>`;
    shadow.appendChild(wrap);

    els = {
      wrap,
      pill: wrap.querySelector('.pill'),
      dot: wrap.querySelector('.dot'),
      count: wrap.querySelector('.count'),
      meta: wrap.querySelector('.meta'),
      fill: wrap.querySelector('.act-fill'),
      review: wrap.querySelector('.act-review'),
      hide: wrap.querySelector('.act-hide'),
      drawer: wrap.querySelector('.drawer')
    };

    els.fill.addEventListener('click', () => handlers.onFill && handlers.onFill());
    els.review.addEventListener('click', toggleDrawer);
    els.hide.addEventListener('click', destroy);

    (document.body || document.documentElement).appendChild(host);
    avoidNativeButtons();
    window.addEventListener('resize', avoidNativeButtons, { passive: true });
    window.addEventListener('scroll', avoidNativeButtons, { passive: true });
  }

  /**
   * Shifts the pill upward if a Next/Submit button sits under it. Checked on
   * every render because these wizards move their footer between steps.
   */
  function avoidNativeButtons() {
    if (!els.wrap) return;
    const buttons = Array.prototype.slice.call(
      document.querySelectorAll('button, a[role="button"], input[type=submit]')
    ).filter((b) => {
      const t = NA.dom.cleanText(b.textContent || b.value || '');
      return NAV_RE.test(t) && NA.dom.isVisible(b);
    });
    if (!buttons.length) { els.wrap.style.transform = ''; return; }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const zone = { left: vw - 460, top: vh - 130, right: vw, bottom: vh };
    let lift = 0;
    buttons.forEach((b) => {
      const r = b.getBoundingClientRect();
      const overlaps = r.right > zone.left && r.left < zone.right &&
                       r.bottom > zone.top && r.top < zone.bottom;
      if (overlaps) lift = Math.max(lift, vh - r.top + 16);
    });
    els.wrap.style.transform = lift ? `translateY(-${Math.min(lift, 260)}px)` : '';
  }

  function toggleDrawer() {
    state.drawerOpen = !state.drawerOpen;
    renderDrawer();
  }

  function pending() {
    return state.skipped.filter((s) => s.reason !== 'already-filled');
  }

  function render() {
    build();
    const p = pending().length + state.suggested.length;

    els.dot.className = 'dot' +
      (state.status === 'filling' || state.status === 'thinking' ? ' busy'
        : (state.modelError ? ' warn' : (p ? ' warn' : '')));

    if (state.status === 'idle' && state.total === 0) {
      els.count.textContent = 'NurseApply';
    } else if (state.status === 'filling') {
      els.count.innerHTML = `Filling <b>${state.filled}</b>/${state.total}`;
    } else if (state.status === 'thinking') {
      els.count.textContent = 'Working out the rest…';
    } else {
      els.count.innerHTML = `<b>${state.filled}</b>/${state.total} filled`;
    }

    const bits = [];
    if (state.modelError) bits.push(state.modelError.slice(0, 90));
    if (state.adapterLabel) bits.push(state.adapterLabel);
    if (state.stepLabel) bits.push(state.stepLabel);
    els.meta.textContent = bits.join(' · ');
    els.meta.title = bits.join(' · ');

    els.fill.disabled = state.status === 'filling';
    els.fill.textContent = state.status === 'filling' ? 'Filling…' : 'Fill step';

    els.review.hidden = p === 0;
    els.review.textContent = `Review skipped (${p})`;

    renderDrawer();
    avoidNativeButtons();
  }

  function renderDrawer() {
    if (!els.drawer) return;
    if (!state.drawerOpen) { els.drawer.hidden = true; return; }
    els.drawer.hidden = false;

    const list = pending();
    const sug = state.suggested;
    const frag = document.createElement('div');

    const head = document.createElement('div');
    head.innerHTML = `<h3>Needs you</h3>
      <p class="sub">NurseApply stopped on these. Attestations about discipline,
      termination, criminal history and exclusions are never auto-answered.</p>`;
    frag.appendChild(head);

    if (!list.length && !sug.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'Nothing outstanding on this step.';
      frag.appendChild(e);
    }

    sug.forEach((s) => frag.appendChild(itemNode(s, true)));
    list.forEach((s) => frag.appendChild(itemNode(s, false)));

    const foot = document.createElement('div');
    foot.className = 'foot';
    foot.innerHTML = `<span class="note">NurseApply never clicks Submit.</span>`;
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.addEventListener('click', toggleDrawer);
    foot.appendChild(close);
    frag.appendChild(foot);

    els.drawer.textContent = '';
    els.drawer.appendChild(frag);
  }

  function itemNode(entry, isSuggestion) {
    const node = document.createElement('div');
    node.className = 'item';

    const row = document.createElement('div');
    row.className = 'row';
    const lbl = document.createElement('div');
    lbl.className = 'lbl';
    lbl.textContent = entry.label;
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = isSuggestion ? 'draft' : tagFor(entry);
    row.appendChild(lbl);
    row.appendChild(tag);
    node.appendChild(row);

    if (entry.note || entry.reason) {
      const why = document.createElement('div');
      why.className = 'why';
      why.textContent = entry.note || readableReason(entry.reason);
      node.appendChild(why);
    }

    let textarea = null;
    if (isSuggestion && entry.value) {
      textarea = document.createElement('textarea');
      textarea.value = entry.value;
      node.appendChild(textarea);
    }

    const acts = document.createElement('div');
    acts.className = 'acts';

    const jump = document.createElement('button');
    jump.textContent = 'Show me';
    jump.addEventListener('click', () => {
      const el = NA.dom.byNaId(entry.naId);
      if (el) NA.dom.scrollTo(el);
    });
    acts.appendChild(jump);

    if (isSuggestion && entry.value) {
      const insert = document.createElement('button');
      insert.className = 'primary';
      insert.textContent = 'Insert this';
      insert.addEventListener('click', async () => {
        const el = NA.dom.byNaId(entry.naId);
        if (!el) return;
        const kind = NA.dom.fieldKind(el);
        const res = await NA.dom.applyValue({ el, kind, naId: entry.naId },
          textarea ? textarea.value : entry.value, {});
        insert.textContent = res.ok ? 'Inserted' : 'Could not insert';
        insert.disabled = true;
        if (res.ok && handlers.onInserted) handlers.onInserted(entry.naId);
      });
      acts.appendChild(insert);
    }

    node.appendChild(acts);
    return node;
  }

  function tagFor(entry) {
    if (entry.reason === 'knockout') return entry.family || 'attestation';
    if (entry.reason === 'user-typed') return 'yours';
    if (entry.reason === 'no-profile-answer') return 'no data';
    if (entry.reason === 'no-match') return 'unmapped';
    if (entry.reason === 'write-rejected') return 'failed';
    return entry.reason || 'skipped';
  }

  const REASON_TEXT = {
    'user-typed': 'Left alone because you had already typed here.',
    'no-match': 'No confident mapping for this field.',
    'write-rejected': 'The portal rejected the value. Fill this one by hand.',
    'not-visible': 'Field was not visible when the fill ran.',
    'element-gone': 'The field disappeared mid-fill, probably a re-render.',
    'unsupported-control': 'Custom control NurseApply does not drive.',
    'no-value': 'Your profile has nothing for this field.',
    'split-date-failed': 'Could not drive this date widget.',
    'date-unparseable': 'Stored date is not in a format this widget accepts.'
  };

  function readableReason(r) { return REASON_TEXT[r] || r || ''; }

  function setState(patch) {
    Object.assign(state, patch);
    render();
  }

  function on(map) { handlers = Object.assign(handlers, map); }

  function destroy() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null; shadow = null; els = {};
    window.removeEventListener('resize', avoidNativeButtons);
    window.removeEventListener('scroll', avoidNativeButtons);
  }

  function exists() { return !!(host && host.isConnected); }

  NA.hud = { build, render, setState, on, destroy, exists, get state() { return state; } };
})(typeof self !== 'undefined' ? self : this);
