# OCR regression benchmark

The benchmark invokes the same generated OCR core, detector, homography,
preprocessing contract, model assets, and worker inference path used by the
production scanner. Ground truth is stored in `images/manifest.json`; it is
never derived from model output.

Run it with:

```bash
# Strict: exits nonzero if any detected board FEN differs from ground truth
npm run benchmark:ocr

# Diagnostic: writes all metrics despite known failures
npm run benchmark:ocr -- --allow-failures
```

`results/latest.json` records detection success and IoU, confirmed orientation,
per-square/occupied/empty accuracy, exact-position accuracy, both FENs, wrong
squares, load/inference time, and process RSS. A deliberately wrong expected
FEN is covered by the benchmark unit tests and fails the case.

## Fixture categories

The categories are intentionally separate:

- `real-independent`: independently sourced real screenshots. There are none
  in v0.3.0, so no real-independent accuracy claim is made.
- `upstream-reference`: the screenshot bundled by the model project. It is a
  useful real-image regression case but is not independent of the model.
- `generated-application`: deterministic local screenshots rendered with the
  repository's MIT-licensed SVG fixture pieces and board themes.
- `augmented-transformed`: deterministic scale, rotation, true perspective,
  compression/panels/coordinates, and colour/lightness transforms of the
  upstream reference. These test robustness regressions, not broad real-world
  accuracy.

JPEG and WebP copies of the reference are decoder-path E2E fixtures and are not
counted as extra independent benchmark cases.

## Latest measured result

The latest diagnostic run contains nine cases:

| Category | Cases | Detection | Mean square | Mean occupied | Mean empty | Exact positions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Real independent | 0 | n/a | n/a | n/a | n/a | n/a |
| Upstream reference | 1 | 100% | 100% | 100% | 100% | 1/1 |
| Generated application | 4 | 100% | 87.11% | 40.63% | 100% | 1/4 |
| Augmented/transformed | 4 | 100% | 100% | 100% | 100% | 4/4 |

The generated piece-set failures are preserved as failures. They demonstrate
that the current model is not universal OCR and must not be described as
production-level or physical-board recognition. See `results/latest.json` for
every expected/detected FEN and wrong square.

## Reproducibility and licences

`scripts/generate-ocr-fixtures.mjs` deterministically produces the local and
augmented images. Source, licence, independence, expected corners, expected
orientation, 64 class labels, expected board FEN, and known complete FEN fields
are recorded per manifest case. Fixture hashes are checked by the generator and
reported in the results.
