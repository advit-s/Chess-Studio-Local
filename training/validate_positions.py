import os
import json
import io
import chess
import chess.pgn
import argparse

def validate_fen(fen: str) -> chess.Board | None:
    try:
        board = chess.Board(fen)
    except ValueError:
        return None
    if not board.is_valid():
        return None
    return board

def process_game(pgn_str: str, game_id: str):
    positions = []
    pgn_io = io.StringIO(pgn_str)
    game = chess.pgn.read_game(pgn_io)
    if game is None:
        return positions
        
    board = game.board()
    ply = 0
    # Capture state throughout game
    for move in game.mainline_moves():
        board.push(move)
        ply += 1
        # Extract at regular intervals (e.g. every 5 moves to avoid high similarity)
        if ply % 5 == 0:
            fen = board.fen()
            valid_b = validate_fen(fen)
            if valid_b:
                positions.append({
                    "fen": fen,
                    "source_game_id": game_id,
                    "source_ply": ply,
                    "source": "Lichess/standard-chess-games"
                })
    return positions

def main():
    parser = argparse.ArgumentParser(description="Validate FENs and reconstruct positions from games.")
    parser.add_argument("--in-dir", type=str, default="data/raw", help="Directory with raw files")
    parser.add_argument("--out-file", type=str, default="data/validated_positions.jsonl", help="Output validated positions file")
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.out_file), exist_ok=True)
    
    validated_list = []
    
    # 1. Validate evaluations
    evals_path = os.path.join(args.in_dir, "evals_raw.jsonl")
    if os.path.exists(evals_path):
        print("Validating raw evaluations...")
        with open(evals_path, "r", encoding="utf-8") as f:
            for line in f:
                item = json.loads(line)
                if validate_fen(item["fen"]):
                    validated_list.append({
                        "fen": item["fen"],
                        "source": item["source"],
                        "source_record_id": item["id"]
                    })
                    
    # 2. Validate puzzles
    puzzles_path = os.path.join(args.in_dir, "puzzles_raw.jsonl")
    if os.path.exists(puzzles_path):
        print("Validating raw puzzles...")
        with open(puzzles_path, "r", encoding="utf-8") as f:
            for line in f:
                item = json.loads(line)
                if validate_fen(item["fen"]):
                    validated_list.append({
                        "fen": item["fen"],
                        "source": item["source"],
                        "source_record_id": item["puzzle_id"]
                    })
                    
    # 3. Process games
    games_path = os.path.join(args.in_dir, "games_raw.jsonl")
    if os.path.exists(games_path):
        print("Replaying raw games and extracting FENs...")
        with open(games_path, "r", encoding="utf-8") as f:
            for line in f:
                item = json.loads(line)
                game_pos = process_game(item["pgn"], item["game_id"])
                validated_list.extend(game_pos)

    # Deduplicate and enrich
    print("Deduplicating and writing validated records...")
    seen_piece_placement = set()
    written_count = 0
    
    with open(args.out_file, "w", encoding="utf-8") as out:
        for item in validated_list:
            fen = item["fen"]
            # piece placement is first field of FEN
            piece_placement = fen.split()[0]
            if piece_placement not in seen_piece_placement:
                seen_piece_placement.add(piece_placement)
                
                item["piece_placement"] = piece_placement
                out.write(json.dumps(item) + "\n")
                written_count += 1
                
    print(f"Validated and deduplicated {written_count} unique positions. Saved to {args.out_file}")

if __name__ == "__main__":
    main()
