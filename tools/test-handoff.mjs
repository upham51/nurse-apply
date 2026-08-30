/**
 * Chatbot handoff harness.
 *
 * The reply from a free assistant is never clean. It arrives fenced, wrapped
 * in an apology, with different key names, with the whole chat transcript
 * around it because the user pressed select-all, or with enum values invented
 * out of thin air. All of that has to import rather than fail, because the
 * person on the other end has already done the copying twice and will not do
 * it a third time.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { console };
sandbox.self = sandbox;
vm.createContext(sandbox);
for (const f of ['src/schema/profile.js', 'src/lib/resumeParse.js', 'src/lib/handoff.js']) {
  vm.runInContext(readFileSync(join(repo, f), 'utf8'), sandbox, { filename: f });
}
const NA = sandbox.NA;

let failures = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { console.error('  FAIL  ' + m); failures++; };
const eq = (got, want, label) => String(got) === String(want)
  ? ok(`${label} = ${JSON.stringify(got)}`)
  : bad(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);

const CLEAN = {
  identity: { firstName: 'Nadia', lastName: 'Okafor', email: 'n.okafor@example.com',
              phone: '(206) 555 0143',
              address: { street: '9 Kerry Ln', city: 'Renton', state: 'Washington', zip: '98055' } },
  licenses: [{ type: 'Registered Nurse', state: 'Washington', number: 'RN99881',
               expirationDate: '03/31/2028', isCompact: 'yes' }],
  certifications: [{ name: 'Basic Life Support', issuingBody: 'American Heart Association',
                     expirationDate: '2027-04-30' }],
  education: [{ degree: 'Bachelor of Science in Nursing', school: 'Cascade College',
                graduationDate: '2016' }],
  experience: [{ company: 'Rainier General', position: 'Charge Nurse, ICU',
                 from: '06/2019', to: 'Present', beds: '28', ratio: '1:2',
                 trauma: 'Level II', setting: 'Hospital',
                 duties: ['Ran the night shift', 'Precepted new graduates'] }],
  skills: { emr: ['EPIC', 'cerner'], procedures: ['CRRT'], languages: ['Igbo'] }
};

console.log('\nA clean reply:');
{
  const { profile: p, issues } = NA.handoff.read(JSON.stringify(CLEAN));
  eq(p.identity.firstName, 'Nadia', 'first name');
  eq(p.identity.phone, '206-555-0143', 'phone normalised');
  eq(p.identity.address.state, 'WA', '"Washington" reduced to the two-letter code');
  eq(p.licenses[0].type, 'RN', '"Registered Nurse" coerced to the RN enum');
  eq(p.licenses[0].state, 'WA', 'licence state');
  eq(p.licenses[0].expirationDate, '2028-03-31', 'US date converted to ISO');
  eq(p.licenses[0].isCompact, true, '"yes" read as a boolean');
  eq(p.licenses[0].isPrimaryState, true, 'first licence marked primary');
  eq(p.certifications[0].name, 'BLS', '"Basic Life Support" coerced to BLS');
  eq(p.certifications[0].issuingBody, 'AHA', 'issuing body coerced');
  eq(p.education[0].degree, 'BSN', 'degree coerced');
  eq(p.education[0].graduationDate, '2016-01', 'bare year expanded');
  eq(p.experience.length, 1, 'jobs');
  eq(p.experience[0].employer, 'Rainier General', '"company" read as employer');
  eq(p.experience[0].title, 'Charge Nurse, ICU', '"position" read as title');
  eq(p.experience[0].startDate, '2019-06', '"from" read as the start date');
  eq(p.experience[0].isCurrent, true, '"to": "Present" read as current');
  eq(p.experience[0].endDate, '', 'no end date on a current role');
  eq(p.experience[0].bedCount, '28', 'beds');
  eq(p.experience[0].traumaLevel, 'Level II', 'trauma level');
  eq(p.experience[0].responsibilities.split('\n').length, 2, 'duties joined one per line');
  eq(p.clinicalSkills.emrSystems.join(','), 'Epic,Cerner', 'EMR names coerced to the enum casing');
  eq(p.clinicalSkills.languages[0].language, 'Igbo', 'a bare language string');
  eq(issues.length, 0, 'no issues on a clean reply');
}

console.log('\nA realistic messy reply:');
{
  const messy =
    "Sure! I've gone through the resume carefully. Here's the JSON you asked for:\n\n" +
    '```json\n' + JSON.stringify(CLEAN, null, 2) + '\n```\n\n' +
    'Let me know if you would like me to adjust anything, for example the date formats!';
  const { profile: p } = NA.handoff.read(messy);
  eq(p.experience[0].employer, 'Rainier General', 'JSON found inside a fenced block with prose either side');
}
{
  const noFence = 'Here you go: ' + JSON.stringify(CLEAN) + ' Hope that helps!';
  const { profile: p } = NA.handoff.read(noFence);
  eq(p.experience[0].employer, 'Rainier General', 'JSON found with no fence at all');
}
{
  const transcript =
    'You said:\nConvert this resume...\n\nChatGPT said:\n' +
    '```\n' + JSON.stringify(CLEAN) + '\n```\n' +
    'Is this conversation helpful so far?';
  const { profile: p } = NA.handoff.read(transcript);
  eq(p.experience[0].employer, 'Rainier General', 'JSON found in a whole select-all transcript');
}
{
  const withBraces = 'Note: I used {} for missing values.\n\n' + JSON.stringify(CLEAN);
  const { profile: p } = NA.handoff.read(withBraces);
  eq(p.experience[0].employer, 'Rainier General', 'a decoy brace pair earlier in the text is skipped');
}

console.log('\nRefusals and repairs:');
{
  const invented = JSON.parse(JSON.stringify(CLEAN));
  invented.nursingCredentials = { npiNumber: '1234567890' };
  const { profile: p, issues } = NA.handoff.read(JSON.stringify(invented));
  eq(p.nursingCredentials.npiNumber, '', 'an NPI failing its check digit is dropped');
  ok(issues.some((i) => /check digit/i.test(i.msg))
    ? 'and the drop is reported' : bad('the dropped NPI was not reported'));
}
{
  const junkEnum = JSON.parse(JSON.stringify(CLEAN));
  junkEnum.experience[0].setting = 'Skilled Nursing Facility';
  junkEnum.experience[0].trauma = 'not a trauma centre';
  const { profile: p } = NA.handoff.read(JSON.stringify(junkEnum));
  eq(p.experience[0].facilityType, 'SNF', 'an unlisted setting is coerced to the nearest enum');
  eq(p.experience[0].traumaLevel, 'Non-Trauma', 'an unrecognised trauma level falls back safely');
}
{
  const empty = NA.handoff.read('I am sorry, I cannot help with that request.');
  eq(empty.profile, null, 'a refusal yields no profile');
  ok(empty.issues.some((i) => /whole reply/i.test(i.msg))
    ? 'and the user is told to paste the whole reply' : bad('no guidance given'));
}
{
  const noJobs = NA.handoff.read(JSON.stringify({ identity: { firstName: 'A' } }));
  ok(noJobs.issues.some((i) => /No jobs were found/i.test(i.msg))
    ? 'a reply with no jobs says so' : bad('missing jobs were not reported'));
}

console.log('\nThe prompt itself:');
{
  const prompt = NA.handoff.buildPrompt('RESUME BODY HERE');
  ok(/Reply with JSON only/.test(prompt) ? 'tells the assistant to answer with JSON only' : bad('no JSON instruction'));
  ok(/Do not invent/.test(prompt) ? 'tells it not to invent a license number or a date' : bad('no anti-invention rule'));
  ok(/RESUME BODY HERE/.test(prompt) ? 'carries the resume text' : bad('resume text missing'));
  ok(prompt.length < 6000 ? `fits in a free-tier message (${prompt.length} chars with a short resume)` : bad('prompt is too long'));
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
