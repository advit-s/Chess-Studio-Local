import os
import json
from PIL import Image, ImageDraw, ImageFont

# Define themes
THEMES = {
    'classic': {'light': '#f0d9b5', 'dark': '#b58863', 'bg': '#1e1e1e', 'coord_light': '#b58863', 'coord_dark': '#f0d9b5'},
    'slate': {'light': '#efe7e4', 'dark': '#a09c99', 'bg': '#161512', 'coord_light': '#a09c99', 'coord_dark': '#efe7e4'},
    'wood': {'light': '#e9d3b4', 'dark': '#8b5a2b', 'bg': '#121212', 'coord_light': '#8b5a2b', 'coord_dark': '#e9d3b4'}
}

GLYPHS = {
    'wk': '♔', 'wq': '♕', 'wr': '♖', 'wb': '♗', 'wn': '♘', 'wp': '♙',
    'bk': '♚', 'bq': '♛', 'br': '♜', 'bb': '♝', 'bn': '♞', 'bp': '♟'
}

# The 13 model class labels
PIECE_TO_CLASS = {
    'K': 'wk', 'Q': 'wq', 'R': 'wr', 'B': 'wb', 'N': 'wn', 'P': 'wp',
    'k': 'bk', 'q': 'bq', 'r': 'br', 'b': 'bb', 'n': 'bn', 'p': 'bp'
}

def parse_board_fen(fen):
    rows = fen.split('/')
    grid = []
    for row in rows:
        for char in row:
            if char.isdigit():
                grid.extend(['empty'] * int(char))
            else:
                grid.append(PIECE_TO_CLASS[char])
    return grid

FIXTURES = [
    {
        'id': 'independent-mobile-slate-coord-white',
        'file': 'independent-mobile-slate-coord-white.png',
        'width': 390,
        'height': 844,
        'board_size': 360,
        'board_x': 15,
        'board_y': 242,
        'theme': 'slate',
        'font_path': 'C:\\Windows\\Fonts\\seguisym.ttf',
        'orientation': 'white',
        'coordinates': True,
        'fen': 'r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R',
        'tags': ['independent', 'mobile', 'slate-theme', 'coordinates', 'white-orientation']
    },
    {
        'id': 'independent-desktop-wood-nocoord-black',
        'file': 'independent-desktop-wood-nocoord-black.png',
        'width': 1280,
        'height': 720,
        'board_size': 560,
        'board_x': 80,
        'board_y': 80,
        'theme': 'wood',
        'font_path': 'C:\\Windows\\Fonts\\msgothic.ttc',
        'orientation': 'black',
        'coordinates': False,
        'fen': 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR',
        'tags': ['independent', 'desktop', 'wood-theme', 'no-coordinates', 'black-orientation']
    },
    {
        'id': 'independent-mobile-classic-nocoord-black',
        'file': 'independent-mobile-classic-nocoord-black.png',
        'width': 390,
        'height': 844,
        'board_size': 360,
        'board_x': 15,
        'board_y': 242,
        'theme': 'classic',
        'font_path': 'C:\\Windows\\Fonts\\seguisym.ttf',
        'orientation': 'black',
        'coordinates': False,
        'fen': 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR',
        'tags': ['independent', 'mobile', 'classic-theme', 'no-coordinates', 'black-orientation']
    },
    {
        'id': 'independent-desktop-slate-coord-white',
        'file': 'independent-desktop-slate-coord-white.png',
        'width': 1280,
        'height': 720,
        'board_size': 560,
        'board_x': 80,
        'board_y': 80,
        'theme': 'slate',
        'font_path': 'C:\\Windows\\Fonts\\msgothic.ttc',
        'orientation': 'white',
        'coordinates': True,
        'fen': 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
        'tags': ['independent', 'desktop', 'slate-theme', 'coordinates', 'white-orientation']
    },
    {
        'id': 'independent-mobile-wood-coord-black',
        'file': 'independent-mobile-wood-coord-black.png',
        'width': 390,
        'height': 844,
        'board_size': 360,
        'board_x': 15,
        'board_y': 242,
        'theme': 'wood',
        'font_path': 'C:\\Windows\\Fonts\\seguisym.ttf',
        'orientation': 'black',
        'coordinates': True,
        'fen': 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR',
        'tags': ['independent', 'mobile', 'wood-theme', 'coordinates', 'black-orientation']
    },
    {
        'id': 'independent-desktop-classic-nocoord-white',
        'file': 'independent-desktop-classic-nocoord-white.png',
        'width': 1280,
        'height': 720,
        'board_size': 560,
        'board_x': 80,
        'board_y': 80,
        'theme': 'classic',
        'font_path': 'C:\\Windows\\Fonts\\seguisym.ttf',
        'orientation': 'white',
        'coordinates': False,
        'fen': 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R',
        'tags': ['independent', 'desktop', 'classic-theme', 'no-coordinates', 'white-orientation']
    }
]

def draw_fixture(f):
    img = Image.new('RGB', (f['width'], f['height']), THEMES[f['theme']]['bg'])
    draw = ImageDraw.Draw(img)
    
    board_size = f['board_size']
    tile_size = board_size // 8
    board_x = f['board_x']
    board_y = f['board_y']
    theme = THEMES[f['theme']]
    
    # Draw board
    for row in range(8):
        for col in range(8):
            x1 = board_x + col * tile_size
            y1 = board_y + row * tile_size
            x2 = x1 + tile_size
            y2 = y1 + tile_size
            
            color = theme['light'] if (row + col) % 2 == 0 else theme['dark']
            draw.rectangle([x1, y1, x2, y2], fill=color)
            
    # Draw coordinates inside if enabled
    if f['coordinates']:
        coord_font = ImageFont.truetype(f['font_path'], int(tile_size * 0.15))
        for i in range(8):
            # Rank numbers 1-8 on the rightmost column of squares
            x_num = board_x + 7 * tile_size + int(tile_size * 0.8)
            y_num = board_y + i * tile_size + int(tile_size * 0.15)
            
            # File letters a-h on the bottom row of squares
            x_let = board_x + i * tile_size + int(tile_size * 0.1)
            y_let = board_y + 7 * tile_size + int(tile_size * 0.8)
            
            is_light_square_num = (i + 7) % 2 == 0
            is_light_square_let = (7 + i) % 2 == 0
            
            color_num = theme['coord_light'] if is_light_square_num else theme['coord_dark']
            color_let = theme['coord_light'] if is_light_square_let else theme['coord_dark']
            
            if f['orientation'] == 'white':
                num_label = str(8 - i)
                let_label = chr(97 + i)
            else:
                num_label = str(i + 1)
                let_label = chr(104 - i)
                
            draw.text((x_num, y_num), num_label, fill=color_num, font=coord_font)
            draw.text((x_let, y_let), let_label, fill=color_let, font=coord_font)

    # Draw pieces
    piece_font = ImageFont.truetype(f['font_path'], int(tile_size * 0.72))
    grid = parse_board_fen(f['fen'])
    
    # Grid contains 64 items. Depending on orientation, they are mapped
    display_grid = grid if f['orientation'] == 'white' else list(reversed(grid))
    
    for index in range(64):
        piece = display_grid[index]
        if piece == 'empty':
            continue
            
        row = index // 8
        col = index % 8
        
        # Center the piece glyph in the square
        x = board_x + col * tile_size + int(tile_size * 0.12)
        y = board_y + row * tile_size + int(tile_size * 0.05)
        
        is_white = piece.startswith('w')
        glyph = GLYPHS[piece]
        fill_color = '#ffffff' if is_white else '#050505'
        
        draw.text((x, y), glyph, fill=fill_color, font=piece_font)

    output_dir = 'tests/ocr-benchmark/images'
    os.makedirs(output_dir, exist_ok=True)
    img.save(os.path.join(output_dir, f['file']))
    print(f"Generated {f['file']}")

if __name__ == '__main__':
    for f in FIXTURES:
        draw_fixture(f)
