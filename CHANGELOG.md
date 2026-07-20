# Changelog

## 0.3.0 — 2026-07-14

- Accelerated OCR model training using PyTorch 2.5.1+cu121 on an **NVIDIA GeForce RTX 3050 Laptop GPU**, reducing 50-epoch training duration from ~2.2 hours on CPU to **under 2 minutes** (100x acceleration).
- Implemented an automated weight conversion pipeline from PyTorch `(Out, In, H, W)` Conv2D CUDA tensors to Keras `(H, W, In, Out)` `.h5` memory layout and transposing Dense/Linear layers.
- Synthesized Stage A (Occupancy CNN) and Stage B (12-Piece CNN) using TensorFlow Functional API into a unified `[64, 13]` probability distribution GraphModel in `public/models/chess-ocr/`.
- Achieved **98.96% Overall Square Accuracy** (exceeding release target $\ge 97\%$), **99.27% Empty Square Accuracy**, **98.55% Occupied Square Accuracy**, **100% Orientation Accuracy**, and **100% Exact FEN Match across all 6 real-world independent test boards**.
- Updated integrity manifest (`public/models/chess-ocr/model-integrity.json`), test suites, and documentation (`README.md`, `public/models/README.md`, `training/README.md`, `ENGINEERING_REPORT.md`).

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
