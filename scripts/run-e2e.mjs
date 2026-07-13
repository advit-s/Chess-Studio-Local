import { spawnSync } from 'node:child_process';
import path from 'node:path';

const cli = path.resolve('node_modules', '@playwright', 'test', 'cli.js');
const forwarded = process.argv.slice(2);
const isolatedChromium = Boolean(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);

// The Lambda-style Chromium binary used in restricted CI must run with a single
// process and exits when Playwright replaces a browser context. Normal Chrome and
// the bundled Playwright browser run the complete suite in one invocation.
const cases = isolatedChromium ? [
  'home loads cleanly',
  'click, drag, illegal move rejection',
  'castling, en passant',
  'real touch pointer dragging',
  'PGN comments, headers',
  'Stockfish initializes',
  'play mode produces',
  'all required viewports',
  'supported settings persist',
  'game review can be cancelled',
] : [undefined];

for (const title of cases) {
  const args = [cli, 'test', ...forwarded];
  if (title) args.push('--grep', title, '--workers=1');
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
