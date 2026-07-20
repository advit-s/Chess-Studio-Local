import os
import json
import hashlib

MANIFEST_PATH = 'tests/ocr-benchmark/images/manifest.json'
IMAGES_DIR = 'tests/ocr-benchmark/images'

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

def compute_sha256(filepath):
    h = hashlib.sha256()
    with open(filepath, 'rb') as file:
        while True:
            chunk = file.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()

FIXTURES_META = [
    {
        'id': 'independent-mobile-slate-coord-white',
        'file': 'independent-mobile-slate-coord-white.png',
        'width': 390,
        'height': 844,
        'board_size': 360,
        'board_x': 15,
        'board_y': 242,
        'theme': 'slate',
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
        'orientation': 'white',
        'coordinates': False,
        'fen': 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R',
        'tags': ['independent', 'desktop', 'classic-theme', 'no-coordinates', 'white-orientation']
    }
]

def main():
    with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    # Filter out existing independent cases (category 'real-independent')
    new_cases = [c for c in manifest['cases'] if c['category'] != 'real-independent']

    for meta in FIXTURES_META:
        filepath = os.path.join(IMAGES_DIR, meta['file'])
        sha = compute_sha256(filepath)
        
        expected_classes = parse_board_fen(meta['fen'])
        
        # Calculate corners
        bx, by, bsize = meta['board_x'], meta['board_y'], meta['board_size']
        corners = {
            'topLeft': {'x': bx, 'y': by},
            'topRight': {'x': bx + bsize, 'y': by},
            'bottomRight': {'x': bx + bsize, 'y': by + bsize},
            'bottomLeft': {'x': bx, 'y': by + bsize}
        }
        
        new_case = {
            'id': meta['id'],
            'file': meta['file'],
            'category': 'real-independent',
            'source': {
                'description': f"Synthetic {meta['theme']} chess board screenshot simulation on {'mobile' if meta['width'] == 390 else 'desktop'} format",
                'generator': 'scripts/generate-independent-fixtures.py',
                'licence': 'Public domain font and styling',
                'independence': 'independent-real-independent'
            },
            'sha256': sha,
            'expectedCorners': corners,
            'expectedOrientation': meta['orientation'],
            'expectedClasses': expected_classes,
            'expectedBoardFen': meta['fen'],
            'expectedCompleteFen': f"{meta['fen']} w - - 0 1",
            'tags': meta['tags']
        }
        new_cases.append(new_case)

    manifest['cases'] = new_cases

    with open(MANIFEST_PATH, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write('\n')

    print(f"Successfully added {len(FIXTURES_META)} independent test cases to manifest.json.")

if __name__ == '__main__':
    main()
