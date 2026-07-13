# Chess Piece Classification Model

## Status: **Not Yet Trained**

This directory is where the ONNX model file (`chess-pieces.onnx`) should be placed once trained.

## Expected Model Specification

### Input
- **Name**: `input` (or model-defined)
- **Shape**: `[1, 3, 32, 32]` — batch of 1, 3 RGB channels, 32×32 pixels
- **Type**: `float32`
- **Normalization**: Pixel values in `[0, 1]` range (divide by 255)
- **Channel order**: RGB, CHW layout

### Output
- **Name**: `output` (or model-defined)
- **Shape**: `[1, 13]` — raw logits for 13 classes
- **Type**: `float32`

### Class Ordering (13 classes)
| Index | Class | Description |
|-------|-------|-------------|
| 0 | `empty` | No piece on square |
| 1 | `wp` | White Pawn |
| 2 | `wn` | White Knight |
| 3 | `wb` | White Bishop |
| 4 | `wr` | White Rook |
| 5 | `wq` | White Queen |
| 6 | `wk` | White King |
| 7 | `bp` | Black Pawn |
| 8 | `bn` | Black Knight |
| 9 | `bb` | Black Bishop |
| 10 | `br` | Black Rook |
| 11 | `bq` | Black Queen |
| 12 | `bk` | Black King |

## Training Requirements

The model should be trained on square images extracted from real chessboard screenshots:

### Minimum training diversity
- Multiple piece sets (Lichess, Chess.com, wooden, tournament)
- Both light and dark square backgrounds
- Multiple board color themes
- Various resolutions (screenshots from different displays)
- Coordinates enabled and disabled
- Slight perspective distortion

### Recommended architecture
- Small CNN (e.g., 3-layer convnet with ~50K parameters)
- Or MobileNetV3-Small with custom head
- Must run in <10ms per square in browser via ONNX Runtime WASM

### Training framework
- PyTorch → export via `torch.onnx.export()`
- Or TensorFlow → convert via `tf2onnx`

## How to Use

1. Train the model using one of the approaches above
2. Export to ONNX format
3. Place the file as `chess-pieces.onnx` in this directory
4. The app will auto-detect and load it on the Scan tab
5. Piece recognition will switch from manual-only to auto+manual-correction
