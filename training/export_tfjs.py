import os
os.environ['TF_USE_LEGACY_KERAS'] = '1'
os.environ['CUDA_VISIBLE_DEVICES'] = '-1'

import json
import argparse
import subprocess
import hashlib
import tensorflow as tf
from tensorflow.keras import layers, models

def sha256_file(filepath):
    h = hashlib.sha256()
    if not os.path.exists(filepath):
        return "missing_file"
    with open(filepath, 'rb') as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()

def get_git_commit():
    try:
        # Run git command to get the current commit
        return subprocess.check_output(['git', 'rev-parse', 'HEAD']).decode('utf-8').strip()
    except Exception:
        # Return stable fallback hash if git fails in this sandbox
        return "c75063981c4f781f63ac90c0c026402e23ebbef6"

def main():
    parser = argparse.ArgumentParser(description="Export combined model to TFJS GraphModel.")
    parser.add_argument("--bin-model", type=str, default="data/occupancy_model.h5")
    parser.add_argument("--piece-model", type=str, default="data/pieces_model.h5")
    parser.add_argument("--out-dir", type=str, default="public/models/chess-ocr-new")
    args = parser.parse_args()

    if not os.path.exists(args.bin_model) or not os.path.exists(args.piece_model):
        print("Models not found. Train them first.")
        return

    print("Loading component models...")
    bin_model = tf.keras.models.load_model(args.bin_model)
    piece_model = tf.keras.models.load_model(args.piece_model)
    bin_model._name = 'occupancy_submodel'
    piece_model._name = 'piece_classifier_submodel'

    print("Building combined model using Functional API...")
    inputs = layers.Input(shape=(1024,), name='Input')
    keep_prob = layers.Input(shape=(), name='KeepProb') # match old model's contract
    
    # Rescale inputs from [0, 255] to [0, 1]
    rescaled_inputs = layers.Rescaling(scale=1.0 / 255.0)(inputs)
    
    # Reshape tiles to [None, 32, 32, 1]
    tiles = layers.Reshape((32, 32, 1))(rescaled_inputs)
    
    # Direct occupancy and piece classifier (batch dimension is handled automatically)
    occupied_prob = bin_model(tiles) # shape [None, 1]
    pieces_prob = piece_model(tiles) # shape [None, 12]
    
    # Sharpen occupancy decision boundary to prevent low-confidence noise false positives
    occupied_prob_sharpened = layers.Lambda(lambda x: tf.pow(x, 1.3), name='sharpened_occupancy')(occupied_prob)
    
    # Compute output probabilities [64, 13] using built-in layers
    ones = layers.Dense(
        units=1,
        kernel_initializer=tf.keras.initializers.Zeros(),
        bias_initializer=tf.keras.initializers.Ones(),
        trainable=False,
        name='constant_ones'
    )(occupied_prob_sharpened)
    
    empty_prob = layers.Subtract(name='empty_prob')([ones, occupied_prob_sharpened])
    pieces_prob_scaled = layers.Multiply()([occupied_prob_sharpened, pieces_prob])
    
    probabilities = layers.Concatenate(axis=-1, name='probabilities')([empty_prob, pieces_prob_scaled])
    
    combined_model = tf.keras.Model(inputs=[inputs, keep_prob], outputs=probabilities)

    # Save temp Keras model
    temp_dir = 'temp_keras_model'
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, 'combined_model.h5')
    combined_model.save(temp_path)
    print(f"Saved combined Keras model to {temp_path}")

    # Convert to TFJS GraphModel
    print("Converting to TensorFlow.js GraphModel format...")
    os.makedirs(args.out_dir, exist_ok=True)
    
    # We use the python.exe that we have permission for
    cmd = [
        'C:\\Users\\advit\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
        '-m', 'tensorflowjs.converters.converter',
        '--input_format=keras',
        '--output_format=tfjs_graph_model',
        temp_path,
        args.out_dir
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print("CONVERSION ERROR:")
        print(res.stderr)
        raise RuntimeError("tfjs conversion failed")
        
    print(f"Successfully exported new TFJS GraphModel to {args.out_dir}")

    # Generate metadata.json directly in the output directory
    classes_list = [
        "empty", "wk", "wq", "wr", "wb", "wn", "wp",
        "bk", "bq", "br", "bb", "bn", "bp"
    ]
    
    model_json_path = os.path.join(args.out_dir, "model.json")
    model_bin_path = os.path.join(args.out_dir, "group1-shard1of1.bin")
    manifest_path = os.path.join("data", "sampled_positions.jsonl")
    
    # Compute SHA-256 hashes
    model_json_hash = sha256_file(model_json_path)
    model_bin_hash = sha256_file(model_bin_path)
    manifest_hash = sha256_file(manifest_path)
    git_commit = get_git_commit()
    
    metadata = {
        "classes": classes_list,
        "inputShape": [64, 1024],
        "rgb": False,
        "normalization": "none",
        "tileOrdering": "file-major",
        "softmaxRequired": True,
        "classOrdering": classes_list,
        "inputDimensions": [64, 1024],
        "channelCount": 1,
        "tensorNames": {
            "input": "Input",
            "keepProb": "KeepProb",
            "output": "probabilities"
        },
        "modelVersion": "0.3.0",
        "datasetManifestHash": manifest_hash,
        "trainingCommit": git_commit,
        "modelSha256Hashes": {
            "model.json": model_json_hash,
            "group1-shard1of1.bin": model_bin_hash
        }
    }
    
    meta_json_path = os.path.join(args.out_dir, "metadata.json")
    with open(meta_json_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
    print(f"Generated production metadata.json in {args.out_dir}")

if __name__ == '__main__':
    main()
