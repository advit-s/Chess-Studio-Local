import os
import json
import argparse
from datasets import load_dataset

def main():
    parser = argparse.ArgumentParser(description="Stream raw chess positions from Hugging Face.")
    parser.add_argument("--limit-evals", type=int, default=60000, help="Number of evaluations to download")
    parser.add_argument("--limit-puzzles", type=int, default=20000, help="Number of puzzles to download")
    parser.add_argument("--limit-games", type=int, default=5000, help="Number of games to download")
    parser.add_argument("--out-dir", type=str, default="data/raw", help="Output directory")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    
    # 1. Broad sample of evaluations
    # Pin exact revision of Lichess/chess-position-evaluations
    evals_revision = "3135c3702b851b427cb17c919d7d4c794017f6b9"
    print(f"Streaming {args.limit_evals} evaluations from Lichess/chess-position-evaluations (rev: {evals_revision})...")
    evals_data = []
    try:
        ds_evals = load_dataset(
            "Lichess/chess-position-evaluations",
            split="train",
            streaming=True,
            revision=evals_revision
        )
        count = 0
        for item in ds_evals:
            evals_data.append({
                "source": "Lichess/chess-position-evaluations",
                "fen": item["fen"],
                "eval": item.get("eval", None),
                "id": f"eval_{count}"
            })
            count += 1
            if count >= args.limit_evals:
                break
    except Exception as e:
        print(f"Error streaming evaluations: {e}")

    # 2. Tactical puzzles
    # Pin exact revision of Lichess/chess-puzzles
    puzzles_revision = "97b69dffc31f478a58a69e46a782e2f3d2831bb2"
    print(f"Streaming {args.limit_puzzles} puzzles from Lichess/chess-puzzles (rev: {puzzles_revision})...")
    puzzles_data = []
    try:
        ds_puzzles = load_dataset(
            "Lichess/chess-puzzles",
            split="train",
            streaming=True,
            revision=puzzles_revision
        )
        count = 0
        for item in ds_puzzles:
            puzzles_data.append({
                "source": "Lichess/chess-puzzles",
                "fen": item["FEN"],
                "puzzle_id": item["PuzzleId"],
                "rating": item.get("Rating", None)
            })
            count += 1
            if count >= args.limit_puzzles:
                break
    except Exception as e:
        print(f"Error streaming puzzles: {e}")

    # 3. Games
    # Pin exact revision of Lichess/standard-chess-games
    games_revision = "7d46536551b689df464975f928e7ee2761895a9e"
    print(f"Streaming {args.limit_games} games from Lichess/standard-chess-games (rev: {games_revision})...")
    games_data = []
    try:
        ds_games = load_dataset(
            "Lichess/standard-chess-games",
            split="train",
            streaming=True,
            revision=games_revision
        )
        count = 0
        for item in ds_games:
            games_data.append({
                "source": "Lichess/standard-chess-games",
                "pgn": item["movetext"],
                "game_id": item.get("Site", f"game_{count}"),
                "white": item.get("White", ""),
                "black": item.get("Black", ""),
                "result": item.get("Result", "")
            })
            count += 1
            if count >= args.limit_games:
                break
    except Exception as e:
        print(f"Error streaming games: {e}")

    # Save outputs
    evals_path = os.path.join(args.out_dir, "evals_raw.jsonl")
    with open(evals_path, "w", encoding="utf-8") as f:
        for item in evals_data:
            f.write(json.dumps(item) + "\n")
    print(f"Saved raw evaluations to {evals_path}")

    puzzles_path = os.path.join(args.out_dir, "puzzles_raw.jsonl")
    with open(puzzles_path, "w", encoding="utf-8") as f:
        for item in puzzles_data:
            f.write(json.dumps(item) + "\n")
    print(f"Saved raw puzzles to {puzzles_path}")

    games_path = os.path.join(args.out_dir, "games_raw.jsonl")
    with open(games_path, "w", encoding="utf-8") as f:
        for item in games_data:
            f.write(json.dumps(item) + "\n")
    print(f"Saved raw games to {games_path}")

if __name__ == "__main__":
    main()
