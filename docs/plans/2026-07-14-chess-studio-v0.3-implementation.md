# Chess Studio Local 0.3.0 implementation plan

This plan implements the approved design in the supplied tree. It uses red-green-refactor for features and bugs, focused verification after each task, and the full clean release gate at the end. No commits or pushes.

## Task 1: Reproducible release metadata and model integrity

**Files:** `package.json`, `package-lock.json`, `scripts/prepare-engine.mjs`, `scripts/verify-ocr-assets.mjs`, `public/models/chess-ocr/model-integrity.json`, installer tests, release docs.

1. Write failing tests for missing, corrupt and valid model/runtime files.
2. Add the integrity manifest from verified upstream hashes and exact contract.
3. Replace network fetch and ONNX/TFJS copying with Stockfish copy plus local verification.
4. Normalize 0.3.0 metadata and remove ONNX/npm TFJS dependency paths.
5. Run focused installer tests, clean `npm ci` and `npm audit`.

## Task 2: Pure board geometry and detection

**Files:** `src/lib/boardDetection.ts`, `src/lib/boardDetection.test.ts`, new geometry fixtures/utilities, worker mirror/build boundary.

1. Add failing identity, rotation, perspective, inverse-mapping and degenerate-quad tests.
2. Implement normalized corner validation, homography solve and bilinear sampler.
3. Add failing candidate-ranking and low-evidence tests.
4. Return candidates with score/signals and remove centered-crop success semantics.
5. Run focused geometry tests and benchmark detector fixtures.

## Task 3: Exact TFJS worker contract and lifecycle

**Files:** `public/scanWorker.js`, model self-test harness, worker protocol types/tests.

1. Write failing tests for preprocessing shape/range/tile order/class mapping.
2. Validate graph nodes and probability `[64,13]` output; verify finite values and row sums.
3. Replace fake confidence fallback with nullable scores and explicit argmax-only semantics.
4. Add load retry, reset, cancellation/invalidation and self-test messages.
5. Guarantee tensor disposal and transfer output buffers where useful.
6. Run worker self-test against the real model and known screenshot.

## Task 4: Safe image decode and crop workflow

**Files:** new scanner utilities/hooks, `ScanPanel.tsx`, targeted components and CSS.

1. Write failing MIME/signature, corrupt, oversize, timeout and downscale tests.
2. Implement object URL/ImageBitmap decode with orientation, pixel limits and cleanup.
3. Add failing contained-image coordinate mapping and stale pointer-up tests.
4. Implement pointer capture, normalized corners and stage-preserving error states.
5. Add worker `onerror`, `onmessageerror`, request timeout, restart and unmount cleanup.

## Task 5: Canonical scan state, orientation, FEN and editor

**Files:** new scan reducer/mapping/FEN tests, scanner editor/controls components, `App.tsx` integration.

1. Write table-driven failures for white/black bottom, rotations, mirrors and double reversal.
2. Implement canonical a8–h1 grid and independent view orientation.
3. Write failures proving draft FEN survives typing and recognized updates.
4. Implement recognized/generated/draft separation with Apply/Validate/Reset.
5. Align FEN errors/warnings and editable unknown fields.
6. Implement reducer-based manual editing, restore, undo/redo, pointer/touch/keyboard and labels.
7. Wire Analyze, Play White, Play Black and Board Editor with callback tests.

## Task 6: Versioned scan persistence

**Files:** `src/lib/scanHistory.ts`, migration tests, scanner history UI.

1. Write failing v1 migration, transaction failure, quota and duplicate tests.
2. Add v2 schema, opt-in original, compressed crop/blob, grids, options, orientation, nullable scores and model version.
3. Await transaction commits and propagate actionable errors.
4. Restore a scan completely and rerun OCR from saved source/crop.
5. Verify delete and clear behavior.

## Task 7: PWA cache separation and lazy scanner

**Files:** `public/sw.js`, `src/main.tsx`, `src/App.tsx`, OCR cache client/tests.

1. Add tests/static assertions that core install excludes optional OCR and cache versions are independent.
2. Implement core, Stockfish and OCR cache strategies with OCR progress/error messages.
3. Lazy-load `ScanPanel` and start model caching only when requested/opened.
4. Build and inspect initial/scanner chunk sizes.
5. Run production offline sequence in Chromium when available.

## Task 8: Core chess and PGN regression hardening

**Files:** `gameState.ts` and tests, Stockfish client tests, storage/UI tests, E2E.

1. Add failing modified-PGN preservation cases for headers, result, comments, NAGs, variations, SetUp and FEN.
2. Implement non-destructive supported round-tripping or explicit safe behavior where mainline editing cannot preserve semantics.
3. Add fake-worker tests for stop/timeout/stale bestmove/new FEN and duplicate reply.
4. Add storage failure tests and gate success notifications.
5. Run existing and expanded chess tests.

## Task 9: Real OCR fixtures and benchmark

**Files:** `tests/ocr-benchmark`, fixture generator, production benchmark harness, reports.

1. Manually establish trusted upstream screenshot ground truth from visible board/source documentation.
2. Generate deterministic open-licensed board screenshots and augmented variants with recorded hashes.
3. Validate manifest schema and category/license metadata.
4. Execute the production worker, calculate all required metrics, and fail exact mismatches.
5. Save JSON and Markdown reports grouped by independent/generated/augmented categories.
6. Set thresholds from observed data and state unsupported themes honestly.

## Task 10: Complete Playwright coverage

**Files:** `scripts/run-e2e.mjs`, `playwright.config.ts`, `tests/e2e`.

1. Make every execution mode run the complete discovered suite.
2. Add a shared strict console/page/request/worker error monitor.
3. Cover real OCR, file inputs, crop, orientation, manual correction, lifecycle, history and destination actions.
4. Cover core chess, Stockfish races, archive/settings, all viewports/zoom/fullscreen and offline.
5. Run against production preview and save artifacts.

## Task 11: Functional-first visual pass

**Files:** scanner components, `src/styles.css`, icon/manifest as needed.

1. Remove scanner inline layout rules and implement the approved board-dominant workstation tokens.
2. Keep controls consistent, focus visible, states direct, panels independently scrollable and motion restrained.
3. Capture/inspect required viewport, zoom, theme, long-content and image-aspect screenshots.
4. Critique and remove decoration that does not encode chess/scanner state.

## Task 12: Documentation, licenses, performance and release

**Files:** README, features/changelog/reports/notices/licenses, launchers, `dist`, ZIP.

1. Update truthful architecture, model contract, limitations, install/offline/manual correction and browser requirements.
2. Add TFJS/model/React/runtime license notices and remove ONNX references.
3. Record bundle/model sizes, TTI proxy, load/transfer/inference timing, large-image memory estimate and concurrent Stockfish behavior.
4. Run the complete clean gate: install, unit, build, smoke, full E2E, audit and preview/manual session.
5. Update every checklist result from saved evidence.
6. Package a clean 0.3.0 ZIP with source, lockfile, verified `dist`, launchers, reports and licenses; exclude `node_modules`, project-agent skills, caches and transient test output.
7. Extract the ZIP and repeat the release smoke checks.

