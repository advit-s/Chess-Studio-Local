import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBoardFen } from './lib/ocr-benchmark.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(projectRoot, 'tests', 'ocr-benchmark', 'images');
const fontPaths = {
  'dejavu-sans': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'dejavu-sans-mono': '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
};

const glyphs = Object.freeze({
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
});

const themes = Object.freeze({
  classic: { light: '#f0d9b5', dark: '#b58863', background: '#20262d', panel: '#303942', accent: '#9bc25b' },
  slate: { light: '#b9c2ca', dark: '#596776', background: '#11171e', panel: '#212a34', accent: '#5ea3d8' },
  wood: { light: '#e1c699', dark: '#9b6744', background: '#201914', panel: '#39281d', accent: '#d8a35d' },
});

const captures = [
  {
    file: 'generated-start-light.png',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
    orientation: 'white', theme: 'classic', font: 'dejavu-sans', coordinates: true, panels: true,
  },
  {
    file: 'generated-empty-dark.png',
    fen: '8/8/8/8/8/8/8/8',
    orientation: 'white', theme: 'slate', font: 'dejavu-sans', coordinates: false, panels: false,
  },
  {
    file: 'generated-middlegame-dark.png',
    fen: 'r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P4/2PBPN2/PP1N1PPP/R1BQR1K1',
    orientation: 'white', theme: 'slate', font: 'dejavu-sans', coordinates: true, panels: true,
  },
  {
    file: 'generated-endgame-black-wood.png',
    fen: '8/5pk1/6p1/3p4/3P1P2/6P1/5K2/8',
    orientation: 'black', theme: 'wood', font: 'dejavu-sans-mono', coordinates: true, panels: true,
  },
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)));
  });
}

function drawCapture(capture) {
  const theme = themes[capture.theme];
  const boardSize = 512;
  const tile = boardSize / 8;
  const boardX = capture.panels ? 88 : 64;
  const boardY = 64;
  const width = capture.panels ? 900 : 640;
  const height = 640;
  const args = ['-size', `${width}x${height}`, `xc:${theme.background}`];

  if (capture.panels) {
    args.push(
      '-fill', theme.panel, '-stroke', 'none', '-draw', `roundrectangle 12,22 70,618 12,12`,
      '-draw', `roundrectangle 620,22 884,618 12,12`,
      '-fill', theme.accent, '-draw', 'roundrectangle 642,48 858,58 5,5',
      '-fill', '#dce5ed', '-font', fontPaths[capture.font], '-pointsize', '18',
      '-draw', "text 642,100 'CHESS STUDIO LOCAL'",
      '-fill', '#91a0ad', '-pointsize', '14', '-draw', "text 642,134 'Analysis · local engine'",
    );
  }

  for (let row = 0; row < 8; row += 1) {
    for (let file = 0; file < 8; file += 1) {
      const x = boardX + file * tile;
      const y = boardY + row * tile;
      args.push('-fill', (row + file) % 2 ? theme.dark : theme.light, '-stroke', 'none',
        '-draw', `rectangle ${x},${y} ${x + tile},${y + tile}`);
    }
  }

  const canonical = parseBoardFen(capture.fen);
  const display = capture.orientation === 'white' ? canonical : [...canonical].reverse();
  for (let index = 0; index < 64; index += 1) {
    const piece = display[index];
    if (piece === 'empty') continue;
    const row = Math.floor(index / 8);
    const file = index % 8;
    const x = boardX + file * tile + 7;
    const y = boardY + row * tile + 55;
    const isWhite = piece.startsWith('w');
    args.push(
      '-font', fontPaths[capture.font], '-pointsize', '56',
      '-fill', isWhite ? '#ffffff' : '#111111',
      '-stroke', isWhite ? '#111111' : '#f2f2f2',
      '-strokewidth', isWhite ? '1.2' : '0.5',
      '-draw', `text ${x},${y} '${glyphs[piece]}'`,
    );
  }

  if (capture.coordinates) {
    args.push('-font', fontPaths[capture.font], '-pointsize', '12', '-strokewidth', '0');
    for (let viewFile = 0; viewFile < 8; viewFile += 1) {
      const canonicalFile = capture.orientation === 'white' ? viewFile : 7 - viewFile;
      const label = String.fromCharCode(97 + canonicalFile);
      const row = 7;
      const color = (row + viewFile) % 2 ? theme.light : theme.dark;
      args.push('-fill', color, '-draw', `text ${boardX + viewFile * tile + 4},${boardY + boardSize - 5} '${label}'`);
    }
    for (let viewRow = 0; viewRow < 8; viewRow += 1) {
      const rank = capture.orientation === 'white' ? 8 - viewRow : viewRow + 1;
      const file = 7;
      const color = (viewRow + file) % 2 ? theme.light : theme.dark;
      args.push('-fill', color, '-draw', `text ${boardX + boardSize - 13},${boardY + viewRow * tile + 14} '${rank}'`);
    }
  }

  args.push('-strip', '-define', 'png:exclude-chunk=time', path.join(fixtureRoot, capture.file));
  return run('convert', args);
}

async function main() {
  await access('/usr/bin/convert');
  for (const fontPath of Object.values(fontPaths)) await access(fontPath);
  await mkdir(fixtureRoot, { recursive: true });
  for (const capture of captures) {
    await drawCapture(capture);
    console.log(`Generated ${capture.file}`);
  }

  const source = path.join(fixtureRoot, 'example_input.png');
  // Decoder fixtures exercise every supported browser input format. They are
  // deterministic encodings of the labelled upstream reference and are not
  // counted as independent real-world benchmark samples.
  await run('convert', [source, '-strip', '-quality', '92', path.join(fixtureRoot, 'format-reference.jpg')]);
  await run('convert', [source, '-strip', '-quality', '92', path.join(fixtureRoot, 'format-reference.webp')]);
  await run('convert', [source, '-resize', '55%', '-strip', '-define', 'png:exclude-chunk=time', path.join(fixtureRoot, 'augmented-scale-55.png')]);
  await run('convert', [source, '-modulate', '82,70,100', '-quality', '38', '/tmp/chess-ocr-compressed.jpg']);
  await run('convert', ['/tmp/chess-ocr-compressed.jpg', '-bordercolor', '#151a20', '-border', '90x48', '-strip', '-define', 'png:exclude-chunk=time', path.join(fixtureRoot, 'augmented-compressed-panels.png')]);
  await run('convert', [source, '-background', '#181e25', '-rotate', '1.5', '-strip', '-define', 'png:exclude-chunk=time', path.join(fixtureRoot, 'augmented-rotate-1_5.png')]);
  await run('convert', [
    source, '-matte', '-virtual-pixel', 'background', '-background', '#181e25',
    '-distort', 'Perspective', '0,0 24,18 1101,0 1080,0 0,1027 0,1004 1101,1027 1120,1027',
    '-strip', '-define', 'png:exclude-chunk=time', path.join(fixtureRoot, 'augmented-perspective.png'),
  ]);
  console.log('Generated transformed regression fixtures.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
