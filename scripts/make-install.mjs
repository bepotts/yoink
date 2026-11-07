import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.error('make:install requires macOS.');
  process.exit(1);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
  }
  if (result.error || result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run(process.execPath, [process.env.npm_execpath, 'run', 'make:mac']);

const applications = join(homedir(), 'Applications');
const destination = join(applications, 'Yoink.app');
const source = join(
  projectRoot,
  'out',
  `Yoink-darwin-${process.arch}`,
  'Yoink.app',
);
mkdirSync(applications, { recursive: true });
run('/usr/bin/ditto', [source, destination]);
console.log(`Installed Yoink at ${destination}`);
