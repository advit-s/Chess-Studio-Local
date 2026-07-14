import { spawnSync } from 'node:child_process';
import path from 'node:path';

const cli = path.resolve('node_modules', '@playwright', 'test', 'cli.js');
const forwarded = process.argv.slice(2);
const baseArgs = [cli, 'test', ...forwarded];
const singleProcessChromium = Boolean(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);

function run(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.signal) {
    console.error(`Playwright was terminated by ${result.signal}.`);
    process.exit(1);
  }
  return result;
}

if (!singleProcessChromium) {
  process.exit(run(baseArgs).status ?? 1);
}

// Lambda-style Chromium exits when Playwright closes its first browser
// context. Discover tests from Playwright itself, then give every discovered
// location a fresh browser process. This is slower, but it covers all current
// and future spec files instead of silently omitting OCR tests.
const listResult = spawnSync(process.execPath, [...baseArgs, '--list', '--reporter=line'], {
  cwd: process.cwd(),
  env: process.env,
  encoding: 'utf8',
});
if (listResult.error) throw listResult.error;
if (listResult.status !== 0) {
  process.stdout.write(listResult.stdout || '');
  process.stderr.write(listResult.stderr || '');
  process.exit(listResult.status ?? 1);
}

const plainList = String(listResult.stdout || '').replace(/\u001b\[[0-9;]*m/g, '');
const locations = Array.from(
  plainList.matchAll(/^\s*(.+\.spec\.[jt]sx?):(\d+):\d+\s+›/gm),
  (match) => `${match[1]}:${match[2]}`,
);
if (locations.length === 0) {
  console.error('Playwright listed no test locations; refusing to report an empty suite as passing.');
  process.exit(1);
}

console.log(`Running all ${locations.length} Playwright tests with isolated browser processes.`);
for (const location of locations) {
  // `forwarded` already constrained the discovery list. Repeating positional
  // file filters here would make Playwright OR them with `location` and launch
  // several tests in the same fragile browser process.
  const result = run([cli, 'test', location, '--workers=1']);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
