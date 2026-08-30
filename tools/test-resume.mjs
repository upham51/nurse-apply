/**
 * Resume parser harness. No browser, no model, no network: the parser is pure
 * text in, structured data out, so it runs straight in node.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { console };
sandbox.self = sandbox;
vm.createContext(sandbox);
for (const f of ['src/schema/profile.js', 'src/lib/resumeParse.js']) {
  vm.runInContext(readFileSync(join(repo, f), 'utf8'), sandbox, { filename: f });
}
const NA = sandbox.NA;

let failures = 0;
const ok = (m) => console.log('    ok    ' + m);
const bad = (m) => { console.error('    FAIL  ' + m); failures++; };
const eq = (got, want, label) =>
  String(got) === String(want) ? ok(`${label} = ${JSON.stringify(got)}`)
                               : bad(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
const has = (arr, pred, label) =>
  (arr || []).some(pred) ? ok(label) : bad(`${label} not found in ${JSON.stringify(arr)}`);

const dir = join(repo, 'tools/fixtures/resumes');
const results = {};
for (const name of readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
  results[name] = NA.resumeParse.parse(readFileSync(join(dir, name), 'utf8'));
}

/* ------------------------------------------------------------ a-classic */
console.log('\na-classic.txt (single column, ALLCAPS headers):');
{
  const { profile: p, stats } = results['a-classic.txt'];
  eq(p.identity.firstName, 'Jordan', 'first name');
  eq(p.identity.lastName, 'Reyes', 'last name');
  eq(p.identity.email, 'jordan.reyes@example.com', 'email');
  eq(p.identity.phone, '503-555-0142', 'phone');
  eq(p.identity.address.city, 'Portland', 'city');
  eq(p.identity.address.state, 'OR', 'state');
  eq(p.identity.address.zip, '97209', 'zip');
  eq(p.identity.address.street, '412 NW Clark St', 'street');
  eq(p.nursingCredentials.nclex.passDate, '2016-08', 'NCLEX date');

  eq(p.licenses.length, 2, 'license count');
  has(p.licenses, (l) => l.state === 'OR' && l.number === 'RN201644882' && l.isCompact && l.expirationDate === '2027-08-31',
      'Oregon compact license with number and expiry');
  has(p.licenses, (l) => l.state === 'WA' && l.number === 'WA6612340', 'Washington license');

  has(p.certifications, (c) => c.name === 'BLS' && c.issuingBody === 'AHA' && c.expirationDate === '2027-02-01', 'BLS from AHA with expiry');
  has(p.certifications, (c) => c.name === 'CCRN' && c.issuingBody === 'AACN', 'CCRN from AACN');
  has(p.certifications, (c) => c.name === 'NIHSS', 'NIHSS');

  eq(p.experience.length, 2, 'role count');
  const micu = p.experience[0];
  eq(micu.employer, 'Providence St Vincent Medical Center', 'role 1 employer, with the trailing city stripped');
  eq(micu.title, 'Registered Nurse III, Medical ICU', 'role 1 title');
  eq(micu.startDate, '2019-03', 'role 1 start');
  eq(micu.isCurrent, true, 'role 1 is current');
  eq(micu.unit, 'MICU', 'role 1 unit');
  eq(micu.bedCount, '24', 'role 1 bed count');
  eq(micu.typicalRatio, '1:2', 'role 1 ratio');
  eq(micu.traumaLevel, 'Level II', 'role 1 trauma level');
  has([micu.responsibilities], (r) => /Titrate vasoactive/.test(r), 'role 1 bullets captured');

  eq(p.education.length, 1, 'education count');
  eq(p.education[0].degree, 'BSN', 'degree');
  eq(p.education[0].graduationDate, '2016-06', 'graduation');
  eq(p.education[0].gpa, '3.7', 'gpa');
  has([p.education[0].school], (s) => /Oregon Health/.test(s), 'school name');

  has(p.clinicalSkills.emrSystems, (e) => e === 'Epic', 'Epic detected');
  has(p.clinicalSkills.emrSystems, (e) => e === 'Cerner', 'Cerner detected');
  has(p.clinicalSkills.languages, (l) => l.language === 'Spanish', 'Spanish detected');
  console.log('    stats:', JSON.stringify(stats));
}

/* -------------------------------------------------------------- b-piped */
console.log('\nb-piped.txt (pipe-separated headers, dates on their own line):');
{
  const { profile: p, stats } = results['b-piped.txt'];
  eq(p.identity.firstName, 'Marisol', 'first name');
  eq(p.identity.phone, '206-555-0119', 'phone');
  eq(p.identity.address.city, 'Seattle', 'city');
  eq(p.identity.address.zip, '98122', 'zip');

  eq(p.experience.length, 2, 'role count');
  const ed = p.experience[0];
  eq(ed.unit, 'Emergency', 'role 1 unit');
  eq(ed.traumaLevel, 'Level I', 'role 1 trauma level');
  eq(ed.bedCount, '62', 'role 1 bed count');
  eq(ed.startDate, '2021-01', 'role 1 start');
  eq(ed.isCurrent, true, 'role 1 current');
  eq(ed.employer, 'Harborview Medical Center', 'role 1 employer split out of the piped header');
  eq(ed.title, 'Emergency Department Registered Nurse', 'role 1 title split out of the piped header');
  eq(p.experience[1].unit, 'Telemetry', 'role 2 unit');
  eq(p.experience[1].endDate, '2020-12', 'role 2 end date');

  has(p.licenses, (l) => l.state === 'WA' && l.number === 'RN60219948', 'Washington license');
  has(p.certifications, (c) => c.name === 'TNCC' && c.issuingBody === 'ENA', 'TNCC from ENA');
  has(p.certifications, (c) => c.name === 'CEN', 'CEN');
  eq(p.education[0].degree, 'BSN', 'degree');
  eq(p.education[0].graduationDate, '2018-06', 'graduation');
  console.log('    stats:', JSON.stringify(stats));
}

/* -------------------------------------------------------------- c-terse */
console.log('\nc-terse.txt (employer above the date line, bare years):');
{
  const { profile: p, stats } = results['c-terse.txt'];
  eq(p.identity.firstName, 'Dana', 'first name');
  eq(p.identity.address.state, 'AZ', 'state');
  eq(p.experience.length, 2, 'role count');
  const ld = p.experience[0];
  has([ld.employer], (e) => /Banner Desert/.test(e), 'role 1 employer');
  has([ld.title], (t) => /Charge Nurse/i.test(t), 'role 1 title');
  eq(ld.unit, 'Labor & Delivery', 'role 1 unit');
  eq(ld.isCurrent, true, 'role 1 current');
  eq(ld.bedCount, '40', 'role 1 bed count');
  eq(ld.typicalRatio, '1:1', 'role 1 ratio');
  eq(p.experience[1].unit, 'Postpartum', 'role 2 unit');
  has(p.licenses, (l) => l.state === 'AZ' && l.isCompact && l.expirationDate === '2027-09-30', 'Arizona compact license');
  has(p.certifications, (c) => c.name === 'BLS' && c.issuingBody === 'ARC', 'BLS from Red Cross');
  has(p.certifications, (c) => c.name === 'NRP', 'NRP');
  eq(p.education[0].degree, 'ADN', 'degree');
  has(p.clinicalSkills.emrSystems, (e) => e === 'PointClickCare', 'PointClickCare detected');
  console.log('    stats:', JSON.stringify(stats));
}

/* ------------------------------------------------------- safety checks */
console.log('\nSafety: the parser never invents:');
{
  const { profile: p, report } = NA.resumeParse.parse(
    'Alex Rivera RN\nalex@example.com\n\nEXPERIENCE\nSome Hospital\nStaff Nurse\n2020 - 2022\n'
  );
  eq((p.licenses || []).length, 0, 'no license invented when none is stated');
  eq((p.nursingCredentials || {}).npiNumber, '', 'no NPI invented');
  eq((p.certifications || []).length, 0, 'no certifications invented');
  has(report, (r) => /license/i.test(r.msg), 'reports the missing license rather than guessing');

  const bad1 = NA.resumeParse.parse('NPI 1234567890\nJane Doe\njane@example.com\n\nEXPERIENCE\nA Hospital\nRN\n2020 - 2021\n');
  eq(bad1.profile.nursingCredentials.npiNumber, '', 'rejects an NPI that fails its check digit');
  has(bad1.report, (r) => /check digit/i.test(r.msg), 'says why the NPI was rejected');

  const good = NA.resumeParse.parse('NPI: 1245319599\nJane Doe\njane@example.com\n\nEXPERIENCE\nA Hospital\nRN\n2020 - 2021\n');
  eq(good.profile.nursingCredentials.npiNumber, '1245319599', 'accepts a valid NPI');

  const empty = NA.resumeParse.parse('');
  has(empty.report, (r) => /scanned|OCR|text/i.test(r.msg), 'explains an empty extraction instead of returning silence');
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
