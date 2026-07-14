# Chess Studio Local 0.3.0 repair design

## Decision and constraints

The approved direction is a surgical rehabilitation of the supplied application. React, chess.js, the immutable game document, Stockfish controller, local launchers and PWA remain. The scanner is rebuilt where its current state model and worker contract are unsound, without replacing the chess application or adding a backend.

Three approaches were evaluated:

1. **Surgical repair (selected):** retain the exact upstream frozen TFJS model, strengthen pure geometry and worker/client contracts, split only the scanner’s major responsibilities, and preserve proven chess code. This has the smallest regression and licensing surface.
2. **Modern CV/ML migration:** add OpenCV or convert the model to a new TFJS/ONNX runtime. This would increase download size, change preprocessing, and require parity evidence that the current benchmark cannot yet supply.
3. **Manual-first scanner with nominal OCR:** remove unreliable automation and make cropping/editing excellent. This would be safer than fake OCR but does not satisfy the required real recognition path.

No commits or pushes will be made.

## Runtime and release architecture

- `package.json` and every release surface become version 0.3.0.
- `postinstall` copies the pinned Stockfish browser files and verifies the already-bundled TFJS runtime/model using a checked-in integrity manifest. It performs no GitHub fetch.
- ONNX Runtime, ONNX copying, Vite exclusions and stale documentation are removed.
- The exact vendored `tf.min.js` is kept because the frozen model requires the legacy `loadFrozenModel` API. Its hash and Apache-2.0 license are recorded. The obsolete npm TFJS dependency can be removed once the vendored file is verified, eliminating its Node-only audit tree without claiming the old browser runtime itself is modern.
- Production `dist` is generated, inspected and included in the final ZIP. Launchers serve it over loopback HTTP with correct headers and MIME types.

## OCR architecture

The scanner becomes an explicit staged state machine:

`empty → decoding → crop confirmation → warping → recognizing → correction → ready`

Every stage can also enter a recoverable error without deleting the last valid image, corners, warp, recognized baseline, edits or FEN draft.

Major boundaries:

- `imageInput`: validates MIME/signatures, file bytes, decode time and decoded pixels; respects browser EXIF orientation; creates a bounded bitmap and revokes URLs.
- `boardGeometry`: normalized corners, contained-image coordinate mapping, quadrilateral validation, inverse 3×3 homography and bilinear sampling.
- `boardDetection`: returns ranked candidates and evidence. Low evidence opens manual corners and never triggers OCR.
- `ocrWorkerClient`: owns worker generation, request IDs, transfer lists, timeouts, retry/restart, stale-result rejection and unmount cleanup.
- `scanState`: owns canonical a8–h1 grids, separate view orientation, recognized baseline, editor history, FEN options and draft.
- `scanHistory`: versioned IndexedDB records with opt-in original image, compressed crop, nullable scores and migration/error semantics.

The Stockfish and OCR workers remain separate.

## Exact model contract

The model and all seven files exactly match `Elucidation/ChessboardFenTensorflowJs` tag `v1.0.0`, commit `c75063981c4f781f63ac90c0c026402e23ebbef6`.

- Aligned board: 256×256 grayscale.
- Input pixels: float32 in the 0–255 range; no normalization.
- Tile layout: eight 256×32 files, each reshaped to 8×1024, concatenated file-major into `[64,1024]`.
- Inputs: `Input` and scalar `KeepProb = 1.0`.
- Outputs: `probabilities` (`[64,13]` softmax) and `prediction` (`[64]` argmax), validated at runtime.
- Class order: empty, white king, white queen, white rook, white bishop, white knight, white pawn, black king, black queen, black rook, black bishop, black knight, black pawn.

If the probability tensor fails shape, finiteness or row-sum validation, the worker may use a verified argmax tensor only with all numerical scores set to `null`. It will not fabricate one-hot scores, margins or 100% confidence.

## Geometry and orientation

Corners are stored normalized to the decoded working bitmap and mapped through the actual `object-fit: contain` rectangle. Pointer capture is mandatory. Pointer-up passes its calculated final point directly, avoiding delayed React state.

Perspective correction solves a destination-to-source homography and bilinearly samples RGBA. Crossed, concave, tiny or ill-conditioned quads are rejected before allocation.

The recognized grid is always canonical FEN order, a8 through h1. White/Black at bottom changes only the mapping between image/view cells and canonical cells. “Flip view” never mutates the grid. Table-driven tests cover rotations, rank reversal, file mirroring and double reversal.

## FEN and manual correction

Recognized grid, canonical generated FEN and editable draft FEN are separate values. Draft typing never mutates the board. The user gets Apply, Validate and Reset to recognized position.

Image-unknowable FEN fields default conservatively (`w - - 0 1`) and remain editable. Syntax, kings, adjacency and counts produce appropriate errors or warnings without rejecting unusual composed material merely for being unusual.

The correction reducer supports select/place/replace/remove/move, clear, restore recognized, undo/redo and flip view. Pointer, touch, click and keyboard are primary paths; native HTML drag is optional. Every square and icon action receives an accessible name.

The final action set is explicit: Analyze position, Play as White, Play as Black, Open in Board Editor, Save scan and Copy FEN.

## Offline and persistence

Service-worker caches are independent:

- core shell cache, installed atomically without OCR;
- Stockfish immutable cache;
- versioned OCR runtime/model cache, populated lazily with progress;
- IndexedDB user scans, not mixed with HTTP caches.

A missing OCR model cannot prevent core installation. Offline validation follows the exact cold sequence and records requests.

## Benchmark and evidence

The benchmark calls the production worker path and validates expected FEN automatically. Results are grouped and never blended:

- **Independent real:** the manually verified MIT-upstream screenshot and any non-blocking redistribution-safe additions.
- **Generated application:** deterministic raster captures using legally redistributable/open piece sets and several board themes.
- **Augmented:** trusted transformations for scale, rotation, perspective, compression, panels, coordinates and light/dark regression.

Each fixture records source/license, category, corners, orientation, 64 classes and expected board FEN. Each result records detection success/IoU, orientation, square/occupied/empty accuracy, exact match, wrong squares, expected/detected FEN, model load, transfer and inference timing, and memory where measurable. A mismatched FEN is a failed case; transformed siblings are not evidence of broad real-world accuracy.

## Visual direction (applied only after functional gates)

Subject: a private chess analysis workstation for a player studying games and digitizing positions. Its single job is to keep the board and current analytical task unmistakably primary.

- Palette: lacquer charcoal `#111416`, analysis steel `#1B2226`, notation ivory `#F1EDE2`, walnut `#7A4B32`, clock brass `#C3A15D`, arbiter red `#B85B52`.
- Type roles: Georgia/Charter-style local serif for restrained identity and section landmarks; Segoe UI/system sans for controls; Consolas/system monospace for FEN, UCI and measurements. No remote fonts.
- Layout: board-dominant two-bay workstation on desktop, disciplined stacked workflow on tablet/mobile, with independent notation/scanner scroll rather than decorative cards.
- Signature: a compact “position rail” that uses real chess coordinates and workflow state to connect source image, crop, recognized board and destination action.
- Aesthetic risk: warm walnut/brass material cues replace the generic neon-green dashboard accent, while radii and shadows are reduced to feel like a chess clock and analysis desk rather than SaaS cards.

Self-critique: the first palette could have repeated the common near-black/acid-green template already present. It was revised toward tournament chess materials, and the signature encodes the scanner’s real workflow rather than decorative numbering. Motion is reserved for stage transitions and respects reduced motion.

## Failure semantics

Errors say which stage failed, what data was preserved, and what action is available. Storage success is shown only after transaction completion. Worker failure never clears corrections. Unexpected render failures remain inside the existing error boundary. No supported claim is made without the checklist’s evidence cell.

