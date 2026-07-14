# Local chess OCR model

Chess Studio Local ships one browser-oriented TensorFlow.js model in
`chess-ocr/`. It does not use ONNX, a Python service, or an external inference
API.

## Provenance

- Model project: `Elucidation/ChessboardFenTensorflowJs` v1.0.0
- Pinned revision: `c75063981c4f781f63ac90c0c026402e23ebbef6`
- Model/project licence: MIT
- Runtime: vendored TensorFlow.js 0.15.3, Apache-2.0
- Integrity manifest: `chess-ocr/model-integrity.json`

The seven runtime/model files are verified byte-for-byte by `npm ci`,
`npm run verify:ocr-assets`, and `npm test`. Installation never downloads or
replaces them.

## Exact model contract

The scanner first creates a projectively aligned 256×256 board. The model
preprocessing matches the pinned upstream code:

1. Read the first RGBA pixel channel into `float32` values in the range 0–255.
2. Do not normalize the values.
3. Split the board into eight 256×32 file strips.
4. Reshape every strip to eight 1,024-value tiles.
5. Concatenate to `[64, 1024]` in file-major order:
   `a8..a1, b8..b1, ... h8..h1`.
6. Run graph inputs `Input` and scalar `KeepProb = 1`.

The `probabilities` node must be finite `[64, 13]` rows whose sums are valid
probabilities. The `prediction` node is `[64]` argmax class indices. The class
order is:

| Index | Class |
| ---: | --- |
| 0 | empty |
| 1 | white king |
| 2 | white queen |
| 3 | white rook |
| 4 | white bishop |
| 5 | white knight |
| 6 | white pawn |
| 7 | black king |
| 8 | black queen |
| 9 | black rook |
| 10 | black bishop |
| 11 | black knight |
| 12 | black pawn |

The UI calls numeric output a **model score**, not calibrated confidence. If
only class indices are available, the score is unavailable; the application
never invents 100% or synthetic probabilities.

## Runtime notes

The OCR model runs in `scanWorker.js`, separate from the Stockfish worker. The
worker selects the CPU backend because the legacy model-compatible WebGL
backend assumes a DOM that dedicated workers do not provide. The runtime and
model are cached only after the scanner's explicit offline-model action.

This model was trained for aligned digital chess screenshots and has limited
piece-set generalization. Manual four-corner correction, FEN editing, and the
piece editor remain available when recognition is wrong or unavailable.
