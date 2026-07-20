import os
from PIL import Image, ImageDraw, ImageFont

GLYPHS = {
    'wk': '♔', 'wq': '♕', 'wr': '♖', 'wb': '♗', 'wn': '♘', 'wp': '♙',
    'bk': '♚', 'bq': '♛', 'br': '♜', 'bb': '♝', 'bn': '♞', 'bp': '♟'
}

CLASSES = [
    'empty', 'wk', 'wq', 'wr', 'wb', 'wn', 'wp',
    'bk', 'bq', 'br', 'bb', 'bn', 'bp'
]

def main():
    # Root directory path relative to training/
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, "tests", "ocr-benchmark", "images", "diagnostic_tiles")
    os.makedirs(out_dir, exist_ok=True)
    
    font_path = "C:\\Windows\\Fonts\\seguisym.ttf"
    tile_size = 32
    bg_color = '#f0d9b5'
    
    piece_font = ImageFont.truetype(font_path, int(tile_size * 0.74))
    
    for cls in CLASSES:
        img = Image.new('RGB', (tile_size, tile_size), bg_color)
        draw = ImageDraw.Draw(img)
        
        if cls != 'empty':
            px = int(tile_size * 0.12)
            py = int(tile_size * 0.05)
            is_white = cls.startswith('w')
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
                GLYPHS[cls],
                fill=fill_color,
                font=piece_font,
                stroke_width=stroke_w,
                stroke_fill=stroke_color
            )
            
        out_path = os.path.join(out_dir, f"{cls}.png")
        img.save(out_path, format="PNG")
        print(f"Generated: {out_path}")

if __name__ == "__main__":
    main()
