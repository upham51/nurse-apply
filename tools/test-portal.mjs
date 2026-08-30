/**
 * Portal harness: does the thing actually work on an application page?
 *
 * Every other harness tests a module. This one loads the packaged extension
 * into a real browser, serves pages at real portal URLs so the manifest's
 * matches apply exactly as they would in the wild, and drives the extension
 * the way a nurse would: open the page, look for the pill, press Fill step.
 *
 * The employer-shell case matters most. Hospitals routinely put an iCIMS or
 * Taleo application in an iframe on their own careers domain, which the
 * manifest does not match, so the top frame gets no content script at all.
 */
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(repo, 'dist', 'nurseapply');
if (!existsSync(join(ext, 'manifest.json'))) {
  console.error('Run `npm run package` first.');
  process.exit(1);
}

let failures = 0;
const ok = (m) => { console.log('  ok    ' + m); return 0; };
const bad = (m) => { console.error('  FAIL  ' + m); return 1; };

const PROFILE = JSON.parse(readFileSync(join(repo, 'tools/fixtures/profile.json'), 'utf8'));

const PAGES = {
  'https://acme.myworkdayjobs.com/en-US/careers/job/apply': 'portal-workday.html',
  'https://careers.riverbendhealth.org/apply': 'portal-employer-shell.html',
  'https://riverbend.icims.com/jobs/apply': 'portal-icims.html'
};

const EXEC = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome'
].filter(Boolean).find(existsSync);

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'na-portal-')), {
  executablePath: EXEC,
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox']
});

await ctx.route('**/*', (route) => {
  const url = route.request().url().split('?')[0];
  const file = PAGES[url];
  if (file) {
    return route.fulfill({ status: 200, contentType: 'text/html',
      body: readFileSync(join(repo, 'tools/fixtures', file), 'utf8') });
  }
  if (url.startsWith('chrome-extension://')) return route.continue();
  return route.fulfill({ status: 404, contentType: 'text/html', body: 'not found' });
});

let worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const id = worker.url().split('/')[2];

// Seed a profile the way the options page would.
const seed = await ctx.newPage();
await seed.goto(`chrome-extension://${id}/src/options/options.html`);
await seed.waitForFunction(() => !!(window.NA && window.NA.storage));
await seed.evaluate(async (p) => {
  await window.NA.storage.setProfile(window.NA.schema.hydrate(p));
}, PROFILE);
await seed.close();

const hudText = (page) => page.evaluate(() => {
  const host = document.getElementById('nurseapply-hud-host');
  if (!host || !host.shadowRoot) return null;
  return host.shadowRoot.querySelector('.pill').textContent.replace(/\s+/g, ' ').trim();
});

const clickFill = (page) => page.evaluate(() => {
  const host = document.getElementById('nurseapply-hud-host');
  if (!host || !host.shadowRoot) return false;
  const btn = host.shadowRoot.querySelector('.act-fill');
  if (!btn) return false;
  btn.click();
  return true;
});

/* ------------------------------------------------------------- Workday ---- */
console.log('\nA Workday application, the domain the manifest matches directly:');
{
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('https://acme.myworkdayjobs.com/en-US/careers/job/apply');
  await page.waitForTimeout(1500);

  const pill = await hudText(page);
  failures += pill ? ok('the pill appears: ' + JSON.stringify(pill)) : bad('no pill on a Workday page');

  if (pill) {
    await clickFill(page);
    await page.waitForTimeout(2500);
    const values = await page.evaluate(() => ({
      first: document.getElementById('fn').value,
      last: document.getElementById('ln').value,
      email: document.getElementById('em').value,
      phone: document.getElementById('ph').value,
      city: document.getElementById('city').value,
      licence: document.getElementById('lic').value,
      felony: Array.from(document.querySelectorAll('input[name=felony]')).some((r) => r.checked)
    }));
    failures += values.first === 'Jordan' ? ok('first name filled') : bad('first name is ' + JSON.stringify(values.first));
    failures += values.email === 'jordan.reyes@example.com' ? ok('email filled') : bad('email is ' + JSON.stringify(values.email));
    failures += values.licence === 'RN201644882' ? ok('licence number filled') : bad('licence is ' + JSON.stringify(values.licence));
    failures += values.felony === false ? ok('the felony question was left alone') : bad('the felony question was answered');
    failures += errors.length === 0 ? ok('no page errors') : bad('page errors: ' + errors.join('; '));

    const after = await hudText(page);
    const m = /(\d+)\/(\d+) filled/.exec(after || '');
    const fieldCount = await page.evaluate(() =>
      document.querySelectorAll('input:not([type=radio]), select, textarea').length +
      new Set(Array.from(document.querySelectorAll('input[type=radio]')).map((r) => r.name)).size);
    failures += m && Number(m[1]) >= 5
      ? ok('the counter moved to ' + m[0] + ' rather than sitting at zero')
      : bad('the pill still reads ' + JSON.stringify(after));
    failures += m && Number(m[2]) === fieldCount
      ? ok(`the total matches the ${fieldCount} fields actually on the page`)
      : bad(`the pill claims a total of ${m ? m[2] : '?'} on a page with ${fieldCount} fields`);
    failures += m && Number(m[1]) <= Number(m[2])
      ? ok('filled never exceeds the total')
      : bad('filled exceeds the total: ' + JSON.stringify(after));
    failures += /Review skipped \(\d+\)/.test(after || '') && !/Review skipped \(0\)/.test(after || '')
      ? ok('the skipped drawer offers the questions it refused to answer')
      : bad('the skipped count is zero or missing: ' + JSON.stringify(after));
  }
  await page.close();
}

/* ------------------------------------------ employer shell with an iframe -- */
console.log('\nAn application hosted in an iframe on the hospital\'s own domain:');
{
  const page = await ctx.newPage();
  await page.goto('https://careers.riverbendhealth.org/apply');
  await page.waitForTimeout(2000);

  const topPill = await hudText(page);
  const framePill = await page.frames()
    .filter((f) => /icims/.test(f.url()))
    .reduce(async (accP, f) => {
      const acc = await accP;
      if (acc) return acc;
      return f.evaluate(() => {
        const host = document.getElementById('nurseapply-hud-host');
        return host && host.shadowRoot
          ? host.shadowRoot.querySelector('.pill').textContent.replace(/\s+/g, ' ').trim() : null;
      }).catch(() => null);
    }, Promise.resolve(null));

  const anyPill = topPill || framePill;
  failures += anyPill
    ? ok('a pill appears' + (topPill ? ' in the top frame' : ' inside the iframe') + ': ' + JSON.stringify(anyPill))
    : bad('NO pill anywhere. The hospital domain is not matched, so the top frame gets no content script, and the iframe never draws one.');

  if (anyPill) {
    const frame = page.frames().find((f) => /icims/.test(f.url()));
    if (topPill) await clickFill(page);
    else await frame.evaluate(() => {
      document.getElementById('nurseapply-hud-host').shadowRoot.querySelector('.act-fill').click();
    });
    await page.waitForTimeout(2500);
    const filled = await frame.evaluate(() => ({
      first: document.getElementById('f').value,
      email: document.getElementById('e').value,
      licence: document.getElementById('ln2').value
    }));
    failures += filled.first === 'Jordan' ? ok('the iframe form was filled') : bad('iframe values: ' + JSON.stringify(filled));
  }
  await page.close();
}

/* ------------------------------------------------ an unmatched career site - */
console.log('\nA hospital careers page on a domain nobody matched:');
{
  const page = await ctx.newPage();
  await page.goto('https://careers.riverbendhealth.org/apply');
  await page.waitForTimeout(600);
  const target = { id: 999, url: 'https://careers.riverbendhealth.org/apply' };

  const popup = await ctx.newPage();
  // A real popup sees the page behind it. Opened as a tab it sees itself, so
  // hand it the tab it would actually have, and let the real popup code run.
  await popup.addInitScript((t) => {
    const patch = () => {
      if (!window.chrome || !window.chrome.tabs) return false;
      const realQuery = window.chrome.tabs.query.bind(window.chrome.tabs);
      window.chrome.tabs.query = (q, cb) => {
        if (q && q.active) return cb([t]);
        return realQuery(q, cb);
      };
      window.chrome.tabs.sendMessage = (id, msg, a, b) => {
        const cb = typeof a === 'function' ? a : b;
        if (cb) cb(undefined);
      };
      return true;
    };
    if (!patch()) document.addEventListener('DOMContentLoaded', patch);
  }, target);
  await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
  await popup.waitForTimeout(800);

  const view = await popup.evaluate(() => ({
    text: document.body.innerText.replace(/\s+/g, ' '),
    enableVisible: !document.getElementById('enable-wrap').classList.contains('hidden'),
    enableLabel: (document.getElementById('enable') || {}).textContent || ''
  }));
  failures += view.enableVisible
    ? ok('the popup offers to switch NurseApply on for this site')
    : bad('no enable option on an unmatched site: ' + JSON.stringify(view.text.slice(0, 140)));
  failures += /riverbendhealth\.org/.test(view.enableLabel)
    ? ok('and names the site it would enable: ' + JSON.stringify(view.enableLabel))
    : bad('the enable button does not name the site: ' + JSON.stringify(view.enableLabel));
  failures += /thousands of different\s*domains/i.test(view.text)
    ? ok('explains why it is off rather than just saying it does not work')
    : bad('no explanation offered');
  await popup.close();
  await page.close();
}

await ctx.close();
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
