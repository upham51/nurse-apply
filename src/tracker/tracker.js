(function () {
  'use strict';
  const NA = self.NA;
  const $ = (s) => document.querySelector(s);
  const STATUSES = ['Draft', 'Submitted', 'Interviewing', 'Offered', 'Archived'];

  let rows = [];

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

  const fmt = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  function filtered() {
    const q = $('#q').value.trim().toLowerCase();
    const st = $('#filter-status').value;
    const ats = $('#filter-ats').value;
    return rows.filter((r) => {
      if (st && r.status !== st) return false;
      if (ats && r.atsType !== ats) return false;
      if (!q) return true;
      return [r.company, r.role, r.location, r.notes, r.atsType]
        .join(' ').toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderKpis() {
    const c = $('#kpis');
    c.textContent = '';
    const counts = { total: rows.length };
    STATUSES.forEach((s) => { counts[s] = rows.filter((r) => r.status === s).length; });
    [['total', 'Tracked'], ['Draft', 'Draft'], ['Submitted', 'Submitted'],
     ['Interviewing', 'Interviewing'], ['Offered', 'Offered']].forEach(([k, label]) => {
      c.appendChild(el('span', { class: 'kpi' }, [
        el('div', { class: 'n', text: String(counts[k] || 0) }),
        el('div', { class: 'l', text: label })
      ]));
    });
  }

  function renderFilters() {
    const sel = $('#filter-ats');
    const current = sel.value;
    const kinds = Array.from(new Set(rows.map((r) => r.atsType).filter(Boolean))).sort();
    sel.textContent = '';
    sel.appendChild(el('option', { value: '', text: 'All portals' }));
    kinds.forEach((k) => sel.appendChild(el('option', { value: k, text: k })));
    sel.value = current;
  }

  function render() {
    renderKpis();
    renderFilters();
    const body = $('#rows');
    body.textContent = '';
    const list = filtered();
    $('#empty').classList.toggle('hidden', rows.length > 0);

    list.forEach((r) => {
      const status = el('select');
      STATUSES.forEach((s) => status.appendChild(el('option', { value: s, text: s })));
      status.value = r.status;
      status.addEventListener('change', async () => {
        await NA.storage.updateApplication(r.id, { status: status.value });
        r.status = status.value;
        renderKpis();
        setStatus('Updated ' + r.company + '.');
      });

      const notes = el('input', { type: 'text', placeholder: 'Recruiter, rate, follow-up' });
      notes.value = r.notes || '';
      let timer = null;
      notes.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          await NA.storage.updateApplication(r.id, { notes: notes.value });
          r.notes = notes.value;
          setStatus('Note saved.');
        }, 500);
      });

      const del = el('button', {
        class: 'small ghost', text: 'Remove',
        onclick: async () => {
          await NA.storage.deleteApplication(r.id);
          rows = rows.filter((x) => x.id !== r.id);
          render();
          setStatus('Removed.');
        }
      });

      const companyCell = r.url
        ? el('a', { href: r.url, target: '_blank', rel: 'noopener', text: r.company })
        : document.createTextNode(r.company);

      body.appendChild(el('tr', {}, [
        el('td', {}, [companyCell]),
        el('td', { class: 'wrap', text: r.role }),
        el('td', { text: r.location || '' }),
        el('td', { text: r.atsType || '' }),
        el('td', { text: fmt(r.dateStarted) }),
        el('td', {}, [status]),
        el('td', { class: 'wrap' }, [notes]),
        el('td', {}, [del])
      ]));
    });
  }

  function toCsv(list) {
    const cols = ['company', 'role', 'location', 'atsType', 'status',
                  'dateStarted', 'dateUpdated', 'fieldsFilled', 'fieldsSkipped', 'notes', 'url'];
    const esc = (v) => {
      const s = v === undefined || v === null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cols.join(',')]
      .concat(list.map((r) => cols.map((c) => esc(r[c])).join(',')))
      .join('\n');
  }

  function setStatus(msg) { $('#status').textContent = msg; }

  (async function boot() {
    rows = await NA.storage.getTracker();
    ['#q', '#filter-status', '#filter-ats'].forEach((s) => {
      $(s).addEventListener('input', render);
      $(s).addEventListener('change', render);
    });
    $('#btn-profile').addEventListener('click', () => chrome.runtime.openOptionsPage());
    $('#btn-csv').addEventListener('click', () => {
      const blob = new Blob([toCsv(filtered())], { type: 'text/csv' });
      const a = el('a', {
        href: URL.createObjectURL(blob),
        download: 'nurseapply-applications-' + NA.schema.todayIso() + '.csv'
      });
      document.body.appendChild(a); a.click(); a.remove();
      setStatus('CSV exported.');
    });
    render();
    setStatus(rows.length + ' application' + (rows.length === 1 ? '' : 's') + ' tracked on this computer.');
  })();
})();
