# Chess Studio Local 0.3.0

Chess Studio Local is a private, browser-only chess analysis and training
workstation for locally served Google Chrome. Legal play, Stockfish analysis,
game data, screenshot pixels, OCR inference, and FEN correction stay on the
device. Core functionality has no external API dependency.

## Run the included production build

Do not open `dist/index.html` with `file://`; workers and the service worker
need a local HTTP origin.

### Windows

1. Extract the complete ZIP without flattening its folders.
2. Install Node.js 22 LTS (preferred) or Python 3.
3. Double-click `start-local.bat`.
4. Keep the server window open while using the reported localhost URL.
5. Press `Ctrl+C` in that window to stop it.

The launcher uses the included `dist` directory and does not run `npm install`.
With Node it uses the hardened local server and opens Chrome when found. Python
is a basic static-server fallback.

### macOS/Linux

```bash
./start-local.sh
```

## Development

Node 20.19+ or 22.12+ is required by the pinned Vite toolchain.

```bash
npm ci --no-audit --no-fund
npm run dev
```

The install is deterministic: Stockfish, TensorFlow.js, and OCR model files are
already pinned in the package/repository and are verified locally during
`postinstall`. No OCR download script runs during installation.

Build and validate with:

```bash
npm test
npm run build
npm run smoke:engine
npm run test:e2e
npm audit
npm run preview
```

## Chess workstation

- Legal click-to-move, mouse drag, and touch-pointer play with legal targets,
  check indication, castling, promotion, en passant, and illegal-move rejection
- Undo/redo, cursor navigation, new games, board flip, and fullscreen
- Local Stockfish 18 Lite worker with MultiPV, mate scores, timeout/restart,
  cancellation, FEN/request identity, and stale-result rejection
- Play Stockfish as either colour and cancellable full-game review
- PGN/FEN import and export, including supported headers, result, comments,
  NAGs, variations, `SetUp`, and `FEN` source annotations
- Validated local settings, saved-game archive, error recovery, light/dark
  themes, responsive desktop/mobile layout, and an offline PWA

## Screenshot scanner

The scanner accepts PNG, JPEG, WebP, paste, and drag/drop. Its local pipeline is:

1. validate and safely decode the image;
2. resize within decoded-pixel and memory limits;
3. detect an honest board candidate without a random crop fallback;
4. let the user adjust all four corners;
5. apply a true projective homography to a 256×256 board;
6. run exact upstream TensorFlow.js preprocessing and 64 tile predictions in a
   dedicated OCR worker;
7. confirm image orientation;
8. validate the position and create an editable FEN;
9. correct pieces manually and open the result in analysis, play, board editor,
   or the archive.

The OCR worker has request IDs, stale-result invalidation, timeout, restart,
retry, and unmount guards. Image buffers are transferred rather than repeatedly
cloned. If decoding, detection, model loading, or inference fails, the source
image, corners, warped board, edits, and FEN draft remain usable. Automatic OCR
is optional; manual crop, piece editing, and FEN correction are first-class
fallbacks.

Numeric output is shown as a **model score**, not guaranteed confidence. If the
model exposes only class IDs, scores are unavailable rather than invented.

### OCR model

The bundled classifier is from MIT-licensed
`Elucidation/ChessboardFenTensorflowJs` v1.0.0 at revision
`c75063981c4f781f63ac90c0c026402e23ebbef6`, running through vendored
TensorFlow.js 0.15.3 (Apache-2.0). `public/models/chess-ocr/model-integrity.json`
pins every size and SHA-256 hash. `public/models/README.md` documents the exact
`[64,1024]` input, `[64,13]` output, class order, preprocessing, and worker
backend.

## OCR benchmark: limited by design

`npm run benchmark:ocr` calls production recognition code and exits nonzero for
an incorrect detected FEN. `-- --allow-failures` records the full diagnostic
report. The latest nine-case run is separated by evidence category:

| Category | Cases | Board detection | Mean square accuracy | Exact FEN |
| --- | ---: | ---: | ---: | ---: |
| Real independent screenshots | 0 | n/a | n/a | n/a |
| Upstream model reference | 1 | 100% | 100% | 1/1 |
| Generated application screenshots | 4 | 100% | 87.11% | 1/4 |
| Augmented/transformed regressions | 4 | 100% | 100% | 4/4 |

The transformed cases are siblings of one source and are regression fixtures,
not evidence of broad real-world accuracy. The upstream reference is a real
screenshot but is not independent of the model project. There are currently no
real-independent cases. The weak generated-piece results are retained honestly.
This small dataset does **not** establish universal OCR, physical-board OCR, or
production-level accuracy.

Ground truth, licences, expected corners/orientation/classes/FENs, per-category
metrics, wrong squares, and timings are in `tests/ocr-benchmark/`.

## Offline design

The service worker uses independent versioned caches for the application shell,
Stockfish, and optional OCR assets. Core installation never depends on caching
the roughly 18 MB OCR runtime/model. Open the scanner and choose **Download
offline OCR model** before going offline. Progress and failures are visible.

The browser test proves a reload after normal HTTP-cache clearing and network
disable can still navigate, run exact reference OCR, and start Stockfish from
service-worker storage. It also records requests and rejects image/FEN uploads.

## Data and security

- No screenshot, pixels, crop, model input, prediction, or FEN is sent out.
- Games/settings use validated profile-local browser storage; scans use
  IndexedDB and are limited by browser quota.
- Imported files are treated as untrusted data and validated before use.
- No Chess.com, Chessis, or other proprietary application assets/code are
  included.

## Known limitations

- The current OCR model is specialized for digital screenshot styles and is
  inaccurate on several generated piece sets. Manual correction is expected.
- Orientation is explicitly confirmed by the user; the model does not infer
  castling rights, en-passant, halfmove clock, or move number from pixels.
- Source PGN annotations are preserved for supported mainline editing, but the
  UI is not a full variation-tree editor.
- Stockfish Lite is intentionally single-threaded and weaker than native
  desktop Stockfish.
- Storage is browser-profile local and does not sync.
- Native Windows batch execution cannot be automated in the Linux verification
  environment; the shared Node server and launcher control flow are tested,
  with a final Windows click-through still recommended.

See `ENGINEERING_REPORT.md`, `docs/REQUIREMENTS_CHECKLIST.md`, `FEATURES.md`,
`CHANGELOG.md`, and `THIRD_PARTY_NOTICES.md` for evidence and attribution.
