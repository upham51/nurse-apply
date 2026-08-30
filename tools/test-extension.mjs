/**
 * Loads the packaged extension into a real Chromium and drives the options
 * page for real. This is the only harness that runs under actual MV3 rules:
 * the chrome-extension:// origin, the extension CSP, real chrome.storage,
 * a real service worker, and real dynamic import of the vendored pdf.js.
 */
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(repo, 'dist', 'nurseapply');
if (!existsSync(join(ext, 'manifest.json'))) {
  console.error('Run `npm run package` first: no dist/nurseapply to load.');
  process.exit(1);
}

let failures = 0;
const ok = (m) => { console.log('  ok    ' + m); return 0; };
const bad = (m) => { console.error('  FAIL  ' + m); return 1; };

const EXEC = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome'
].filter(Boolean).find(existsSync);

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'na-')), {
  executablePath: EXEC,
  headless: true,
  channel: EXEC ? undefined : 'chromium',
  args: [
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
    '--no-sandbox'
  ]
});

const problems = [];
ctx.on('weberror', (e) => problems.push('page error: ' + e.error().message));

// Find the extension id from its service worker.
let worker = ctx.serviceWorkers()[0];
if (!worker) worker = await ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);

console.log('\nExtension loads:');
failures += worker ? ok('service worker started: ' + worker.url().split('/')[2])
                   : bad('no service worker started, the extension did not load');
if (!worker) { await ctx.close(); process.exit(1); }
const id = worker.url().split('/')[2];

const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push('console.error: ' + m.text()); });

await page.goto(`chrome-extension://${id}/src/options/options.html`);
await page.waitForFunction(() => !!(window.NA && window.NA.resumeParse), null, { timeout: 15000 })
  .catch(() => {});

console.log('\nOptions page under the real extension CSP:');
const loaded = await page.evaluate(() => ({
  schema: !!(window.NA && window.NA.schema),
  storage: !!(window.NA && window.NA.storage),
  docx: !!(window.NA && window.NA.docx),
  pdftext: !!(window.NA && window.NA.pdftext),
  resumeParse: !!(window.NA && window.NA.resumeParse)
}));
Object.entries(loaded).forEach(([k, v]) => { failures += v ? ok(`NA.${k} loaded`) : bad(`NA.${k} missing`); });

await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));

console.log('\nDynamic import of the vendored pdf.js (the MV3-only risk):');
const pdfLoad = await page.evaluate(async () => {
  try {
    const lib = await window.NA.pdftext.loadPdfjs();
    return { ok: true, hasGetDocument: typeof lib.getDocument === 'function',
             worker: lib.GlobalWorkerOptions.workerSrc };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});
failures += pdfLoad.ok && pdfLoad.hasGetDocument
  ? ok('pdf.js imported inside the extension, worker at ' + String(pdfLoad.worker).split('/').pop())
  : bad('pdf.js failed to import: ' + (pdfLoad.error || 'no getDocument export'));

console.log('\nEnd to end: a real PDF through the real extension:');
const pdfBytes = Array.from(readFileSync(join(repo, 'tools/fixtures/resumes/a-classic.pdf')));
const result = await page.evaluate(async (bytes) => {
  try {
    const text = await window.NA.pdftext.extractText(new Uint8Array(bytes).buffer);
    const parsed = window.NA.resumeParse.parse(text);
    return { ok: true, chars: text.length, stats: parsed.stats,
             first: parsed.profile.identity.firstName,
             unit: (parsed.profile.experience[0] || {}).unit };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}, pdfBytes);

if (!result.ok) {
  failures += bad('extraction threw inside the extension: ' + result.error);
} else {
  failures += result.chars > 800 ? ok(`extracted ${result.chars} characters`) : bad(`only ${result.chars} characters`);
  failures += result.first === 'Jordan' ? ok('parsed name from the PDF') : bad('name came out as ' + JSON.stringify(result.first));
  failures += result.unit === 'MICU' ? ok('parsed unit from the PDF') : bad('unit came out as ' + JSON.stringify(result.unit));
  console.log('  stats: ' + JSON.stringify(result.stats));
}

console.log('\nThe options page import path, end to end:');
// Drives handleResume the way the file picker does, so the whole sequence runs:
// read bytes, keep them for upload, extract, parse, render. Calling the pdf
// library alone missed a detached-buffer bug that only this path hits.
const importPath = await page.evaluate(async (bytes) => {
  const file = new File([new Uint8Array(bytes)], 'a-classic.pdf', { type: 'application/pdf' });
  const input = document.createElement('input');
  input.type = 'file';
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;

  document.getElementById('btn-import-resume').click();
  await new Promise((r) => setTimeout(r, 200));
  const zone = document.querySelector('.modal .dropzone');
  if (!zone) return { ok: false, error: 'import modal did not open' };

  const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
  zone.dispatchEvent(drop);

  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const note = document.querySelector('.modal p.note');
    const msg = note ? note.textContent : '';
    if (/Could not read that file/i.test(msg)) return { ok: false, error: msg };
    const review = document.getElementById('review');
    if (review && !review.classList.contains('hidden')) {
      const roles = document.querySelectorAll('#review-roles .entry').length;
      const summary = (document.getElementById('review-summary') || {}).textContent || '';
      return { ok: true, roles, summary: summary.trim() };
    }
  }
  const note = document.querySelector('.modal p.note');
  return { ok: false, error: 'timed out, last status: ' + (note ? note.textContent : 'none') };
}, pdfBytes);

failures += importPath.ok
  ? ok(`drop-to-parse opened the review panel with ${importPath.roles} roles`)
  : bad('import path failed: ' + importPath.error);

if (importPath.ok) {
  console.log('\nThe review panel, which is the only thing standing between a misread and a submitted application:');
  failures += /Nothing is saved until you press Use this/.test(importPath.summary)
    ? ok('says nothing is saved yet')
    : bad('the summary does not say the import is unsaved: ' + JSON.stringify(importPath.summary));

  // Nothing may have reached the profile yet.
  const beforeApply = await page.evaluate(async () => {
    const p = await window.NA.storage.getProfile();
    return p.experience.filter((x) => x.employer).length;
  });
  failures += beforeApply === 0
    ? ok('no job has been written to storage before the user approves')
    : bad(beforeApply + ' jobs were saved without approval');

  // The whole-document swap: one click, every role.
  const swap = await page.evaluate(async () => {
    const before = window.NA.review.state.profile.experience.map((r) => [r.employer, r.title]);
    const btns = Array.from(document.querySelectorAll('#review-swap button'));
    const target = btns.find((b) => /swap them/i.test(b.textContent));
    if (!target) return { ok: false, error: 'no swap button' };
    target.click();
    await new Promise((r) => setTimeout(r, 100));
    const after = window.NA.review.state.profile.experience.map((r) => [r.employer, r.title]);
    return {
      ok: true,
      count: before.length,
      allSwapped: before.every((b, i) => after[i][0] === b[1] && after[i][1] === b[0])
    };
  });
  failures += swap.ok && swap.allSwapped
    ? ok(`one click swapped employer and title on all ${swap.count} roles`)
    : bad('the document-wide swap did not work: ' + JSON.stringify(swap));

  // Put it back, then check the source lines are shown and clickable.
  const reassign = await page.evaluate(async () => {
    window.NA.review.swapAll();
    await new Promise((r) => setTimeout(r, 80));
    const toggle = Array.from(document.querySelectorAll('#review-roles button'))
      .find((b) => /Where did this come from/i.test(b.textContent));
    if (!toggle) return { ok: false, error: 'no source-lines toggle' };
    toggle.click();
    await new Promise((r) => setTimeout(r, 80));
    const lines = document.querySelectorAll('#review-roles .srcline');
    if (!lines.length) return { ok: false, error: 'no source lines shown' };
    const text = lines[0].querySelector('.txt').textContent;
    const employerBtn = Array.from(lines[0].querySelectorAll('button'))
      .find((b) => b.textContent === 'Employer');
    employerBtn.click();
    await new Promise((r) => setTimeout(r, 80));
    return { ok: true, lineCount: lines.length,
             assigned: window.NA.review.state.profile.experience[0].employer === text };
  });
  failures += reassign.ok && reassign.assigned
    ? ok(`the resume lines are shown (${reassign.lineCount}) and clicking one assigns it`)
    : bad('source-line reassignment failed: ' + JSON.stringify(reassign));

  // Approve, and only now should anything reach storage.
  const applied = await page.evaluate(async () => {
    document.getElementById('review-apply').click();
    await new Promise((r) => setTimeout(r, 200));
    const hidden = document.getElementById('review').classList.contains('hidden');
    const fileField = document.querySelector('#sec-documents input');
    return { hidden, fileName: fileField ? fileField.value : '' };
  });
  failures += applied.hidden ? ok('the review panel closes on approval') : bad('review panel stayed open');
  failures += applied.fileName === 'a-classic.pdf'
    ? ok('the resume file name landed in the profile form')
    : bad('resume file name is ' + JSON.stringify(applied.fileName));
}

console.log('\nStorage round trip through the real chrome.storage:');
const stored = await page.evaluate(async () => {
  await window.NA.storage.setSettings({ apiKey: 'sk-ant-roundtrip' });
  const back = await window.NA.storage.getSettings();
  await window.NA.storage.setSettings({ apiKey: '' });
  return back.apiKey;
});
failures += stored === 'sk-ant-roundtrip' ? ok('settings persist and read back') : bad('settings round trip returned ' + JSON.stringify(stored));

console.log('\nTracker page:');
const tracker = await ctx.newPage();
const trackerErrors = [];
tracker.on('pageerror', (e) => trackerErrors.push(e.message));
await tracker.goto(`chrome-extension://${id}/src/tracker/tracker.html`);
await tracker.waitForTimeout(600);
failures += trackerErrors.length === 0 ? ok('tracker page loads with no errors') : bad('tracker errors: ' + trackerErrors.join('; '));

console.log('\nPopup page:');
const popup = await ctx.newPage();
const popupErrors = [];
popup.on('pageerror', (e) => popupErrors.push(e.message));
await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
await popup.waitForTimeout(600);
failures += popupErrors.length === 0 ? ok('popup loads with no errors') : bad('popup errors: ' + popupErrors.join('; '));

console.log('\nCollected console and page errors:');
if (problems.length) { problems.forEach((p) => console.error('  ' + p)); failures += problems.length; }
else ok('none');

await ctx.close();
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
