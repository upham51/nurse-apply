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
    if (spec.required) lab.appendChild(el('em', { text: ' *' }));
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
      { path: 'identity.firstName', label: 'First name', col: 4, required: true },
      { path: 'identity.lastName', label: 'Last name', col: 4, required: true },
      { path: 'identity.preferredName', label: 'Preferred name', col: 4 },
      { path: 'identity.email', label: 'Email', type: 'email', col: 6, required: true },
      { path: 'identity.phone', label: 'Phone', type: 'tel', col: 6, required: true, normalize: 'phone', placeholder: '503-555-0142' },
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

  function renderIssues() {
    const report = S.validateProfile(profile);
    const wrap = $('#issues-wrap');
    const ul = $('#issues');
    ul.textContent = '';
    const all = report.errors.map((e) => ({ ...e, err: true })).concat(report.warnings);
    if (!all.length) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    all.slice(0, 30).forEach((issue) => {
      const li = el('li', { class: issue.err ? 'err' : '' });
      li.appendChild(document.createTextNode(issue.msg + ' '));
      li.appendChild(el('code', { text: issue.path }));
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
    const report = S.validateProfile(profile);
    await NA.storage.setProfile(profile);
    await NA.storage.setSettings(settings);
    dirty = false;
    renderIssues();
    setStatus(
      report.errors.length
        ? `Saved. ${report.errors.length} field${report.errors.length === 1 ? '' : 's'} still need attention.`
        : 'Saved.',
      report.errors.length ? 'bad' : 'ok'
    );
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

  /**
   * Resume import runs entirely on this machine by default. pdf.js pulls the
   * text out of a PDF, a small unzip reads DOCX, and resumeParse.js turns that
   * text into profile fields using the closed vocabularies nursing gives us:
   * an eight-item certification list, an eight-item EMR list, enumerated
   * degrees, units, license types and trauma levels, plus the fixed shapes of
   * dates, phone numbers, ZIPs and nurse-to-patient ratios.
   *
   * A model is only ever a second pass, offered afterwards, for the parts that
   * are genuinely ambiguous rather than merely unstructured.
   */
  function openResumeImport() {
    const zone = el('div', { class: 'dropzone', text: 'Drop a PDF, DOCX or TXT resume here, or click to choose' });
    const input = el('input', { type: 'file', accept: '.pdf,.docx,.txt,.md', class: 'hidden' });
    const statusNode = el('p', { class: 'note', text: '' });
    const resultNode = el('div', {});

    const pick = (file) => handleResume(file, { statusNode, resultNode, ui });

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
      'Read and parsed on this computer. No API key, no upload, no network. ' +
      'Nothing is stored until you press Save profile, so read every section first.',
      [zone, input, statusNode, resultNode],
      [el('button', { class: 'ghost', text: 'Close', onclick: () => ui.close() })]
    );
  }

  async function extractResumeText(file, buf, statusNode) {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const isDocx = /\.docx$/i.test(file.name);
    if (isPdf) {
      statusNode.textContent = 'Extracting text from the PDF on this machine…';
      return { text: await NA.pdftext.extractText(buf), isPdf: true };
    }
    if (isDocx) return { text: await NA.docx.extractText(buf), isPdf: false };
    return { text: new TextDecoder().decode(buf), isPdf: false };
  }

  async function handleResume(file, ctx) {
    const { statusNode, resultNode, ui } = ctx;
    resultNode.textContent = '';
    statusNode.textContent = 'Reading ' + file.name + '…';
    try {
      const buf = await file.arrayBuffer();
      const { text, isPdf } = await extractResumeText(file, buf, statusNode);

      profile.documents.resumeFileName = file.name;
      if (text) profile.documents.resumeText = text;

      if (isPdf) {
        // Keeping the bytes is what lets NurseApply attach the resume to a
        // portal file input later. chrome.storage.local has a quota, and a
        // failed write would take the rest of the profile with it.
        if (buf.byteLength <= MAX_STORED_RESUME_BYTES) {
          profile.documents.resumeBase64 = bytesToBase64(new Uint8Array(buf));
          profile.documents.resumeMimeType = 'application/pdf';
        } else {
          profile.documents.resumeBase64 = '';
          profile.documents.resumeMimeType = '';
        }
      }

      statusNode.textContent = 'Parsing…';
      const parsed = NA.resumeParse.parse(text);
      applyParsed(parsed.profile);
      render();
      markDirty();

      statusNode.textContent = summarise(parsed.stats, file.name, isPdf && buf.byteLength > MAX_STORED_RESUME_BYTES);
      resultNode.appendChild(reportList(parsed.report));
      resultNode.appendChild(refineRow(text, statusNode, resultNode));
    } catch (e) {
      statusNode.textContent = 'Could not import: ' + e.message;
    }
  }

  function summarise(stats, fileName, tooBigToStore) {
    if (!stats || !stats.lines) return 'Nothing readable came out of ' + fileName + '.';
    const bits = [];
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
    if (stats.experience) bits.push(plural(stats.experience, 'role'));
    if (stats.licenses) bits.push(plural(stats.licenses, 'license'));
    if (stats.certifications) bits.push(plural(stats.certifications, 'certification'));
    if (stats.education) bits.push(plural(stats.education, 'school'));
    if (stats.emrSystems) bits.push(plural(stats.emrSystems, 'EMR system'));
    if (stats.procedures) bits.push(plural(stats.procedures, 'skill'));
    const head = bits.length ? 'Found ' + bits.join(', ') + '.' : 'Read the file but recognised no profile fields.';
    return head + (tooBigToStore
      ? ' The PDF is over 4 MB so the file itself was not stored, only its text.'
      : ' Check every section, then press Save profile.');
  }

  function reportList(report) {
    const wrap = el('div', {});
    if (!report || !report.length) return wrap;
    const ul = el('ul', { class: 'issues' });
    report.slice(0, 12).forEach((r) => {
      ul.appendChild(el('li', { class: r.level === 'warn' ? 'err' : '', text: r.msg }));
    });
    wrap.appendChild(ul);
    return wrap;
  }

  /**
   * The optional second pass. Everything above already ran; this only exists
   * for the parts a rule cannot settle, and it is never on the critical path.
   */
  function refineRow(text, statusNode, resultNode) {
    const row = el('div', { class: 'row-actions', style: 'margin-top:12px' });

    if (!settings.apiKey) {
      row.appendChild(el('p', { class: 'note', style: 'margin:0',
        text: 'Anything the rules could not work out is listed above. Fill those in by hand, or add an Anthropic API key in Settings and a second pass can attempt them.' }));
      return row;
    }

    const btn = el('button', {
      class: 'ghost', text: 'Second pass with the model',
      onclick: async () => {
        btn.disabled = true;
        statusNode.textContent = 'Asking the model to fill the gaps. This takes a few seconds…';
        const res = await sendMessage({ type: 'llm:parseResume', text });
        if (!res || !res.ok) {
          statusNode.textContent = 'Second pass failed: ' + ((res && res.error) || 'no response');
          btn.disabled = false;
          return;
        }
        applyParsed(res.parsed, { onlyFillBlanks: true });
        render();
        markDirty();
        statusNode.textContent = 'Second pass applied to the blanks only. Existing values were left alone. Check it, then Save profile.';
        resultNode.textContent = '';
      }
    });
    row.appendChild(btn);
    row.appendChild(el('span', { class: 'note', style: 'margin:0;flex:1',
      text: 'Optional. Sends the resume text to Anthropic with your key, and only writes into fields the local parser left blank.' }));
    return row;
  }

  /**
   * Merges parsed output in without destroying anything the user already typed.
   * Arrays are replaced only when the model actually found entries.
   */
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
