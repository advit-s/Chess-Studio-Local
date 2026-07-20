import os
import json
import hashlib
import numpy as np
import tensorflow as tf
from PIL import Image

# Centralized class list matching public/models/chess-ocr/metadata.json
CLASSES = [
    'empty', 'wk', 'wq', 'wr', 'wb', 'wn', 'wp',
    'bk', 'bq', 'br', 'bb', 'bn', 'bp'
]

def get_sha256(arr):
    return hashlib.sha256(arr.tobytes()).hexdigest()

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tiles_dir = os.path.join(root, "tests", "ocr-benchmark", "images", "diagnostic_tiles")
    
    # Combined model path
    combined_model_path = os.path.join(root, "temp_keras_model", "combined_model.h5")
    if not os.path.exists(combined_model_path):
        print("Combined Keras model not found. Generating it via export_tfjs.py...")
        # Run export_tfjs.py
        import subprocess
        python_exe = "C:\\Users\\advit\\AppData\\Local\\Programs\\Python\\Python311\\python.exe"
        export_script = os.path.join(root, "training", "export_tfjs.py")
        res = subprocess.run([python_exe, export_script], capture_output=True, text=True)
        if res.returncode != 0:
            print("Export error:")
            print(res.stderr)
            raise RuntimeError("Failed to auto-generate combined Keras model.")

    print(f"Loading combined Keras model from: {combined_model_path}")
    # Force legacy keras to prevent compatibility issues
    os.environ['TF_USE_LEGACY_KERAS'] = '1'
    model = tf.keras.models.load_model(combined_model_path)

    results = []

    for cls in CLASSES:
        tile_path = os.path.join(tiles_dir, f"{cls}.png")
        if not os.path.exists(tile_path):
            print(f"Warning: Tile {tile_path} does not exist.")
            continue
            
        img = Image.open(tile_path)
        # Convert to Grayscale ('L') to match training pipeline input luma
        img_l = img.convert('L')
        
        # Array of shape (1024,) in range [0, 255]
        pixels_flat = np.array(img_l, dtype=np.float32).flatten()
        
        # Calculate stats
        inp_min = float(np.min(pixels_flat))
        inp_max = float(np.max(pixels_flat))
        inp_mean = float(np.mean(pixels_flat))
        inp_std = float(np.std(pixels_flat))
        inp_sha = get_sha256(pixels_flat)
        
        # Run Keras prediction
        # The model name for input layers can be retrieved:
        # Input layer 1: 'Input' (1024,)
        # Input layer 2: 'KeepProb' (1,)
        probs = model.predict({
            'Input': np.expand_dims(pixels_flat, 0),
            'KeepProb': np.array([1.0], dtype=np.float32)
        }, verbose=0)[0]
        
        selected_idx = int(np.argmax(probs))
        mapped_class = CLASSES[selected_idx]
        
        report = {
            "tile_name": f"{cls}.png",
            "expected_class": cls,
            "input_shape": list(pixels_flat.shape),
            "input_min": inp_min,
            "input_max": inp_max,
            "input_mean": inp_mean,
            "input_std": inp_std,
            "input_sha256": inp_sha,
            "output_shape": list(probs.shape),
            "output_vector": [float(v) for v in probs],
            "selected_class_index": selected_idx,
            "mapped_class": mapped_class
        }
        
        results.append(report)
        print(f"Parity Python - {cls}: predicted {mapped_class} (idx {selected_idx})")

    out_path = os.path.join(root, "training", "parity_results_python.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"Parity Python results saved to {out_path}")

if __name__ == "__main__":
    main()
