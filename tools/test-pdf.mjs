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
  const text = await window.NA.pdftext.extractText(buf);
  const parsed = window.NA.resumeParse.parse(text);
  return { chars: text.length, sample: text.slice(0, 90), profile: parsed.profile, stats: parsed.stats };
}, pdfBytes);

failures += out.chars > 800 ? ok(`extracted ${out.chars} characters`) : bad(`only ${out.chars} characters extracted`);
console.log('  first line: ' + JSON.stringify(out.sample.split('\n')[0]));

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

await browser.close();
server.close();
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
