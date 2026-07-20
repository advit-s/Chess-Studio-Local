import os
os.environ['TF_USE_LEGACY_KERAS'] = '1'
os.environ['CUDA_VISIBLE_DEVICES'] = '-1'

import json
import argparse
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models, callbacks
from PIL import Image

CLASSES = [
    'empty', 'wk', 'wq', 'wr', 'wb', 'wn', 'wp',
    'bk', 'bq', 'br', 'bb', 'bn', 'bp'
]
CLASS_MAP = {c: i for i, c in enumerate(CLASSES)}

PIECE_TO_CLASS = {
    'K': 'wk', 'Q': 'wq', 'R': 'wr', 'B': 'wb', 'N': 'wn', 'P': 'wp',
    'k': 'bk', 'q': 'bq', 'r': 'br', 'b': 'bb', 'n': 'bn', 'p': 'bp'
}

def parse_board_fen(fen):
    rows = fen.split()[0].split('/')
    grid = []
    for row in rows:
        for char in row:
            if char.isdigit():
                grid.extend(['empty'] * int(char))
            else:
                grid.append(PIECE_TO_CLASS[char])
    return grid

def extract_tiles(metadata_path, limit_records=None):
    X = []
    Y = []
    
    records = []
    with open(metadata_path, "r", encoding="utf-8") as f:
        for line in f:
            records.append(json.loads(line))
            
    import random
    random.seed(42)
    random.shuffle(records)
    
    if limit_records is not None:
        records = records[:limit_records]
        
    for item in records:
        img_path = item["image_path"]
        if not os.path.exists(img_path):
            continue
            
        img = Image.open(img_path).convert('L')
        w = item["render_width"]
        border = item.get("border", False)
        board_size = w - 32 if border else w
        tile_size = board_size // 8
        bx = (w - board_size) // 2
        by = (w - board_size) // 2
        
        grid = parse_board_fen(item["full_fen"])
        display_grid = grid if item["orientation"] == 'white' else list(reversed(grid))
        
        for index in range(64):
            row = index // 8
            col = index % 8
            
            x1 = bx + col * tile_size
            y1 = by + row * tile_size
            tile = img.crop((x1, y1, x1 + tile_size, y1 + tile_size)).resize((32, 32), Image.BILINEAR)
            tile_arr = np.array(tile, dtype=np.float32) / 255.0
            
            piece = display_grid[index]
            cls_idx = CLASS_MAP[piece]
            
            X.append(tile_arr)
            Y.append(0 if cls_idx == 0 else 1)
            
    X = np.expand_dims(np.array(X), -1)
    Y = np.array(Y)
    return X, Y

def main():
    parser = argparse.ArgumentParser(description="Train empty vs occupied classifier.")
    parser.add_argument("--meta-dir", type=str, default="data", help="Directory with metadata splits")
    parser.add_argument("--out-model", type=str, default="data/occupancy_model.h5", help="Output model path")
    args = parser.parse_args()

    train_meta = os.path.join(args.meta_dir, "train_metadata.jsonl")
    val_meta = os.path.join(args.meta_dir, "val_metadata.jsonl")
    
    if not os.path.exists(train_meta) or not os.path.exists(val_meta):
        print("Metadata splits do not exist. Please render first.")
        return
        
    print("Loading training occupancy data...")
    X_train, Y_train = extract_tiles(train_meta, limit_records=6000)
    print("Loading validation occupancy data...")
    X_val, Y_val = extract_tiles(val_meta, limit_records=1500)
    
    # Balanced square sampling
    empty_indices = np.where(Y_train == 0)[0]
    occ_indices = np.where(Y_train == 1)[0]
    
    min_count = min(len(empty_indices), len(occ_indices))
    print(f"Balancing dataset to {min_count} empty and {min_count} occupied tiles...")
    
    np.random.seed(42)
    selected_empty = np.random.choice(empty_indices, min_count, replace=False)
    selected_occ = np.random.choice(occ_indices, min_count, replace=False)
    
    balanced_indices = np.concatenate([selected_empty, selected_occ])
    np.random.shuffle(balanced_indices)
    
    X_train_b = X_train[balanced_indices]
    Y_train_b = Y_train[balanced_indices]
    
    # Deep VGG-like CNN for Stage A
    model = models.Sequential([
        layers.Input(shape=(32, 32, 1)),
        layers.Conv2D(32, (3, 3), padding='same'),
        layers.BatchNormalization(),
        layers.Activation('relu'),
        layers.Conv2D(32, (3, 3), padding='same'),
        layers.BatchNormalization(),
        layers.Activation('relu'),
        layers.MaxPooling2D((2, 2)),
        
        layers.Conv2D(64, (3, 3), padding='same'),
        layers.BatchNormalization(),
        layers.Activation('relu'),
        layers.MaxPooling2D((2, 2)),
        
        layers.Flatten(),
        layers.Dense(128),
        layers.BatchNormalization(),
        layers.Activation('relu'),
        layers.Dropout(0.3),
        layers.Dense(1, activation='sigmoid')
    ])
    
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss='binary_crossentropy',
        metrics=['accuracy']
    )
    
    early_stopping = callbacks.EarlyStopping(
        monitor='val_loss',
        patience=3,
        restore_best_weights=True
    )
    
    print("Training Stage A (Occupancy) model...")
    model.fit(
        X_train_b, Y_train_b,
        epochs=15,
        batch_size=64,
        validation_data=(X_val, Y_val),
        callbacks=[early_stopping]
    )
    
    os.makedirs(os.path.dirname(args.out_model), exist_ok=True)
    model.save(args.out_model)
    print(f"Saved occupancy model to {args.out_model}")

if __name__ == "__main__":
    main()
