# Third-party notices

Pinned versions are recorded in `package-lock.json`. License copies for the redistributed engine and test/runtime libraries are in `THIRD_PARTY_LICENSES`.

## Stockfish / Stockfish.js 18.0.8

The local browser engine is `stockfish-18-lite-single.js` plus its WASM binary from the `stockfish` npm package. Stockfish and Stockfish.js are licensed under GPL-3.0.

- Stockfish.js source: https://github.com/nmrugg/stockfish.js
- Upstream Stockfish source: https://github.com/official-stockfish/Stockfish
- License copy: `THIRD_PARTY_LICENSES/Stockfish-GPL-3.0.txt`

The worker header identifies the Stockfish.js 18 build and its neural-network source reference. The Lite build needs no separately downloaded NNUE file at runtime.

## chess.js 1.4.0

`chess.js` is licensed under BSD-2-Clause.

- Project: https://github.com/jhlywa/chess.js
- License copy: `THIRD_PARTY_LICENSES/chess.js-BSD-2-Clause.txt`

## Playwright 1.61.1

Playwright is used only for browser tests and is licensed under Apache-2.0.

- Project: https://github.com/microsoft/playwright
- License copy: `THIRD_PARTY_LICENSES/Playwright-Apache-2.0.txt`

## React, Vite, Vitest, and TypeScript

React, React DOM, Vite, Vitest, and TypeScript are open-source development/runtime dependencies distributed under their respective MIT or Apache-compatible licenses. Their package metadata and exact transitive dependency notices are available after `npm ci` in `node_modules`.

Chess Studio Local does not include Chessis source, branding, proprietary algorithms, or assets.
