/* Profile builder. Data-driven so the schema stays the single source of truth. */
(function () {
  'use strict';
  const NA = self.NA;
  const S = NA.schema;
  const E = S.ENUMS;

  let profile = null;
  let settings = null;
  let dirty = false;

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.prototype.slice.call((ctx || document).querySelectorAll(sel));

  /* --------------------------------------------------------- path access */

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => {
      if (o === undefined || o === null) return undefined;
      const m = /^(\w+)\[(\d+)\]$/.exec(k);
      return m ? (o[m[1]] || [])[Number(m[2])] : o[k];
    }, obj);
  }

  function setPath(obj, path, value) {
    const keys = path.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const m = /^(\w+)\[(\d+)\]$/.exec(keys[i]);
      if (m) {
        cur[m[1]] = cur[m[1]] || [];
        cur[m[1]][Number(m[2])] = cur[m[1]][Number(m[2])] || {};
        cur = cur[m[1]][Number(m[2])];
      } else {
        cur[keys[i]] = cur[keys[i]] || {};
        cur = cur[keys[i]];
      }
    }
    cur[keys[keys.length - 1]] = value;
  }

  /* ------------------------------------------------------- field builder */

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

  function field(spec) {
    const col = 'col-' + (spec.col || 6);

    if (spec.type === 'check') {
      const input = el('input', { type: 'checkbox' });
      input.checked = !!getPath(profile, spec.path);
      input.addEventListener('change', () => {
        setPath(profile, spec.path, input.checked);
        markDirty();
        if (spec.rerender) render();
      });
      const wrap = el('label', { class: 'check ' + col }, [input, el('span', { text: spec.label })]);
      return wrap;
    }

    let control;
    if (spec.type === 'select') {
      control = el('select');
      const opts = typeof spec.options === 'function' ? spec.options() : spec.options;
      if (spec.allowBlank) control.appendChild(el('option', { value: '', text: spec.placeholder || 'Select' }));
      opts.forEach((o) => {
        const value = typeof o === 'string' ? o : o.value;
        const text = typeof o === 'string' ? o : o.label;
        control.appendChild(el('option', { value, text }));
      });
      control.value = getPath(profile, spec.path) || '';
    } else if (spec.type === 'textarea') {
      control = el('textarea', { placeholder: spec.placeholder || '' });
      control.value = getPath(profile, spec.path) || '';
      if (spec.rows) control.style.minHeight = (spec.rows * 22) + 'px';
    } else {
      control = el('input', {
        type: spec.type || 'text',
        placeholder: spec.placeholder || '',
        maxlength: spec.maxlength
      });
      control.value = getPath(profile, spec.path) || '';
    }

    control.addEventListener('input', () => {
      setPath(profile, spec.path, control.value);
      markDirty();
    });
    control.addEventListener('change', () => {
      if (spec.normalize === 'phone') control.value = S.normalizePhone(control.value);
      if (spec.normalize === 'state') control.value = S.normalizeState(control.value);
      setPath(profile, spec.path, control.value);
      markDirty();
      if (spec.rerender) render();
    });

    const lab = el('span', { class: 'lab' });
    lab.textContent = spec.label;
    if (spec.hint) {
      const h = el('span', { text: '  ' + spec.hint });
      h.style.opacity = '.55';
      lab.appendChild(h);
    }
    return el('label', { class: 'field ' + col }, [lab, control]);
  }

  function mount(containerId, specs) {
    const c = $('#' + containerId);
    if (!c) return;
    c.textContent = '';
    specs.forEach((s) => c.appendChild(field(s)));
  }

  /* ------------------------------------------------------- repeat lists */

  function renderList(containerId, arrayPath, title, blankFn, specsFn) {
    const c = $('#' + containerId);
    if (!c) return;
    c.textContent = '';
    const list = getPath(profile, arrayPath) || [];

    if (!list.length) {
      c.appendChild(el('p', { class: 'note', text: 'Nothing added yet.' }));
      return;
    }

    list.forEach((_, i) => {
      const head = el('div', { class: 'entry-head' }, [
        el('h4', { text: title + ' ' + (i + 1) }),
        el('div', { class: 'row-actions' }, [
          i > 0 ? el('button', {
            class: 'small ghost', text: 'Move up',
            onclick: () => { const a = getPath(profile, arrayPath); const t = a[i]; a[i] = a[i - 1]; a[i - 1] = t; markDirty(); render(); }
          }) : null,
          el('button', {
            class: 'small danger', text: 'Remove',
            onclick: () => { getPath(profile, arrayPath).splice(i, 1); markDirty(); render(); }
          })
        ])
      ]);
      const grid = el('div', { class: 'grid' });
      specsFn(i).forEach((s) => grid.appendChild(field(s)));
      c.appendChild(el('div', { class: 'entry' }, [head, grid]));
    });
  }

  /* ------------------------------------------------------------ sections */

  function render() {
    mount('sec-personal', [
      { path: 'identity.firstName', label: 'First name', col: 4 },
      { path: 'identity.lastName', label: 'Last name', col: 4 },
      { path: 'identity.preferredName', label: 'Preferred name', col: 4 },
      { path: 'identity.email', label: 'Email', type: 'email', col: 6 },
      { path: 'identity.phone', label: 'Phone', type: 'tel', col: 6, normalize: 'phone', placeholder: '503-555-0142' },
      { path: 'identity.address.street', label: 'Street address', col: 8 },
      { path: 'identity.address.line2', label: 'Apt / unit', col: 4 },
      { path: 'identity.address.city', label: 'City', col: 5 },
      { path: 'identity.address.state', label: 'State', type: 'select', col: 3, allowBlank: true, options: S.STATES },
      { path: 'identity.address.zip', label: 'ZIP', col: 4, maxlength: 10 },
      { path: 'identity.veteranStatus', label: 'Veteran status', type: 'select', col: 3, options: E.veteranStatus },
      { path: 'identity.disabilityStatus', label: 'Disability status', type: 'select', col: 3, options: E.disabilityStatus },
      { path: 'identity.gender', label: 'Gender', type: 'select', col: 3, options: E.gender },
      { path: 'identity.raceEthnicity', label: 'Race / ethnicity', type: 'select', col: 3, options: E.raceEthnicity },
      { path: 'identity.workAuthorization', label: 'Authorized to work in the US', type: 'check', col: 4 },
      { path: 'identity.requiresSponsorship', label: 'Will require visa sponsorship', type: 'check', col: 4 },
      { path: 'identity.willingToRelocate', label: 'Willing to relocate', type: 'check', col: 4 }
    ]);

    mount('sec-credentials', [
      { path: 'nursingCredentials.npiNumber', label: 'NPI number', col: 4, maxlength: 10, hint: '(optional)' },
      { path: 'nursingCredentials.nclex.passDate', label: 'NCLEX pass date', type: 'month', col: 4 },
      { path: 'nursingCredentials.nclex.state', label: 'NCLEX state', type: 'select', col: 4, allowBlank: true, options: S.STATES }
    ]);

    renderList('list-licenses', 'licenses', 'License', S.blankLicense, (i) => [
      { path: `licenses[${i}].type`, label: 'Type', type: 'select', col: 2, options: E.licenseType },
      { path: `licenses[${i}].state`, label: 'State', type: 'select', col: 2, allowBlank: true, options: S.STATES },
      { path: `licenses[${i}].number`, label: 'License number', col: 4 },
      { path: `licenses[${i}].issueDate`, label: 'Issued', type: 'date', col: 2 },
      { path: `licenses[${i}].expirationDate`, label: 'Expires', type: 'date', col: 2 },
      { path: `licenses[${i}].isCompact`, label: 'Compact / multistate', type: 'check', col: 4 },
      { path: `licenses[${i}].isPrimaryState`, label: 'Primary state of residence', type: 'check', col: 4 },
      { path: `licenses[${i}].disciplinaryAction`, label: 'Has had disciplinary action', type: 'check', col: 4, rerender: true },
      ...(getPath(profile, `licenses[${i}].disciplinaryAction`) ? [
        { path: `licenses[${i}].disciplinaryExplanation`, label: 'Explanation (never auto-filled, kept for your reference)', type: 'textarea', col: 12 }
      ] : [])
    ]);

    renderList('list-certifications', 'certifications', 'Certification', S.blankCertification, (i) => [
      { path: `certifications[${i}].name`, label: 'Certification', type: 'select', col: 3, options: E.certName, rerender: true },
      ...(getPath(profile, `certifications[${i}].name`) === 'Other' ? [
        { path: `certifications[${i}].otherName`, label: 'Name it', col: 3 }
      ] : []),
      { path: `certifications[${i}].issuingBody`, label: 'Issuing body', type: 'select', col: 3, options: E.issuingBody },
      { path: `certifications[${i}].issueDate`, label: 'Issued', type: 'date', col: 3 },
      { path: `certifications[${i}].expirationDate`, label: 'Expires', type: 'date', col: 3 },
      { path: `certifications[${i}].verificationUrlOrCertId`, label: 'Card ID or verification link', col: 12 }
    ]);

    renderList('list-education', 'education', 'School', S.blankEducation, (i) => [
      { path: `education[${i}].degree`, label: 'Degree', type: 'select', col: 3, options: E.degree },
      { path: `education[${i}].major`, label: 'Major', col: 3 },
      { path: `education[${i}].school`, label: 'School', col: 6 },
      { path: `education[${i}].city`, label: 'City', col: 4 },
      { path: `education[${i}].state`, label: 'State', type: 'select', col: 2, allowBlank: true, options: S.STATES },
      { path: `education[${i}].graduationDate`, label: 'Graduated', type: 'month', col: 3 },
      { path: `education[${i}].gpa`, label: 'GPA', col: 3 }
    ]);

    renderList('list-experience', 'experience', 'Role', S.blankExperience, (i) => [
      { path: `experience[${i}].employer`, label: 'Employer', col: 6 },
      { path: `experience[${i}].title`, label: 'Job title', col: 6 },
      { path: `experience[${i}].facilityType`, label: 'Facility type', type: 'select', col: 3, options: E.facilityType },
      { path: `experience[${i}].traumaLevel`, label: 'Trauma level', type: 'select', col: 3, options: E.traumaLevel },
      { path: `experience[${i}].unit`, label: 'Unit / specialty', col: 3, placeholder: 'MICU' },
      { path: `experience[${i}].bedCount`, label: 'Bed count', col: 3, placeholder: '24' },
      { path: `experience[${i}].typicalRatio`, label: 'Typical ratio', col: 3, placeholder: '1:2' },
      { path: `experience[${i}].startDate`, label: 'Start', type: 'month', col: 3 },
      { path: `experience[${i}].endDate`, label: 'End', type: 'month', col: 3 },
      { path: `experience[${i}].isCurrent`, label: 'Current role', type: 'check', col: 3 },
      { path: `experience[${i}].supervisorName`, label: 'Supervisor name', col: 3 },
      { path: `experience[${i}].supervisorTitle`, label: 'Supervisor title', col: 3 },
      { path: `experience[${i}].supervisorPhone`, label: 'Supervisor phone', type: 'tel', col: 3, normalize: 'phone' },
      { path: `experience[${i}].supervisorEmail`, label: 'Supervisor email', type: 'email', col: 3 },
      { path: `experience[${i}].mayContact`, label: 'May contact this employer', type: 'check', col: 4 },
      { path: `experience[${i}].reasonForLeaving`, label: 'Reason for leaving', col: 8 },
      { path: `experience[${i}].responsibilities`, label: 'Responsibilities', type: 'textarea', col: 12, rows: 5 }
    ]);

    renderEmrChips();
    mount('sec-skills', [
      { path: 'clinicalSkills.procedures', label: 'Procedures and competencies (comma separated)', type: 'textarea', col: 12,
        placeholder: 'IV insertion, trach care, ventilator management, CRRT, titrating vasoactive infusions' }
    ]);
    bindCsv('clinicalSkills.procedures');

    renderList('list-languages', 'clinicalSkills.languages', 'Language', S.blankLanguage, (i) => [
      { path: `clinicalSkills.languages[${i}].language`, label: 'Language', col: 6 },
      { path: `clinicalSkills.languages[${i}].proficiency`, label: 'Proficiency', type: 'select', col: 6, options: E.proficiency }
    ]);

    mount('sec-preferences', [
      { path: 'preferences.shift', label: 'Shift', type: 'select', col: 3, options: E.shift },
      { path: 'preferences.shiftLength', label: 'Shift length', type: 'select', col: 3, options: E.shiftLength },
      { path: 'preferences.employmentType', label: 'Employment type', type: 'select', col: 3, options: E.employmentType },
      { path: 'preferences.minHourlyRate', label: 'Minimum hourly rate', col: 3, placeholder: '62' },
      { path: 'preferences.weekendAvailability', label: 'Available weekends', type: 'check', col: 3 },
      { path: 'preferences.holidayAvailability', label: 'Available holidays', type: 'check', col: 3 },
      { path: 'preferences.floatPoolWilling', label: 'Willing to float', type: 'check', col: 3 },
      { path: 'preferences.travelWilling', label: 'Willing to travel', type: 'check', col: 3 }
    ]);

    renderList('list-references', 'references', 'Reference', S.blankReference, (i) => [
      { path: `references[${i}].name`, label: 'Name', col: 4 },
      { path: `references[${i}].title`, label: 'Title', col: 4 },
      { path: `references[${i}].relationship`, label: 'Relationship', type: 'select', col: 4, options: E.relationship },
      { path: `references[${i}].employer`, label: 'Employer', col: 4 },
      { path: `references[${i}].phone`, label: 'Phone', type: 'tel', col: 4, normalize: 'phone' },
      { path: `references[${i}].email`, label: 'Email', type: 'email', col: 4 },
      { path: `references[${i}].mayContact`, label: 'May be contacted', type: 'check', col: 12 }
    ]);

    mount('sec-compliance', [
      { path: 'compliance.tbTestDate', label: 'TB test date', type: 'date', col: 3 },
      { path: 'compliance.tbTestType', label: 'TB test type', type: 'select', col: 3, options: E.tbTestType },
      { path: 'compliance.fluVaccineSeason', label: 'Flu vaccine season', col: 3, placeholder: '2025-2026' },
      { path: 'compliance.covidVaccineStatus', label: 'COVID status', type: 'select', col: 3, options: E.covidVaccineStatus },
      { path: 'compliance.hepBStatus', label: 'Hepatitis B', type: 'select', col: 4, options: E.hepBStatus },
      { path: 'compliance.mmrTiterDate', label: 'MMR titer date', type: 'date', col: 4 },
      { path: 'compliance.varicellaTiterDate', label: 'Varicella titer date', type: 'date', col: 4 },
      { path: 'compliance.drugScreenWilling', label: 'Will consent to a drug screen', type: 'check', col: 6 },
      { path: 'compliance.backgroundCheckWilling', label: 'Will consent to a background check', type: 'check', col: 6 }
    ]);

    mount('sec-documents', [
      { path: 'documents.resumeFileName', label: 'Resume file on record', col: 6 },
      { path: 'documents.coverLetterTemplate', label: 'Cover letter template', type: 'textarea', col: 12, rows: 8 },
      { path: 'documents.resumeText', label: 'Plain-text resume (pasted into text-only portals)', type: 'textarea', col: 12, rows: 6 }
    ]);

    renderSettings();
    renderIssues();
  }

  function renderEmrChips() {
    const c = $('#chips-emr');
    if (!c) return;
    c.textContent = '';
    const selected = profile.clinicalSkills.emrSystems || [];
    E.emrSystems.forEach((name) => {
      const on = selected.indexOf(name) !== -1;
      const chip = el('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(on), text: name,
        onclick: () => {
          const list = profile.clinicalSkills.emrSystems;
          const idx = list.indexOf(name);
          if (idx === -1) list.push(name); else list.splice(idx, 1);
          markDirty();
          renderEmrChips();
        }
      });
      c.appendChild(chip);
    });
  }

  /** Comma-separated textarea bound to a string array. */
  function bindCsv(path) {
    const container = $('#sec-skills');
    const ta = container && container.querySelector('textarea');
    if (!ta) return;
    ta.value = (getPath(profile, path) || []).join(', ');
    const sync = () => {
      setPath(profile, path, ta.value.split(',').map((s) => s.trim()).filter(Boolean));
      markDirty();
    };
    ta.addEventListener('input', sync);
    ta.addEventListener('change', sync);
  }

  function renderSettings() {
    const c = $('#sec-settings');
    c.textContent = '';

    // Settings persist on their own, separately from the profile. The API key
    // living only in memory until someone pressed Save profile was the reason
    // resume import could report "no API key" one second after you typed one.
    const key = el('input', { type: 'password', placeholder: 'sk-ant-…', id: 'na-api-key' });
    key.value = settings.apiKey || '';
    key.addEventListener('input', () => { settings.apiKey = key.value.trim(); });
    key.addEventListener('change', persistSettings);
    key.addEventListener('blur', persistSettings);
    c.appendChild(el('label', { class: 'field col-6' },
      [el('span', { class: 'lab', text: 'Anthropic API key (saved as you type it, kept on this machine, never exported)' }), key]));

    const mapModel = el('input', { type: 'text' });
    mapModel.value = settings.mappingModel;
    mapModel.addEventListener('input', () => { settings.mappingModel = mapModel.value.trim(); });
    mapModel.addEventListener('change', persistSettings);
    c.appendChild(el('label', { class: 'field col-3' },
      [el('span', { class: 'lab', text: 'Field-mapping model' }), mapModel]));

    const parseModel = el('input', { type: 'text' });
    parseModel.value = settings.parsingModel;
    parseModel.addEventListener('input', () => { settings.parsingModel = parseModel.value.trim(); });
    parseModel.addEventListener('change', persistSettings);
    c.appendChild(el('label', { class: 'field col-3' },
      [el('span', { class: 'lab', text: 'Resume-parsing model' }), parseModel]));

    [
      ['enableLlmFallback', 'Use the model for fields the rules cannot map'],
      ['enableTracker', 'Log applications to the tracker'],
      ['highlightFilled', 'Outline fields NurseApply filled'],
      ['fillDemographics', 'Answer voluntary EEO questions from my profile'],
      ['autoFillOnLoad', 'Fill automatically when a form loads (off is safer)']
    ].forEach(([k, label]) => {
      const input = el('input', { type: 'checkbox' });
      input.checked = !!settings[k];
      input.addEventListener('change', () => { settings[k] = input.checked; persistSettings(); });
      c.appendChild(el('label', { class: 'check col-6' }, [input, el('span', { text: label })]));
    });
  }

  /**
   * Nothing on this page is required. The profile saves whatever state it is
   * in, and filling works from whatever is there. This list is a reminder of
   * what hospital portals tend to ask for, so a blank licence number is
   * noticed here rather than halfway through an application.
   */
  function renderIssues() {
    const report = S.validateProfile(profile);
    const wrap = $('#issues-wrap');
    const ul = $('#issues');
    ul.textContent = '';
    const all = report.errors.concat(report.warnings);
    if (!all.length) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    all.slice(0, 30).forEach((issue) => {
      const li = el('li', {});
      li.appendChild(document.createTextNode(issue.msg));
      ul.appendChild(li);
    });
  }

  /* -------------------------------------------------------------- status */

  function markDirty() { dirty = true; setStatus('Unsaved changes.'); }

  /** Settings are written immediately; only the profile waits for Save. */
  let persistTimer = null;
  function persistSettings() {
    clearTimeout(persistTimer);
    return new Promise((resolve) => {
      persistTimer = setTimeout(async () => {
        try { settings = await NA.storage.setSettings(settings); } catch (e) { /* best effort */ }
        resolve(settings);
      }, 0);
    });
  }

  function setStatus(msg, tone) {
    const n = $('#status');
    n.className = 'msg' + (tone ? ' ' + tone : '');
    n.textContent = msg;
  }

  async function save() {
    await NA.storage.setProfile(profile);
    await NA.storage.setSettings(settings);
    dirty = false;
    renderIssues();
    // Always a clean save. A half-finished profile is a perfectly good profile:
    // it fills what it can and leaves the rest, which is better than refusing.
    setStatus('Saved.', 'ok');
  }

  /* --------------------------------------------------------- resume import */

  function modal(title, sub, bodyNodes, footNodes) {
    const rootEl = $('#modal-root');
    rootEl.textContent = '';
    const box = el('div', { class: 'modal' }, [
      el('h2', { text: title }),
      el('p', { class: 'sub', text: sub })
    ].concat(bodyNodes).concat([el('div', { class: 'row-actions', style: 'margin-top:18px' }, footNodes)]));
    const backdrop = el('div', { class: 'modal-backdrop' }, [box]);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) rootEl.textContent = ''; });
    rootEl.appendChild(backdrop);
    return { close: () => { rootEl.textContent = ''; } };
  }

  const MAX_STORED_RESUME_BYTES = 4 * 1024 * 1024;
  let lastResumeText = '';

  /**
   * Resume import runs on this machine. pdf.js reads the PDF, a small unzip
   * reads DOCX, and resumeParse.js turns the text into fields using the closed
   * vocabularies nursing gives us.
   *
   * The result is never applied silently. Rule-based extraction of a free-form
   * document is wrong often enough, and plausibly enough, that the only honest
   * design is to show the work and make corrections cheap. Three things back
   * each other up: the parser, Chrome's on-device model where it exists, and a
   * copy-and-paste handoff to whichever free assistant the user already has.
   */
  function openResumeImport() {
    const zone = el('div', { class: 'dropzone', text: 'Drop a PDF, DOCX or TXT resume here, or click to choose' });
    const input = el('input', { type: 'file', accept: '.pdf,.docx,.txt,.md', class: 'hidden' });
    const statusNode = el('p', { class: 'note', text: '' });

    const pick = (file) => handleResume(file, { statusNode, ui });

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('over');
      if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { if (input.files[0]) pick(input.files[0]); });

    const ui = modal(
      'Import resume',
      'Read on this computer. No API key, no upload, no account. You will get a chance to ' +
      'check every job before anything is saved.',
      [zone, input, statusNode],
      [el('button', { class: 'ghost', text: 'Close', onclick: () => ui.close() })]
    );
  }

  async function extractResumeText(file, buf, statusNode) {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const isDocx = /\.docx$/i.test(file.name);
    if (isPdf) {
      statusNode.textContent = 'Reading the PDF on this machine…';
      return { text: await NA.pdftext.extractText(buf), isPdf: true };
    }
    if (isDocx) return { text: await NA.docx.extractText(buf), isPdf: false };
    return { text: new TextDecoder().decode(buf), isPdf: false };
  }

  async function handleResume(file, ctx) {
    const { statusNode, ui } = ctx;
    statusNode.textContent = 'Reading ' + file.name + '…';
    try {
      const buf = await file.arrayBuffer();
      const size = buf.byteLength;
      const isPdfFile = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';

      // Read the bytes we intend to keep before any parser touches the buffer:
      // pdf.js transfers the ArrayBuffer to its worker, which detaches it.
      if (isPdfFile && size <= MAX_STORED_RESUME_BYTES) {
        profile.documents.resumeBase64 = bytesToBase64(new Uint8Array(buf));
        profile.documents.resumeMimeType = 'application/pdf';
      } else if (isPdfFile) {
        profile.documents.resumeBase64 = '';
        profile.documents.resumeMimeType = '';
      }

      const { text } = await extractResumeText(file, buf, statusNode);
      lastResumeText = text;
      profile.documents.resumeFileName = file.name;
      if (text) profile.documents.resumeText = text;
      markDirty();

      statusNode.textContent = 'Reading the layout…';
      const parsed = NA.resumeParse.parse(text);
      parsed.text = text;

      const meta = { source: file.name, issues: [] };
      await maybeRefineLocally(parsed, statusNode, meta);

      ui.close();
      openReview(parsed, meta);
    } catch (e) {
      statusNode.textContent = 'Could not read that file: ' + e.message;
    }
  }

  /**
   * Chrome 138 and later ship a small model that runs on the device. Where it
   * is present it is strictly better than the heuristics at telling an
   * employer from a job title, costs nothing, needs no key, and sends nothing
   * anywhere. Where it is absent nothing is said about it: a nurse on an old
   * laptop should not be shown a feature she cannot have.
   */
  async function maybeRefineLocally(parsed, statusNode, meta) {
    try {
      if (!(await NA.localModel.ready())) return;
      const roles = parsed.profile.experience || [];
      if (!roles.length) return;

      statusNode.textContent = 'Checking the jobs…';
      const fixes = await NA.localModel.refineRoles(roles, parsed.sources, {
        onProgress: (done, total) => {
          statusNode.textContent = `Checking the jobs… ${done} of ${total}`;
        }
      });
      if (!fixes) return;

      let changed = 0;
      fixes.forEach((fix, i) => {
        if (!fix) return;
        const role = roles[i];
        const cleanEmployer = fix.employer ? tidy(fix.employer) : '';
        const cleanTitle = fix.title ? tidy(fix.title) : '';
        if (cleanEmployer && cleanEmployer !== role.employer) { role.employer = cleanEmployer; changed++; }
        if (cleanTitle && cleanTitle !== role.title) { role.title = cleanTitle; changed++; }
      });
      if (changed) meta.refined = changed;
    } catch (e) {
      // Never let an optional accelerator break the import.
    }
  }

  /** Source lines carry their location and schedule noise; fields should not. */
  function tidy(line) {
    const RP = NA.resumeParse;
    let out = RP.splitRuns(String(line || '').trim());
    out = out.split(/\s*[|·•]\s*/)[0].trim();
    out = RP.stripScheduleNoise(out);
    const loc = RP.locationSuffix(out);
    if (loc && loc.head) out = loc.head;
    return RP.firstSentence(out).replace(/[,\s]+$/, '');
  }

  function openReview(parsed, meta) {
    NA.review.open(parsed, meta, {
      onApply: (reviewed) => {
        applyParsed(reviewed);
        render();
        markDirty();
        setStatus('Import applied. Read it through, then press Save profile.', 'ok');
      },
      onDiscard: () => setStatus('Import discarded. Nothing was changed.')
    });
  }

  /* ------------------------------------------------- chatbot handoff flow */

  const ASSISTANTS = [
    { name: 'ChatGPT', url: 'https://chatgpt.com/' },
    { name: 'Claude', url: 'https://claude.ai/new' },
    { name: 'Gemini', url: 'https://gemini.google.com/app' }
  ];

  /**
   * For when the parser gets a layout wrong and there is no on-device model.
   * The user already has a free assistant in a browser tab; this hands them a
   * finished prompt and reads back whatever they paste, however messy.
   */
  function openHandoff(resumeText) {
    const text = resumeText || lastResumeText || profile.documents.resumeText || '';

    // The resume text is editable and can start empty. A scanned PDF has no
    // text layer at all, and someone may simply want to paste what they have
    // rather than hunt for a file, so this path never depends on the parser
    // having succeeded, or on a file existing.
    const resumeBox = el('textarea', {
      placeholder: 'Your resume text. Import a file above to fill this in, or paste or type it here.'
    });
    resumeBox.value = text;
    resumeBox.style.minHeight = '110px';

    const promptBox = el('textarea', { class: 'hidden' });

    const copyNote = el('span', { class: 'note', style: 'margin:0' });
    const copy = el('button', {
      class: 'primary', text: 'Copy the question',
      onclick: async () => {
        const body = resumeBox.value.trim();
        if (!body) {
          copyNote.textContent = 'Put your resume text in the box first.';
          resumeBox.focus();
          return;
        }
        const prompt = NA.handoff.buildPrompt(body);
        promptBox.value = prompt;
        const ok = await copyToClipboard(prompt, promptBox);
        copyNote.textContent = ok
          ? 'Copied. Now open your assistant and paste it.'
          : 'Select the text below and copy it with Ctrl+C or Cmd+C.';
        if (!ok) { promptBox.classList.remove('hidden'); promptBox.select(); }
      }
    });

    const openers = ASSISTANTS.map((a) => el('button', {
      class: 'small ghost', text: 'Open ' + a.name,
      onclick: () => chrome.tabs.create({ url: a.url })
    }));

    const reply = el('textarea', { placeholder: 'Paste the whole answer here. Extra words around it are fine.' });
    reply.style.minHeight = '150px';

    const status = el('p', { class: 'note', text: '' });

    const use = el('button', {
      class: 'primary', text: 'Use the answer',
      onclick: () => {
        const result = NA.handoff.read(reply.value);
        if (!result.profile) {
          status.textContent = result.issues.map((i) => i.msg).join(' ');
          return;
        }
        ui.close();
        openReview(
          { profile: result.profile, sources: [], report: [], text: resumeBox.value,
            stats: {
              experience: result.profile.experience.length,
              licenses: result.profile.licenses.length,
              certifications: result.profile.certifications.length,
              education: result.profile.education.length,
              emrSystems: result.profile.clinicalSkills.emrSystems.length
            } },
          { source: 'From your assistant', issues: result.issues }
        );
      }
    });

    const steps = el('ol', { class: 'steps' }, [
      el('li', {}, [document.createTextNode('Press Copy the question.'),
        el('span', { class: 'sub', text: 'It puts your resume and the instructions on the clipboard.' })]),
      el('li', {}, [document.createTextNode('Open ChatGPT, Claude or Gemini and paste it in, then press enter.'),
        el('span', { class: 'sub', text: 'The free version is fine. You do not need to pay for anything.' })]),
      el('li', {}, [document.createTextNode('Select the whole answer, copy it, and paste it in the box below.'),
        el('span', { class: 'sub', text: 'If you copy extra words by accident it still works.' })])
    ]);

    const ui = modal(
      'Fix it with a chatbot',
      'Your resume goes to whichever assistant you choose, the same as if you had pasted it there yourself. ' +
      'Nothing is sent by this extension, and no API key is involved.',
      [steps,
       el('label', { class: 'field' },
         [el('span', { class: 'lab', text: 'Your resume text' }), resumeBox]),
       el('div', { class: 'row-actions', style: 'margin-top:12px' },
          [copy].concat(openers).concat([copyNote])),
       promptBox,
       el('label', { class: 'field', style: 'margin-top:16px' },
         [el('span', { class: 'lab', text: 'The answer' }), reply]),
       status],
      [use, el('button', { class: 'ghost', text: 'Close', onclick: () => ui.close() })]
    );
  }

  async function copyToClipboard(text, fallbackNode) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        fallbackNode.classList.remove('hidden');
        fallbackNode.select();
        return document.execCommand('copy');
      } catch (e2) { return false; }
    }
  }

  function applyParsed(parsed, opts) {
    if (!parsed || typeof parsed !== 'object') return;
    const onlyBlanks = !!(opts && opts.onlyFillBlanks);

    ['identity', 'nursingCredentials', 'clinicalSkills', 'compliance', 'preferences'].forEach((k) => {
      if (!parsed[k]) return;
      if (onlyBlanks) fillBlanksOnly(profile[k], parsed[k]);
      else S.mergeInto(profile[k], parsed[k]);
    });

    ['licenses', 'certifications', 'education', 'experience', 'references'].forEach((k) => {
      if (!Array.isArray(parsed[k]) || !parsed[k].length) return;
      const blank = {
        licenses: S.blankLicense, certifications: S.blankCertification,
        education: S.blankEducation, experience: S.blankExperience,
        references: S.blankReference
      }[k];
      if (onlyBlanks) {
        // Never renumber or reorder what the local parser already built. Only
        // top up empty fields in matching rows, and append genuinely new ones.
        parsed[k].forEach((row, i) => {
          if (profile[k][i]) fillBlanksOnly(profile[k][i], row);
          else profile[k].push(S.mergeInto(blank(), row));
        });
      } else {
        profile[k] = parsed[k].map((row) => S.mergeInto(blank(), row));
      }
    });

    if (parsed.identity && parsed.identity.phone) {
      profile.identity.phone = S.normalizePhone(profile.identity.phone || parsed.identity.phone);
    }
    if (profile.licenses.length && !profile.licenses.some((l) => l.isPrimaryState)) {
      profile.licenses[0].isPrimaryState = true;
    }
  }

  /** Writes only where the target is empty. Booleans are left alone entirely. */
  function fillBlanksOnly(target, source) {
    if (!target || !source) return;
    Object.keys(source).forEach((k) => {
      const incoming = source[k];
      const current = target[k];
      if (incoming === undefined || incoming === null || incoming === '') return;
      if (Array.isArray(incoming)) {
        if (!Array.isArray(current) || current.length === 0) target[k] = incoming.slice();
        return;
      }
      if (incoming && typeof incoming === 'object') {
        target[k] = target[k] && typeof target[k] === 'object' ? target[k] : {};
        fillBlanksOnly(target[k], incoming);
        return;
      }
      if (typeof incoming === 'boolean') return;
      if (current === '' || current === undefined || current === null) target[k] = incoming;
    });
  }

  function bytesToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
        resolve(res);
      });
    });
  }

  /* ------------------------------------------------------------- actions */

  function wire() {
    $('#btn-save').addEventListener('click', save);
    $('#btn-save-2').addEventListener('click', save);
    $('#btn-import-resume').addEventListener('click', openResumeImport);
    $('#btn-handoff').addEventListener('click', () => openHandoff());
    NA.review.wire();
    const reviewHandoff = $('#review-handoff');
    if (reviewHandoff) reviewHandoff.addEventListener('click', () => {
      const st = NA.review.state;
      NA.review.close();
      openHandoff(st && st.text);
    });
    $('#btn-tracker').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/tracker/tracker.html') });
    });

    $$('[data-add]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const which = btn.getAttribute('data-add');
        const blanks = {
          licenses: S.blankLicense, certifications: S.blankCertification,
          education: S.blankEducation, experience: S.blankExperience,
          references: S.blankReference, languages: S.blankLanguage
        };
        if (which === 'languages') profile.clinicalSkills.languages.push(blanks.languages());
        else profile[which].push(blanks[which]());
        markDirty();
        render();
      });
    });

    $('#btn-test-key').addEventListener('click', async () => {
      setStatus('Testing the key…');
      await NA.storage.setSettings(settings);
      const res = await sendMessage({ type: 'llm:test' });
      if (res && res.ok) setStatus('Key works. Model replied: ' + res.text, 'ok');
      else setStatus('Key test failed: ' + ((res && res.error) || 'no response'), 'bad');
    });

    $('#btn-clear-cache').addEventListener('click', async () => {
      const n = await NA.storage.clearCache();
      setStatus(`Cleared ${n} cached form mapping${n === 1 ? '' : 's'}.`, 'ok');
    });

    $('#btn-export').addEventListener('click', async () => {
      const payload = await NA.storage.exportAll();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = el('a', {
        href: URL.createObjectURL(blob),
        download: `nurseapply-backup-${S.todayIso()}.json`
      });
      document.body.appendChild(a); a.click(); a.remove();
      setStatus('Exported. The API key is deliberately left out of the file.', 'ok');
    });

    $('#btn-import').addEventListener('click', () => $('#file-import').click());
    $('#file-import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        await NA.storage.importAll(payload);
        profile = await NA.storage.getProfile();
        settings = await NA.storage.getSettings();
        render();
        setStatus('Backup restored.', 'ok');
      } catch (err) {
        setStatus('Import failed: ' + err.message, 'bad');
      }
      e.target.value = '';
    });

    $('#btn-wipe').addEventListener('click', () => {
      const confirmBtn = el('button', {
        class: 'danger', text: 'Yes, erase everything',
        onclick: async () => {
          await new Promise((r) => chrome.storage.local.clear(r));
          profile = S.emptyProfile();
          settings = Object.assign({}, NA.storage.DEFAULT_SETTINGS);
          ui.close(); render();
          setStatus('All local NurseApply data erased.', 'ok');
        }
      });
      const ui = modal(
        'Erase everything',
        'This deletes your profile, settings, application tracker and cached form mappings from this browser. It cannot be undone.',
        [], [confirmBtn, el('button', { class: 'ghost', text: 'Cancel', onclick: () => ui.close() })]
      );
    });

    window.addEventListener('beforeunload', (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  /* ---------------------------------------------------------------- boot */

  (async function boot() {
    profile = await NA.storage.getProfile();
    settings = await NA.storage.getSettings();
    if (!profile.licenses.length) profile.licenses.push(S.blankLicense());
    if (!profile.experience.length) profile.experience.push(S.blankExperience());
    if (!profile.education.length) profile.education.push(S.blankEducation());
    wire();
    render();
    setStatus('Loaded. Changes are kept on this computer only.');
  })();
})();
