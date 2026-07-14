# Chess Studio Local 0.3.0 engineering and verification report

Date: 2026-07-14  
Target: local Google Chrome/Chromium, browser-only application  
Input archive SHA-256: `dbaddea8bd938a65652e7d54f5ba6bab8a75777a1ca03b4838c358f3ea831c3d`  
Canonical prompt SHA-256: `a30e22ff93e2900be009a1f65e8516f8b692bc2bcd71ce5d4f30a3b1bd27f598`

## Outcome

The existing application was repaired in place; it was not replaced with a
simplified chess app. Core chess, Stockfish, PGN/FEN, archive, responsive UI,
scanner correction, local OCR, and offline behavior were verified in production
Chromium. The release includes source, tests, documentation, launchers, pinned
model/runtime assets, and a clean 23-file `dist`.

Automatic OCR is functional but not broadly accurate. The one upstream model
reference and all four transformations are exact; three of four generated
application positions are not. Those failures remain visible and make the strict
benchmark exit nonzero. Manual crop, piece editing, and FEN correction work even
when the model cannot load. This report does not claim universal, physical-board,
or production-level OCR accuracy.

## Root causes found and repaired

1. Installation used a postinstall network download despite model files already
   being present. The release now verifies pinned local sizes and SHA-256 hashes.
2. TensorFlow.js and ONNX paths coexisted although only the frozen TensorFlow.js
   model existed. ONNX dependencies, assets, copying, configuration, docs, and a
   duplicate fake benchmark were removed.
3. The model's upstream class order, file-major tile order, 0–255 first-channel
   input, graph node names, and no-normalization contract were not enforced.
4. The worker treated class IDs as fabricated 100% confidence and guessed output
   semantics. Output shape, finiteness, probability rows, scores, and nullable
   class-only results are now explicit.
5. The legacy TFJS WebGL backend assumed DOM APIs and crashed inside a dedicated
   worker. The model-compatible worker now selects CPU and has a worker-safe
   OffscreenCanvas shim.
6. The function named `warpPerspective` was not a true projective transform.
   Production now solves/inverts a homography and performs bounded bilinear
   sampling with degenerate-input checks.
7. Board detection trusted weak axis-aligned signals and silently used a centered
   crop. It now scores evidence, refines rotation/perspective candidates, returns
   manual-needed honestly, and reports labelled IoU.
8. `object-fit: contain` letterboxing and asynchronous React state made crop
   coordinates/pointer-up stale. Mapping now uses the rendered image rectangle
   and a synchronous corner ref.
9. OCR lifecycle lacked complete invalidation, timeout, retry, restart, and
   unmount protection. A dedicated client/state protocol now owns request IDs,
   generations, transferable buffers, timeout, and disposal.
10. Error paths cleared the user's image or edits. Decode/detect/model/inference
    errors are non-destructive, and automatic OCR is optional.
11. Image orientation, editor view orientation, and grid reversal were conflated.
    The grid is canonical a8–h1; image reinterpretation happens once and view
    flipping never mutates the FEN.
12. FEN effects overwrote drafts and image-only data invented castling/move state.
    Draft/apply/reset is explicit and non-board fields default conservatively.
13. Scanner history stored misleading scores and could report success before a
    transaction committed. The v2 record is versioned, quota-aware, nullable-score,
    and optionally stores the source image.
14. The OCR benchmark skipped real inference and never failed wrong FENs. It now
    invokes production worker code, validates ground truth, records all required
    metrics, and fails strict mode on any incorrect position.
15. The service worker precached optional large model files in the shell install.
    Core, Stockfish, and OCR assets now use independent cache versions, with an
    explicit progress-reporting offline OCR action.
16. Inline scanner grids overrode responsive rules and squeezed the scanner into
    one outer-column fraction. CSS now gives the scanner full workstation width,
    deliberate desktop rails, mobile stacking, square previews, and bounded scroll.
17. The custom single-process Playwright runner hard-coded ten non-OCR tests. It
    now discovers every test from Playwright and refuses an empty suite.
18. Modified PGN exports could silently discard source comments, NAGs, variations,
    result, `SetUp`, or `FEN`. Supported source annotations are preserved through
    mainline edits and checked token-for-token.
19. Archive/settings/scan write failures could produce false success messages.
    Storage writes now return committed outcomes that gate UI notices.
20. Version/docs/model notices described v0.2.0 and nonexistent ONNX training.
    Package, manifest, visible About UI, cache names, docs, licence copies, and
    final filename are normalized to v0.3.0.
21. A real OCR response could arrive after a manual grid edit and replace the
    user's correction. Every manual mutation now invalidates and cancels pending
    automatic work; changed squares also discard scores for the old class.
22. Vite entry responses use `Vary: Origin`, but string-based service-worker
    precaching stored no-CORS request metadata. A cold HTTP-cache clear could
    therefore leave cached JS/CSS unusable. Build, engine, and OCR assets are now
    cached with explicit CORS/same-origin requests, normalized lookups, and a
    bumped core-cache version.

The earlier 0.2.0 repairs for immutable game state, the stale Stockfish PV black
screen, engine request identity, touch movement, responsive board sizing, error
boundary, local launch server, and relative production paths were retained and
retested rather than rewritten.

## Architecture after repair

### Chess and Stockfish

`GameDocument` remains the canonical immutable start-FEN/move/cursor/redo/header
record. Every move includes an expected-position token. `StockfishClient` owns a
separate local Web Worker with UCI readiness, serialized stop/drain, generation
and position identity, timeouts, legal-bestmove validation, restart, MultiPV, mate
scores, play-mode ownership, and cancellable game review.

### Scanner and OCR

The production path is:

```text
validated PNG/JPEG/WebP -> EXIF-aware bounded decode -> evidence-based detection
-> labelled/manual four-corner crop -> true homography -> 256x256 board
-> exact upstream 64-tile preprocessing -> dedicated TFJS CPU worker
-> 64 predictions/scores -> explicit orientation -> validation
-> editable FEN/manual grid -> analysis/play/editor/archive
```

`OcrWorkerClient` and `ocrWorkerState` isolate lifecycle concerns from React.
Typed source modules generate the classic worker scripts consumed by production
and the Node benchmark, preventing a second benchmark implementation.

### Persistence and offline

Validated localStorage holds settings and saved games. IndexedDB scan records use
a versioned schema and store only the necessary corrected state unless the user
opts into retaining the source image. The service worker has independent shell,
engine, and OCR caches; optional OCR caching cannot reject core installation.
Same-origin immutable assets are stored with the CORS request metadata expected
at runtime, including safe `Vary: Origin` fallback matching.

### Presentation and packaging

The scanner is code-split with `React.lazy`. CSS owns critical layout rather than
inline rules. Vite uses a relative base and empties `dist`. The Node launcher
serves correct MIME types, isolation and cache headers, rejects missing assets,
supports SPA fallback, and opens local Chrome on Windows when available.

## OCR model provenance and integrity

- Source: `Elucidation/ChessboardFenTensorflowJs`
- Model version: v1.0.0
- Revision: `c75063981c4f781f63ac90c0c026402e23ebbef6`
- Model/project licence: MIT
- Runtime: TensorFlow.js 0.15.3, Apache-2.0
- Runtime backend in the dedicated worker: CPU

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `tf.min.js` | 967,489 | `8e51ada3786380cbe9937a53a8ad2f753f3014772033f28fa7dd859b8f0a81e4` |
| `tensorflowjs_model.pb` | 2,417 | `ecfc6a1123d69f37bd8eba4394809dabbb15950973f91b439cbe48caa7f9a05f` |
| `weights_manifest.json` | 812 | `07fba17d74075d73592b1ea1903d62d1ab44ecb083d413a497df2b08ba14fc3c` |
| `group1-shard1of5` | 4,194,304 | `a9f1e00dae34443963de282e85d7ea24663bcf4387c7d7ad61fd594578ef03c4` |
| `group1-shard2of5` | 4,194,304 | `996bdb13f58d581564965b1d303cb5a47d4394bb55b7d0ec68be1911c32e6e67` |
| `group1-shard3of5` | 4,194,304 | `a754e2dafae30ec46648e17044fbc10c472cbd65b08285578d307414feeb57de` |
| `group1-shard4of5` | 4,194,304 | `dc705766881db0deb75f9cb0f169150609342dfb4a345c9dbea625768d5d7c92` |
| `group1-shard5of5` | 265,808 | `3b911775bb51572f33bb0bbde668f7179841883b3ca643a6a78f8e1680f91598` |

`model-integrity.json` itself has SHA-256
`3fa2ecd5e70f055584278670b070b98358e1b69da60a220945316594ef8ae71a`.

## Exact preprocessing and class mapping

The aligned RGBA board is 256×256. Production reads only the first pixel channel
as float32 values in `[0,255]`, applies no normalization, slices eight 256×32
file strips, reshapes each into eight 1,024-value rows, and concatenates
file-major in order `a8..a1, b8..b1, ... h8..h1` to `[64,1024]`.

Graph inputs are `Input` and scalar `KeepProb=1`. Outputs are
`probabilities[64,13]` and `prediction[64]`. Class indices are:

| Index | Class | Index | Class |
| ---: | --- | ---: | --- |
| 0 | empty | 7 | black king |
| 1 | white king | 8 | black queen |
| 2 | white queen | 9 | black rook |
| 3 | white rook | 10 | black bishop |
| 4 | white bishop | 11 | black knight |
| 5 | white knight | 12 | black pawn |
| 6 | white pawn |  |  |

Probability rows must be `[64,13]`, finite, bounded, and sum as probabilities.
The implementation does not softmax an already probabilistic node. If only the
argmax output is usable, scores/margins are null. UI text says “model score,” not
confidence.

## OCR benchmark result

Run generated: 2026-07-13T23:31:35Z. The strict command exited 1 because three
automatic results did not match ground truth. `--allow-failures` is the diagnostic
reporting mode; it does not turn incorrect cases into passes.

| Category | Cases | Detection | Mean IoU | Mean square | Mean occupied | Mean empty | Exact |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Real independent | 0 | n/a | n/a | n/a | n/a | n/a | n/a |
| Upstream reference | 1 | 100% | 99.72% | 100% | 100% | 100% | 1/1 |
| Generated application | 4 | 100% | 99.56% | 87.11% | 40.63% | 100% | 1/4 |
| Augmented/transformed | 4 | 100% | 99.11% | 100% | 100% | 100% | 4/4 |

### Expected versus detected board FEN

| Fixture | Category | Square | Wrong | Expected | Detected |
| --- | --- | ---: | ---: | --- | --- |
| upstream reference | upstream | 100% | 0 | `rn1qkb1r/p4ppb/1pp1pn1p/4N3/2BP2P1/1QN1P2P/PP3P2/R1B2RK1` | exact match |
| generated start | generated | 82.81% | 11 | `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR` | `rPpPkppr/pppppppp/8/8/8/8/PPPPPPPP/RPPPPPPR` |
| generated empty | generated | 100% | 0 | `8/8/8/8/8/8/8/8` | exact match |
| generated middlegame | generated | 78.13% | 14 | `r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P4/2PBPN2/PP1N1PPP/R1BQR1K1` | `r1pP1PP1/pp2Kppp/2P1pN2/2pp4/3P4/2PPPP2/PP1P1PPB/R1PPR1P1` |
| generated black endgame | generated | 87.50% | 8 | `8/5pk1/6p1/3p4/3P1P2/6P1/5K2/8` | `8/5PN1/6P1/3P4/3N1N2/6N1/5P2/8` |
| 55% scale | transformed | 100% | 0 | upstream reference | exact match |
| compression + panels | transformed | 100% | 0 | upstream reference | exact match |
| 1.5° rotation | transformed | 100% | 0 | upstream reference | exact match |
| perspective | transformed | 100% | 0 | upstream reference | exact match |

Every wrong-square coordinate and expected/detected class is retained in
`tests/ocr-benchmark/results/latest.json`.

### Dataset limitation

There are no independent real screenshots in this release. The one real
screenshot is bundled by the model project, so it is reported separately and is
not independent accuracy evidence. The four transformed images are siblings of
that screenshot and are regression tests only. The four generated captures are
deterministic and redistribution-safe, but not real-world photographs. This
small dataset cannot establish broad OCR accuracy.

## Verification results

Final dependency and build commands below were rerun after `npm ci` recreated
`node_modules` from the lockfile. The explicit `/tmp` npm cache was required
because the verifier's default root cache is unwritable; this is an environment
workaround, not a project requirement. Browser files were run completely against
the production build in isolated Chromium processes.

| Check | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | Passed; 104 packages; postinstall copied Stockfish and verified 8 OCR assets / 18,013,742 bytes |
| `npm test` | Passed; 13 Vitest files, 85 tests; plus 4 integrity, 4 benchmark, 4 service-worker, 1 code-split, 1 E2E-runner Node tests |
| `npm run build` | Passed; 50 modules transformed; 23 production files |
| `npm run smoke:engine` | Passed; Stockfish 18 Lite returned legal best move `e2e4` |
| `npm audit --audit-level=low` | Passed; 0 vulnerabilities |
| `npm run preview` | Passed; HTML and 7,295,411-byte WASM returned 200 with isolation headers |
| Core Playwright file | 10/10 passed in clean production build |
| OCR Playwright file | 16/16 passed in production Chromium, including real-worker manual-edit cancellation |
| Cold-offline Playwright file | 1/1 passed in 19.7 s after HTTP-cache clearing and network disable |
| Total browser assertions | 27/27 passed across the three complete spec files |

The hosted work environment imposes a long-parent-process duration cap, so the
three complete files were run separately with the same production config and all
27 passed. The dynamic runner test proves discovery is not hard-coded and refuses
an empty suite. On normal Chrome/Playwright, the unfiltered command uses one
standard suite invocation.

### Browser coverage

- Click, native drag, trusted mobile touch, illegal rejection, legal targets,
  20 plies, undo/redo, flip, checkmate, castling, en passant, promotion
- FEN/PGN import/export/navigation and supported annotation preservation
- Stockfish readiness, legal lines, MultiPV/depth changes, stale-output guard,
  one reply, review cancel/restart
- Actual model OCR with automatic expected-FEN comparison
- PNG/JPEG/WebP, paste, drop, invalid input, history rerun, failure preservation
- Manual place/replace/move/erase/undo/redo/restore and mobile touch crop/correction
- Analysis/play-white/play-black/editor/archive integration
- Scanner/core layout at 1920×1080, 1600×900, 1366×768, 1280×720,
  1024×768, 768×1024, 390×844 and browser scale 80/100/125/150%
- True service-worker-only reload after HTTP-cache clearing and network disable,
  followed by exact OCR, Stockfish, and navigation
- Cross-origin/non-read request monitoring proving no image/FEN upload

## Production and performance measurements

| Measurement | Result |
| --- | ---: |
| Main JS | 272.71 kB; 86.94 kB gzip |
| Lazy scanner JS | 51.86 kB; 16.37 kB gzip |
| CSS | 23.01 kB; 5.87 kB gzip |
| Complete `dist` | 23 files; about 25 MB including engine/model/runtime |
| OCR runtime + model assets | 18,013,742 bytes |
| Node CPU model load | 3,249.1 ms |
| Node CPU inference range | 3,179.0–4,178.2 ms per 64-square case |
| Upstream total benchmark case | 6,710.6 ms including first model load |
| Benchmark peak process RSS | 239.8–280.5 MB; process + worker, not browser heap |
| Browser upstream OCR E2E | about 8.2–8.6 s including UI, detection, load and inference |
| Cold-offline scenario | 19.7 s including cache checks, reload, OCR, and engine |
| Input limits | 10 MB file; 32 MP decode; 4 MP/2048 px working image |

The old TFJS CPU path is deliberately slower than a modern converted runtime,
but conversion/retraining was not adopted without benchmark parity evidence.
Stockfish and OCR remain separate workers; their functional concurrency is
verified, not presented as a multi-hour performance soak.

## Local/offline verification

The cold-offline test built and served production, activated the service worker,
opened the scanner, explicitly cached the OCR runtime/model, warmed Stockfish,
inspected separate cache names/counts, cleared ordinary Chromium HTTP cache via
CDP without deleting Cache Storage, disabled network, reloaded, ran exact OCR,
started Stockfish, and navigated the app. It recorded zero cross-origin uploads,
zero non-GET/HEAD uploads, and no unexpected offline request failures.

The prebuilt Node server separately returned correct HTML/WASM/model content,
COOP/COEP/nosniff headers, SPA fallback, a real 404 for a missing JS asset, and
405 for POST.

## Exact files changed

### Updated

- Release/docs: `README.md`, `FEATURES.md`, `CHANGELOG.md`,
  `ENGINEERING_REPORT.md`, `THIRD_PARTY_NOTICES.md`, `package.json`,
  `package-lock.json`, `public/manifest.webmanifest`, `public/models/README.md`
- Production OCR/PWA: `public/scanWorker.js`, `public/sw.js`, `vite.config.ts`
- Application/UI: `src/App.tsx`, `src/components/ScanPanel.tsx`, `src/styles.css`
- Domain/storage: `src/lib/boardDetection.ts`, `src/lib/fenValidation.ts`,
  `src/lib/gameState.ts`, `src/lib/scanHistory.ts`, `src/lib/storage.ts`
- Existing tests: corresponding `*.test.ts`, `tests/e2e/chess-ocr.spec.ts`,
  `tests/e2e/chess-studio.spec.ts`, benchmark manifest/README

### Added

- Model/runtime contract: `public/models/chess-ocr/model-integrity.json`,
  `public/ocr-core.js`, `public/ocr-model-contract.js`,
  `public/ocr-worker-state.js`
- OCR source/lifecycle: `src/lib/OcrWorkerClient.ts`, `ocrModelContract.ts`,
  `ocrWorkerState.ts`, `scanImage.ts`, `scanOrientation.ts`,
  `offlineOcrCache.ts` and their tests; scan-history/storage tests
- Build/verification: `scripts/benchmark-ocr.mjs`, `build-ocr-core.mjs`,
  `generate-ocr-fixtures.mjs`, `ocr-node-worker.mjs`, `verify-ocr-assets.mjs`,
  `service-worker.test.mjs`, `code-splitting.test.mjs`, `run-e2e.test.mjs`,
  `scripts/lib/ocr-benchmark.mjs`, `scripts/lib/verify-assets.mjs`
- Browser/offline: `tests/e2e/offline-ocr.spec.ts`
- Benchmark: four generated PNGs, four transformed PNGs, JPEG/WebP decoder
  copies, expanded manifest, `results/latest.json`
- Evidence/checklist/plans: `docs/REQUIREMENTS_CHECKLIST.md`,
  `docs/evidence/screenshots/**`, `docs/plans/**`
- Licences: TFJS Apache-2.0, model MIT, React MIT, DejaVu/Bitstream Vera copies

### Removed

- `onnxruntime-web` and transitive package-lock entries
- `public/onnx/**`
- stale `tests/ocr-benchmark/benchmark.ts`
- stale `scripts/playwright-debug.ts`

Generated `dist/**` was rebuilt cleanly and contains only the current hashed
bundles plus local PWA, engine, OCR runtime, model, and metadata assets.

## Known limitations

1. There are no independent real OCR screenshots, and generated piece sets expose
   poor model generalization. Manual correction is a normal part of this release.
2. Automatic orientation is not claimed; the fixture label/user confirmation is
   authoritative. Pixels cannot reveal castling rights, en-passant, or counters.
3. The model-compatible TensorFlow.js CPU backend is slow and uncalibrated.
4. The UI preserves supported PGN annotation source but is not a full variation
   tree editor.
5. Stockfish Lite is single-threaded and weaker than native desktop Stockfish.
6. Saved data is local to a browser profile and subject to browser quota/eviction.
7. Browser tests are regression/interaction coverage, not a long memory soak.
8. Linux Chromium 149 was the real browser available. Native Windows batch-file
   control flow cannot be executed here; the shared Node server and extraction
   path are verified, and a Windows click-through remains prudent.
9. A dedicated EXIF-orientation fixture, formal automated WCAG audit, and precise
   browser peak-heap measurement were not available.

## Final release archive

The archive candidate contained 147 files (about 52 MB extracted), passed
`unzip -t`, contained no `node_modules`, test results, agent skills, or cache
files, and preserved identical public/dist hashes for TFJS and Stockfish WASM.
From a fresh extraction, `scripts/serve-dist.mjs` returned 200 for HTML, WASM,
and a 4,194,304-byte model shard with the expected MIME/cache/isolation headers.

The final ZIP is built from the same frozen tree after this wording update. Its
immutable byte size and SHA-256 are supplied in the external handoff because an
archive cannot contain its own hash without changing that hash.
