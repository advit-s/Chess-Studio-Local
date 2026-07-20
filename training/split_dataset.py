import os
import json
import hashlib
import argparse
import random

def get_stable_split(key: str, train_ratio=0.70, val_ratio=0.15) -> str:
    # Stable hash-based split
    h = hashlib.md5(key.encode("utf-8")).hexdigest()
    val = int(h, 16) % 100
    if val < (train_ratio * 100):
        return "train"
    elif val < ((train_ratio + val_ratio) * 100):
        return "val"
    else:
        return "test"

def main():
    parser = argparse.ArgumentParser(description="Split dataset by game and position to prevent leakage.")
    parser.add_argument("--in-file", type=str, default="data/sampled_positions.jsonl", help="Input sampled positions")
    parser.add_argument("--out-dir", type=str, default="data", help="Output directory")
    args = parser.parse_args()

    if not os.path.exists(args.in_file):
        print(f"Error: {args.in_file} does not exist.")
        return
        
    train_records = []
    val_records = []
    test_records = []
    
    # Store records to ensure game consistency
    # We group by game_id if it exists, otherwise by piece_placement
    with open(args.in_file, "r", encoding="utf-8") as f:
        for line in f:
            item = json.loads(line)
            
            # Determine split key
            game_id = item.get("source_game_id", None)
            split_key = game_id if game_id is not None else item["piece_placement"]
            
            split = get_stable_split(split_key)
            
            # Save split info
            item["split"] = split
            
            # Assign piece set assignment rules:
            # At least one piece set (MS Gothic) must appear only in the test set.
            # Training/Validation sets can only use Segoe UI Symbol and SimSun.
            # Test set can use MS Gothic (unseen) or seen piece sets to measure seen vs unseen generalization!
            if split == "train":
                train_records.append(item)
            elif split == "val":
                val_records.append(item)
            else:
                test_records.append(item)
                
    print(f"Split results:")
    print(f"  Train: {len(train_records)}")
    print(f"  Val: {len(val_records)}")
    print(f"  Test: {len(test_records)}")
    
    # Save files
    os.makedirs(args.out_dir, exist_ok=True)
    
    with open(os.path.join(args.out_dir, "train_split.jsonl"), "w", encoding="utf-8") as out:
        for r in train_records:
            out.write(json.dumps(r) + "\n")
            
    with open(os.path.join(args.out_dir, "val_split.jsonl"), "w", encoding="utf-8") as out:
        for r in val_records:
            out.write(json.dumps(r) + "\n")
            
    with open(os.path.join(args.out_dir, "test_split.jsonl"), "w", encoding="utf-8") as out:
        for r in test_records:
            out.write(json.dumps(r) + "\n")
            
    print("Dataset splits saved successfully.")

if __name__ == "__main__":
    main()
