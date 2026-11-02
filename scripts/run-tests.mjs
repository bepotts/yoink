// Runs test suites while streaming stdout and stderr to the terminal and a log file.

import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';

const [suite, ...extraArgs] = process.argv.slice(2);
if (!['test', 'act'].includes(suite)) {
  throw new Error('Expected test or act as the suite name');
}

const root = fileURLToPath(new URL('../', import.meta.url));
const logPath = new URL(`../logs/${suite}-all.log`, import.meta.url);
await mkdir(new URL('../logs/', import.meta.url), { recursive: true });
const log = await open(logPath, 'w');
const npm = process.env.npm_execpath;
const commands =
  suite === 'act'
    ? [['act', 'push', ...extraArgs]]
    : [
        [process.execPath, npm, 'test'],
        [process.execPath, npm, 'run', 'test:e2e', ...extraArgs],
      ];

console.log(`Saving output to ${fileURLToPath(logPath)}`);
try {
  for (const [command, ...args] of commands) {
    if (args.some((arg) => arg === undefined))
      throw new Error('Run this script through npm.');
    await log.write(`\n> ${command} ${args.join(' ')}\n\n`);
    const child = spawn(command, args, {
      cwd: root,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    // Use synchronous writes per chunk so stdout and stderr cannot overwrite each other.
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      writeSync(log.fd, chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      writeSync(log.fd, chunk);
    });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    let result;
    try {
      result = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      });
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
    const code = result.code ?? 128 + (constants.signals[result.signal] ?? 1);
    if (code !== 0) {
      process.exitCode = code;
      break;
    }
  }
} catch (error) {
  const message = `${error instanceof Error ? error.message : error}\n`;
  process.stderr.write(message);
  await log.write(message);
  process.exitCode = 1;
} finally {
  await log.close();
}
