/**
 * Headless verification harness.
 *
 * Loads the content-script modules into a synthetic ATS page that behaves the
 * way a React form behaves (it reverts writes that bypass the native setter)
 * and asserts the fill result field by field, including the fields that must
 * NOT be filled.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const read = (p) => readFileSync(join(repo, p), 'utf8');

const SCRIPTS = [
  'src/schema/profile.js',
  'src/content/domUtils.js',
  'src/content/knockout.js',
  'src/content/heuristics.js',
  'src/content/adapters/base.js',
  'src/content/mapper.js'
];

const PROFILE = {
  identity: {
    firstName: 'Jordan', lastName: 'Reyes', email: 'jordan.reyes@example.com',
    phone: '5035550142',
    address: { street: '412 NW Clark St', line2: '', city: 'Portland', state: 'OR', zip: '97209' },
    workAuthorization: true, requiresSponsorship: false,
    veteranStatus: 'Decline', disabilityStatus: 'Decline',
    gender: 'Decline', raceEthnicity: 'Decline', willingToRelocate: false
  },
  nursingCredentials: { npiNumber: '1245319599', nclex: { passDate: '2016-08', state: 'OR' } },
  licenses: [{
    type: 'RN', state: 'OR', number: 'RN201644882',
    issueDate: '2016-09-14', expirationDate: '2027-08-31',
    isCompact: true, isPrimaryState: true, disciplinaryAction: false, disciplinaryExplanation: ''
  }],
  certifications: [
    { name: 'BLS', issuingBody: 'AHA', issueDate: '2025-02-10', expirationDate: '2027-02-28' },
    { name: 'ACLS', issuingBody: 'AHA', issueDate: '2025-02-10', expirationDate: '2027-02-28' }
  ],
  education: [{ degree: 'BSN', major: 'Nursing', school: 'Oregon Health & Science University',
                city: 'Portland', state: 'OR', graduationDate: '2016-06', gpa: '3.7' }],
  experience: [{
    employer: 'Providence St Vincent', facilityType: 'Hospital', traumaLevel: 'Level II',
    unit: 'MICU', bedCount: '24', typicalRatio: '1:2', title: 'Registered Nurse III',
    startDate: '2019-03', endDate: '', isCurrent: true,
    supervisorName: 'Dana Whitfield', supervisorTitle: 'Nurse Manager',
    supervisorPhone: '5035550188', supervisorEmail: 'dana.w@example.org',
    mayContact: true, reasonForLeaving: 'Seeking a Level I trauma center',
    responsibilities: 'Managed vented patients; CRRT; titrated vasoactive infusions.'
  }],
  clinicalSkills: {
    emrSystems: ['Epic', 'Cerner'],
    procedures: ['IV Insertion', 'Ventilator Management', 'CRRT'],
    languages: [{ language: 'Spanish', proficiency: 'Professional' }]
  },
  preferences: {
    shift: 'Nights', shiftLength: '12 hr', employmentType: 'Full-Time', minHourlyRate: '62',
    weekendAvailability: true, holidayAvailability: true, floatPoolWilling: false, travelWilling: false
  },
  references: [],
  compliance: {
    tbTestDate: '2026-01-08', tbTestType: 'Quantiferon Gold', fluVaccineSeason: '2025-2026',
    covidVaccineStatus: 'Fully Vaccinated', hepBStatus: 'Series Complete + Titer Reactive',
    mmrTiterDate: '2015-05-02', varicellaTiterDate: '2015-05-02',
    drugScreenWilling: true, backgroundCheckWilling: true
  },
  documents: { resumeFileName: 'reyes-rn.pdf', resumeText: '', resumeBase64: '', resumeMimeType: '',
               coverLetterTemplate: 'Dear {{hospital}}, applying for {{role}} on {{unit}}. {{certifications}}. {{emr_experience}}.' }
};

const EXPECT_FILLED = {
  '#fn': 'Jordan',
  '#ln': 'Reyes',
  '#em': 'jordan.reyes@example.com',
  '#ph': '503-555-0142',
  '#lic': 'RN201644882',
  '#licexp': '08/31/2027',
  '#st': 'OR',
  '#notes': 'Seeking a Level I trauma center',
  '#emr': 'Epic, Cerner',
  '#ratio': '1:2',
  '#trauma': 'Level II',
  '#tb': '01/08/2026'
};

const MUST_NOT_FILL = ['#ssn'];
const MUST_KEEP = { '#typed': 'DO NOT OVERWRITE' };
const KNOCKOUT_GROUPS = ['term', 'felony'];

function fail(msg) { console.error('  FAIL  ' + msg); return 1; }
function pass(msg) { console.log('  ok    ' + msg); return 0; }

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome'
].filter(Boolean);

let browser = null;
for (const executablePath of CANDIDATES) {
  try { browser = await chromium.launch({ executablePath }); break; } catch (e) { /* try next */ }
}
if (!browser) browser = await chromium.launch();

const page = await browser.newPage();
page.on('pageerror', (e) => console.error('  page error:', e.message));

await page.goto('file://' + join(repo, 'tools/fixtures/form.html'));

// Minimal chrome shim so the modules load outside an extension context.
await page.addInitScript(() => { window.chrome = { runtime: { sendMessage: () => {}, lastError: null } }; });
await page.evaluate(() => { window.chrome = { runtime: { sendMessage: () => {}, lastError: null } }; });

for (const s of SCRIPTS) await page.addScriptTag({ content: read(s) });

const result = await page.evaluate(async (profile) => {
  const NA = window.NA;
  NA.currentProfile = profile;
  const adapter = NA.adapterBase.BaseAdapter;
  const settings = { fillDemographics: true, enableLlmFallback: false, highlightColor: '#14b8a6' };
  const fields = NA.mapper.scan(adapter, document);
  const planned = NA.mapper.plan(fields, profile, settings, adapter);
  const exec = await NA.mapper.execute(planned.plan, profile, settings, adapter);
  return {
    total: exec.total,
    filled: exec.filled.map((f) => ({ label: f.label, ruleId: f.ruleId })),
    skipped: exec.skipped.map((f) => ({ label: f.label, reason: f.reason, family: f.family })),
    suggested: exec.suggested.map((f) => ({ label: f.label, family: f.family })),
    unitValue: document.getElementById('unit').dataset.value || '',
    reactSawInput: !!window.__reactSawInput
  };
}, PROFILE);

let failures = 0;
console.log(`\nScanned ${result.total} fields, filled ${result.filled.length}, ` +
            `skipped ${result.skipped.length}, drafted ${result.suggested.length}.\n`);

console.log('Values written:');
for (const [sel, want] of Object.entries(EXPECT_FILLED)) {
  const got = await page.$eval(sel, (el) => el.value);
  failures += got === want ? pass(`${sel} = ${JSON.stringify(got)}`)
                           : fail(`${sel} expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

console.log('\nFramework-safe write (value survives a React re-render):');
// Negative control: a naive assignment on an identically-guarded input. If this
// survives, the harness is not actually simulating the failure mode and the
// positive result above would mean nothing.
await page.evaluate(() => { document.getElementById('naive').value = 'naive write'; });
await page.waitForTimeout(300);
const fnAfter = await page.$eval('#fn', (el) => el.value);
const naiveAfter = await page.$eval('#naive', (el) => el.value);
failures += (fnAfter === 'Jordan' && result.reactSawInput)
  ? pass('#fn survived the re-render and the framework saw an input event')
  : fail(`#fn is now ${JSON.stringify(fnAfter)}, framework saw input = ${result.reactSawInput}`);
failures += naiveAfter === ''
  ? pass('control: a naive el.value assignment was discarded, so this test can fail')
  : fail(`control field kept ${JSON.stringify(naiveAfter)}; the harness is not simulating a controlled input`);

console.log('\nCustom ARIA combobox:');
failures += result.unitValue === 'MICU'
  ? pass('unit combobox selected MICU')
  : fail(`unit combobox value is ${JSON.stringify(result.unitValue)}`);

console.log('\nNever-overwrite rule:');
for (const [sel, want] of Object.entries(MUST_KEEP)) {
  const got = await page.$eval(sel, (el) => el.value);
  failures += got === want ? pass(`${sel} left alone`) : fail(`${sel} was overwritten with ${JSON.stringify(got)}`);
}

console.log('\nKnockout guard:');
for (const sel of MUST_NOT_FILL) {
  const got = await page.$eval(sel, (el) => el.value);
  failures += got === '' ? pass(`${sel} left blank`) : fail(`${sel} was filled with ${JSON.stringify(got)}`);
}
for (const name of KNOCKOUT_GROUPS) {
  const checked = await page.$$eval(`input[name="${name}"]`, (els) => els.some((e) => e.checked));
  failures += !checked ? pass(`radio group "${name}" left unanswered`)
                       : fail(`radio group "${name}" was answered automatically`);
}
const authAnswered = await page.$$eval('input[name="workauth"]',
  (els) => els.find((e) => e.checked)?.value || '');
failures += authAnswered === 'y'
  ? pass('work authorization answered Yes from the profile')
  : fail(`work authorization is ${JSON.stringify(authAnswered)}`);

console.log('\nEssay handling:');
const essay = result.suggested.find((s) => /why do you want/i.test(s.label));
const essayValue = await page.$eval('#why', (el) => el.value);
failures += (essay && essayValue === '')
  ? pass('motivation question drafted into the drawer, not written into the form')
  : fail(`essay handling wrong: suggested=${!!essay}, textarea=${JSON.stringify(essayValue)}`);

console.log('\nSkipped, with reasons:');
result.skipped.forEach((s) =>
  console.log(`  - ${s.label} :: ${s.reason}${s.family ? ' (' + s.family + ')' : ''}`));

await browser.close();

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
