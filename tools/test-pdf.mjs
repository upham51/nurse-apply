/**
 * End-to-end PDF check: a real PDF goes in, profile fields come out, with no
 * network and no API key. Proves the vendored pdf.js build actually runs under
 * the constraints an extension page imposes.
 */
import { createRequire } from 'node:module';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (m) => { console.log('  ok    ' + m); return 0; };
const bad = (m) => { console.error('  FAIL  ' + m); return 1; };
const eq = (got, want, label) => String(got) === String(want)
  ? ok(`${label} = ${JSON.stringify(got)}`)
  : bad(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);

// ES modules cannot be imported from file:// (opaque origin), and an extension
// page is served over a real origin anyway, so mirror that with a local server.
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf',
  '.png': 'image/png'
};
const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([.]{2}[/\\])+/, '');
  const file = join(repo, rel);
  if (!file.startsWith(repo) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;

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

// Fail loudly if anything leaves the local origin: the whole claim is that
// parsing needs no network. Requests to the local static server are the page
// loading the extension's own vendored files, which is what a chrome-extension://
// origin does too.
await page.route('**/*', (route) => {
  const url = route.request().url();
  if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
  console.error('  FAIL  page attempted an external request to ' + url);
  failures++;
  return route.abort();
});

await page.addInitScript((base) => {
  window.chrome = { runtime: { getURL: (p) => base + p } };
}, origin + '/');

await page.goto(origin + '/tools/fixtures/blank.html');
for (const f of ['src/schema/profile.js', 'src/lib/pdftext.js', 'src/lib/resumeParse.js']) {
  await page.addScriptTag({ content: readFileSync(join(repo, f), 'utf8') });
}

const pdfBytes = Array.from(readFileSync(join(repo, 'tools/fixtures/resumes/a-classic.pdf')));

console.log('\nPDF text extraction with the vendored pdf.js:');
const out = await page.evaluate(async (bytes) => {
  const buf = new Uint8Array(bytes).buffer;
  const before = buf.byteLength;
  const text = await window.NA.pdftext.extractText(buf);

  // pdf.js hands its typed array to the worker as a transferable, which
  // detaches the buffer in this thread. The options page still needs those
  // bytes afterwards to store the resume for portal uploads, so extraction
  // must not consume the caller's buffer.
  let survived = false;
  let reuseError = '';
  try {
    const copy = new Uint8Array(buf);
    survived = buf.byteLength === before && copy.length === before;
  } catch (e) { reuseError = String(e && e.message || e); }

  const parsed = window.NA.resumeParse.parse(text);
  return { chars: text.length, sample: text.slice(0, 90), profile: parsed.profile,
           stats: parsed.stats, survived, reuseError };
}, pdfBytes);

failures += out.chars > 800 ? ok(`extracted ${out.chars} characters`) : bad(`only ${out.chars} characters extracted`);
console.log('  first line: ' + JSON.stringify(out.sample.split('\n')[0]));

console.log('\nCaller buffer survives extraction:');
failures += out.survived
  ? ok('the input ArrayBuffer is still usable after extraction')
  : bad('extraction detached the caller buffer' + (out.reuseError ? ': ' + out.reuseError : ''));

console.log('\nParsed straight out of the PDF:');
const p = out.profile;
failures += eq(p.identity.firstName, 'Jordan', 'first name');
failures += eq(p.identity.email, 'jordan.reyes@example.com', 'email');
failures += eq(p.identity.phone, '503-555-0142', 'phone');
failures += eq(p.identity.address.zip, '97209', 'zip');
failures += eq(p.licenses.length, 2, 'licenses');
failures += eq(p.certifications.length, 4, 'certifications');
failures += eq(p.experience.length, 2, 'roles');
failures += eq(p.experience[0].unit, 'MICU', 'role 1 unit');
failures += eq(p.experience[0].typicalRatio, '1:2', 'role 1 ratio');
failures += eq(p.experience[0].bedCount, '24', 'role 1 bed count');
failures += eq(p.education[0].degree, 'BSN', 'degree');
console.log('  stats: ' + JSON.stringify(out.stats));

/* ------------------------------------------------------------------------
   Second case: the designed layout.

   A real resume from a designer-built template broke every structural
   assumption at once, and each trait below is one that produced a wrong
   answer rather than an obvious failure. Empty output is easy to notice; a
   job title of "PAGE 1 OF 3" is not.
   ------------------------------------------------------------------------ */
console.log('\nDesigned layout: letter-spaced headers, right-aligned dates, no bullet glyphs:');
const designerBytes = Array.from(readFileSync(join(repo, 'tools/fixtures/resumes/designer-layout.pdf')));
const d = await page.evaluate(async (bytes) => {
  const text = await window.NA.pdftext.extractText(new Uint8Array(bytes).buffer);
  const parsed = window.NA.resumeParse.parse(text);
  return { text, profile: parsed.profile, stats: parsed.stats, report: parsed.report };
}, designerBytes);

const dp = d.profile;
const roles = dp.experience;

failures += d.stats.sections.indexOf('experience') !== -1
  ? ok('letter-spaced "P R O F E S S I O N A L  E X P E R I E N C E" recognised as a section')
  : bad('sections found were ' + JSON.stringify(d.stats.sections));

failures += eq(roles.length, 4, 'roles');
failures += eq(dp.identity.firstName, 'Priya', 'first name');
failures += eq(dp.identity.address.city, 'Tacoma', 'city from the headline, not the words before it');
failures += eq(dp.identity.address.state, 'WA', 'state');

if (roles.length === 4) {
  failures += eq(roles[0].title, 'RN Unit Manager / MDS Coordinator', 'run-together title split');
  failures += eq(roles[0].employer, 'Cascade Ridge Center (Northgate Health)', 'employer, city stripped');
  failures += eq(roles[0].startDate, '2024-03', 'right-aligned date paired with its title');
  failures += eq(roles[0].isCurrent, true, 'current role');
  failures += eq(roles[0].facilityType, 'SNF', 'facility type');
  failures += eq(roles[0].bedCount, '118', 'bed count');
  failures += eq(roles[0].unit, 'Long Term Care', 'unit');

  failures += eq(roles[1].employer, 'Olympic Correctional Complex, level 3 medium security institution',
    'long employer line kept, not mistaken for a duty');
  failures += eq(roles[1].facilityType, 'Corrections', 'corrections facility');
  failures += eq(roles[1].unit, 'Triage',
    'unit read from the title, not from "psychiatric crises" in the duties');

  failures += eq(roles[2].startDate, '2019-08', 'page-two role keeps its own date');
  failures += eq(roles[2].traumaLevel, 'Level II', 'trauma level');
  failures += eq(roles[2].typicalRatio, '1:2', 'ratio');
  failures += eq(roles[2].bedCount, '288', 'bed count');

  failures += roles.every((r) => !/page\s*\d/i.test(r.title) && !/page\s*\d/i.test(r.employer))
    ? ok('the running page footer never became a job title or employer')
    : bad('page furniture leaked into a role: ' + JSON.stringify(roles.map((r) => r.title)));

  failures += roles.every((r) => r.responsibilities && r.responsibilities.length > 20)
    ? ok('duties captured despite there being no bullet characters')
    : bad('duties missing: ' + JSON.stringify(roles.map((r) => r.responsibilities.length)));
}

failures += eq(dp.education.length, 1, 'schools');
if (dp.education.length) {
  failures += eq(dp.education[0].school, 'Pacific Cascade University',
    'school name, with the licensure column not glued on');
  failures += eq(dp.education[0].degree, 'BSN', 'degree from a run-together string');
  failures += eq(dp.education[0].graduationDate, '2015-05', 'graduation');
}

const states = dp.licenses.map((l) => l.state).sort().join(',');
failures += states === 'ID,OR,WA'
  ? ok('multi-state licensure expanded to ID, OR, WA')
  : bad('licence states came out as ' + JSON.stringify(states));
failures += dp.licenses.every((l) => l.number === '')
  ? ok('no license number invented, because the resume states none')
  : bad('a license number was invented');
failures += d.report.some((r) => /no license numbers/i.test(r.msg))
  ? ok('reports the missing license numbers')
  : bad('did not report the missing license numbers');
failures += d.report.some((r) => /no certifications/i.test(r.msg))
  ? ok('reports that no certifications were found')
  : bad('did not report the absent certifications');
failures += dp.certifications.length === 0
  ? ok('no certification invented')
  : bad('invented ' + dp.certifications.length + ' certifications');

const ambiguous = d.report.filter((r) => /Could not tell employer from job title/.test(r.msg));
failures += ambiguous.length === 0
  ? ok('no spurious ambiguity warnings on a layout it read correctly')
  : bad(ambiguous.length + ' roles flagged ambiguous: ' + JSON.stringify(ambiguous.map((a) => a.msg)));

console.log('  stats: ' + JSON.stringify(d.stats));

await browser.close();
server.close();
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
