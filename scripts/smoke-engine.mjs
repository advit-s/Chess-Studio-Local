import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const initEngine = require('stockfish');
const engine = await initEngine('lite-single');

const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Stockfish smoke test timed out.')), 20_000);
  const lines = [];
  engine.listener = (line) => {
    lines.push(line);
    if (line.startsWith('bestmove ')) {
      clearTimeout(timeout);
      resolve({ bestMove: line.split(/\s+/)[1], lines });
    }
  };
  engine.sendCommand('uci');
  engine.sendCommand('setoption name MultiPV value 2');
  engine.sendCommand('position startpos');
  engine.sendCommand('go depth 8');
});

if (!result.bestMove || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(result.bestMove)) {
  throw new Error(`Unexpected best move: ${result.bestMove}`);
}
if (!result.lines.some((line) => line.startsWith('info ') && line.includes(' pv '))) {
  throw new Error('Stockfish did not return a principal variation.');
}
console.log(`Stockfish smoke test passed. Best move: ${result.bestMove}`);
engine.sendCommand('quit');
