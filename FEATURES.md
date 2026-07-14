# Feature status

## Verified in 0.3.0

- Immutable legal chess state with click, mouse drag, and touch-pointer input
- Legal targets, illegal rejection, castling, en passant, promotion, check,
  checkmate, stalemate, repetition, insufficient material, and fifty-move draw
- Undo, redo, navigation, new/custom positions, flip, and fullscreen
- PGN/FEN import/export with supported source annotations preserved
- Dedicated local Stockfish 18 Lite worker with MultiPV, mate scores,
  cancellation, restart, stale-output protection, play as either colour, and
  full-game review
- Validated settings and local game archive with truthful storage errors
- Local screenshot scanner with validated decode, bounded resize, automatic
  board detection, four-corner crop, true homography, separate OCR worker,
  orientation confirmation, position warnings, editable FEN, and reliable
  manual correction
- Versioned scan history with restore and real OCR rerun
- Separate application/engine/OCR service-worker caches and explicit offline
  OCR-model download
- Lazy-loaded scanner, responsive square boards, light/dark themes, visible
  focus states, mobile stacking, and independent desktop panel scrolling
- Unit, integrity, benchmark, Stockfish smoke, production Chromium, OCR, and
  true offline browser tests

## Deliberate limits

- OCR is a correction-assisted local tool, not universal or physical-board OCR
- No automated castling/en-passant/move-counter inference from an image
- No cloud sync, online imports, opening database, chess clocks, Chess960, or
  engine-vs-engine mode
- No full visual variation-tree editor for PGN annotations
