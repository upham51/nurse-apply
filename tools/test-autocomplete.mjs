/**
 * The autocomplete tier and the iCIMS id overrides.
 *
 * Every label in the fixtures below is deliberately one that no label rule can
 * match, so a field that fills here can only have been resolved by the
 * autocomplete attribute or by an adapter id. Each positive case has a negative
 * control: the same page run without the new path must leave the field empty,
 * which is what stops these assertions passing for the wrong reason.
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

const SCRIPTS = [
  'src/schema/profile.js',
  'src/content/domUtils.js',
  'src/content/knockout.js',
  'src/content/heuristics.js',
  'src/content/adapters/base.js',
  'src/content/adapters/icims.js',
  'src/content/mapper.js'
];

let failures = 0;
const ok = (m) => { console.log('  ok    ' + m); };
const bad = (m) => { console.error('  FAIL  ' + m); failures++; };
const check = (cond, m) => (cond ? ok(m) : bad(m));

const AUTOCOMPLETE_PAGE = `<!doctype html><html><body><form>
  <label for="a_first">Candidate given designation</label>
  <input id="a_first" type="text" autocomplete="given-name">

  <label for="a_last">Candidate family designation</label>
  <input id="a_last" type="text" autocomplete="family-name">

  <label for="a_mail">Where we reach you</label>
  <input id="a_mail" type="text" autocomplete="email">

  <label for="a_tel">Best number</label>
  <input id="a_tel" type="text" autocomplete="tel">

  <label for="a_street">Residence line</label>
  <input id="a_street" type="text" autocomplete="address-line1">

  <label for="a_city">Residence locality</label>
  <input id="a_city" type="text" autocomplete="address-level2">

  <label for="a_state">Residence area</label>
  <select id="a_state" autocomplete="address-level1">
    <option value="">Select</option><option value="OR">Oregon</option><option value="WA">Washington</option>
  </select>

  <label for="a_zip">Residence mail routing</label>
  <input id="a_zip" type="text" autocomplete="shipping postal-code">

  <!-- must stay empty -->
  <label for="n_emerg">Emergency contact name</label>
  <input id="n_emerg" type="text" autocomplete="name">

  <label for="n_bday">Zzz</label>
  <input id="n_bday" type="text" autocomplete="bday">

  <label for="n_off">Yyy</label>
  <input id="n_off" type="text" autocomplete="off">

  <label for="n_none">Xxx</label>
  <input id="n_none" type="text">
</form></body></html>`;

const ICIMS_PAGE = `<!doctype html><html><body><form>
  <label for="icims_f_curCity">Current location line</label>
  <input id="icims_f_curCity" name="icims_f_curCity" type="text">

  <label for="icims_f_curZip">Code</label>
  <input id="icims_f_curZip" name="icims_f_curZip" type="text">

  <label for="icims_f_curStreet">Where</label>
  <input id="icims_f_curStreet" name="icims_f_curStreet" type="text">

  <label for="icims_f_curState">Pick one</label>
  <select id="icims_f_curState" name="icims_f_curState">
    <option value="">Select</option><option value="Oregon">Oregon</option><option value="Washington">Washington</option>
  </select>

  <label for="icims_f_mobilePhone">Best way to text you</label>
  <input id="icims_f_mobilePhone" name="icims_f_mobilePhone" type="text">
</form></body></html>`;

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

async function run(html, adapterName) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => bad('page error: ' + e.message));
  await page.setContent(html);
  await page.evaluate(() => { window.chrome = { runtime: { sendMessage: () => {}, lastError: null } }; });
  for (const s of SCRIPTS) await page.addScriptTag({ content: read(s) });
  const out = await page.evaluate(async ({ profile, adapterName }) => {
    const NA = window.NA;
    const p = NA.schema.hydrate(profile);
    NA.currentProfile = p;
    const adapter = adapterName === 'icims' ? NA.adapters.icims : NA.adapterBase.BaseAdapter;
    const settings = { fillDemographics: true, enableLlmFallback: false };
    const fields = NA.mapper.scan(adapter, document);
    const planned = NA.mapper.plan(fields, p, settings, adapter);
    await NA.mapper.execute(planned.plan, p, settings, adapter);
    const values = {};
    document.querySelectorAll('input,select').forEach((el) => { values[el.id] = el.value; });
    return {
      values,
      rules: planned.plan.filter((x) => x.action === 'fill').map((x) => x.ruleId),
      jibeMatches: !!(NA.adapters.icims && NA.adapters.icims.matches({ hostname: 'careers.jibeapply.com' }, document)),
      otherMatches: !!(NA.adapters.icims && NA.adapters.icims.matches({ hostname: 'example.org' }, { querySelector: () => null }))
    };
  }, { profile: PROFILE, adapterName });
  await page.close();
  return out;
}

/* ------------------------------------------------- autocomplete tier ---- */
console.log('\nFields whose labels no rule can read, resolved by the autocomplete attribute:');
{
  const r = await run(AUTOCOMPLETE_PAGE, 'base');
  const v = r.values;
  check(v.a_first === 'Jordan', 'given-name filled the first name: ' + JSON.stringify(v.a_first));
  check(v.a_last === 'Reyes', 'family-name filled the last name: ' + JSON.stringify(v.a_last));
  check(v.a_mail === 'jordan.reyes@example.com', 'email filled: ' + JSON.stringify(v.a_mail));
  check(/^503.?555.?0142$/.test(v.a_tel), 'tel filled in phone shape: ' + JSON.stringify(v.a_tel));
  check(v.a_street === '412 NW Clark St', 'address-line1 filled: ' + JSON.stringify(v.a_street));
  check(v.a_city === 'Portland', 'address-level2 filled the city: ' + JSON.stringify(v.a_city));
  check(v.a_state === 'OR', 'address-level1 chose the state option: ' + JSON.stringify(v.a_state));
  check(v.a_zip === '97209', 'a "shipping postal-code" token resolved by its last word: ' + JSON.stringify(v.a_zip));
  check(r.rules.filter((x) => x.startsWith('autocomplete:')).length === 8,
    'all eight were attributed to the autocomplete tier, not to a label rule');

  console.log('\nThe cases that must stay empty:');
  check(v.n_emerg === '', 'an "Emergency contact name" field was not given the applicant\'s name');
  check(v.n_bday === '', 'a bday token was never mapped');
  check(v.n_off === '', 'autocomplete="off" was ignored');
  check(v.n_none === '', 'an unlabelled, unannotated field was left alone');
}

/* ------------------------------------------------------ iCIMS ids ------ */
console.log('\niCIMS ids that have no word boundary, so a generic pattern cannot see them:');
{
  const withAdapter = await run(ICIMS_PAGE, 'icims');
  const v = withAdapter.values;
  check(v.icims_f_curCity === 'Portland', 'icims_f_curCity filled: ' + JSON.stringify(v.icims_f_curCity));
  check(v.icims_f_curZip === '97209', 'icims_f_curZip filled: ' + JSON.stringify(v.icims_f_curZip));
  check(v.icims_f_curStreet === '412 NW Clark St', 'icims_f_curStreet filled: ' + JSON.stringify(v.icims_f_curStreet));
  check(v.icims_f_curState === 'Oregon', 'icims_f_curState chose the full-name option: ' + JSON.stringify(v.icims_f_curState));
  check(/503.?555.?0142/.test(v.icims_f_mobilePhone), 'icims_f_mobilePhone filled: ' + JSON.stringify(v.icims_f_mobilePhone));

  const control = await run(ICIMS_PAGE, 'base');
  const left = ['icims_f_curCity', 'icims_f_curZip', 'icims_f_curStreet', 'icims_f_mobilePhone']
    .filter((id) => control.values[id] === '');
  check(left.length === 4, 'negative control: without the iCIMS adapter the same four fields stay empty (' + left.length + '/4)');

  check(withAdapter.jibeMatches, 'the iCIMS adapter recognises careers.jibeapply.com');
  check(!withAdapter.otherMatches, 'and does not claim an unrelated domain');
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
