# Third-party notices

Exact npm versions are pinned in `package-lock.json`. Redistributed production
code/model assets and fixture-source licences are listed below; corresponding
texts are in `THIRD_PARTY_LICENSES/`.

## Stockfish / Stockfish.js 18.0.8

The local engine worker and WASM are copied unchanged from the `stockfish` npm
package. Stockfish and Stockfish.js are GPL-3.0 licensed.

- Stockfish.js: https://github.com/nmrugg/stockfish.js
- Stockfish: https://github.com/official-stockfish/Stockfish
- Licence: `THIRD_PARTY_LICENSES/Stockfish-GPL-3.0.txt`

The Lite single-thread build needs no separately downloaded NNUE file.

## chess.js 1.4.0

The legal rules/PGN library is BSD-2-Clause licensed.

- Project: https://github.com/jhlywa/chess.js
- Licence: `THIRD_PARTY_LICENSES/chess.js-BSD-2-Clause.txt`

## React and React DOM 19.2.7

The production UI runtimes are MIT licensed, copyright Meta Platforms, Inc.
and affiliates.

- Project: https://github.com/facebook/react
- Licence: `THIRD_PARTY_LICENSES/React-MIT.txt`

## TensorFlow.js 0.15.3

`public/tf.min.js` is the vendored browser runtime needed to load the pinned
frozen graph. It is Apache-2.0 licensed. It is deliberately not installed as a
second npm OCR runtime.

- Project: https://github.com/tensorflow/tfjs
- Licence: `THIRD_PARTY_LICENSES/TensorFlow.js-Apache-2.0.txt`
- SHA-256: `8e51ada3786380cbe9937a53a8ad2f753f3014772033f28fa7dd859b8f0a81e4`

## ChessboardFenTensorflowJs model/project v1.0.0

The frozen graph, weights, upstream reference fixture, and preprocessing/class
contract originate in Elucidation's MIT-licensed project at pinned revision
`c75063981c4f781f63ac90c0c026402e23ebbef6`.

- Project: https://github.com/Elucidation/ChessboardFenTensorflowJs
- Licence: `THIRD_PARTY_LICENSES/ChessboardFenTensorflowJs-MIT.txt`
- File sizes/hashes: `public/models/chess-ocr/model-integrity.json`

Chess Studio Local adapts worker loading, board detection, projective warping,
validated output handling, lifecycle control, UI, and benchmark integration.
The model files themselves remain integrity-pinned to upstream.

## DejaVu fonts (benchmark raster fixtures only)

The deterministic generated benchmark screenshots rasterize standard Unicode
chess glyphs from DejaVu Sans/Mono. The font files are not bundled. Bitstream
Vera glyphs are covered by the Bitstream Vera licence; DejaVu changes are in
the public domain.

- Project: https://dejavu-fonts.github.io/
- Licence: `THIRD_PARTY_LICENSES/DejaVu-Bitstream-Vera.txt`

## Playwright 1.61.1

Playwright is a development/browser-test dependency only and is Apache-2.0
licensed.

- Project: https://github.com/microsoft/playwright
- Licence: `THIRD_PARTY_LICENSES/Playwright-Apache-2.0.txt`

Vite, Vitest, TypeScript, their plugins, and type packages are development
dependencies and are not embedded as separate runtime libraries in `dist`;
their pinned package metadata and notices are available after `npm ci`.

Chess Studio Local includes no Chessis source/branding/algorithms and no
Chess.com or Lichess application assets. Theme colours and generated test
layouts are original deterministic fixtures.
