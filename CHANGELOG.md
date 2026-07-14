# Changelog

## 0.3.0 — 2026-07-14

- Rebuilt screenshot scanning around validated image decode, bounded resizing,
  evidence-based board detection, manual four-corner correction, and true
  projective homography.
- Integrated the exact pinned MIT TensorFlow.js chess classifier locally in a
  dedicated recoverable OCR worker; removed ONNX and fabricated confidence.
- Added request IDs, invalidation, timeout/restart/retry, transferable buffers,
  output-shape/value validation, nullable scores, and stale/unmount guards.
- Made OCR failure non-destructive and completed manual piece/FEN correction,
  orientation confirmation, history rerun, analysis/play/editor/archive routing,
  and truthful storage outcomes.
- Replaced the empty/mock OCR benchmark with nine labeled production-path
  cases, separate evidence categories, expected-versus-detected FENs, detection
  IoU, square metrics, wrong-square reports, and strict failure behavior.
- Added real Chromium OCR tests for PNG/JPEG/WebP/paste/drop, manual workflows,
  integration colors, failure recovery, responsive layouts, and a true offline
  reload with both OCR and Stockfish.
- Split service-worker caches into core, engine, and optional OCR versions;
  added explicit offline OCR-model caching with progress and error reporting.
- Lazy-loaded the scanner and repaired its desktop/mobile workstation layout,
  square editor, overflow, zoom, focus, and offline-font presentation.
- Preserved supported PGN comments, NAGs, variations, result, `SetUp`, and `FEN`
  annotations across mainline edits without silently rewriting source text.
- Made archive/settings/scan save failures visible instead of reporting false
  success.
- Normalized release metadata and documentation to 0.3.0, added exact model
  provenance/hashes/licences, retained a verified `dist`, and removed stale
  duplicate benchmark/debug files.

## 0.2.0 — 2026-07-13

- Replaced mutable board state with an immutable reducer and stale-position move
  guard.
- Fixed the post-move black screen caused by rendering an old Stockfish PV
  against a newer FEN.
- Rebuilt mouse/touch input, promotion, legal-target, move history, board sizing,
  error recovery, Stockfish lifecycle, PWA paths, storage validation, and local
  launchers.
- Added the first complete unit and production-browser regression suites.

## 0.1.1

- Added the original prebuilt launcher.

## 0.1.0

- Initial local chess studio release.
