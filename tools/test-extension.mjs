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
