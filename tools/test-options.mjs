/**
 * Options-page harness.
 *
 * Loads options.html against an in-memory chrome.storage.local shim and checks
 * the behaviours that only show up in a real browser: that the API key is
 * persisted the moment it is typed rather than waiting for Save profile, and
 * that resume import asks for a key instead of failing after a file is chosen.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const pass = (m) => { console.log('  ok    ' + m); return 0; };
const fail = (m) => { console.error('  FAIL  ' + m); return 1; };

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome'
].filter(Boolean);

let browser = null;
for (const executablePath of CANDIDATES) {
  try { browser = await chromium.launch({ executablePath }); break; } catch (e) { /* next */ }
}
if (!browser) browser = await chromium.launch();

const page = await browser.newPage();
page.on('pageerror', (e) => { console.error('  page error:', e.message); failures++; });

// Minimal chrome extension API, with the message round-trip the page relies on.
await page.addInitScript(() => {
  const store = {};
  window.__store = store;
  window.__sent = [];
  window.chrome = {
    runtime: {
      lastError: null,
      openOptionsPage() {},
      getURL: (p) => p,
      sendMessage(msg, cb) {
        window.__sent.push(msg);
        if (msg.type === 'llm:test') {
          const key = (store.na_settings || {}).apiKey;
          return cb(key ? { ok: true, text: 'ready' } : { ok: false, error: 'No Anthropic API key saved yet.' });
        }
        cb({ ok: true });
      }
    },
    storage: {
      local: {
        get(keys, cb) {
          if (keys === null) return cb(JSON.parse(JSON.stringify(store)));
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          list.forEach((k) => { if (k in store) out[k] = JSON.parse(JSON.stringify(store[k])); });
          cb(out);
        },
        set(obj, cb) { Object.assign(store, JSON.parse(JSON.stringify(obj))); cb && cb(); },
        remove(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]); cb && cb(); },
        clear(cb) { Object.keys(store).forEach((k) => delete store[k]); cb && cb(); }
      }
    },
    tabs: { create() {}, query(q, cb) { cb([]); } }
  };
});

await page.goto('file://' + join(repo, 'src/options/options.html'));
await page.waitForFunction(() => document.querySelectorAll('#sec-settings input').length > 0);
// Every section is a collapsed <details>; open them so fields are interactable.
await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
await page.waitForSelector('#na-api-key', { state: 'visible' });

console.log('\nOptions page:');
failures += (await page.$$('.panel')).length >= 10
  ? pass('all profile sections rendered')
  : fail('sections missing');

console.log('\nAPI key persistence (the bug this test exists for):');
await page.fill('#na-api-key', 'sk-ant-test-key-value');
await page.dispatchEvent('#na-api-key', 'change');
await page.waitForTimeout(120);
const stored = await page.evaluate(() => (window.__store.na_settings || {}).apiKey || '');
failures += stored === 'sk-ant-test-key-value'
  ? pass('key reached chrome.storage.local without pressing Save profile')
  : fail(`key was not persisted; storage holds ${JSON.stringify(stored)}`);

console.log('\nResume import:');
await page.click('#btn-import-resume');
await page.waitForSelector('.modal h2');
let heading = await page.$eval('.modal h2', (n) => n.textContent);
let bodyText = await page.$eval('.modal', (n) => n.textContent);
failures += heading === 'Import resume'
  ? pass('opens the drop zone')
  : fail(`expected the import modal, got ${JSON.stringify(heading)}`);
failures += /No API key, no upload, no network/i.test(bodyText)
  ? pass('states that parsing is local')
  : fail('import modal does not say parsing is local');
await page.click('.modal .row-actions button:last-child');

console.log('\nResume import with no key at all:');
await page.click('#na-api-key');
await page.keyboard.press('Control+A');
await page.keyboard.press('Delete');
await page.dispatchEvent('#na-api-key', 'change');
await page.waitForTimeout(150);
const clearedKey = await page.evaluate(() => (window.__store.na_settings || {}).apiKey || '');
failures += clearedKey === ''
  ? pass('clearing the field clears the stored key too')
  : fail(`stored key survived clearing: ${JSON.stringify(clearedKey)}`);

await page.click('#btn-import-resume');
await page.waitForSelector('.modal h2');
heading = await page.$eval('.modal h2', (n) => n.textContent);
failures += heading === 'Import resume'
  ? pass('still opens the drop zone with no key, because parsing needs none')
  : fail(`expected the import modal, got ${JSON.stringify(heading)}`);
await page.click('.modal .row-actions button:last-child');

console.log('\nLocal parser is wired into the page:');
const parserWired = await page.evaluate(() => !!(window.NA && window.NA.resumeParse && window.NA.pdftext));
failures += parserWired
  ? pass('resumeParse and pdftext are loaded on the options page')
  : fail('local parsing modules are not loaded');
const localResult = await page.evaluate(() => {
  const r = window.NA.resumeParse.parse(
    'Pat Nguyen RN\npat@example.com\n503-555-0100\nPortland, OR 97209\n\n' +
    'LICENSURE\nOregon RN License #RN123456 exp 01/31/2028\n\n' +
    'CERTIFICATIONS\nBLS AHA exp 02/2027\n\n' +
    'EXPERIENCE\nSome Hospital\nStaff Nurse, ICU\n2019 - Present\n* 20-bed ICU, ratio 1:2\n'
  );
  return { licenses: r.profile.licenses.length, certs: r.profile.certifications.length,
           roles: r.profile.experience.length, unit: (r.profile.experience[0] || {}).unit };
});
failures += (localResult.licenses === 1 && localResult.certs === 1 && localResult.roles === 1 && localResult.unit === 'ICU')
  ? pass('parses a resume in-page with no network: ' + JSON.stringify(localResult))
  : fail('in-page parse returned ' + JSON.stringify(localResult));

console.log('\nValidation surface:');
const issues = await page.$$eval('#issues li', (ns) => ns.map((n) => n.textContent));
failures += issues.length > 0
  ? pass(`${issues.length} issues listed for an empty profile`)
  : fail('empty profile produced no validation issues');

await browser.close();
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
