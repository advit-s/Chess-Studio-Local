# Changelog

## 0.2.0 — 2026-07-13

- Replaced mutable/reconstructed board state with an immutable game reducer and stale-position move guard.
- Fixed the post-move black screen caused by converting an old Stockfish PV against a new FEN during React render.
- Added a top-level error boundary and explicit recovery UI.
- Rebuilt click, native drag, touch-pointer drag, promotion, legal-target, last-move, and check presentation.
- Added redo and robust historical-position navigation without changing the live game.
- Rebuilt Stockfish integration around UCI readiness, serialized search transitions, request generations, FEN-tagged results, legal best-move validation, timeouts, cancellation, and restart.
- Fixed an engine-ownership race between live analysis and game review.
- Replaced hard-coded/clamped board dimensions with a square aspect-ratio container and responsive grid/stack layouts.
- Restored mobile access to PGN/FEN and prevented archive-card overflow at narrow zoom-equivalent widths.
- Added safe PGN/FEN errors, custom FEN export headers, PGN download, and validated storage migration.
- Removed stale generated Vite configs that made production use the wrong base and retain obsolete bundles.
- Made production asset paths relative and ensured every build empties `dist`.
- Added a versioned network-first service worker; development removes old registrations/caches.
- Replaced file launching with local HTTP launchers and a Node static server with correct WASM MIME type, cache headers, path checks, and Chrome discovery.
- Added 12 unit tests and 10 browser scenarios covering the complete interaction, engine, persistence, offline, fullscreen, and responsive paths.

## 0.1.1

- Added the original prebuilt launcher.

## 0.1.0

- Initial local chess studio release.
