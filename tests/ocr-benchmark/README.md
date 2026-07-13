# OCR Benchmark Framework

## Status: **Infrastructure Ready — Awaiting Trained Model**

This directory provides the benchmark framework for evaluating chess board detection and piece recognition accuracy.

## Directory Structure

```
tests/ocr-benchmark/
├── README.md           # This file
├── benchmark.ts        # Benchmark runner script
└── images/             # Labeled test screenshots (to be added)
    └── manifest.json   # Test case manifest
```

## Test Case Manifest Format

Each test case in `images/manifest.json`:

```json
{
  "cases": [
    {
      "id": "starting-position-lichess",
      "file": "starting-position-lichess.png",
      "expectedFen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR",
      "orientation": "white",
      "source": "Lichess",
      "tags": ["starting", "light-theme", "no-coordinates"],
      "boardBounds": { "x": 50, "y": 50, "w": 400, "h": 400 }
    }
  ]
}
```

## Required Test Images

When adding labeled test screenshots, include at minimum:

| ID | Description | Tags |
|----|-------------|------|
| `starting-white` | Starting position, white at bottom | starting, white |
| `starting-black` | Starting position, black at bottom | starting, black |
| `empty-board` | Empty board | empty |
| `middlegame-1` | Complex middlegame | middlegame |
| `endgame-1` | King + pawns endgame | endgame |
| `lichess-light` | Lichess light theme | light-theme |
| `lichess-dark` | Lichess dark theme | dark-theme |
| `wooden-board` | Wooden board texture | wooden |
| `coords-on` | Coordinates visible | coordinates |
| `coords-off` | No coordinates | no-coordinates |
| `perspective` | Slight perspective distortion | perspective |
| `full-page` | Full page with panels around board | full-page |

## Metrics Reported

For each test case, the benchmark reports:

- **Board Detection IoU** — Intersection over Union of detected vs expected board bounds
- **Square Classification Accuracy** — Per-square correct/incorrect
- **Full-Position Accuracy** — Does detected FEN == expected FEN?
- **Orientation Accuracy** — Was the board orientation correctly detected?
- **Expected FEN** vs **Detected FEN**
- **Misclassified Squares** — List of incorrectly classified squares

## Running

```bash
npx tsx tests/ocr-benchmark/benchmark.ts
```

Currently reports "SKIPPED" for classification tests since no trained model is available.
Board detection tests run against any provided images.
