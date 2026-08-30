/**
 * Autopilot harness.
 *
 * Runs the packaged extension against a four-step nursing application and a
 * local stand-in for the model API. The stand-in is deliberately imperfect: it
 * answers most things correctly, returns one value that is not among a
 * dropdown's options, and reports every field label it was shown. That last
 * part is how the important guarantee gets checked, because the promise is not
 * "the model behaves" but "it is never given the chance to misbehave".
 *
 * Set AUTOPILOT_BASE_URL, AUTOPILOT_KEY and AUTOPILOT_MODEL to point the same
 * harness at a real provider instead.
 */
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(repo, 'dist', 'nurseapply');
if (!existsSync(join(ext, 'manifest.json'))) { console.error('Run npm run package first.'); process.exit(1); }

let failures = 0;
const ok = (m) => { console.log('  ok    ' + m); return 0; };
const bad = (m) => { console.error('  FAIL  ' + m); return 1; };

const PROFILE = JSON.parse(readFileSync(join(repo, 'tools/fixtures/profile.json'), 'utf8'));

/* ------------------------------------------------------- the stand-in model */

const seenLabels = [];
let requestCount = 0;

/** Answers from the profile, the way a competent model would. */
function answer(fields, profile) {
  const out = {};
  const id = profile.identity, addr = id.address;
  const lic = profile.licenses[0] || {};
  const job = profile.experience[0] || {};
  const edu = profile.education[0] || {};
  const cert = (name) => (profile.certifications || []).find((c) => c.name === name) || {};
  const yesNo = (b) => (b ? 'Yes' : 'No');

  for (const f of fields) {
    const l = (f.label || '').toLowerCase();
    const put = (v) => { if (v) out[f.id] = v; };

    if (/middle initial/.test(l)) put('');
    else if (/preferred first name/.test(l)) put(id.preferredName || id.firstName);
    else if (/confirm email/.test(l)) put(id.email);
    else if (/phone device type/.test(l)) put('Mobile');
    else if (/^country|country$/.test(l) && f.options) put('United States of America');
    else if (/how did you hear/.test(l)) put('Company Website');
    else if (/highest level of education/.test(l)) put("Bachelor's Degree");
    else if (/school or university/.test(l)) put(edu.school);
    else if (/^degree/.test(l)) put(edu.degree);
    else if (/field of study/.test(l)) put(edu.major);
    else if (/graduation date/.test(l)) put(edu.graduationDate);
    else if (/\bgpa\b/.test(l)) put(edu.gpa);
    else if (/license type/.test(l)) put(lic.type);
    else if (/license issuing state/.test(l)) put('Washington' === 'x' ? 'x' : stateName(lic.state));
    else if (/license number/.test(l)) put(lic.number);
    else if (/license expiration/.test(l)) put(lic.expirationDate);
    else if (/compact or multistate/.test(l)) put(yesNo(lic.isCompact));
    else if (/nclex/.test(l)) put((profile.nursingCredentials.nclex || {}).passDate);
    else if (/bls certification expiration/.test(l)) put(cert('BLS').expirationDate);
    else if (/acls certification expiration/.test(l)) put(cert('ACLS').expirationDate);
    else if (/employer name/.test(l)) put(job.employer);
    else if (/job title/.test(l)) put(job.title);
    else if (/facility type/.test(l)) put(job.facilityType);
    else if (/unit or department/.test(l)) put(job.unit);
    else if (/licensed beds/.test(l)) put(job.bedCount);
    else if (/nurse to patient ratio/.test(l)) put(job.typicalRatio);
    else if (/trauma level/.test(l)) put(job.traumaLevel);
    else if (/employment start/.test(l)) put(job.startDate);
    else if (/supervisor name/.test(l)) put(job.supervisorName);
    else if (/supervisor title/.test(l)) put(job.supervisorTitle);
    else if (/supervisor phone/.test(l)) put(job.supervisorPhone);
    else if (/supervisor email/.test(l)) put(job.supervisorEmail);
    else if (/may we contact/.test(l)) put(yesNo(job.mayContact));
    else if (/total years of nursing/.test(l)) put('7');
    else if (/primary emr/.test(l)) put(profile.clinicalSkills.emrSystems[0]);
    else if (/clinical responsibilities/.test(l)) put(job.responsibilities);
    else if (/desired shift/.test(l)) put(profile.preferences.shift);
    else if (/shift length/.test(l)) put(profile.preferences.shiftLength);
    else if (/employment type/.test(l)) put(profile.preferences.employmentType);
    else if (/desired hourly rate/.test(l)) put(profile.preferences.minHourlyRate);
    else if (/available to work weekends/.test(l)) put(yesNo(profile.preferences.weekendAvailability));
    else if (/available to work holidays/.test(l)) put(yesNo(profile.preferences.holidayAvailability));
    // A question no rule anticipates, answered sensibly from the profile.
    else if (/intensive care experience/.test(l)) put('Extensive');
    // Deliberately wrong: not one of the listed options. Must be discarded.
    else if (/night shift/.test(l)) put('About four years');
    else if (/willing to float/.test(l)) put(yesNo(profile.preferences.floatPoolWilling));
    else if (/willing to relocate/.test(l)) put(yesNo(id.willingToRelocate));
    else if (/drug screen/.test(l)) put(yesNo(profile.compliance.drugScreenWilling));
    else if (/background check/.test(l)) put(yesNo(profile.compliance.backgroundCheckWilling));
    else if (/tb test date/.test(l)) put(profile.compliance.tbTestDate);
    else if (/influenza/.test(l)) put(profile.compliance.fluVaccineSeason);
    else if (/hepatitis/.test(l)) put(profile.compliance.hepBStatus);
    else if (/covid/.test(l)) put(profile.compliance.covidVaccineStatus);
    else if (/gender/.test(l)) put(id.gender);
    else if (/race/.test(l)) put(id.raceEthnicity);
    else if (/veteran/.test(l)) put(id.veteranStatus);
    else if (/disability/.test(l)) put(id.disabilityStatus);
    else if (/why do you want/.test(l)) put('I am drawn to Cascade Health because my ICU background matches this unit.');
  }
  return out;
}

function stateName(a) {
  return ({ OR: 'Oregon', WA: 'Washington', CA: 'California' })[a] || a;
}

const api = createServer((req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST, OPTIONS'
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    requestCount++;
    let payload = {};
    try { payload = JSON.parse(JSON.parse(body).messages[1].content); } catch (e) { /* ignore */ }
    (payload.fields || []).forEach((f) => seenLabels.push(f.label || ''));
    const content = JSON.stringify(answer(payload.fields || [], payload.profile || {}));
    res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, cors));
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
  });
});
await new Promise((r) => api.listen(0, '127.0.0.1', r));
const apiBase = `http://127.0.0.1:${api.address().port}/v1`;

/* ------------------------------------------------------------ the browser -- */

const PAGE_URL = 'https://cascade.myworkdayjobs.com/en-US/careers/apply';
const EXEC = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome'].filter(Boolean).find(existsSync);

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'na-auto-')), {
  executablePath: EXEC, headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox']
});
await ctx.route('**/*', (route) => {
  const url = route.request().url().split('?')[0];
  if (url === PAGE_URL) {
    return route.fulfill({ status: 200, contentType: 'text/html',
      body: readFileSync(join(repo, 'tools/fixtures/portal-wizard.html'), 'utf8') });
  }
  return route.continue();
});

let worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const id = worker.url().split('/')[2];

const seed = await ctx.newPage();
await seed.goto(`chrome-extension://${id}/src/options/options.html`);
await seed.waitForFunction(() => !!(window.NA && window.NA.storage));
await seed.evaluate(async ({ profile, base, key, model }) => {
  await window.NA.storage.setProfile(window.NA.schema.hydrate(profile));
  await window.NA.storage.setSettings({
    provider: 'custom', baseUrl: base, apiKey: key, model,
    autopilot: true, autoAdvance: false, fillDemographics: true
  });
}, { profile: PROFILE, base: process.env.AUTOPILOT_BASE_URL || apiBase,
     key: process.env.AUTOPILOT_KEY || 'test-key',
     model: process.env.AUTOPILOT_MODEL || 'mock-1' });
await seed.close();

const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(PAGE_URL);
await page.waitForTimeout(1500);

const fillStep = async () => {
  await page.evaluate(() => {
    const h = document.getElementById('nurseapply-hud-host');
    h.shadowRoot.querySelector('.act-fill').click();
  });
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => {
      const h = document.getElementById('nurseapply-hud-host');
      return h.shadowRoot.querySelector('.pill').textContent.replace(/\s+/g, ' ');
    });
    if (!/Filling|Working out/.test(s)) return s;
  }
  return 'timed out';
};

console.log('\nFilling a four-step application with autopilot:');
const stepNames = ['My Information', 'Education and Licensure', 'Work Experience', 'Preferences and Screening'];
for (let n = 0; n < 4; n++) {
  const pill = await fillStep();
  console.log(`  step ${n + 1} (${stepNames[n]}): ${pill.replace(/Fill step.*$/, '').trim()}`);
  if (n < 3) {
    await page.click(`#n${n + 1}`);
    await page.waitForTimeout(1200);
  }
}

const state = await page.evaluate(() => {
  const val = (id) => { const n = document.getElementById(id); return n ? (n.type === 'checkbox' ? n.checked : n.value) : '(missing)'; };
  const radio = (name) => { const r = Array.from(document.querySelectorAll(`input[name="${name}"]`)).find((x) => x.checked); return r ? r.value : ''; };
  const all = Array.from(document.querySelectorAll('input:not([type=radio]):not([type=checkbox]), select, textarea'));
  const radios = Array.from(new Set(Array.from(document.querySelectorAll('input[type=radio]')).map((r) => r.name)));
  return {
    empties: all.filter((n) => !String(n.value||'').trim()).map((n) => {
      const lab = document.querySelector(`label[for="${n.id}"]`);
      return lab ? lab.textContent.trim().slice(0,44) : (n.id || n.name);
    }),
    totalInputs: all.length,
    filledInputs: all.filter((n) => String(n.value || '').trim()).length,
    totalRadioGroups: radios.length,
    answeredRadioGroups: radios.filter((n) => Array.from(document.querySelectorAll(`input[name="${n}"]`)).some((r) => r.checked)).length,
    firstName: val('a1'), email: val('a5'), city: val('a11'), state: val('a12'),
    school: val('b2'), licenceNumber: val('b9'), licenceExp: val('b10'),
    employer: val('c1'), unit: val('c4'), ratio: val('c6'), trauma: val('c7'),
    shift: val('d1'), tb: val('d5'), covid: val('d8'), gender: val('d9'),
    essay: val('d13'), icuFit: val('d15'), nightYears: val('d14'),
    weekend: radio('wknd'), holiday: radio('hol'),
    terminated: radio('term'), disciplined: radio('disc'), felony: radio('fel'), excluded: radio('oig'),
    auth: radio('auth')
  };
});

console.log('\nCoverage:');
const inputPct = Math.round((state.filledInputs / state.totalInputs) * 100);
const radioPct = Math.round((state.answeredRadioGroups / state.totalRadioGroups) * 100);
console.log(`  text, select and textarea: ${state.filledInputs}/${state.totalInputs} (${inputPct}%)`);
console.log(`  radio groups: ${state.answeredRadioGroups}/${state.totalRadioGroups} (${radioPct}%)`);
console.log(`  model requests: ${requestCount}, fields shown to it: ${seenLabels.length}`);
console.log('  still empty: ' + JSON.stringify(state.empties));
if (process.env.AUTOPILOT_DEBUG) {
  seenLabels.forEach((l) => console.log('    sent: ' + JSON.stringify(l.slice(0, 80))));
}

failures += inputPct >= 80 ? ok(`${inputPct}% of the typed fields filled`) : bad(`only ${inputPct}% of typed fields filled`);

console.log('\nSpot checks across the four steps:');
const expect = {
  firstName: 'Jordan', email: 'jordan.reyes@example.com', city: 'Portland', state: 'OR',
  school: 'Oregon Health & Science University', licenceNumber: 'RN201644882', licenceExp: '2027-08-31',
  employer: 'Providence St Vincent', unit: 'MICU', ratio: '1:2', trauma: 'Level II',
  shift: 'Nights', tb: '2026-01-08', covid: 'Fully Vaccinated', gender: 'Decline'
};
for (const [k, v] of Object.entries(expect)) {
  failures += state[k] === v ? ok(`${k} = ${JSON.stringify(state[k])}`)
                             : bad(`${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(state[k])}`);
}
failures += /ICU background/.test(state.essay) ? ok('the free-text question was answered')
                                               : bad('essay is ' + JSON.stringify(state.essay));
failures += state.auth === 'y' ? ok('work authorisation answered from the profile')
                               : bad('work authorisation is ' + JSON.stringify(state.auth));
failures += state.holiday === 'y' ? ok('holiday availability answered') : bad('holiday is ' + JSON.stringify(state.holiday));

console.log('\nThe two guarantees:');
const blocked = ['terminated', 'disciplined', 'felony', 'excluded'];
const answered = blocked.filter((k) => state[k]);
failures += answered.length === 0
  ? ok('every screening attestation was left unanswered')
  : bad('these were answered: ' + answered.join(', '));

const leaked = seenLabels.filter((l) => /terminat|disciplin|felony|convict|excluded from medicare|malpractice/i.test(l));
failures += leaked.length === 0
  ? ok('and none of them was ever sent to the model')
  : bad('these labels were sent to the model: ' + JSON.stringify(leaked));

failures += state.icuFit === 'Extensive'
  ? ok('a question no rule anticipates was answered by the model: "' + state.icuFit + '"')
  : bad('the novel question was not answered: ' + JSON.stringify(state.icuFit));
failures += state.nightYears === ''
  ? ok('a value that was not one of the options ("About four years") was discarded, not typed')
  : bad('the invalid option was accepted: ' + JSON.stringify(state.nightYears));

failures += pageErrors.length === 0 ? ok('no page errors') : bad('page errors: ' + pageErrors.join('; '));

/* --------------------------------------------------- filling on its own --- */
console.log('\nAuto-advance, which is the point of the whole thing:');
{
  const auto = await ctx.newPage();
  await auto.goto(`chrome-extension://${id}/src/options/options.html`);
  await auto.waitForFunction(() => !!(window.NA && window.NA.storage));
  await auto.evaluate(() => window.NA.storage.setSettings({ autoAdvance: true }));
  await auto.close();

  const p2 = await ctx.newPage();
  await p2.goto(PAGE_URL);
  // Nothing is clicked here at all. The page loads and should fill itself.
  let filled = '';
  for (let i = 0; i < 40; i++) {
    await p2.waitForTimeout(500);
    filled = await p2.evaluate(() => document.getElementById('a1') ? document.getElementById('a1').value : '');
    if (filled) break;
  }
  failures += filled === 'Jordan'
    ? ok('step one filled itself on load with no click')
    : bad('nothing filled on load, first name is ' + JSON.stringify(filled));

  // Press Next the way a nurse would, and the new step should fill itself.
  await p2.click('#n1');
  let school = '';
  for (let i = 0; i < 40; i++) {
    await p2.waitForTimeout(500);
    school = await p2.evaluate(() => document.getElementById('b2') ? document.getElementById('b2').value : '');
    if (school) break;
  }
  failures += /Oregon Health/.test(school)
    ? ok('pressing Next filled the next step without another click')
    : bad('the next step did not fill itself, school is ' + JSON.stringify(school));

  const submitted = await p2.evaluate(() => document.querySelectorAll('.step.active #submit').length > 0);
  failures += !submitted ? ok('and it never advanced as far as Submit on its own')
                         : bad('it advanced to the submit step by itself');
  await p2.close();
}

await ctx.close();
api.close();
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
