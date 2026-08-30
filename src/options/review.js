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
    renderIssues();
    renderIdentity();
    renderCredentials();
    renderEducation();
    renderSkills();
    renderSwap();
    renderRoles();
  }

  /* --------------------------------------------------- everything it read */

  function heading(text, hint) {
    const h = el('h4', { text });
    if (hint) {
      const s2 = el('span', { text: '  ' + hint });
      s2.style.fontWeight = '400';
      s2.style.color = 'var(--ink-faint)';
      s2.style.fontSize = '12px';
      h.appendChild(s2);
    }
    return h;
  }

  function renderIdentity() {
    const c = $('#review-identity');
    c.textContent = '';
    const id = state.profile.identity || {};
    const addr = id.address || {};
    c.appendChild(heading('You'));
    c.appendChild(el('div', { class: 'grid' }, [
      textField(id, 'firstName', 'First name', 3),
      textField(id, 'lastName', 'Last name', 3),
      textField(id, 'email', 'Email', 6),
      textField(id, 'phone', 'Phone', 3),
      textField(addr, 'street', 'Street', 5),
      textField(addr, 'city', 'City', 2),
      textField(addr, 'state', 'State', 1),
      textField(addr, 'zip', 'ZIP', 1)
    ]));
  }

  function renderCredentials() {
    const c = $('#review-credentials');
    c.textContent = '';
    const licenses = state.profile.licenses || [];
    const certs = state.profile.certifications || [];

    c.appendChild(heading('Licenses', licenses.length ? '' : 'none found on the resume'));
    if (!licenses.length) {
      c.appendChild(el('p', { class: 'note', text: 'Add these by hand after the import. Portals will not accept an application without one.' }));
    }
    licenses.forEach((l, i) => {
      c.appendChild(el('div', { class: 'grid' }, [
        textField(l, 'type', 'Type', 2),
        textField(l, 'state', 'State', 2),
        textField(l, 'number', 'Number', 4),
        textField(l, 'expirationDate', 'Expires', 3),
        checkField(l, 'isCompact', 'Compact', 1),
        removeButton(licenses, i, 'license')
      ]));
    });

    c.appendChild(heading('Certifications', certs.length ? '' : 'none found on the resume'));
    if (!certs.length) {
      c.appendChild(el('p', { class: 'note', text: 'Nearly every posting requires BLS, and most acute-care roles want ACLS.' }));
    }
    certs.forEach((cert, i) => {
      c.appendChild(el('div', { class: 'grid' }, [
        textField(cert, 'name', 'Certification', 3),
        textField(cert, 'otherName', 'Full name', 4),
        textField(cert, 'issuingBody', 'Issued by', 2),
        textField(cert, 'expirationDate', 'Expires', 2),
        removeButton(certs, i, 'certification')
      ]));
    });
  }

  function renderEducation() {
    const c = $('#review-education');
    c.textContent = '';
    const list = state.profile.education || [];
    c.appendChild(heading('Education', list.length ? '' : 'none found on the resume'));
    list.forEach((e, i) => {
      c.appendChild(el('div', { class: 'grid' }, [
        textField(e, 'degree', 'Degree', 2),
        textField(e, 'school', 'School', 6),
        textField(e, 'city', 'City', 2),
        textField(e, 'graduationDate', 'Graduated', 2),
        removeButton(list, i, 'school')
      ]));
    });
  }

  function renderSkills() {
    const c = $('#review-skills');
    c.textContent = '';
    const s2 = state.profile.clinicalSkills || {};
    const emr = s2.emrSystems || [];
    const procedures = s2.procedures || [];
    const languages = (s2.languages || []).map((l) => l.language).filter(Boolean);
    if (!emr.length && !procedures.length && !languages.length) return;

    c.appendChild(heading('Skills'));
    const line = (label, values) => {
      if (!values.length) return null;
      return el('p', { class: 'note', style: 'margin:0 0 6px' }, [
        el('strong', { text: label + ': ' }),
        document.createTextNode(values.join(', '))
      ]);
    };
    [line('EMR systems', emr), line('Procedures', procedures), line('Languages', languages)]
      .forEach((n) => { if (n) c.appendChild(n); });
    c.appendChild(el('p', { class: 'note', style: 'margin-top:6px',
      text: 'Edit these in the Skills and EMR section after the import.' }));
  }

  function checkField(obj, key, label, col) {
    const input = el('input', { type: 'checkbox' });
    input.checked = !!obj[key];
    input.addEventListener('change', () => { obj[key] = input.checked; });
    return el('label', { class: 'check col-' + col }, [input, el('span', { text: label })]);
  }

  function removeButton(list, i, what) {
    return el('div', { class: 'col-12 row-actions' }, [
      el('button', {
        class: 'small ghost', text: 'Remove this ' + what,
        onclick: () => { list.splice(i, 1); render(); }
      })
    ]);
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

    c.appendChild(heading('Jobs', roles.length + (roles.length === 1 ? ' found' : ' found')));
    c.appendChild(el('p', { class: 'note', style: 'margin:0 0 10px',
      text: 'Employer and title are the pair that goes wrong most often, so check the first one.' }));
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
