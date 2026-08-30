/**
 * DOM injection utilities.
 *
 * The whole point of this file: React (Workday), Angular (iCIMS) and Oracle
 * ADF (Taleo) all keep their own copy of an input's value. Assigning
 * `el.value = x` mutates the DOM node but never tells the framework, so the
 * next re-render wipes it. Every write here goes through the prototype's
 * native value setter and then fires the events the framework listens for.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});

  const FILLED_ATTR = 'data-nurseapply-filled';
  const SKIPPED_ATTR = 'data-nurseapply-skipped';
  const ID_ATTR = 'data-nurseapply-id';

  let idCounter = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ------------------------------------------------------------ visibility */

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.disabled || el.readOnly) return false;
    if (el.type === 'hidden') return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    return true;
  }

  function isFilledByUs(el) {
    return el.getAttribute(FILLED_ATTR) === 'true';
  }

  /**
   * Core safety rule: never clobber something the user typed. A value we wrote
   * ourselves is fair game to rewrite; anything else is not.
   */
  function hasUserContent(el) {
    if (!el) return false;
    if (isFilledByUs(el)) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
      return String(el.value || '').trim().length > 0;
    }
    if (tag === 'select') {
      const v = String(el.value || '').trim();
      if (!v) return false;
      const opt = el.selectedOptions && el.selectedOptions[0];
      // A placeholder option ("Select One", "--") is not user content.
      if (opt && /^\s*(select|choose|--|please)\b/i.test(opt.textContent || '')) return false;
      return true;
    }
    if (el.isContentEditable) return String(el.textContent || '').trim().length > 0;
    if (tag === 'button') {
      // "State Washington Required" means the picker already says Washington.
      const combo = parseAriaCombo(el);
      if (combo.value) return true;
      const shown = cleanText(el.textContent);
      return !!shown && !/^\s*(select one|select|choose|--)\b/i.test(shown);
    }
    return false;
  }

  /* ------------------------------------------------------ label resolution */

  function cleanText(s) {
    return String(s || '').replace(/\s+/g, ' ').replace(/[*∗]/g, '').trim();
  }

  function isOptionControl(el) {
    const t = (el.type || '').toLowerCase();
    return t === 'radio' || t === 'checkbox' ||
      el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'checkbox';
  }

  /** The question text wrapping a radio or checkbox group. */
  function groupQuestion(el) {
    const group = el.closest('fieldset, [role="radiogroup"], [role="group"]');
    if (group) {
      const aria = group.getAttribute('aria-label');
      if (aria) return aria;
      const labelledBy = group.getAttribute('aria-labelledby');
      if (labelledBy) {
        const parts = labelledBy.split(/\s+/)
          .map((id) => el.ownerDocument.getElementById(id))
          .filter(Boolean)
          .map((n) => cleanText(n.textContent));
        if (parts.length) return parts.join(' ');
      }
      const legend = group.querySelector('legend, .legend, [class*="question" i], [class*="label" i]');
      if (legend) return cleanText(legend.textContent);
    }
    // No fieldset: look for a heading-ish node just above the group of inputs.
    const holder = el.closest('div, td, li, section');
    if (holder) {
      const prev = previousLabelish(holder);
      if (prev && prev.length > 12) return prev;
    }
    return '';
  }

  /**
   * Resolves the question a control belongs to.
   *
   * For a radio or checkbox this matters twice over: the element's own label is
   * usually just "Yes", and the actual question ("Have you ever been convicted
   * of a felony?") lives on the enclosing fieldset legend. Without the group
   * question the knockout guard has nothing to match against, so it goes first.
   * Pass {group: false} when you want only the option's own text.
   */
  function labelFor(el, opts) {
    const includeGroup = !opts || opts.group !== false;
    const parts = [];
    const push = (v) => { const c = cleanText(v); if (c) parts.push(c); };

    if (includeGroup && isOptionControl(el)) push(groupQuestion(el));

    if (el.id) {
      const doc = el.ownerDocument;
      const lab = doc.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (lab) push(lab.textContent);
    }
    const wrapping = el.closest('label');
    if (wrapping) push(onlyOwnText(wrapping));

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => {
        const n = el.ownerDocument.getElementById(id);
        if (n) push(n.textContent);
      });
    }
    push(el.getAttribute('aria-label'));
    push(el.getAttribute('placeholder'));
    push(el.getAttribute('title'));

    // Workday wraps each field in a div[data-automation-id]; Taleo uses tables.
    const group = el.closest('[data-automation-id], .field, .form-group, fieldset, td, li');
    if (group && parts.length === 0) {
      const legend = group.querySelector('legend, .label, [class*="label" i]');
      if (legend) push(legend.textContent);
    }
    if (parts.length === 0) {
      const prev = previousLabelish(el);
      if (prev) push(prev);
    }

    const combo = parseAriaCombo(el);
    if (combo.label) push(combo.label);
    push(el.getAttribute('name'));
    push(automationId(el));
    push(el.id);

    return parts.join(' | ').slice(0, 400);
  }

  function onlyOwnText(labelEl) {
    const clone = labelEl.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, button').forEach((n) => n.remove());
    return clone.textContent;
  }

  function previousLabelish(el) {
    let node = el;
    for (let hops = 0; hops < 4 && node; hops++) {
      let sib = node.previousElementSibling;
      while (sib) {
        const t = cleanText(sib.textContent);
        if (t && t.length < 160 && !sib.querySelector('input, select, textarea')) return t;
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return '';
  }

  /**
   * Workday puts its stable identifier on the field wrapper, not the control:
   * <div data-automation-id="formField-legalName--firstName"><input ...></div>.
   * Reading it off the input alone returned nothing, which blinded the whole
   * Workday adapter and threw away the best identifier on the page.
   */
  function automationId(el) {
    if (!el) return '';
    const own = el.getAttribute('data-automation-id');
    if (own) return own.replace(/^formField-/, '');
    const wrap = el.closest('[data-automation-id]');
    if (!wrap) return '';
    return (wrap.getAttribute('data-automation-id') || '').replace(/^formField-/, '');
  }

  /**
   * Workday's dropdowns are plain buttons whose aria-label carries the field
   * name, the current value and the word Required all run together:
   * "State Washington Required". Split so the label can be matched on and the
   * current value is not mistaken for emptiness.
   */
  function parseAriaCombo(el) {
    const raw = cleanText(el.getAttribute('aria-label'));
    if (!raw) return { label: '', value: '', required: false };
    const required = /\bRequired\s*$/i.test(raw);
    let rest = raw.replace(/\s*Required\s*$/i, '').trim();
    if (/select one\s*$/i.test(rest)) {
      return { label: rest.replace(/\s*select one\s*$/i, '').trim(), value: '', required };
    }
    // The field name is the leading words; the value is what follows. Use the
    // known field name when the wrapper gives one, otherwise take the first
    // one or two words.
    const auto = automationId(el).replace(/^.*--/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
    if (auto) {
      const re = new RegExp('^' + auto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*') + '\\s*', 'i');
      if (re.test(rest)) return { label: auto, value: rest.replace(re, '').trim(), required };
    }
    const words = rest.split(/\s+/);
    const label = words.slice(0, Math.min(2, words.length - 1)).join(' ');
    return { label: label || rest, value: words.slice(label ? label.split(' ').length : 0).join(' '), required };
  }

  function cssEscape(v) {
    if (root.CSS && typeof root.CSS.escape === 'function') return root.CSS.escape(v);
    return String(v).replace(/["\\\]\[#.:>+~*^$|()]/g, '\\$&');
  }

  /* ------------------------------------------------------ field collection */

  const FIELD_SELECTOR = [
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset])',
    'select',
    'textarea',
    '[contenteditable="true"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="radiogroup"]',
    'button[aria-haspopup="listbox"]',
    // Workday renders every dropdown as a bare <button> inside its field
    // wrapper, with no role and no aria-haspopup. Without this the country,
    // state, prefix and phone-type pickers were never even seen as fields.
    '[data-automation-id^="formField-"] button'
  ].join(',');

  /** Walk the document plus any open shadow roots. */
  function deepQueryAll(selector, rootNode) {
    const out = [];
    const seen = new Set();
    const walk = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      let found = [];
      try { found = Array.prototype.slice.call(node.querySelectorAll(selector)); } catch (e) { /* noop */ }
      found.forEach((n) => { if (out.indexOf(n) === -1) out.push(n); });
      let all = [];
      try { all = Array.prototype.slice.call(node.querySelectorAll('*')); } catch (e) { /* noop */ }
      all.forEach((n) => { if (n.shadowRoot) walk(n.shadowRoot); });
    };
    walk(rootNode || document);
    return out;
  }

  function fieldKind(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return el.multiple ? 'multiselect' : 'select';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'file') return 'file';
      if (t === 'date') return 'date';
      return 'text';
    }
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') return 'combobox';
    if (role === 'radiogroup') return 'radiogroup';
    if (role === 'listbox') return 'combobox';
    if (el.isContentEditable) return 'richtext';
    if (t === 'button') {
      // Only a button that sits inside a field wrapper is a picker. Next, Save
      // and Back are buttons too, and must never be touched.
      const wrap = el.closest('[data-automation-id^="formField-"]');
      if (wrap && !/\b(next|back|save|submit|continue|cancel|delete|remove|add)\b/i
        .test(cleanText(el.textContent))) return 'combobox';
    }
    return 'unknown';
  }

  function optionsFor(el) {
    const kind = fieldKind(el);
    if (kind === 'select' || kind === 'multiselect') {
      return Array.prototype.map.call(el.options, (o) => cleanText(o.textContent) || o.value)
        .filter(Boolean).slice(0, 120);
    }
    if (kind === 'radiogroup') {
      return Array.prototype.map.call(
        el.querySelectorAll('[role="radio"], input[type=radio]'),
        (r) => cleanText(labelFor(r, { group: false }))
      ).filter(Boolean).slice(0, 40);
    }
    if (kind === 'radio' && el.name) {
      return Array.prototype.map.call(
        el.ownerDocument.querySelectorAll(`input[type=radio][name="${cssEscape(el.name)}"]`),
        (r) => cleanText(labelFor(r, { group: false }))
      ).filter(Boolean).slice(0, 40);
    }
    if (kind === 'combobox') {
      const listId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
      const list = listId ? el.ownerDocument.getElementById(listId) : null;
      if (list) {
        return Array.prototype.map.call(
          list.querySelectorAll('[role="option"], li'),
          (o) => cleanText(o.textContent)
        ).filter(Boolean).slice(0, 120);
      }
    }
    return [];
  }

  /**
   * Returns a serializable descriptor per visible field. This is also the exact
   * shape sent to the model in Tier 3 (no values, ever, only structure).
   */
  function collectFields(rootNode) {
    const els = deepQueryAll(FIELD_SELECTOR, rootNode || document);
    const fields = [];
    const seenRadioGroups = new Set();

    els.forEach((el) => {
      if (!isVisible(el)) return;
      const kind = fieldKind(el);
      if (kind === 'unknown') return;
      if (kind === 'radio') {
        const key = el.name || labelFor(el);
        if (seenRadioGroups.has(key)) return;
        seenRadioGroups.add(key);
      }
      if (!el.getAttribute(ID_ATTR)) {
        el.setAttribute(ID_ATTR, 'naf_' + (++idCounter));
      }
      fields.push({
        naId: el.getAttribute(ID_ATTR),
        el,
        kind,
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        name: el.getAttribute('name') || '',
        id: el.id || '',
        automationId: automationId(el),
        label: labelFor(el),
        required: el.required || el.getAttribute('aria-required') === 'true',
        options: optionsFor(el),
        filled: isFilledByUs(el),
        userContent: hasUserContent(el)
      });
    });
    return fields;
  }

  /** Strip element references so the descriptor can cross a message boundary. */
  function serializeField(f) {
    return {
      naId: f.naId, kind: f.kind, type: f.type, label: f.label,
      name: f.name, id: f.id, required: !!f.required,
      options: (f.options || []).slice(0, 60)
    };
  }

  function byNaId(naId, rootNode) {
    return deepQueryAll(`[${ID_ATTR}="${cssEscape(naId)}"]`, rootNode || document)[0] || null;
  }

  /** Stable identity for a form layout, used as the LLM mapping cache key. */
  function fingerprintForm(fields) {
    const basis = fields
      .map((f) => `${f.kind}:${(f.automationId || f.name || f.id || f.label).slice(0, 60)}`)
      .sort()
      .join('|');
    let h = 5381;
    for (let i = 0; i < basis.length; i++) {
      h = ((h << 5) + h + basis.charCodeAt(i)) >>> 0;
    }
    return h.toString(36) + '_' + fields.length;
  }

  /* ---------------------------------------------------------- native write */

  function nativeSetter(el) {
    const proto =
      el instanceof root.HTMLTextAreaElement ? root.HTMLTextAreaElement.prototype :
      el instanceof root.HTMLSelectElement ? root.HTMLSelectElement.prototype :
      root.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) return desc.set;
    const own = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el) || {}, 'value'
    );
    return (own && own.set) || null;
  }

  function fireInputEvents(el, opts) {
    const o = opts || {};
    const ev = (name, Ctor, init) =>
      el.dispatchEvent(new Ctor(name, Object.assign({ bubbles: true }, init)));

    if (o.keys !== false) {
      ev('keydown', root.KeyboardEvent, { key: 'Unidentified', cancelable: true });
    }
    ev('input', root.InputEvent || root.Event, { cancelable: false });
    ev('change', root.Event);
    if (o.keys !== false) {
      ev('keyup', root.KeyboardEvent, { key: 'Unidentified', cancelable: true });
    }
    if (o.blur !== false) {
      ev('blur', root.FocusEvent || root.Event, { bubbles: false });
      el.dispatchEvent(new (root.FocusEvent || root.Event)('focusout', { bubbles: true }));
    }
  }

  /**
   * Writes a value in a way React/Angular/Vue actually observe.
   */
  function setNativeValue(el, value, opts) {
    const setter = nativeSetter(el);
    try { el.focus({ preventScroll: true }); } catch (e) { /* noop */ }
    if (setter) setter.call(el, value); else el.value = value;

    // React 15 and some Angular builds cache the previous value on the node.
    if (el._valueTracker && typeof el._valueTracker.setValue === 'function') {
      el._valueTracker.setValue('');
    }
    fireInputEvents(el, opts);
    return String(el.value) === String(value);
  }

  function setContentEditable(el, value) {
    try { el.focus({ preventScroll: true }); } catch (e) { /* noop */ }
    el.textContent = value;
    el.dispatchEvent(new (root.InputEvent || root.Event)('input', { bubbles: true }));
    el.dispatchEvent(new root.Event('change', { bubbles: true }));
    el.dispatchEvent(new root.Event('blur', { bubbles: true }));
    return cleanText(el.textContent) === cleanText(value);
  }

  /* ------------------------------------------------------------- matching */

  function normalizeForMatch(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[^a-z0-9'+\/ ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 0..1 similarity, tuned for short option labels rather than prose. */
  function similarity(a, b) {
    const x = normalizeForMatch(a);
    const y = normalizeForMatch(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.indexOf(y) === 0 || y.indexOf(x) === 0) return 0.92;
    if (x.indexOf(y) !== -1 || y.indexOf(x) !== -1) return 0.82;
    const xt = new Set(x.split(' '));
    const yt = new Set(y.split(' '));
    let hits = 0;
    xt.forEach((t) => { if (yt.has(t)) hits++; });
    const denom = Math.max(xt.size, yt.size);
    return denom ? (hits / denom) * 0.78 : 0;
  }

  function bestMatch(candidates, target, threshold) {
    let best = null;
    let bestScore = threshold === undefined ? 0.55 : threshold;
    candidates.forEach((c) => {
      const text = typeof c === 'string' ? c : c.text;
      const s = similarity(text, target);
      if (s > bestScore) { bestScore = s; best = c; }
    });
    return best === null ? null : { match: best, score: bestScore };
  }

  /* -------------------------------------------------------- native select */

  function fillSelect(el, value) {
    const opts = Array.prototype.slice.call(el.options);
    const candidates = opts.map((o, i) => ({
      text: cleanText(o.textContent), value: o.value, index: i
    }));

    let chosen = candidates.find((c) => c.value && c.value === value);
    if (!chosen) chosen = candidates.find((c) => normalizeForMatch(c.text) === normalizeForMatch(value));
    if (!chosen) {
      const b = bestMatch(candidates, value, 0.6);
      chosen = b && b.match;
    }
    if (!chosen) return false;

    el.selectedIndex = chosen.index;
    const setter = nativeSetter(el);
    if (setter) { try { setter.call(el, chosen.value); } catch (e) { /* noop */ } }
    fireInputEvents(el, { keys: false });
    return el.selectedIndex === chosen.index;
  }

  /* ------------------------------------------------------ custom combobox */

  function findOpenListbox(doc, trigger) {
    const owned = trigger.getAttribute('aria-controls') || trigger.getAttribute('aria-owns');
    if (owned) {
      const n = doc.getElementById(owned);
      if (n && isVisible(n)) return n;
    }
    const lists = Array.prototype.slice.call(
      doc.querySelectorAll('[role="listbox"], [role="menu"], ul[class*="option" i], div[class*="dropdown" i][class*="open" i]')
    ).filter(isVisible);
    if (!lists.length) return null;
    // Prefer the listbox nearest the trigger in the DOM.
    lists.sort((a, b) => distanceToTrigger(a, trigger) - distanceToTrigger(b, trigger));
    return lists[0];
  }

  function distanceToTrigger(node, trigger) {
    const a = node.getBoundingClientRect();
    const b = trigger.getBoundingClientRect();
    return Math.abs(a.top - b.bottom) + Math.abs(a.left - b.left);
  }

  function listOptions(listbox) {
    let nodes = Array.prototype.slice.call(listbox.querySelectorAll('[role="option"]'));
    if (!nodes.length) nodes = Array.prototype.slice.call(listbox.querySelectorAll('li, [role="menuitem"], [role="treeitem"]'));
    if (!nodes.length) nodes = Array.prototype.slice.call(listbox.children);
    return nodes.filter((n) => isVisible(n) && cleanText(n.textContent));
  }

  function realClick(el) {
    const rect = el.getBoundingClientRect();
    const init = {
      bubbles: true, cancelable: true, view: root,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2)
    };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      const Ctor = type.indexOf('pointer') === 0 && root.PointerEvent
        ? root.PointerEvent : root.MouseEvent;
      try { el.dispatchEvent(new Ctor(type, init)); } catch (e) { el.dispatchEvent(new root.Event(type, { bubbles: true })); }
    });
    if (typeof el.click === 'function') { try { el.click(); } catch (e) { /* noop */ } }
  }

  /**
   * Drives the searchable ARIA dropdowns Workday and Taleo use for state
   * boards, certifying bodies and unit specialties. Returns true on a match.
   */
  async function selectCustomCombobox(trigger, searchText, opts) {
    const o = opts || {};
    const doc = trigger.ownerDocument;
    if (!searchText) return false;

    try { trigger.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) { /* noop */ }
    try { trigger.focus({ preventScroll: true }); } catch (e) { /* noop */ }
    realClick(trigger);
    await sleep(o.openDelay || 150);

    let listbox = findOpenListbox(doc, trigger);
    if (!listbox) {
      // Some implementations only open on ArrowDown.
      trigger.dispatchEvent(new root.KeyboardEvent('keydown', {
        key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true
      }));
      await sleep(150);
      listbox = findOpenListbox(doc, trigger);
    }
    if (!listbox) return false;

    // Type into the search box if the widget exposes one. This is what makes
    // 50-state and 200-specialty lists tractable.
    const searchInput =
      (trigger.tagName === 'INPUT' ? trigger : null) ||
      listbox.querySelector('input[type=text], input:not([type])') ||
      doc.querySelector('[role="combobox"] input:not([type=hidden])');
    if (searchInput && isVisible(searchInput)) {
      setNativeValue(searchInput, searchText, { blur: false });
      await sleep(o.searchDelay || 300);
      listbox = findOpenListbox(doc, trigger) || listbox;
    }

    let options = listOptions(listbox);
    if (!options.length) { await sleep(250); options = listOptions(findOpenListbox(doc, trigger) || listbox); }
    if (!options.length) return false;

    const scored = options.map((n) => ({ node: n, text: cleanText(n.textContent) }));
    const b = bestMatch(scored, searchText, o.threshold === undefined ? 0.6 : o.threshold);
    if (!b) {
      // Close the popup so we do not leave the page in a weird state.
      trigger.dispatchEvent(new root.KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true
      }));
      return false;
    }

    realClick(b.match.node);
    await sleep(o.settleDelay || 120);
    return true;
  }

  /* -------------------------------------------------- radios and checkboxes */

  function setRadioOrCheckbox(el, boolValue) {
    const want = !!boolValue;
    if (el.checked === want) { markFilled(el); return true; }
    try { el.focus({ preventScroll: true }); } catch (e) { /* noop */ }
    el.checked = want;
    realClick(el);
    el.checked = want; // a cancelled click handler can flip it back
    el.dispatchEvent(new root.Event('input', { bubbles: true }));
    el.dispatchEvent(new root.Event('change', { bubbles: true }));
    return el.checked === want;
  }

  /** Picks the radio in a group whose label best matches `value`. */
  function selectRadioInGroup(anyRadio, value) {
    const doc = anyRadio.ownerDocument;
    let group;
    if (anyRadio.name) {
      group = Array.prototype.slice.call(
        doc.querySelectorAll(`input[type=radio][name="${cssEscape(anyRadio.name)}"]`)
      );
    } else {
      const container = anyRadio.closest('[role="radiogroup"], fieldset, .form-group') || doc;
      group = Array.prototype.slice.call(container.querySelectorAll('input[type=radio], [role="radio"]'));
    }
    group = group.filter(isVisible);
    if (!group.length) return false;

    const scored = group.map((r) => ({ node: r, text: labelFor(r, { group: false }) }));
    const b = bestMatch(scored, String(value), 0.55);
    if (!b) return false;
    const node = b.match.node;
    if (node.tagName === 'INPUT') return setRadioOrCheckbox(node, true);
    realClick(node);
    return node.getAttribute('aria-checked') === 'true';
  }

  /* ------------------------------------------------------------ file input */

  /**
   * Injects a stored resume into a native file input. Requires the base64 copy
   * saved in the profile. Drag/drop-only widgets are reported as skipped.
   */
  function attachFile(el, fileName, base64, mimeType) {
    if (!base64 || typeof root.DataTransfer !== 'function') return false;
    try {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], fileName || 'resume.pdf', {
        type: mimeType || 'application/pdf'
      });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      el.dispatchEvent(new root.Event('input', { bubbles: true }));
      el.dispatchEvent(new root.Event('change', { bubbles: true }));
      const dropTarget = el.closest('[class*="drop" i], [class*="upload" i]') || el;
      const drop = new root.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
      dropTarget.dispatchEvent(drop);
      return el.files && el.files.length === 1;
    } catch (e) {
      return false;
    }
  }

  /* --------------------------------------------------------- visual marks */

  let highlightColor = '#14b8a6';
  function setHighlightColor(c) { highlightColor = c || '#14b8a6'; }

  function markFilled(el) {
    el.setAttribute(FILLED_ATTR, 'true');
    el.removeAttribute(SKIPPED_ATTR);
    el.style.setProperty('outline', `2px solid ${highlightColor}`, 'important');
    el.style.setProperty('outline-offset', '1px', 'important');
    el.style.setProperty('border-radius', '4px');
  }

  function markSkipped(el) {
    if (!el) return;
    el.setAttribute(SKIPPED_ATTR, 'true');
    el.style.setProperty('outline', '2px dashed #f59e0b', 'important');
    el.style.setProperty('outline-offset', '1px', 'important');
  }

  function clearMarks(rootNode) {
    deepQueryAll(`[${FILLED_ATTR}], [${SKIPPED_ATTR}]`, rootNode || document).forEach((el) => {
      el.removeAttribute(FILLED_ATTR);
      el.removeAttribute(SKIPPED_ATTR);
      el.style.removeProperty('outline');
      el.style.removeProperty('outline-offset');
    });
  }

  function scrollTo(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* noop */ }
    const prev = el.style.boxShadow;
    el.style.setProperty('box-shadow', '0 0 0 6px rgba(245,158,11,0.35)', 'important');
    setTimeout(() => { el.style.boxShadow = prev; }, 1600);
  }

  /* ------------------------------------------------------------ dispatcher */

  /**
   * Single entry point used by the mapper: applies `value` to `field` using
   * whatever technique that control needs. Returns
   * {ok, reason} so callers can route failures into the skipped drawer.
   */
  async function applyValue(field, value, opts) {
    const el = field.el || byNaId(field.naId);
    if (!el || !el.isConnected) return { ok: false, reason: 'element-gone' };
    if (!isVisible(el)) return { ok: false, reason: 'not-visible' };
    if (hasUserContent(el)) return { ok: false, reason: 'user-typed' };
    if (value === undefined || value === null || value === '') {
      return { ok: false, reason: 'no-value' };
    }

    let ok = false;
    switch (field.kind) {
      case 'text':
      case 'date':
      case 'textarea':
        ok = setNativeValue(el, String(value));
        break;
      case 'richtext':
        ok = setContentEditable(el, String(value));
        break;
      case 'select':
        ok = fillSelect(el, String(value));
        break;
      case 'multiselect':
        ok = (Array.isArray(value) ? value : [value]).map((v) => fillSelect(el, String(v))).some(Boolean);
        break;
      case 'checkbox':
        ok = setRadioOrCheckbox(el, coerceBool(value));
        break;
      case 'radio':
      case 'radiogroup':
        ok = typeof value === 'boolean'
          ? selectRadioInGroup(el, value ? 'Yes' : 'No')
          : selectRadioInGroup(el, String(value));
        break;
      case 'combobox':
        ok = await selectCustomCombobox(el, String(value), opts);
        break;
      case 'file':
        ok = attachFile(el, (opts && opts.fileName), (opts && opts.base64), (opts && opts.mimeType));
        break;
      default:
        return { ok: false, reason: 'unsupported-control' };
    }

    if (ok) { markFilled(el); return { ok: true }; }
    return { ok: false, reason: 'write-rejected' };
  }

  function coerceBool(v) {
    if (typeof v === 'boolean') return v;
    return /^(y|yes|true|1)$/i.test(String(v).trim());
  }

  NA.dom = {
    FILLED_ATTR, SKIPPED_ATTR, ID_ATTR, FIELD_SELECTOR,
    sleep, isVisible, hasUserContent, isFilledByUs,
    labelFor, cleanText, cssEscape, automationId, parseAriaCombo,
    deepQueryAll, collectFields, serializeField, byNaId, fieldKind,
    optionsFor, fingerprintForm,
    setNativeValue, setContentEditable, fillSelect, selectCustomCombobox,
    setRadioOrCheckbox, selectRadioInGroup, attachFile, realClick,
    groupQuestion, isOptionControl,
    normalizeForMatch, similarity, bestMatch, coerceBool,
    markFilled, markSkipped, clearMarks, scrollTo, setHighlightColor,
    applyValue
  };
})(typeof self !== 'undefined' ? self : this);
