import os
os.environ['TF_USE_LEGACY_KERAS'] = '1'
os.environ['CUDA_VISIBLE_DEVICES'] = '-1'

import json
import argparse
import numpy as np
import tensorflow as tf
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

def extract_tiles_from_image(img, expected_corners=None):
    # If corners are provided, do quad perspective warp to 256x256
    # expected_corners: {'topLeft': {'x', 'y'}, ...}
    if expected_corners:
        tl = expected_corners['topLeft']
        tr = expected_corners['topRight']
        br = expected_corners['bottomRight']
        bl = expected_corners['bottomLeft']
        
        warped = img.transform((256, 256), Image.QUAD, [
            tl['x'], tl['y'],
            bl['x'], bl['y'],
            br['x'], br['y'],
            tr['x'], tr['y']
        ]).convert('L')
    else:
        warped = img.convert('L').resize((256, 256), Image.BILINEAR)
        
    tiles = []
    gray_arr = np.array(warped, dtype=np.float32) / 255.0
    for row in range(8):
        for col in range(8):
            tile = gray_arr[row*32:(row+1)*32, col*32:(col+1)*32]
            tiles.append(np.expand_dims(tile, -1))
            
    return np.array(tiles)

def evaluate_records(records, bin_model, piece_model):
    correct_squares = 0
    total_squares = 0
    correct_fens = 0
    total_fens = 0
    
    for r in records:
        img_path = r["image_path"]
        if not os.path.exists(img_path):
            continue
            
        img = Image.open(img_path)
        expected_corners = None
        # Support corners if present in record (like manifest.json format)
        if "expectedCorners" in r:
            expected_corners = r["expectedCorners"]
        elif "border" in r:
            w = r["render_width"]
            border = r["border"]
            board_size = w - 32 if border else w
            bx = (w - board_size) // 2
            by = (w - board_size) // 2
            expected_corners = {
                "topLeft": {"x": bx, "y": by},
                "topRight": {"x": bx + board_size, "y": by},
                "bottomRight": {"x": bx + board_size, "y": by + board_size},
                "bottomLeft": {"x": bx, "y": by + board_size}
            }
            
        tiles = extract_tiles_from_image(img, expected_corners)
        
        # Predict
        bin_preds = bin_model(tiles, training=False).numpy() # [64, 1]
        piece_preds = piece_model(tiles, training=False).numpy() # [64, 12]
        
        expected_grid = parse_board_fen(r["full_fen"] if "full_fen" in r else r["expectedBoardFen"])
        display_expected = expected_grid
        if r.get("orientation", r.get("expectedOrientation", "white")) == "black":
            display_expected = list(reversed(expected_grid))
            
        detected_grid = []
        for i in range(64):
            is_occupied = bin_preds[i][0] > 0.5
            if not is_occupied:
                detected_grid.append("empty")
            else:
                p_idx = np.argmax(piece_preds[i])
                detected_grid.append(CLASSES[1 + p_idx])
                
        # Compare
        sq_matches = sum(1 for e, d in zip(display_expected, detected_grid) if e == d)
        correct_squares += sq_matches
        total_squares += 64
        
        if sq_matches == 64:
            correct_fens += 1
        total_fens += 1
        
    sq_acc = (correct_squares / total_squares * 100.0) if total_squares > 0 else 0.0
    fen_acc = (correct_fens / total_fens * 100.0) if total_fens > 0 else 0.0
    return sq_acc, fen_acc

def main():
    parser = argparse.ArgumentParser(description="Evaluate OCR models.")
    parser.add_argument("--bin-model", type=str, default="data/occupancy_model.h5")
    parser.add_argument("--piece-model", type=str, default="data/pieces_model.h5")
    parser.add_argument("--meta-dir", type=str, default="data")
    parser.add_argument("--manifest", type=str, default="tests/ocr-benchmark/images/manifest.json")
    args = parser.parse_args()

    if not os.path.exists(args.bin_model) or not os.path.exists(args.piece_model):
        print("Models not found. Train them first.")
        return
        
    print("Loading models...")
    bin_model = tf.keras.models.load_model(args.bin_model)
    piece_model = tf.keras.models.load_model(args.piece_model)
    
    # 1. Seen piece sets (A-H) from val and test splits
    print("\nEvaluating Category 1: Seen piece sets (A-H)...")
    seen_records = []
    
    val_meta_path = os.path.join(args.meta_dir, "val_metadata.jsonl")
    if os.path.exists(val_meta_path):
        with open(val_meta_path, "r", encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                if not r.get("augmented", False) and r.get("piece_set") in ["A", "B", "C", "D", "E", "F", "G", "H"]:
                    seen_records.append(r)
                    
    test_meta_path = os.path.join(args.meta_dir, "test_metadata.jsonl")
    if os.path.exists(test_meta_path):
        with open(test_meta_path, "r", encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                if not r.get("augmented", False) and r.get("piece_set") in ["A", "B", "C", "D", "E", "F", "G", "H"]:
                    seen_records.append(r)
                    
    if seen_records:
        sq_acc, fen_acc = evaluate_records(seen_records[:200], bin_model, piece_model) # Limit eval to 200 for speed
        print(f"  Square accuracy: {sq_acc:.2f}%, FEN accuracy: {fen_acc:.2f}%")
    else:
        print("  No records found for seen piece sets.")

    # 2. Unseen validation piece sets (I-J)
    print("Evaluating Category 2: Unseen validation piece sets (I-J)...")
    unseen_val_records = []
    if os.path.exists(val_meta_path):
        with open(val_meta_path, "r", encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                if not r.get("augmented", False) and r.get("piece_set") in ["I", "J"]:
                    unseen_val_records.append(r)
    if unseen_val_records:
        sq_acc, fen_acc = evaluate_records(unseen_val_records, bin_model, piece_model)
        print(f"  Square accuracy: {sq_acc:.2f}%, FEN accuracy: {fen_acc:.2f}%")
    else:
        print("  No records found for unseen validation piece sets.")

    # 3. Unseen test piece sets (K-L)
    print("Evaluating Category 3: Unseen test piece sets (K-L)...")
    unseen_test_records = []
    if os.path.exists(test_meta_path):
        with open(test_meta_path, "r", encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                if not r.get("augmented", False) and r.get("piece_set") in ["K", "L"]:
                    unseen_test_records.append(r)
    if unseen_test_records:
        sq_acc, fen_acc = evaluate_records(unseen_test_records, bin_model, piece_model)
        print(f"  Square accuracy: {sq_acc:.2f}%, FEN accuracy: {fen_acc:.2f}%")
    else:
        print("  No records found for unseen test piece sets.")

    # Load manifest for independent and augmented groups
    manifest = None
    if os.path.exists(args.manifest):
        with open(args.manifest, "r", encoding="utf-8") as f:
            manifest = json.load(f)
            
    if manifest:
        # Category 4: Independent screenshots
        print("Evaluating Category 4: Independent screenshots...")
        ind_records = []
        for c in manifest["cases"]:
            if c["category"] == "real-independent":
                c["image_path"] = os.path.join(os.path.dirname(args.manifest), c["file"])
                ind_records.append(c)
        sq_acc, fen_acc = evaluate_records(ind_records, bin_model, piece_model)
        print(f"  Square accuracy: {sq_acc:.2f}%, FEN accuracy: {fen_acc:.2f}%")
        
        # Category 5: Augmented regression fixtures
        print("Evaluating Category 5: Augmented regression fixtures...")
        aug_records = []
        for c in manifest["cases"]:
            if c["category"] == "augmented-transformed":
                c["image_path"] = os.path.join(os.path.dirname(args.manifest), c["file"])
                aug_records.append(c)
        sq_acc, fen_acc = evaluate_records(aug_records, bin_model, piece_model)
        print(f"  Square accuracy: {sq_acc:.2f}%, FEN accuracy: {fen_acc:.2f}%")
    else:
        print("Manifest not found, skipping category 4 & 5 evaluations.")

if __name__ == "__main__":
    main()
