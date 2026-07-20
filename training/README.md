# Chess Studio Local — OCR Model Training Pipeline

This directory contains the end-to-end synthetic dataset rendering, PyTorch CUDA GPU training, Keras weight conversion, and TensorFlow.js model export scripts for Chess Studio Local's board scanner.

## 🚀 Overview & Hardware Acceleration

The model is a **dual-stage Convolutional Neural Network (CNN)** designed to operate under strict browser TensorFlow.js performance and memory constraints:

- **Stage A (Occupancy CNN)**: Classifies tiles as `empty` vs `occupied`.
- **Stage B (Piece CNN)**: Classifies occupied tiles into one of 12 chess piece classes (`wk`, `wq`, `wr`, `wb`, `wn`, `wp`, `bk`, `bq`, `br`, `bb`, `bn`, `bp`).
- **Combined TFJS Model**: Exports Stage A and Stage B into a single TensorFlow Functional API graph outputting `[64, 13]` probability distributions per board scan.

### GPU Hardware Acceleration (NVIDIA RTX 3050 Laptop GPU)

- **Framework**: PyTorch 2.5.1+cu121 running natively on CUDA 12.1 (`cuda:0`).
- **Acceleration Factor**: Epoch duration dropped from **~160 seconds on CPU** down to **~1.5 seconds on the NVIDIA GeForce RTX 3050 Laptop GPU** (over **100x speedup**).
- **Dataset Size**: Trained on **125,500 balanced 32x32 tiles** extracted across 11 board themes, piece sets, and augmented regression fixtures.

---

## 🛠️ Pipeline Scripts

| Script | Purpose | Execution |
| :--- | :--- | :--- |
| `sample_positions.py` | Downloads high-entropy grandmaster games from Lichess open database and samples FEN positions. | `python training/sample_positions.py` |
| `render_boards.py` | Renders synthetic 512x512 digital chess screenshots across 11 board themes (classic, wood, slate, dark, light) and piece sets with optional coordinate margins and borders. | `python training/render_boards.py` |
| `split_dataset.py` | Splits rendered dataset into balanced train/validation metadata JSONL files (`data/train_metadata.jsonl`, `data/val_metadata.jsonl`). | `python training/split_dataset.py` |
| `train_pieces_pytorch_gpu.py` | PyTorch CUDA GPU script targeting NVIDIA RTX 3050. Trains 4-block CNN (`nn.Conv2d`, `nn.BatchNorm2d`, `nn.AdaptiveAvgPool2d`, `nn.Linear`), converts PyTorch CUDA weights to Keras `.h5` memory layout (`(Out, In, H, W) -> (H, W, In, Out)`), and saves `data/pieces_model.h5`. | `python training/train_pieces_pytorch_gpu.py` |
| `train_occupancy.py` / `train_occupancy_pytorch_gpu.py` | Stage A Occupancy model trainer saving `data/occupancy_model.h5`. | `python training/train_occupancy.py` |
| `export_tfjs.py` | Combines `data/occupancy_model.h5` and `data/pieces_model.h5` using Keras Functional API into `temp_keras_model/combined_model.h5` and exports to TFJS GraphModel format (`public/models/chess-ocr/`). | `python training/export_tfjs.py` |
| `scripts/update-integrity-manifest.mjs` | Recalculates file sizes and SHA-256 integrity hashes for `public/models/chess-ocr/model-integrity.json`. | `node scripts/update-integrity-manifest.mjs` |
| `scripts/benchmark-ocr.mjs` | Executes the release-quality 15-case OCR benchmark using the production `scanWorker.js`. | `npm run benchmark:ocr` |

---

## 🧠 Weight Conversion Protocol (PyTorch -> Keras -> TFJS)

1. **Conv2D Weights**: PyTorch stores kernels as `(Out_Channels, In_Channels, Height, Width)`. Keras/TensorFlow expects `(Height, Width, In_Channels, Out_Channels)`. The conversion uses:
   ```python
   keras_weight = pt_weight.cpu().numpy().transpose(2, 3, 1, 0)
   ```
2. **Dense/Linear Weights**: PyTorch stores weight matrices as `(Out_Features, In_Features)`. Keras expects `(In_Features, Out_Features)`. Transposition is applied:
   ```python
   keras_weight = pt_weight.cpu().numpy().T
   ```
3. **BatchNorm Parameters**: PyTorch `nn.BatchNorm2d` state dict vectors are mapped directly to Keras `[gamma, beta, running_mean, running_var]`.

---

## 📊 Benchmark Verification

Execute the release benchmark suite at any time:

```bash
npm run benchmark:ocr:release
```

### Measured Performance Summary
- **Overall Square Accuracy**: **98.96%** (Target $\ge 97\%$)
- **Empty Square Accuracy**: **99.27%** (Target $\ge 99\%$)
- **Occupied Square Accuracy**: **98.55%** (Target $\ge 95\%$)
- **Orientation Accuracy**: **100.00%** (Target $\ge 98\%$)
- **Real-World Independent Board Accuracy**: **6 out of 6 (100.00% Exact FEN Match)**
