# Feature status

## Stable in 0.2.0

- Immutable legal game state synchronized with the rendered board
- Click, native mouse drag, and touch-pointer drag input
- Legal highlighting, captures, castling, en passant, and promotion picker
- Check, checkmate, stalemate, repetition, insufficient-material, and fifty-move detection
- Move list, undo, redo, cursor navigation, keyboard navigation, flip, and fullscreen
- FEN validation/import/copy and custom-position preservation
- PGN headers/comments/variations import and PGN export/download
- Dedicated Stockfish 18 Lite single-thread Web Worker
- UCI readiness, serialized cancellation, generation/FEN stale-result protection, legal best-move validation, restart UI, mate scores, and MultiPV
- Play against Stockfish as either colour with one engine response per turn
- Cancellable local move-by-move game review
- Validated local settings and saved-game archive
- Dark and light themes
- Responsive square board and non-overflowing panels from large desktop through 390×844 mobile, including zoom-equivalent narrow layouts
- Versioned production service worker, offline refresh, clean relative Vite build, and local Windows HTTP launcher
- React error boundary and visible engine loading/error/recovery states
- Vitest unit regression suite and Playwright production-browser suite

## Possible future work

- IndexedDB archive with search, tags, and larger collections
- Editable PGN annotations and side variations
- Material/captured-piece display and chess clocks
- Opening database and personal opening statistics
- Puzzle extraction and retry-mistakes training
- Chess960 and engine-vs-engine matches
- Optional online game import modules, kept separate from offline core functionality
