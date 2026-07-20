import os
import json
import random
import argparse
import io
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from concurrent.futures import ProcessPoolExecutor

def adjust_color_temp(img, temp_factor):
    # temp_factor > 1.0 is warmer, < 1.0 is cooler
    r, g, b = img.split()
    r = r.point(lambda p: min(255, int(p * temp_factor)))
    b = b.point(lambda p: min(255, int(p * (2.0 - temp_factor))))
    return Image.merge("RGB", (r, g, b))

def apply_augmentations(img, seed_val):
    random.seed(seed_val)
    width, height = img.size
    
    # 1. Mild rotation (up to 2 degrees)
    angle = random.uniform(-2.0, 2.0)
    # Rotate with background fill color similar to theme background
    img = img.rotate(angle, resample=Image.BILINEAR, expand=False, fillcolor=(20, 20, 20))
    
    # 2. Shift / crop error (1 to 3 pixels)
    dx = random.randint(-3, 3)
    dy = random.randint(-3, 3)
    cropped = img.crop((max(0, dx), max(0, dy), min(width, width + dx), min(height, height + dy)))
    img = cropped.resize((width, height), Image.BILINEAR)
    
    # 3. Random contrast
    if random.random() < 0.6:
        enh = ImageEnhance.Contrast(img)
        img = enh.enhance(random.uniform(0.75, 1.25))
        
    # 4. Random brightness
    if random.random() < 0.6:
        enh = ImageEnhance.Brightness(img)
        img = enh.enhance(random.uniform(0.75, 1.25))
        
    # 5. Mild sharpening
    if random.random() < 0.3:
        enh = ImageEnhance.Sharpness(img)
        img = enh.enhance(random.uniform(1.0, 1.5))
        
    # 6. Color-temperature variation
    if random.random() < 0.4:
        temp_factor = random.uniform(0.9, 1.1)
        img = adjust_color_temp(img, temp_factor)

    # 7. Surrounding panels simulation
    if random.random() < 0.3:
        # Paste the board onto a slightly larger background panel (adds margin/sidebars)
        panel_w = int(width * random.uniform(1.05, 1.15))
        panel_h = int(height * random.uniform(1.05, 1.15))
        panel = Image.new("RGB", (panel_w, panel_h), color=(random.randint(10, 40), random.randint(10, 40), random.randint(10, 40)))
        px = (panel_w - width) // 2
        py = (panel_h - height) // 2
        panel.paste(img, (px, py))
        img = panel.resize((width, height), Image.BILINEAR)

    # 8. WebP / JPEG compression simulation (in-memory via BytesIO)
    comp_type = random.choice(["jpeg", "webp", "none"])
    if comp_type == "jpeg":
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=random.randint(40, 85))
        buf.seek(0)
        img = Image.open(buf)
        img.load()
    elif comp_type == "webp":
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=random.randint(40, 85))
        buf.seek(0)
        img = Image.open(buf)
        img.load()
                
    return img

def process_single_record(args):
    idx, r, split, out_dir, seed_val = args
    img_path = r["image_path"]
    if not os.path.exists(img_path):
        return None
        
    try:
        img = Image.open(img_path)
        aug_img = apply_augmentations(img, seed_val)
        
        aug_filename = f"{split}_{idx}_aug.png"
        aug_path = os.path.join(out_dir, aug_filename)
        aug_img.save(aug_path)
        
        # Construct augmented metadata
        aug_r = r.copy()
        aug_r["image_path"] = aug_path.replace("\\", "/")
        aug_r["augmented"] = True
        return aug_r
    except Exception as e:
        print(f"Error processing {img_path}: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description="Augment rendered clean images in parallel.")
    parser.add_argument("--split-dir", type=str, default="data", help="Directory with split metadata files")
    parser.add_argument("--out-dir", type=str, default="data/images/augmented", help="Directory for augmented images")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    splits = ["train", "val", "test"]
    
    for split in splits:
        meta_path = os.path.join(args.split_dir, f"{split}_metadata.jsonl")
        if not os.path.exists(meta_path):
            continue
            
        clean_records = []
        with open(meta_path, "r", encoding="utf-8") as f:
            for line in f:
                clean_records.append(json.loads(line))
                
        print(f"Augmenting {split} split in parallel (total clean: {len(clean_records)})...")
        
        # Prepare task arguments
        # Use a reproducible but changing seed per record
        task_args = []
        for idx, r in enumerate(clean_records):
            # Seed base
            seed_val = 42 + idx + (1000000 if split == "val" else 2000000 if split == "test" else 0)
            task_args.append((idx, r, split, args.out_dir, seed_val))
            
        augmented_records = []
        # Use ProcessPoolExecutor to speed up image generation
        with ProcessPoolExecutor() as executor:
            # Map returns results in order
            for aug_r in executor.map(process_single_record, task_args, chunksize=100):
                if aug_r is not None:
                    augmented_records.append(aug_r)
                    
        # Append augmented records to the same split metadata file
        with open(meta_path, "w", encoding="utf-8") as out:
            # First write all clean records
            for r in clean_records:
                out.write(json.dumps(r) + "\n")
            # Then write all augmented records
            for r in augmented_records:
                out.write(json.dumps(r) + "\n")
                
        print(f"Appended {len(augmented_records)} augmented records to {meta_path}")

if __name__ == "__main__":
    main()
