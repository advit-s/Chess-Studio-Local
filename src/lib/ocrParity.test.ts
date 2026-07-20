import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { MODEL_CLASSES } from './ocrModelContract';

interface ParityResultPython {
  tile_name: string;
  expected_class: string;
  input_shape: number[];
  input_min: number;
  input_max: number;
  input_mean: number;
  input_std: number;
  input_sha256: string;
  output_shape: number[];
  output_vector: number[];
  selected_class_index: number;
  mapped_class: string;
}

interface ParityResultTfjs {
  tile_name: string;
  expected_class: string;
  input_shape: number[];
  input_min: number;
  input_max: number;
  input_mean: number;
  input_std: number;
  input_sha256: string;
  output_shape: number[];
  output_vector: number[];
  selected_class_index: number;
  mapped_class: string;
}

interface ParityResultWorker {
  tile_name: string;
  expected_class: string;
  mapped_class: string;
  score: number;
  topCandidates: Array<{ piece: string; score: number }>;
}

describe('OCR Parity Testing', () => {
  const projectRoot = path.resolve(__dirname, '../../');
  
  it('Training metadata and browser contract metadata align', () => {
    const metadataPath = path.join(projectRoot, 'public', 'models', 'chess-ocr', 'metadata.json');
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));

    // Assert identical class ordering
    expect(metadata.classes).toEqual(MODEL_CLASSES);
    
    // Assert structural requirements
    expect(metadata.inputShape).toEqual([64, 1024]);
    expect(metadata.rgb).toBe(false);
    expect(metadata.normalization).toBe('none');
    expect(metadata.tileOrdering).toBe('file-major');
  });

  it('Direct TFJS predictions match Python Keras source model predictions', () => {
    const pythonResultsPath = path.join(projectRoot, 'training', 'parity_results_python.json');
    const tfjsResultsPath = path.join(projectRoot, 'training', 'parity_results_tfjs.json');

    const pythonResults: ParityResultPython[] = JSON.parse(readFileSync(pythonResultsPath, 'utf8'));
    const tfjsResults: ParityResultTfjs[] = JSON.parse(readFileSync(tfjsResultsPath, 'utf8'));

    expect(tfjsResults).toHaveLength(pythonResults.length);

    for (let i = 0; i < pythonResults.length; i++) {
      const py = pythonResults[i];
      const tfjs = tfjsResults[i];

      expect(tfjs.tile_name).toBe(py.tile_name);
      expect(tfjs.expected_class).toBe(py.expected_class);

      // Verify mapping index parity
      expect(tfjs.selected_class_index).toBe(py.selected_class_index);
      expect(tfjs.mapped_class).toBe(py.mapped_class);

      // Verify output probabilities are within floating-point tolerance 1e-4
      expect(tfjs.output_vector.length).toBe(py.output_vector.length);
      for (let j = 0; j < py.output_vector.length; j++) {
        const diff = Math.abs(tfjs.output_vector[j] - py.output_vector[j]);
        expect(diff).toBeLessThan(1e-4);
      }
    }
  });

  it('Production worker outputs match direct TFJS predictions', () => {
    const tfjsResultsPath = path.join(projectRoot, 'training', 'parity_results_tfjs.json');
    const workerResultsPath = path.join(projectRoot, 'training', 'parity_results_worker.json');

    const tfjsResults: ParityResultTfjs[] = JSON.parse(readFileSync(tfjsResultsPath, 'utf8'));
    const workerResults: ParityResultWorker[] = JSON.parse(readFileSync(workerResultsPath, 'utf8'));

    // Worker results check tiles 0 to 11 (the 12 piece sets plus empty)
    for (const workerRes of workerResults) {
      const correspondingTfjs = tfjsResults.find(t => t.tile_name === workerRes.tile_name);
      expect(correspondingTfjs).toBeDefined();

      if (correspondingTfjs) {
        expect(workerRes.mapped_class).toBe(correspondingTfjs.mapped_class);
      }
    }
  });
});
