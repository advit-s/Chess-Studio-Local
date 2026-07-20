import os
import json
import random
import argparse
from PIL import Image, ImageDraw, ImageFont
from concurrent.futures import ProcessPoolExecutor

# Define themes (at least 10, total 11)
THEMES = {
    'classic': {'light': '#f0d9b5', 'dark': '#b58863', 'bg': '#1e1e1e', 'coord_light': '#b58863', 'coord_dark': '#f0d9b5'},
    'slate': {'light': '#efe7e4', 'dark': '#a09c99', 'bg': '#161512', 'coord_light': '#a09c99', 'coord_dark': '#efe7e4'},
    'wood': {'light': '#e9d3b4', 'dark': '#8b5a2b', 'bg': '#121212', 'coord_light': '#8b5a2b', 'coord_dark': '#e9d3b4'},
    'ocean': {'light': '#e2e4e6', 'dark': '#4b7399', 'bg': '#14171a', 'coord_light': '#4b7399', 'coord_dark': '#e2e4e6'},
    'green': {'light': '#eeeed2', 'dark': '#769656', 'bg': '#191b1d', 'coord_light': '#769656', 'coord_dark': '#eeeed2'},
    'ice': {'light': '#e8f1f5', 'dark': '#b3cde3', 'bg': '#0f172a', 'coord_light': '#b3cde3', 'coord_dark': '#e8f1f5'},
    'forest': {'light': '#efebe9', 'dark': '#4e342e', 'bg': '#1c1917', 'coord_light': '#4e342e', 'coord_dark': '#efebe9'},
    'cherry': {'light': '#fce4ec', 'dark': '#c2185b', 'bg': '#2d0614', 'coord_light': '#c2185b', 'coord_dark': '#fce4ec'},
    'sunset': {'light': '#ffe0b2', 'dark': '#e65100', 'bg': '#2e0f00', 'coord_light': '#e65100', 'coord_dark': '#ffe0b2'},
    'platinum': {'light': '#f5f5f5', 'dark': '#9e9e9e', 'bg': '#212121', 'coord_light': '#9e9e9e', 'coord_dark': '#f5f5f5'},
    'charcoal': {'light': '#d6d6d6', 'dark': '#424242', 'bg': '#121212', 'coord_light': '#424242', 'coord_dark': '#d6d6d6'}
}

HOLLOW_GLYPHS = {
    'wk': '♔', 'wq': '♕', 'wr': '♖', 'wb': '♗', 'wn': '♘', 'wp': '♙',
    'bk': '♚', 'bq': '♛', 'br': '♜', 'bb': '♝', 'bn': '♞', 'bp': '♟'
}
SOLID_GLYPHS = {
    'wk': '♚', 'wq': '♛', 'wr': '♜', 'wb': '♝', 'wn': '♞', 'wp': '♟',
    'bk': '♚', 'bq': '♛', 'br': '♜', 'bb': '♝', 'bn': '♞', 'bp': '♟'
}

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

def render_board(fen, orientation, font_path, theme_name, coordinates, border, render_width, use_solid=True, use_stroke=True):
    height = render_width
    theme = THEMES[theme_name]
    
    img = Image.new('RGB', (render_width, height), theme['bg'])
    draw = ImageDraw.Draw(img)
    
    board_size = render_width - 32 if border else render_width
    tile_size = board_size // 8
    
    bx = (render_width - board_size) // 2
    by = (height - board_size) // 2
    
    # Draw squares
    for row in range(8):
        for col in range(8):
            x1 = bx + col * tile_size
            y1 = by + row * tile_size
            color = theme['light'] if (row + col) % 2 == 0 else theme['dark']
            draw.rectangle([x1, y1, x1 + tile_size, y1 + tile_size], fill=color)
            
    # Draw coordinates if enabled
    if coordinates:
        coord_font = ImageFont.truetype(font_path, int(tile_size * 0.16))
        for i in range(8):
            x_num = bx + 7 * tile_size + int(tile_size * 0.8)
            y_num = by + i * tile_size + int(tile_size * 0.15)
            
            x_let = bx + i * tile_size + int(tile_size * 0.1)
            y_let = by + 7 * tile_size + int(tile_size * 0.8)
            
            is_light_square_num = (i + 7) % 2 == 0
            is_light_square_let = (7 + i) % 2 == 0
            
            color_num = theme['coord_light'] if is_light_square_num else theme['coord_dark']
            color_let = theme['coord_light'] if is_light_square_let else theme['coord_dark']
            
            if orientation == 'white':
                num_label = str(8 - i)
                let_label = chr(97 + i)
            else:
                num_label = str(i + 1)
                let_label = chr(104 - i)
                
            draw.text((x_num, y_num), num_label, fill=color_num, font=coord_font)
            draw.text((x_let, y_let), let_label, fill=color_let, font=coord_font)

    # Draw pieces
    piece_font = ImageFont.truetype(font_path, int(tile_size * 0.74))
    grid = parse_board_fen(fen)
    display_grid = grid if orientation == 'white' else list(reversed(grid))
    
    for index in range(64):
        piece = display_grid[index]
        if piece == 'empty':
            continue
        row = index // 8
        col = index % 8
        
        px = bx + col * tile_size + int(tile_size * 0.12)
        py = by + row * tile_size + int(tile_size * 0.05)
        
        is_white = piece.startswith('w')
        glyph = SOLID_GLYPHS[piece] if use_solid else HOLLOW_GLYPHS[piece]
        
        if use_stroke:
            if is_white:
                fill_color = '#ffffff'
                stroke_color = '#111111'
                stroke_w = max(1, int(tile_size * 0.02))
            else:
                fill_color = '#111111'
                stroke_color = '#f2f2f2'
                stroke_w = max(1, int(tile_size * 0.01))
                
            draw.text(
                (px, py),
                glyph,
                fill=fill_color,
                font=piece_font,
                stroke_width=stroke_w,
                stroke_fill=stroke_color
            )
        else:
            fill_color = '#ffffff' if is_white else '#0b0b0b'
            draw.text((px, py), glyph, fill=fill_color, font=piece_font)
            
    return img

def process_single_position(args_tuple):
    idx, r, split, out_dir, fonts_dict, themes_keys = args_tuple
    
    # Set seed based on idx and split for perfect reproducibility
    random.seed(idx + (12345 if split == "val" else 54321 if split == "test" else 0))
    
    results = []
    for var_idx in range(2):
        theme = random.choice(themes_keys)
        width = random.choice([256, 384, 512, 640])
        
        if split == "train":
            p_set = random.choice(["A", "B", "C", "D", "E", "F", "G", "H"])
            orientation = "white" if var_idx == 0 else "black"
            coordinates = True if var_idx == 0 else False
            border = True if var_idx == 0 else False
        elif split == "val":
            p_set = random.choice(["A", "B", "C", "D", "E", "F", "G", "H"]) if var_idx == 0 else random.choice(["I", "J"])
            orientation = random.choice(["white", "black"])
            coordinates = random.choice([True, False])
            border = random.choice([True, False])
        else: # test split
            p_set = random.choice(["A", "B", "C", "D", "E", "F", "G", "H"]) if var_idx == 0 else random.choice(["K", "L"])
            orientation = random.choice(["white", "black"])
            coordinates = random.choice([True, False])
            border = random.choice([True, False])
            
        font_path = fonts_dict[p_set]
        
        # Render:
        # var_idx == 0: solid pieces, use_stroke = True
        # var_idx == 1: hollow pieces, use_stroke = False
        use_solid = (var_idx == 0)
        use_stroke = (var_idx == 0)
        img = render_board(r["fen"], orientation, font_path, theme, coordinates, border, width, use_solid=use_solid, use_stroke=use_stroke)
        
        # Save image
        img_filename = f"{split}_{idx}_{var_idx}.png"
        img_path = os.path.join(out_dir, img_filename)
        img.save(img_path)
        
        # Construct metadata
        meta = {
            "image_path": img_path.replace("\\", "/"),
            "full_fen": r["fen"],
            "piece_placement": r["piece_placement"],
            "orientation": orientation,
            "source_dataset": r.get("source", "unknown"),
            "source_record_id": str(r.get("source_record_id", "")),
            "source_game_id": str(r.get("source_game_id", "")),
            "source_ply": r.get("source_ply", 0) if r.get("source_ply") is not None else 0,
            "piece_set": p_set,
            "board_theme": theme,
            "coordinates": coordinates,
            "render_width": width,
            "position_category": r["category"],
            "split": split
        }
        results.append(meta)
    return results

def main():
    parser = argparse.ArgumentParser(description="Render boards from splits in parallel.")
    parser.add_argument("--split-dir", type=str, default="data", help="Directory with split files")
    parser.add_argument("--out-dir", type=str, default="data/images/clean", help="Directory for images")
    parser.add_argument("--limit-render", type=int, default=50000, help="Limit number of positions to render")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    
    # Fonts map to pre-installed Windows fonts
    fonts = {
        "A": "C:\\Windows\\Fonts\\seguisym.ttf",
        "B": "training/DejaVuSans.ttf",
        "C": "C:\\Windows\\Fonts\\msgothic.ttc",
        "D": "C:\\Windows\\Fonts\\seguisym.ttf",
        "E": "training/DejaVuSans.ttf",
        "F": "C:\\Windows\\Fonts\\msgothic.ttc",
        "G": "C:\\Windows\\Fonts\\seguisym.ttf",
        "H": "training/DejaVuSans.ttf",
        "I": "C:\\Windows\\Fonts\\msgothic.ttc",
        "J": "training/DejaVuSans.ttf",
        "K": "C:\\Windows\\Fonts\\seguisym.ttf",
        "L": "C:\\Windows\\Fonts\\msgothic.ttc"
    }
    
    themes_keys = list(THEMES.keys())
    splits = ["train", "val", "test"]
    
    for split in splits:
        split_path = os.path.join(args.split_dir, f"{split}_split.jsonl")
        if not os.path.exists(split_path):
            continue
            
        records = []
        with open(split_path, "r", encoding="utf-8") as f:
            for line in f:
                records.append(json.loads(line))
                
        # Trim records to limit
        if len(records) > args.limit_render:
            records = records[:args.limit_render]
            
        print(f"Rendering {split} split in parallel (total positions: {len(records)})...")
        
        # Prepare task arguments
        task_args = []
        for idx, r in enumerate(records):
            task_args.append((idx, r, split, args.out_dir, fonts, themes_keys))
            
        output_metadata = []
        with ProcessPoolExecutor() as executor:
            for result_list in executor.map(process_single_position, task_args, chunksize=100):
                output_metadata.extend(result_list)
            
        # Save split metadata file
        meta_out_path = os.path.join(args.split_dir, f"{split}_metadata.jsonl")
        with open(meta_out_path, "w", encoding="utf-8") as out:
            for item in output_metadata:
                out.write(json.dumps(item) + "\n")
                
        print(f"Saved {len(output_metadata)} renders for {split} split to {meta_out_path}")

if __name__ == "__main__":
    main()
