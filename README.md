# Chess Studio Local 0.2.0

Chess Studio Local is a private, offline-first chess board and analysis application for Google Chrome on Windows. Move legality comes from `chess.js`; Stockfish 18 Lite runs locally in a dedicated Web Worker. Core play, analysis, PGN/FEN handling, saved games, and the **local Chess OCR position scanner** do not use an account, API, or cloud server.

## Fast Windows start (included production build)

1. Extract the complete ZIP to a normal folder such as `C:\ChessStudioLocal`.
2. Install [Node.js 22 LTS](https://nodejs.org/) if it is not already installed. Python 3 is also supported as a basic server fallback.
3. Double-click `start-local.bat`.
4. Keep the server window open. The launcher opens Google Chrome at a local address, normally `http://127.0.0.1:8080/`.
5. Press `Ctrl+C` in the server window when finished.

The launcher serves `dist` over HTTP; do not open `dist/index.html` with `file://`. The Node launcher tries ports 8080 through 8089, sends the correct WASM MIME type and isolation headers, and opens Chrome directly when it can find it. `run-prebuilt.bat` is an equivalent explicit launcher.

No npm install or internet connection is needed for this prebuilt path. The JavaScript, CSS, icon, Stockfish worker, and 7.3 MB WASM engine are included in `dist`.

## Development

Requirements:

- Node.js 20.19+ or 22.12+
- npm 10+
- Current Google Chrome, Chromium, or Microsoft Edge

From Command Prompt or PowerShell in the project folder:

```bash
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173/`. On Windows, `start-development.bat` performs the install when needed and starts the development server.

## Clean production build

```bash
npm ci
npm run build
```

Vite preview normally uses `http://127.0.0.1:4173/`. To use the same server as the Windows prebuilt launcher:

```bash
npm run build
npm run serve
```

`npm install` copies the pinned Stockfish Lite single-thread worker and WASM from the `stockfish` package into `public/engine`. Vite copies those files into every clean `dist` build.

## Tests

Install the Playwright browser once, then run all checks:

```bash
npm ci
  npx playwright install chromium
npm test
npm run smoke:engine
npm run build
npm run test:e2e
npm audit
```

To test an installed Google Chrome rather than Playwright Chromium on Windows:

```bat
set PLAYWRIGHT_USE_CHROME=1
npm run test:e2e
```

The end-to-end suite starts the production preview automatically. It covers click, mouse drag, real touch-pointer drag, illegal moves, special moves, 20 consecutive legal plies, undo/redo/navigation, PGN/FEN, Stockfish analysis and play, cancellation, review, archive persistence, offline refresh, fullscreen, Chess OCR position scanning, and every required viewport.

## Architecture

- `src/lib/gameState.ts` owns an immutable game document: starting FEN, legal move list, redo list, navigation cursor, and PGN headers. Every rendered position is replayed from that document through `chess.js`; the board never owns a second mutable position.
- `src/components/ChessBoard.tsx` is a presentation/input boundary for click, native drag, and touch-pointer input. Move callbacks include the position FEN that accepted them, preventing Strict Mode duplicates and stale callbacks.
- `src/engine/StockfishClient.ts` owns one dedicated classic Web Worker. It performs the UCI handshake, serializes `stop`/search transitions, validates best moves, and tags every request and snapshot with a generation and FEN so stale output cannot update another position.
- **`public/ocrWorker.js`**: Operates entirely locally inside a dedicated Web Worker to process uploaded chess images. It runs an automatic grid detection search, handles bilinear perspective warping, extracts piece foreground shapes via corner-background subtraction, and matches shape density/symmetry profiles to classify pieces offline.
- **`src/components/ScanPanel.tsx`**: Renders the complete position scanner interface, allowing drag-and-drop, file upload, or pasting of images. Offers custom draggable corner markers to fix perspective warping, a board editor grid with a piece palette, history (undo/redo) capability, FEN generators/validators, and IndexedDB integration for scan logs.
- **`src/lib/scanHistory.ts`**: Provides a Promise-based IndexedDB storage manager to persist scanned positions, thumbnails, corrected FENs, and comments locally without any cloud leakage.
- `src/App.tsx` coordinates separate game, board-presentation, engine, review, archive, scan, and settings state. Analysis and game-review modes explicitly hand off engine ownership.
- `src/lib/storage.ts` validates and migrates localStorage records. Settings and up to 100 saved games stay in the current Chrome profile.
- `src/components/ErrorBoundary.tsx` preserves a useful recovery screen if a future render error escapes component-level validation.
- `public/sw.js` uses a versioned cache, network-first navigation, hashed immutable assets, and cache cleanup. It dynamically pre-caches Vite assets, Stockfish WASM files, and the `ocrWorker.js` script.

## Supported chess behaviour

- Click-to-move, mouse drag-and-drop, and touch-pointer drag
- Legal targets, captures, promotion choice, castling, and en passant
- Check, checkmate, stalemate, threefold repetition, insufficient material, and fifty-move draw status
- Move history, undo, redo, first/previous/next/live navigation, keyboard navigation, flip, and fullscreen
- Validated FEN import and current-FEN copy
- PGN import with headers, comments, and variations; PGN export/download; custom starting-FEN preservation
- Local Stockfish MultiPV analysis, mate scores, legal variation previews, game play, retry, and cancellable full-game review
- **Local Chess OCR Position Scanner**: drag-and-drop/paste screenshots, auto grid alignment with manual corner adjustment handles, piece recognition with confidence levels, editable position details, and FEN generation.
- **Local Scan History**: browse, rename, load, and delete previous screenshot scans saved offline in IndexedDB.
- Local archive, dark/light themes, responsive desktop/tablet/mobile layout, and offline production refresh

## Offline and update behaviour

The first production visit installs the service worker. Navigations are network-first, so a freshly rebuilt local server wins over an older shell. Hashed JS/CSS and engine assets are cached after use, and old `chess-studio-local-*` cache versions are deleted on activation. Development mode unregisters any production service worker for the origin to prevent stale bundles from masking source changes.

## Current limitations

- Stockfish 18 Lite is intentionally single-threaded for compatibility and UI safety. It is weaker than a native multi-thread desktop Stockfish build.
- The Lite WASM includes the engine evaluation data it needs; there is no separate `.nnue` request or user-selectable network.
- Game-review labels use transparent centipawn-loss thresholds and are not proprietary Chess.com/Chessis classifications.
- Saved games use validated localStorage rather than IndexedDB, are limited to 100 entries, and do not sync between Chrome profiles (screenshot scans, however, use IndexedDB to support image storage).
- Piece rendering uses local system chess glyphs; no remote piece-image CDN is required.
- Chess clocks, Chess960, an opening database, cloud imports, and engine-vs-engine play are outside this release.

See `FEATURES.md`, `CHANGELOG.md`, and `THIRD_PARTY_NOTICES.md` for more detail.
