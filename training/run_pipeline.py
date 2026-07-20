import os
import sys
import subprocess

def run_step(script_name, args=[]):
    print(f"\n>>> Running step: {script_name} {' '.join(args)} ...")
    python_exe = sys.executable
    script_path = os.path.join("training", script_name)
    
    cmd = [python_exe, script_path] + args
    res = subprocess.run(cmd)
    if res.returncode != 0:
        print(f"Error: Step {script_name} failed with exit code {res.returncode}")
        sys.exit(res.returncode)
    print(f"Step {script_name} completed successfully.")

def main():
    print("====================================================")
    # Chess OCR Model Training Pipeline
    print("STARTING CHESS OCR MODEL TRAINING PIPELINE")
    print("====================================================")
    
    # Step 1: Download positions from Hugging Face
    run_step("download_positions.py")
    
    # Step 2: Validate FENs with python-chess
    run_step("validate_positions.py")
    
    # Step 3: Classify, balance and sample positions
    run_step("sample_positions.py")
    
    # Step 4: Split dataset stably by game_id/placement
    run_step("split_dataset.py")
    
    # Step 5: Render visually diverse clean boards (2 variants per FEN)
    run_step("render_boards.py")
    
    # Step 6: Apply realistic image augmentations
    run_step("augment_images.py")
    
    # Step 7: Train Stage A Model (Empty vs Occupied)
    run_step("train_occupancy.py")
    
    # Step 8: Train Stage B Model (12-class pieces with Grayscale vs RGB comparison)
    run_step("train_pieces.py")
    
    # Step 9: Export combined functional model to TFJS GraphModel with metadata
    run_step("export_tfjs.py")
    
    # Step 10: Run Python-side TFJS parity validation
    run_step("parity_check.py")
    
    print("\n====================================================")
    print("ALL TRAINING PIPELINE STEPS COMPLETED SUCCESSFULLY!")
    print("====================================================")
    print("Next steps:")
    print("1. Compare the new model on the benchmark using:")
    print("   npm run benchmark:ocr")
    print("2. If the new model wins, integrate it into the production path using:")
    print("   powershell scripts/integrate-new-model.ps1")

if __name__ == "__main__":
    main()
