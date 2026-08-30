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
failures += /No API key, no upload, no account/i.test(bodyText)
  ? pass('states that reading happens on this computer with no key or account')
  : fail('import modal does not say reading is local');
failures += /check every job before anything is saved/i.test(bodyText)
  ? pass('promises a review before anything is saved')
  : fail('import modal does not promise a review step');
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

console.log('\nEvery import path is wired into the page:');
const wired = await page.evaluate(() => ({
  resumeParse: !!(window.NA && window.NA.resumeParse),
  pdftext: !!(window.NA && window.NA.pdftext),
  localModel: !!(window.NA && window.NA.localModel),
  handoff: !!(window.NA && window.NA.handoff),
  review: !!(window.NA && window.NA.review)
}));
Object.entries(wired).forEach(([k, v]) => {
  failures += v ? pass('NA.' + k + ' loaded') : fail('NA.' + k + ' missing');
});

console.log('\nThe chatbot handoff, which needs no key, no local model and no parsed file:');
await page.click('#btn-handoff');
await page.waitForTimeout(300);
const handoffHeading = await page.$eval('.modal h2', (n) => n.textContent).catch(() => '');
const handoffBody = await page.$eval('.modal', (n) => n.textContent).catch(() => '');
failures += /chatbot/i.test(handoffHeading)
  ? pass('opens without an API key')
  : fail('handoff modal did not open, heading was ' + JSON.stringify(handoffHeading));
failures += /no API key is involved/i.test(handoffBody)
  ? pass('states that no API key is involved')
  : fail('handoff modal does not say a key is unnecessary');
failures += (await page.$$('.modal .steps li')).length === 3
  ? pass('gives three numbered steps')
  : fail('the steps list is not three items');
failures += (await page.$$('.modal textarea')).length >= 2
  ? pass('offers a box to paste resume text into, so it works with a scanned PDF too')
  : fail('no resume text box in the handoff modal');

// Feed it a reply the way a user would, and check it reaches the review panel.
const handoffRound = await page.evaluate(async () => {
  const boxes = Array.from(document.querySelectorAll('.modal textarea'))
    .filter((t) => !t.classList.contains('hidden'));
  const reply = boxes[boxes.length - 1];
  reply.value = 'Sure, here you go:\n\n```json\n' + JSON.stringify({
    identity: { firstName: 'Ada', lastName: 'Vance' },
    experience: [{ company: 'Mercy General', position: 'Staff Nurse',
                   from: '01/2020', to: 'Present', setting: 'Hospital' }]
  }) + '\n```\nHope that helps!';
  reply.dispatchEvent(new Event('input', { bubbles: true }));
  const use = Array.from(document.querySelectorAll('.modal button'))
    .find((b) => /Use the answer/i.test(b.textContent));
  use.click();
  await new Promise((r) => setTimeout(r, 250));
  const review = document.getElementById('review');
  return {
    opened: review && !review.classList.contains('hidden'),
    employer: (window.NA.review.state || {}).profile
      ? window.NA.review.state.profile.experience[0].employer : ''
  };
});
failures += handoffRound.opened && handoffRound.employer === 'Mercy General'
  ? pass('a fenced reply with prose either side round-trips into the review panel')
  : fail('handoff round trip failed: ' + JSON.stringify(handoffRound));
await page.evaluate(() => {
  const d = document.getElementById('review-discard');
  if (d) d.click();
});
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
