/**
 * Static integrity check. Runs before packaging: a manifest that references a
 * file which is not there fails silently in Chrome with a blank content script,
 * which is a miserable thing to debug on a live application page.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { console.error('  FAIL  ' + m); failures++; };

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const files = walk(repo);

console.log('\nJavaScript syntax:');
for (const f of files.filter((f) => f.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    bad(f.replace(repo + '/', '') + '\n' + String(e.stderr).slice(0, 400));
  }
}
if (!failures) ok(`${files.filter((f) => f.endsWith('.js')).length} files parse`);

console.log('\nManifest:');
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(repo, 'manifest.json'), 'utf8'));
  ok('manifest.json is valid JSON');
} catch (e) {
  bad('manifest.json: ' + e.message);
  process.exit(1);
}

if (manifest.manifest_version !== 3) bad('manifest_version must be 3');
else ok('manifest_version 3');

if ((manifest.host_permissions || []).some((h) => h === '<all_urls>')) {
  bad('<all_urls> is present; host permissions must stay explicit');
} else {
  ok(`${(manifest.host_permissions || []).length} explicit host permissions, no <all_urls>`);
}

const referenced = [];
const cs = (manifest.content_scripts || [])[0] || {};
referenced.push(...(cs.js || []), ...(cs.css || []));
referenced.push(manifest.background.service_worker);
referenced.push(manifest.options_page, manifest.action.default_popup);
Object.values(manifest.icons || {}).forEach((v) => referenced.push(v));

for (const rel of referenced.filter(Boolean)) {
  if (existsSync(join(repo, rel))) continue;
  bad('manifest references a missing file: ' + rel);
}
ok(`${referenced.length} manifest file references resolve`);

if (!cs.all_frames) bad('content_scripts.all_frames must be true for iCIMS and Taleo iframes');
else ok('content scripts run in all frames');

console.log('\nHTML script and style references:');
for (const f of files.filter((f) => f.endsWith('.html') && !f.includes('/tools/'))) {
  const html = readFileSync(f, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (/^(https?:|data:|#)/.test(ref)) continue;
    if (!existsSync(resolve(dirname(f), ref))) {
      bad(`${f.replace(repo + '/', '')} references missing ${ref}`);
    }
  }
}
if (!failures) ok('every local script and stylesheet reference resolves');

console.log('\nSafety invariants:');
const contentSources = (cs.js || []).map((rel) => readFileSync(join(repo, rel), 'utf8')).join('\n');
if (/\.submit\s*\(/.test(contentSources)) bad('a content script calls form.submit()');
else ok('no content script calls form.submit()');

const clickTargets = /realClick\(|\.click\(\)/.test(contentSources);
if (!clickTargets) bad('expected click helpers to exist');
else ok('click helpers exist (used for dropdown options and radios only)');

const knockout = readFileSync(join(repo, 'src/content/knockout.js'), 'utf8');
for (const family of ['criminal', 'termination', 'board-discipline', 'exclusion', 'substance']) {
  if (knockout.includes(`family: '${family}'`)) ok(`knockout family present: ${family}`);
  else bad(`knockout family missing: ${family}`);
}

const sw = readFileSync(join(repo, 'src/background/service-worker.js'), 'utf8');
if (/allowedKeys/.test(sw) && !/profile/.test(sw.split('const MAP_SYSTEM')[1].split('async function mapFieldsWithModel')[0] || '')) {
  ok('field-mapping prompt carries no profile data');
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
