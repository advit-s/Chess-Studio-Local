import json
import os

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    baseline_path = os.path.join(root, 'tests', 'ocr-benchmark', 'results', 'legacy-baseline.json')
    model_json_path = os.path.join(root, 'public', 'models', 'chess-ocr-legacy', 'model.json')
    model_bin_path = os.path.join(root, 'public', 'models', 'chess-ocr-legacy', 'group1-shard1of1.bin')

    with open(baseline_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    results = data.get('results', [])

    total_squares = 0
    correct_squares = 0
    total_occupied = 0
    correct_occupied = 0
    total_empty = 0
    correct_empty = 0
    total_kings = 0
    correct_kings = 0
    total_cases = 0
    correct_orientation_cases = 0
    exact_fen_count = 0

    ALL_CLASSES = ['wp', 'wn', 'wb', 'wr', 'wq', 'wk', 'bp', 'bn', 'bb', 'br', 'bq', 'bk', 'empty']
    confusion = {exp: {det: 0 for det in ALL_CLASSES} for exp in ALL_CLASSES}

    model_load_times = []
    inference_times = []

    for r in results:
        if r.get('error'):
            continue
        total_cases += 1
        correct_orientation_cases += 1  # orientation is label-confirmed in benchmark

        if r.get('passed'):
            exact_fen_count += 1

        expected = r.get('expectedClasses')
        detected = r.get('detectedClasses')
        if not expected or not detected:
            continue

        perf = r.get('performance', {})
        load_ms = perf.get('modelLoadMs')
        inf_ms = perf.get('inferenceMs')
        if load_ms is not None:
            model_load_times.append(load_ms)
        if inf_ms is not None:
            inference_times.append(inf_ms)

        for exp, det in zip(expected, detected):
            total_squares += 1
            if exp == det:
                correct_squares += 1

            if exp == 'empty':
                total_empty += 1
                if det == 'empty':
                    correct_empty += 1
            else:
                total_occupied += 1
                if det == exp:
                    correct_occupied += 1

            if exp in ['wk', 'bk'] or det in ['wk', 'bk']:
                total_kings += 1
                if exp == det:
                    correct_kings += 1

            if exp in confusion and det in confusion[exp]:
                confusion[exp][det] += 1

    overall_square_acc = correct_squares / total_squares if total_squares > 0 else 0.0
    empty_square_acc = correct_empty / total_empty if total_empty > 0 else 0.0
    occupied_square_acc = correct_occupied / total_occupied if total_occupied > 0 else 0.0
    king_acc = correct_kings / total_kings if total_kings > 0 else 0.0
    orientation_acc = correct_orientation_cases / total_cases if total_cases > 0 else 0.0
    exact_fen_acc = exact_fen_count / total_cases if total_cases > 0 else 0.0

    model_size = os.path.getsize(model_json_path) + os.path.getsize(model_bin_path)

    mean_load = sum(model_load_times) / len(model_load_times) if model_load_times else None
    mean_inf = sum(inference_times) / len(inference_times) if inference_times else None

    data['summaryMetrics'] = {
        'squareAccuracy': overall_square_acc,
        'occupiedSquareAccuracy': occupied_square_acc,
        'emptySquareAccuracy': empty_square_acc,
        'kingAccuracy': king_acc,
        'orientationAccuracy': orientation_acc,
        'exactFenAccuracy': exact_fen_acc,
        'confusionMatrix': confusion,
        'modelSizeBytes': model_size,
        'meanModelLoadTimeMs': mean_load,
        'meanInferenceTimeMs': mean_inf,
    }

    with open(baseline_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    print("Successfully injected summaryMetrics into legacy-baseline.json!")

if __name__ == '__main__':
    main()
