/** Builds dist/nurseapply-<version>.zip containing only what Chrome loads. */
import { readFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(repo, 'manifest.json'), 'utf8'));
const stage = join(repo, 'dist', 'nurseapply');
const zipPath = join(repo, 'dist', `nurseapply-${manifest.version}.zip`);

rmSync(join(repo, 'dist'), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

for (const item of ['manifest.json', 'src', 'icons', 'README.md', 'LICENSE']) {
  const from = join(repo, item);
  if (existsSync(from)) cpSync(from, join(stage, item), { recursive: true });
}

execFileSync('zip', ['-rq', zipPath, 'nurseapply'], { cwd: join(repo, 'dist') });
console.log('Packaged ' + zipPath.replace(repo + '/', ''));
