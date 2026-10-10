/**
 * Workday as it actually rendered on a live UW posting (wd5.myworkdaysite.com).
 *
 * Two things only a real page showed. First, the experience step opens with no
 * entries, just Add buttons, plus a "Select files" button in the upload block.
 * fieldKind() referenced a variable that only exists in the input branch, so
 * the first plain button threw, the scan died, the pill froze on the previous
 * step and Fill step hung on "Filling". Second, with nothing to fill the old
 * code reported success, because there was nothing to fill.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(repo, p), 'utf8');
const PROFILE = JSON.parse(read('tools/fixtures/profile.json'));
const SCRIPTS = ['src/schema/profile.js', 'src/content/domUtils.js', 'src/content/knockout.js',
  'src/content/heuristics.js', 'src/content/adapters/base.js', 'src/content/adapters/workday.js',
  'src/content/mapper.js'];

let failures = 0;
const check = (c, m) => { if (c) console.log('  ok    ' + m); else { console.error('  FAIL  ' + m); failures++; } };

const date = (id, k, l) => `<div data-automation-id="formField-${k}"><label>${l}<abbr>*</abbr></label><div>
 <input id="${id}--${k}-dateSectionMonth-input" data-automation-id="dateSectionMonth-input" role="spinbutton" aria-label="Month" type="text">
 <input id="${id}--${k}-dateSectionYear-input" data-automation-id="dateSectionYear-input" role="spinbutton" aria-label="Year" type="text"></div></div>`;
const PAGE = `<!doctype html><html><body><div data-automation-id="applyFlowPage">
<h3>My Experience</h3>
<h4>Work Experience</h4><div id="jobs"></div>
<button type="submit" data-automation-id="add-button" id="addJob">Add</button>
<h4>Education</h4><div id="schools"></div>
<button type="submit" data-automation-id="add-button" id="addSchool">Add</button>
<h4>Resume/Cover Letter</h4>
<div data-automation-id="formField-"><label>Upload a file</label>
 <button type="button" id="resumeAttachments--attachments" data-automation-id="select-files">Select files</button>
 <input type="file" data-automation-id="file-upload-input-ref" style="display:none"></div>
<button type="submit" data-automation-id="pageFooterNextButton">Save and Continue</button>
</div><script>
let n = 6, m = 15;
document.getElementById('addJob').onclick = (e) => { e.preventDefault(); const id = 'workExperience-' + (n++);
 document.getElementById('jobs').insertAdjacentHTML('beforeend', '<div>' +
 '<div data-automation-id="formField-jobTitle"><label for="'+id+'--jobTitle">Job Title</label><input id="'+id+'--jobTitle" name="jobTitle" type="text"></div>' +
 '<div data-automation-id="formField-companyName"><label for="'+id+'--companyName">Company</label><input id="'+id+'--companyName" name="companyName" type="text"></div>' +
 '<div data-automation-id="formField-location"><label for="'+id+'--location">Location</label><input id="'+id+'--location" name="location" type="text"></div>' +
 \`${date('"+id+"', 'startDate', 'From').replace(/`/g, '')}\` + '</div>'); };
document.getElementById('addSchool').onclick = (e) => { e.preventDefault(); const id = 'education-' + (m++);
 document.getElementById('schools').insertAdjacentHTML('beforeend', '<div>' +
 '<div data-automation-id="formField-school"><label for="'+id+'--school">School or University</label><input id="'+id+'--school" type="text"></div>' +
 '<div data-automation-id="formField-fieldOfStudy"><label for="'+id+'--fieldOfStudy">Field of Study</label><input id="'+id+'--fieldOfStudy" type="text"></div></div>'); };
</script></body></html>`;

const b = await chromium.launch();
const pg = await b.newPage();
await pg.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: PAGE }));
await pg.goto('https://wd5.myworkdaysite.com/en-US/recruiting/uw/UWhires/job/x/apply');
for (const s of SCRIPTS) await pg.addScriptTag({ content: read(s) });

const res = await pg.evaluate(async (profile) => {
  const p = NA.schema.hydrate(profile);
  const ad = NA.adapters.workday;
  const out = {};
  try { NA.mapper.scan(ad, document); out.emptyScan = 'ok'; } catch (e) { out.emptyScan = 'THREW ' + e.message; }
  out.pressed = await ad.prepare(document, p);
  let fields;
  try { fields = NA.mapper.scan(ad, document); } catch (e) { out.scan = 'THREW ' + e.message; return out; }
  const plan = NA.mapper.plan(fields, p, { fillDemographics: true }, ad);
  out.rows = plan.plan.map((i) => ({ id: i.field.id, kind: i.field.kind, action: i.action, value: i.value }));
  out.pressedAgain = await ad.prepare(document, p);
  return out;
}, PROFILE);

check(res.emptyScan === 'ok', 'a page with only Add and Select files buttons scans without throwing');
check(res.pressed === 2, `Add pressed once per profile entry (${res.pressed})`);
check(res.pressedAgain === 0, 'running it again adds nothing, entries already exist');
const row = (suffix) => (res.rows || []).find((r) => r.id.endsWith(suffix));
check(row('--jobTitle') && row('--jobTitle').value === 'Registered Nurse III', 'job title resolved');
check(row('--companyName') && row('--companyName').value === 'Providence St Vincent', 'company resolved');
check(row('--school') && /Oregon Health/.test(row('--school').value), 'school resolved');
check(row('--fieldOfStudy') && row('--fieldOfStudy').action === 'fill', 'field of study resolved');
const sel = row('resumeAttachments--attachments');
check(!sel || sel.action !== 'fill', 'the Select files button is never filled');
await b.close();
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll checks passed.');
