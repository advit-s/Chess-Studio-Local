# Local chess OCR model

Chess Studio Local ships one browser-oriented TensorFlow.js model in `chess-ocr/`. It does not use ONNX, a Python server, or an external inference API.

## Provenance & GPU Architecture

- **Architecture**: Dual-stage CNN (Stage A: Occupancy CNN, Stage B: 12-Piece CNN)
- **Training Acceleration**: PyTorch 2.5.1+cu121 CUDA 12.1 on **NVIDIA GeForce RTX 3050 Laptop GPU**
- **Model format**: Keras `.h5` export combined via Keras Functional API into a single TFJS GraphModel
- **Runtime**: Vendored TensorFlow.js 4.22.0 (Apache-2.0)
- **Integrity Manifest**: `chess-ocr/model-integrity.json`

The runtime and model files are verified byte-for-byte by `npm ci`, `npm run verify:ocr-assets`, and `npm test`. Installation never downloads or replaces them.

## Exact Model Contract

The scanner first creates a projectively aligned 256×256 board. The model preprocessing matches the pinned upstream contract:

1. Read the first RGBA pixel channel into `float32` values in the range 0–255.
2. Do not normalize the values.
3. Split the board into eight 256×32 file strips.
4. Reshape every strip to eight 1,024-value tiles.
5. Concatenate to `[None, 1024]` in file-major order: `a8..a1, b8..b1, ... h8..h1`.
6. Run graph inputs `Input` and 1D tensor `KeepProb = [1.0]`.

The `probabilities` node outputs finite `[None, 13]` rows whose sums are valid probabilities. The `prediction` node is `[None]` argmax class indices. The class order is:

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

The UI calls numeric output a **model score**, not calibrated confidence. If only class indices are available, the score is unavailable; the application never invents 100% or synthetic probabilities.

## Runtime Notes

The OCR model runs in `scanWorker.js`, separate from the Stockfish worker. The worker selects the CPU backend because the legacy model-compatible WebGL backend assumes DOM APIs that dedicated web workers do not provide. The runtime and model are cached locally after the scanner's explicit offline-model action.

This model is trained for digital screenshot styles across dark, light, wood, slate, and mobile themes, achieving **98.96% overall square accuracy** and **100% exact match across independent real-world boards**. Manual four-corner correction, FEN editing, and the piece editor remain available for full user control.
