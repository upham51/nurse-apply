/**
 * Import review.
 *
 * The parser is right most of the time and wrong in ways that look plausible,
 * which is the dangerous kind. So the import is never applied silently. This
 * screen shows what was read, shows the resume lines each field came from, and
 * makes the two common corrections cheap:
 *
 *  1. A whole-document swap. Layout is consistent within one resume, so when
 *     employer and title are the wrong way round they are wrong for every job.
 *     One button fixes all of them.
 *  2. Click a line to assign it. When a field is wrong, the right answer is
 *     almost always another line already on screen, so reassigning beats
 *     retyping.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});

  let state = null;
  let handlers = {};

  const $ = (s) => document.querySelector(s);

  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach((c) => { if (c) n.appendChild(c); });
    return n;
  }

  /* ---------------------------------------------------------------- open */

  function open(parsed, meta, callbacks) {
    state = {
      profile: parsed.profile,
      sources: parsed.sources || [],
      report: parsed.report || [],
      stats: parsed.stats || {},
      text: parsed.text || '',
      meta: meta || {},
      expanded: new Set(),
      swapped: false
    };
    handlers = callbacks || {};
    render();
    const panel = $('#review');
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function close() {
    $('#review').classList.add('hidden');
    state = null;
  }

  /* -------------------------------------------------------------- render */

  function render() {
    if (!state) return;
    renderSummary();
    renderSwap();
    renderIssues();
    renderRoles();
  }

  function renderSummary() {
    const c = $('#review-summary');
    c.textContent = '';
    const s = state.stats;
    const bits = [];
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
    if (s.experience) bits.push(plural(s.experience, 'role'));
    if (s.licenses) bits.push(plural(s.licenses, 'license'));
    if (s.certifications) bits.push(plural(s.certifications, 'certification'));
    if (s.education) bits.push(plural(s.education, 'school'));
    if (s.emrSystems) bits.push(plural(s.emrSystems, 'EMR system'));

    c.appendChild(el('p', { class: 'note',
      text: (state.meta.source ? state.meta.source + ': ' : '') +
        (bits.length ? 'found ' + bits.join(', ') + '.' : 'nothing recognisable was found.') +
        ' Nothing is saved until you press Use this.' }));
  }

  /** The one question that fixes a whole document at once. */
  function renderSwap() {
    const c = $('#review-swap');
    c.textContent = '';
    const roles = state.profile.experience || [];
    if (roles.length < 1) return;

    const first = roles.find((r) => r.employer || r.title);
    if (!first) return;

    c.appendChild(el('h4', { text: 'Does this look right?' }));
    const table = el('div', { class: 'grid' }, [
      el('label', { class: 'field col-6' }, [
        el('span', { class: 'lab', text: 'Employer' }),
        el('div', { class: 'readout', text: first.employer || '(nothing)' })
      ]),
      el('label', { class: 'field col-6' }, [
        el('span', { class: 'lab', text: 'Job title' }),
        el('div', { class: 'readout', text: first.title || '(nothing)' })
      ])
    ]);
    c.appendChild(table);

    const n = roles.length;
    c.appendChild(el('div', { class: 'row-actions', style: 'margin-top:10px' }, [
      el('button', {
        class: 'small', text: n === 1 ? 'No, swap them' : `No, swap them on all ${n} jobs`,
        onclick: swapAll
      }),
      el('span', { class: 'note', style: 'margin:0;flex:1',
        text: n === 1 ? '' : 'Resumes keep the same layout throughout, so one swap fixes every job.' })
    ]));
  }

  function swapAll() {
    (state.profile.experience || []).forEach((r) => {
      const t = r.employer;
      r.employer = r.title;
      r.title = t;
    });
    state.swapped = !state.swapped;
    render();
  }

  function renderIssues() {
    const ul = $('#review-issues');
    ul.textContent = '';
    const list = (state.report || []).concat(state.meta.issues || []);
    if (!list.length) return;
    list.slice(0, 14).forEach((r) => {
      ul.appendChild(el('li', { class: r.level === 'warn' ? 'err' : '', text: r.msg }));
    });
  }

  function renderRoles() {
    const c = $('#review-roles');
    c.textContent = '';
    const roles = state.profile.experience || [];
    if (!roles.length) {
      c.appendChild(el('p', { class: 'note', text: 'No jobs were found. You can add them by hand below, or try the assistant handoff.' }));
      return;
    }

    roles.forEach((role, i) => {
      const src = state.sources[i];
      const head = el('div', { class: 'entry-head' }, [
        el('h4', { text: dateLabel(role) }),
        el('div', { class: 'row-actions' }, [
          src && src.lines && src.lines.length ? el('button', {
            class: 'small ghost',
            text: state.expanded.has(i) ? 'Hide the lines' : 'Where did this come from?',
            onclick: () => {
              if (state.expanded.has(i)) state.expanded.delete(i); else state.expanded.add(i);
              render();
            }
          }) : null,
          el('button', {
            class: 'small ghost', text: 'Swap',
            onclick: () => { const t = role.employer; role.employer = role.title; role.title = t; render(); }
          }),
          el('button', {
            class: 'small danger', text: 'Drop',
            onclick: () => { roles.splice(i, 1); state.sources.splice(i, 1); render(); }
          })
        ])
      ]);

      const fields = el('div', { class: 'grid' }, [
        textField(role, 'employer', 'Employer', 6),
        textField(role, 'title', 'Job title', 6),
        textField(role, 'unit', 'Unit', 3),
        textField(role, 'bedCount', 'Beds', 2),
        textField(role, 'typicalRatio', 'Ratio', 2),
        textField(role, 'startDate', 'Start', 2),
        textField(role, 'endDate', role.isCurrent ? 'End (current)' : 'End', 3)
      ]);

      const kids = [head, fields];
      if (state.expanded.has(i) && src) kids.push(sourceLines(role, src));
      c.appendChild(el('div', { class: 'entry' }, kids));
    });
  }

  function dateLabel(role) {
    const end = role.isCurrent ? 'present' : (role.endDate || '?');
    return (role.startDate || '?') + ' to ' + end;
  }

  function textField(obj, key, label, col) {
    const input = el('input', { type: 'text' });
    input.value = obj[key] || '';
    input.addEventListener('input', () => { obj[key] = input.value; });
    return el('label', { class: 'field col-' + col },
      [el('span', { class: 'lab', text: label }), input]);
  }

  /**
   * The resume lines this job was built from. Clicking one assigns it, which
   * is faster and less error-prone than retyping an employer name.
   */
  function sourceLines(role, src) {
    const wrap = el('div', { class: 'srclines' });
    wrap.appendChild(el('p', { class: 'note', style: 'margin:8px 0 6px',
      text: 'These are the lines from your resume for this job. Click one to use it.' }));
    src.lines.slice(0, 12).forEach((line) => {
      const row = el('div', { class: 'srcline' }, [
        el('span', { class: 'txt', text: line }),
        el('span', { class: 'row-actions' }, [
          el('button', { class: 'small ghost', text: 'Employer',
            onclick: () => { role.employer = line; render(); } }),
          el('button', { class: 'small ghost', text: 'Title',
            onclick: () => { role.title = line; render(); } })
        ])
      ]);
      wrap.appendChild(row);
    });
    return wrap;
  }

  function wire() {
    const apply = $('#review-apply');
    const discard = $('#review-discard');
    if (apply) apply.addEventListener('click', () => {
      if (handlers.onApply) handlers.onApply(state.profile);
      close();
    });
    if (discard) discard.addEventListener('click', () => {
      if (handlers.onDiscard) handlers.onDiscard();
      close();
    });
  }

  NA.review = { open, close, render, wire, swapAll, get state() { return state; } };
})(typeof self !== 'undefined' ? self : this);
