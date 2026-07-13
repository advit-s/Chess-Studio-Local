# Chess Studio Local 0.2.0 engineering report

Date: 2026-07-13  
Target: locally served Google Chrome on Windows  
Audited input: `chess-studio-local-v0.1.1(1).zip`  
Input SHA-256: `40ef193bcdec445e0a34a267cbf27b54574f1d904abf3e1c2225e6c0aecd00c5`

## Outcome

The application was repaired as a complete state/worker/layout/build system rather than patched around individual symptoms. The final clean build has one hashed JS bundle, one hashed CSS bundle, the icon/manifest/service worker, and the local Stockfish worker/WASM. It runs through development, Vite preview, and the supplied local HTTP launcher without external APIs.

## Root causes found

1. **Exact black-screen failure:** a Stockfish PV calculated for the prior FEN remained in `EngineSnapshot` after a move. `EnginePanel.variationSan()` constructed a `Chess` from the new FEN and called `chess.move()` with the old first PV move. `chess.js` threw `Invalid move` during React rendering. There was no error boundary, so React unmounted the complete application and exposed the black page background.
2. **No engine result identity:** snapshots carried neither a request generation nor their position FEN. Old `info` and `bestmove` messages could update the new position, a stopped request, game review, or engine-play turn.
3. **Unsafe UCI/search lifecycle:** the original client had no handshake timeout, readiness rejection, legal-best-move check, restart path, unmount-safe request identity, or reliable pending-request cancellation. `stop`, live analysis, requested analysis, depth changes, and MultiPV changes could overlap.
4. **Worker creation during render:** `StockfishClient` was allocated through a render-time ref. React Strict Mode could create/discard a render before effects owned cleanup, and worker callbacks were not tied to a mounted generation.
5. **Scattered mutable game model:** live `Chess`, `rootFen`, navigation ply, pending engine moves, review positions, and variation previews were coordinated separately. Historical review and variation selection could replace the original game. Engine callbacks captured obsolete `Chess` instances. Undo rebuilt a different game and redo did not exist.
6. **Duplicate/stale move acceptance:** moves had no expected-position token. A late drag/click/Strict Mode callback could be applied to a position other than the one that accepted the gesture.
7. **Incomplete input boundary:** mouse drag existed, but there was no touch-pointer drag path. Native drag, square click, and pending promotion had no single accepted/rejected contract. Check highlighting was absent.
8. **Rectangular/overflowing board:** `.board-shell` combined `width: 100%`, `aspect-ratio`, and a smaller `max-height`. CSS could clamp height without recomputing width. The child relied on `height: 100%`, individual squares also had aspect ratios, and surrounding columns had hard minimums. The body forced 320 px, narrow archive cards forced 260 px, and the mobile stylesheet hid PGN/FEN entirely.
9. **Production used a different Vite config:** stale generated `vite.config.js` and `.d.ts` files were shipped next to `vite.config.ts`. Vite selected the old JavaScript config, losing `base: './'` and the repaired production settings. Old hashed bundles accumulated in `dist`, masking which code was active.
10. **Stale service-worker strategy:** the original service worker was cache-first for the application shell and used absolute-root URLs. It could continue serving a broken bundle and did not isolate Chess Studio caches. Development did not unregister the production worker.
11. **Launcher instability:** `start-local.bat` attempted a development dependency install before using the supplied build. The prebuilt launcher opened a generic browser before confirming its Python server and had no Node server with controlled MIME, cache, path, and isolation headers.
12. **PGN/FEN/history loss:** custom FEN games did not reliably acquire `SetUp`/`FEN` headers on export. Review selection and PV selection could replace the live game/history. Input errors were only partially surfaced and clipboard failures were unhandled.
13. **Unvalidated storage:** arbitrary JSON was cast directly to settings/games, invalid values were merged into settings, read failures were silently swallowed, and write errors were not reported.
14. **Test blind spots:** the five original unit tests tested helpers and UCI parsing, not browser rendering, move input, stale engine output, layout, production assets, service workers, or launch/build parity.

## Architecture after repair

### Game domain

`src/lib/gameState.ts` defines an immutable `GameDocument` containing the canonical starting FEN, legal move list, redo list, cursor, and PGN headers. `gameReducer` accepts a move only when its `expectedFen` equals the current reconstructed FEN. Every live or historical `Chess` position is derived by replay; the board cannot desynchronize from a hidden mutable instance.

### Presentation/input

`ChessBoard` is memoized and only renders a position map. It returns a Boolean acceptance result for mouse drag and touch-pointer drag, uses a movement threshold/pointer capture for touch, and keeps square clicks separate. Selection, legal/capture targets, promotion, last move, check, orientation, arrows, and disabled state are presentation data owned by `App`.

### Engine

`StockfishClient` owns exactly one dedicated single-thread Web Worker. It performs `uci`/`uciok`/`isready`/`readyok`, serializes search transitions, drains `stop`, validates all input FENs and returned best moves, applies request timeouts, and can restart after a failure. Every search increments a generation and every snapshot includes its FEN. Results are ignored unless both generation and position still match. App mode boundaries prevent live analysis, computer play, and review from competing for the worker.

### UI and persistence

Game state, board presentation, engine state, review state, archive state, and settings are independent React state boundaries. Storage v2 validates record shape/ranges and reads the v1 keys for migration. The error boundary logs an actual render failure and presents a reload recovery screen.

### Build/PWA/startup

Vite uses relative base paths and empties `dist`. Production registers a versioned network-first service worker; development unregisters it and clears only Chess Studio caches. The Node local server serves correct content types and headers, rejects missing assets instead of returning HTML, selects ports 8080–8089, and finds Chrome on Windows. A Python server remains a basic fallback.

## Important files changed

- Project/build: `package.json`, `package-lock.json`, `.gitignore`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.app.json`, `tsconfig.node.json`, `index.html`
- Canonical state: `src/lib/gameState.ts`, `src/lib/storage.ts`, `src/lib/chessUtils.ts`, `src/types/chess.ts`
- App/UI: `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `src/components/ChessBoard.tsx`, `src/components/EnginePanel.tsx`, `src/components/ErrorBoundary.tsx`, `src/components/ImportExportDialog.tsx`, `src/components/ReviewPanel.tsx`
- Engine: `src/engine/StockfishClient.ts`
- PWA/assets: `public/sw.js`, `public/manifest.webmanifest`, rebuilt `dist/**`
- Launching: `start-local.bat`, `start-development.bat`, `run-prebuilt.bat`, `start-local.sh`, `scripts/serve-dist.mjs`
- Tests: `src/lib/gameState.test.ts`, `src/lib/chessUtils.test.ts`, `src/engine/uci.test.ts`, `tests/e2e/chess-studio.spec.ts`, `scripts/run-e2e.mjs`
- Documentation/licensing: `README.md`, `FEATURES.md`, `CHANGELOG.md`, `THIRD_PARTY_NOTICES.md`, `THIRD_PARTY_LICENSES/**`, this report
- Removed: stale `vite.config.js`, `vite.config.d.ts`, root TypeScript build-info outputs

## Tests added/repaired

### Unit tests — 12 passed

- Legal move applied once; stale duplicate callback rejected
- Immutable undo/redo
- Castling, en passant, and promotion replay
- PGN headers/comments/variations and custom starting FEN round trip
- Invalid FEN/PGN rejection
- Evaluation perspective, loss classification, and UCI move parsing
- Stalemate, threefold, insufficient material, and fifty-move status
- MultiPV/centipawn info parsing, mate parsing, bestmove parsing, malformed-line rejection

### Production browser scenarios — 10 passed

1. Clean home load, square/non-zero board, zero captured console/page/network errors, local JS/WASM 200
2. Illegal click rejection, click movement, native drag, 20 legal plies, board survival, undo, redo, flip, and a complete short checkmate game
3. Castling, en passant, promotion, invalid FEN recovery
4. Trusted Chrome touch-event drag with no duplicate click/move
5. Two PGN imports (headers/comments/variation and normal headers), history navigation, second FEN flow, custom-FEN export headers
6. Stockfish readiness/legal lines, rapid depth/MultiPV cancellation, multiple positions, stale-output crash regression
7. Play mode produces exactly one legal engine reply
8. Fullscreen and square/no-overflow layout at 1920×1080, 1600×900, 1366×768, 1280×720, 1024×768, 768×1024, 390×844, plus 312×675 and 260×563 zoom-equivalent CSS viewports
9. Theme/orientation persistence, saved archive open, production asset availability, and offline service-worker reload
10. Game review cancellation, restart, completion, and non-destructive move selection

Development-server browser checks separately passed the clean-load and full 20-ply interaction scenarios.

## Final results

- Input checksum: passed
- Clean `npm ci` in a new temporary copy: passed; 102 packages installed; postinstall copied the engine
- TypeScript/Vite build: passed; 42 modules transformed
- Unit tests: 3 files, 12 tests passed
- Stockfish Node smoke: passed; legal best move returned
- Browser tests: all 10 scenarios passed in real Chromium 149.0.7827.0
- Browser error collection: no uncaught React errors, page errors, console errors, or failed same-origin asset requests in passing scenarios
- Dependency audit: 0 known vulnerabilities
- Final `dist`: 8 files, approximately 7.3 MB
- Stockfish worker SHA-256: `5243fd9b276cab7dfe3ad1d43ab9ead73568fac76468c614242977a210c4a391`
- Stockfish WASM SHA-256: `a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1`

## Commands executed

Main reproducible commands (diagnostic `rg`, `sed`, archive inspection, and browser-console probes were also used during the audit):

```bash
sha256sum chess-studio-local-v0.1.1\(1\).zip
unzip -q chess-studio-local-v0.1.1\(1\).zip

pnpm install --lockfile=false --ignore-scripts --store-dir /tmp/pnpm-store
pnpm test
pnpm run build
pnpm run smoke:engine

pnpm dlx npm@10.9.4 install --package-lock-only --ignore-scripts --no-audit --no-fund
pnpm dlx npm@10.9.4 audit --audit-level=low

# Clean-copy verification
pnpm dlx npm@10.9.4 ci --no-audit --no-fund
npm test
npm run build
npm run smoke:engine

# Production browser verification
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<chromium> npm run test:e2e

# Development browser verification
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4174 \
PLAYWRIGHT_SERVER_COMMAND='npm run dev -- --port 4174 --strictPort' \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<chromium> \
pnpm exec playwright test --grep '<scenario>' --workers=1

# Local production-server protocol checks
CHESS_STUDIO_NO_OPEN=1 PORT=8190 node scripts/serve-dist.mjs
curl -I http://127.0.0.1:8190/
curl -I http://127.0.0.1:8190/engine/stockfish-18-lite-single.wasm
curl http://127.0.0.1:8190/assets/does-not-exist.js
```

The restricted audit container requires a Lambda-style Chromium `--single-process` build. `scripts/run-e2e.mjs` detects that explicit executable environment and runs each scenario in a fresh browser process. On ordinary Windows Playwright/Chrome, `npm run test:e2e` runs the suite normally.

## Exact Windows startup

### Run the included stable build

1. Extract the ZIP, keeping its directory structure.
2. Install Node.js 22 LTS (preferred) or Python 3.
3. Double-click `start-local.bat`.
4. Chrome opens the reported `http://127.0.0.1:<port>/` URL. Keep the console window open.
5. Stop with `Ctrl+C`.

### Develop

```bat
cd C:\path\to\chess-studio-local
npm ci
npm run dev
```

### Rebuild and preview

```bat
cd C:\path\to\chess-studio-local
npm ci
npm run build
npm run preview
```

Do not use `file://`. Core functionality remains local after dependencies have been installed once, and the included prebuilt launcher does not need npm or an internet connection.

## Remaining limitations

- The final browser run used Chromium 149 in the Linux audit container. The Windows `.bat` control flow and the same Node server were inspected/tested, but this environment cannot execute a native Windows Google Chrome process. A final click-through on the target Windows machine is still prudent.
- Stockfish Lite is single-threaded by design and weaker than native desktop Stockfish. This is also the compatibility fallback; it does not need SharedArrayBuffer or an external NNUE request.
- RAV/comments are accepted on PGN import and the main line is loaded; the app does not retain an editable variation/comment tree on re-export.
- The archive is localStorage-based, capped at 100 games, and profile-local.
- Browser tests are interaction/regression tests, not a multi-hour memory soak.
- Chess clocks, Chess960, opening databases, and online imports are not included.
