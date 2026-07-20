import os
import json
import chess
import random
import argparse
from collections import Counter

def detect_category(fen: str, source: str) -> str:
    board = chess.Board(fen)
    
    # 1. Check sparse
    total_pieces = sum(len(board.pieces(pt, color)) for pt in chess.PIECE_TYPES for color in chess.COLORS)
    if total_pieces <= 6:
        return "sparse"
        
    # 2. Check promotion / unusual-material
    # e.g., standard: 1 Q, 2 R, 2 B, 2 N per side
    for color in chess.COLORS:
        queens = len(board.pieces(chess.QUEEN, color))
        rooks = len(board.pieces(chess.ROOK, color))
        bishops = len(board.pieces(chess.BISHOP, color))
        knights = len(board.pieces(chess.KNIGHT, color))
        if queens > 1 or rooks > 2 or bishops > 2 or knights > 2:
            return "promotion"
            
    # 3. Check puzzle source
    if source == "Lichess/chess-puzzles":
        return "puzzle"
        
    # Standard phase calculation based on material
    # Queen = 9, Rook = 5, Bishop = 3, Knight = 3
    non_pawn_material = 0
    queens_count = 0
    for color in chess.COLORS:
        queens_count += len(board.pieces(chess.QUEEN, color))
        non_pawn_material += len(board.pieces(chess.ROOK, color)) * 5
        non_pawn_material += len(board.pieces(chess.BISHOP, color)) * 3
        non_pawn_material += len(board.pieces(chess.KNIGHT, color)) * 3
        
    # 4. Opening
    # Move number is low (fullmove_number <= 8) and most pieces on board
    if board.fullmove_number <= 8 and non_pawn_material >= 28:
        return "opening"
        
    # 5. Endgame
    # Total non-pawn material is low, or no queens and non-pawn material is moderate
    if non_pawn_material <= 12 or (queens_count == 0 and non_pawn_material <= 22):
        return "endgame"
        
    # 6. Middlegame (default)
    return "middlegame"

def main():
    parser = argparse.ArgumentParser(description="Classify and balance the positions dataset.")
    parser.add_argument("--in-file", type=str, default="data/validated_positions.jsonl", help="Input validated positions")
    parser.add_argument("--out-file", type=str, default="data/sampled_positions.jsonl", help="Output sampled positions")
    parser.add_argument("--limit", type=int, default=50000, help="Total target sample size")
    args = parser.parse_args()

    if not os.path.exists(args.in_file):
        print(f"Error: {args.in_file} does not exist.")
        return
        
    # Group by category
    categories = {
        "opening": [],
        "middlegame": [],
        "endgame": [],
        "puzzle": [],
        "promotion": [],
        "sparse": []
    }
    
    total_count = 0
    with open(args.in_file, "r", encoding="utf-8") as f:
        for line in f:
            item = json.loads(line)
            cat = detect_category(item["fen"], item.get("source", ""))
            item["category"] = cat
            categories[cat].append(item)
            total_count += 1
            
    print(f"Total validated positions: {total_count}")
    for cat, items in categories.items():
        print(f"  {cat}: {len(items)}")

    # Target distribution:
    # opening: 20%, middlegame: 40%, endgame: 20%, puzzle: 10%, promotion: 5%, sparse: 5%
    targets = {
        "opening": int(args.limit * 0.20),
        "middlegame": int(args.limit * 0.40),
        "endgame": int(args.limit * 0.20),
        "puzzle": int(args.limit * 0.10),
        "promotion": int(args.limit * 0.05),
        "sparse": int(args.limit * 0.05)
    }

    sampled_list = []
    
    # Random selection with replacement or safety clamp
    random.seed(42)
    for cat, target in targets.items():
        items = categories[cat]
        if not items:
            print(f"Warning: Category '{cat}' is empty, skipping.")
            continue
        
        # Sample with replacement if target is larger than available items
        if len(items) < target:
            # Replicate items with a warning or reuse
            sampled = random.choices(items, k=target)
        else:
            sampled = random.sample(items, target)
            
        sampled_list.extend(sampled)
        print(f"Sampled {len(sampled)} items for category '{cat}'")

    # Shuffle the final balanced list
    random.shuffle(sampled_list)

    with open(args.out_file, "w", encoding="utf-8") as out:
        for item in sampled_list:
            out.write(json.dumps(item) + "\n")
            
    print(f"Successfully balanced and saved {len(sampled_list)} positions to {args.out_file}")

if __name__ == "__main__":
    main()
