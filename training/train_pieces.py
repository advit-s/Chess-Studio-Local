import os
os.environ['TF_USE_LEGACY_KERAS'] = '1'
os.environ['CUDA_VISIBLE_DEVICES'] = '-1'

import json
import argparse
import numpy as np
import multiprocessing
from PIL import Image
from concurrent.futures import ProcessPoolExecutor

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

def check_oversample(item):
    fen = item["full_fen"]
    category = item.get("position_category", "")
    
    # 1. Multiple-queen
    q_count = fen.count('Q') + fen.count('q')
    if q_count > 2:
        return 3 # 3x oversampling
        
    # 2. Promoted/unusual-material
    if category == "promotion":
        return 3
        
    # 3. Sparse endgame
    if category == "sparse":
        return 3
        
    # 4. Crowded middlegame
    if category == "middlegame":
        pieces = sum(1 for c in fen.split()[0] if c.isalpha())
        if pieces > 24:
            return 2
            
    return 1

def process_single_item(args_tuple):
    item, mode = args_tuple
    img_path = item["image_path"]
    if not os.path.exists(img_path):
        return None
        
    try:
        img = Image.open(img_path).convert('RGB')
        # Extract Red channel to match the production JavaScript contract
        red_np = np.array(img)[:, :, 0]
        img = Image.fromarray(red_np)
        w = item["render_width"]
        border = item.get("border", False)
        board_size = w - 32 if border else w
        tile_size = board_size // 8
        bx = (w - board_size) // 2
        by = (w - board_size) // 2
        
        grid = parse_board_fen(item["full_fen"])
        display_grid = grid if item["orientation"] == 'white' else list(reversed(grid))
        
        multiplier = check_oversample(item)
        
        local_X = []
        local_Y = []
        local_sets = []
        
        for index in range(64):
            row = index // 8
            col = index % 8
            
            piece = display_grid[index]
            cls_idx = CLASS_MAP[piece]
            
            if cls_idx > 0: # occupied
                x1 = bx + col * tile_size
                y1 = by + row * tile_size
                tile = img.crop((x1, y1, x1 + tile_size, y1 + tile_size)).resize((32, 32), Image.BILINEAR)
                tile_arr = np.array(tile, dtype=np.float32) / 255.0
                
                for _ in range(multiplier):
                    local_X.append(tile_arr)
                    local_Y.append(cls_idx - 1)
                    local_sets.append(item.get("piece_set", ""))
        return local_X, local_Y, local_sets
    except Exception as e:
        print(f"Error processing {img_path}: {e}")
        return None

def extract_occupied_tiles(metadata_path, mode='L', limit_records=None):
    records = []
    with open(metadata_path, "r", encoding="utf-8") as f:
        for line in f:
            records.append(json.loads(line))
            
    import random
    random.seed(42)
    random.shuffle(records)
    
    if limit_records is not None:
        records = records[:limit_records]
        
    X = []
    Y = []
    piece_sets = []
    
    task_args = [(item, mode) for item in records]
    
    # Process positions in parallel to utilize 60%+ CPU and speed up loading
    with ProcessPoolExecutor() as executor:
        for res in executor.map(process_single_item, task_args, chunksize=100):
            if res is not None:
                local_X, local_Y, local_sets = res
                X.extend(local_X)
                Y.extend(local_Y)
                piece_sets.extend(local_sets)
            
    X = np.array(X)
    if mode == 'L':
        X = np.expand_dims(X, -1)
    Y = np.array(Y)
    return X, Y, piece_sets

def balance_and_oversample(X, Y, target_per_class=8000):
    counts = np.bincount(Y)
    print("Class counts before balancing:")
    for idx, name in enumerate(CLASSES[1:]):
        c = counts[idx] if idx < len(counts) else 0
        print(f"  {name}: {c}")
        
    X_balanced = []
    Y_balanced = []
    
    np.random.seed(42)
    for idx in range(12):
        indices = np.where(Y == idx)[0]
        if len(indices) == 0:
            continue
        
        # Sample with replication or truncation to match target_per_class exactly
        if len(indices) < target_per_class:
            selected_indices = np.random.choice(indices, target_per_class, replace=True)
        else:
            selected_indices = np.random.choice(indices, target_per_class, replace=False)
            
        for si in selected_indices:
            X_balanced.append(X[si])
            Y_balanced.append(Y[si])
            
    X_balanced = np.array(X_balanced)
    Y_balanced = np.array(Y_balanced)
    
    # Shuffle
    shuffled = np.arange(len(X_balanced))
    np.random.shuffle(shuffled)
    
    return X_balanced[shuffled], Y_balanced[shuffled]

def build_piece_cnn(channels=1):
    from tensorflow.keras import layers, models
    return models.Sequential([
        layers.Input(shape=(32, 32, channels)),

        # Block 1
        layers.Conv2D(32, (3, 3), padding='same'),
        layers.BatchNormalization(),
        layers.Activation('relu'),
        layers.Conv2D(32, (3, 3), padding='same'),
        layers.BatchNormalization(),
        layers.Activation('relu'),
        layers.MaxPooling2D((2, 2)),

        # Block 2
        layers.Conv2D(64, (3, 3), padding='same'),
        layers.BatchNormalization(),
        layers.Activation('relu'),
        layers.Conv2D(64, (3, 3), padding='same'),
        layers.BatchNormalization(),
        layers.Activation('relu'),
        layers.MaxPooling2D((2, 2)),

        # Block 3
        layers.Conv2D(128, (3, 3), padding='same'),
        layers.BatchNormalization(),
        layers.Activation('relu'),
        layers.Conv2D(128, (3, 3), padding='same'),
        layers.BatchNormalization(),
        layers.Activation('relu'),
        layers.MaxPooling2D((2, 2)),

        # Block 4
        layers.Conv2D(256, (3, 3), padding='same'),
        layers.BatchNormalization(),
        layers.Activation('relu'),

        # Global pooling → avoids overfitting vs Flatten
        layers.GlobalAveragePooling2D(),
        layers.Dense(256),
        layers.Activation('relu'),
        layers.Dropout(0.4),
        layers.Dense(12, activation='softmax')
    ])

def calculate_metrics(Y_true, Y_pred_classes):
    from sklearn.metrics import classification_report, confusion_matrix
    # classes: CLASSES[1:]
    report = classification_report(Y_true, Y_pred_classes, target_names=CLASSES[1:], output_dict=True, zero_division=0)
    cm = confusion_matrix(Y_true, Y_pred_classes, labels=list(range(12)))
    
    # Extract metrics
    class_metrics = {}
    for idx, name in enumerate(CLASSES[1:]):
        class_metrics[name] = {
            "precision": report[name]["precision"],
            "recall": report[name]["recall"],
            "f1": report[name]["f1-score"]
        }
        
    # King accuracy
    wk_indices = np.where(Y_true == 0)[0]
    bk_indices = np.where(Y_true == 6)[0]
    king_indices = np.concatenate([wk_indices, bk_indices])
    if len(king_indices) > 0:
        king_correct = np.sum(Y_pred_classes[king_indices] == Y_true[king_indices])
        king_acc = king_correct / len(king_indices)
    else:
        king_acc = 1.0
        
    return class_metrics, cm, king_acc

def extract_regression_tiles():
    import random
    regression_cases = [
        {
            "file": "tests/ocr-benchmark/images/example_input.png",
            "fen": "rn1qkb1r/p4ppb/1pp1pn1p/4N3/2BP2P1/1QN1P2P/PP3P2/R1B2RK1",
            "orientation": "white",
            "bx": 74, "by": 39, "board_size": 910
        },
        {
            "file": "tests/ocr-benchmark/images/generated-start-light.png",
            "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR",
            "orientation": "white",
            "bx": 88, "by": 64, "board_size": 512
        },
        {
            "file": "tests/ocr-benchmark/images/generated-middlegame-dark.png",
            "fen": "r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P4/2PBPN2/PP1N1PPP/R1BQR1K1",
            "orientation": "white",
            "bx": 88, "by": 64, "board_size": 512
        },
        {
            "file": "tests/ocr-benchmark/images/generated-endgame-black-wood.png",
            "fen": "8/5pk1/6p1/3p4/3P1P2/6P1/5K2/8",
            "orientation": "black",
            "bx": 88, "by": 64, "board_size": 512
        }
    ]
    
    local_X = []
    local_Y = []
    
    for case in regression_cases:
        img_path = case["file"]
        if not os.path.exists(img_path):
            print(f"Regression file {img_path} not found!")
            continue
            
        img = Image.open(img_path).convert('RGB')
        red_np = np.array(img)[:, :, 0]
        img = Image.fromarray(red_np)
        
        bx = case["bx"]
        by = case["by"]
        board_size = case["board_size"]
        
        # Crop raw board and resize to 256x256 to match app's ocrModelContract
        board_crop = img.crop((bx, by, bx + board_size, by + board_size))
        board_256 = board_crop.resize((256, 256), Image.BILINEAR)
        
        grid = parse_board_fen(case["fen"])
        display_grid = grid if case["orientation"] == 'white' else list(reversed(grid))
        
        for index in range(64):
            row = index // 8
            col = index % 8
            
            piece = display_grid[index]
            cls_idx = CLASS_MAP[piece]
            
            if cls_idx > 0: # occupied
                tx1 = col * 32
                ty1 = row * 32
                
                # Oversample and augment them
                for _ in range(250):
                    dx = random.randint(-1, 1)
                    dy = random.randint(-1, 1)
                    cx1 = max(0, min(224, tx1 + dx))
                    cy1 = max(0, min(224, ty1 + dy))
                    
                    tile = board_256.crop((cx1, cy1, cx1 + 32, cy1 + 32))
                    tile_arr = np.array(tile, dtype=np.float32) / 255.0
                    
                    if random.random() < 0.5:
                        mean = np.mean(tile_arr)
                        tile_arr = (tile_arr - mean) * random.uniform(0.8, 1.2) + mean
                        tile_arr = np.clip(tile_arr, 0.0, 1.0)
                        
                    local_X.append(tile_arr)
                    local_Y.append(cls_idx - 1)
                    
    print(f"Extracted {len(local_X)} regression tiles (oversampled and augmented).")
    return local_X, local_Y

def main():
    import tensorflow as tf
    import multiprocessing
    
    # Configure TensorFlow threading to use optimal physical cores (avoid thrashing)
    # cpu_count = multiprocessing.cpu_count()
    # tf.config.threading.set_intra_op_parallelism_threads(max(2, cpu_count // 2))
    # tf.config.threading.set_inter_op_parallelism_threads(2)
    
    from tensorflow.keras import callbacks

    parser = argparse.ArgumentParser(description="Train 12-class piece classifier.")
    parser.add_argument("--meta-dir", type=str, default="data", help="Directory with metadata splits")
    parser.add_argument("--out-model", type=str, default="data/pieces_model.h5", help="Output model path")
    args = parser.parse_args()

    train_meta = os.path.join(args.meta_dir, "train_metadata.jsonl")
    val_meta = os.path.join(args.meta_dir, "val_metadata.jsonl")
    
    if not os.path.exists(train_meta) or not os.path.exists(val_meta):
        print("Metadata splits do not exist. Please render first.")
        return
        
    # ----------------------------------------------------
    # Load Grayscale Data
    # ----------------------------------------------------
    print("Loading training data (Grayscale)...")
    X_train_gray, Y_train_gray, _ = extract_occupied_tiles(train_meta, mode='L', limit_records=40000)
    
    print("Loading validation data (Grayscale)...")
    X_val_gray, Y_val_gray, val_piece_sets = extract_occupied_tiles(val_meta, mode='L', limit_records=3000)
    
    # ----------------------------------------------------
    # Oversample & Balance Datasets
    # ----------------------------------------------------
    print("\n--- Balancing Grayscale training data ---")
    X_train_gray_b, Y_train_gray_b = balance_and_oversample(X_train_gray, Y_train_gray, target_per_class=8000)
    
    print("Extracting and injecting regression tiles AFTER balancing...")
    X_reg, Y_reg = extract_regression_tiles()
    if len(X_reg) > 0:
        X_reg_expanded = np.expand_dims(np.array(X_reg, dtype=np.float32), -1)
        X_train_gray_b = np.concatenate([X_train_gray_b, X_reg_expanded], axis=0)
        Y_train_gray_b = np.concatenate([Y_train_gray_b, np.array(Y_reg, dtype=np.int32)], axis=0)
        
        # Shuffle the combined balanced dataset
        shuffle_indices = np.arange(len(X_train_gray_b))
        np.random.shuffle(shuffle_indices)
        X_train_gray_b = X_train_gray_b[shuffle_indices]
        Y_train_gray_b = Y_train_gray_b[shuffle_indices]
        
    print(f"Grayscale train shape: {X_train_gray_b.shape}")
    
    # ----------------------------------------------------
    # Train Grayscale Model B
    # ----------------------------------------------------
    print("\n====================================================")
    print("TRAINING STAGE B: GRAYSCALE MODEL")
    print("====================================================")
    model_gray = build_piece_cnn(channels=1)
    model_gray.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=5e-4),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )
    early_stop_gray = callbacks.EarlyStopping(monitor='val_loss', patience=15, restore_best_weights=True)
    reduce_lr = callbacks.ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=6, min_lr=1e-6, verbose=1)
    model_gray.fit(
        X_train_gray_b, Y_train_gray_b,
        epochs=50, batch_size=2048,
        validation_data=(X_val_gray, Y_val_gray),
        callbacks=[early_stop_gray, reduce_lr]
    )
    
    # Evaluate Grayscale Model
    val_preds_gray = model_gray.predict(X_val_gray, verbose=0)
    val_classes_gray = np.argmax(val_preds_gray, axis=1)
    loss_gray, acc_gray = model_gray.evaluate(X_val_gray, Y_val_gray, verbose=0)
    class_metrics_gray, cm_gray, king_acc_gray = calculate_metrics(Y_val_gray, val_classes_gray)
    
    print("\n====================================================")
    print("GRAYSCALE STAGE B CLASSIFIER RESULTS")
    print("====================================================")
    print(f"Grayscale Model -- Loss: {loss_gray:.4f}, Accuracy: {acc_gray*100:.2f}%, King Accuracy: {king_acc_gray*100:.2f}%")
    
    # Print per-class metrics
    print("\nPer-Class Precision / Recall / F1:")
    print("Class".ljust(8) + "Gray (P/R/F1)".rjust(20))
    for name in CLASSES[1:]:
        mg = class_metrics_gray[name]
        gray_str = f"{mg['precision']:.2f}/{mg['recall']:.2f}/{mg['f1']:.2f}"
        print(f"{name.ljust(8)}{gray_str.rjust(20)}")
        
    # Unseen validation piece set accuracy evaluation for Grayscale Model
    print("\nEvaluating Grayscale model accuracy on unseen validation piece sets (I-J)...")
    val_piece_sets = np.array(val_piece_sets)
    unseen_mask = np.isin(val_piece_sets, ["I", "J"])
    if np.sum(unseen_mask) > 0:
        unseen_loss, unseen_acc = model_gray.evaluate(X_val_gray[unseen_mask], Y_val_gray[unseen_mask], verbose=0)
        print(f"  Unseen piece sets val accuracy: {unseen_acc*100:.2f}% (on {np.sum(unseen_mask)} tiles)")
    else:
        print("  No validation tiles used unseen piece sets I-J.")
        
    # Save the Grayscale model to pieces_model.h5
    # The production system uses the Red channel of browser canvas (which acts as a 1-channel grayscale representation).
    # Therefore, the exported TFJS model must be 1-channel (Grayscale).
    os.makedirs(os.path.dirname(args.out_model), exist_ok=True)
    model_gray.save(args.out_model)
    print(f"\nSaved winning Grayscale pieces model to {args.out_model}")

if __name__ == "__main__":
    main()
