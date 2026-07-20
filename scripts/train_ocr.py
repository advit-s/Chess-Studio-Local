import os
import json
import random
import hashlib
import numpy as np
import chess
from PIL import Image, ImageDraw, ImageFont, ImageEnhance, ImageFilter
import tensorflow as tf
from tensorflow.keras import layers, models

# Disable GPU to make CPU training stable and deterministic
os.environ['CUDA_VISIBLE_DEVICES'] = '-1'

THEMES = {
    'classic': {'light': '#f0d9b5', 'dark': '#b58863', 'bg': '#1e1e1e'},
    'slate': {'light': '#efe7e4', 'dark': '#a09c99', 'bg': '#161512'},
    'wood': {'light': '#e9d3b4', 'dark': '#8b5a2b', 'bg': '#121212'}
}

GLYPHS = {
    'wk': '♔', 'wq': '♕', 'wr': '♖', 'wb': '♗', 'wn': '♘', 'wp': '♙',
    'bk': '♚', 'bq': '♛', 'br': '♜', 'bb': '♝', 'bn': '♞', 'bp': '♟'
}

CLASSES = [
    'empty', 'wk', 'wq', 'wr', 'wb', 'wn', 'wp',
    'bk', 'bq', 'br', 'bb', 'bn', 'bp'
]

CLASS_MAP = {c: i for i, c in enumerate(CLASSES)}

PIECE_TO_CLASS = {
    'K': 'wk', 'Q': 'wq', 'R': 'wr', 'B': 'wb', 'N': 'wn', 'P': 'wp',
    'k': 'bk', 'q': 'bq', 'r': 'br', 'b': 'bb', 'n': 'bn', 'p': 'bp'
}

def generate_legal_board():
    board = chess.Board()
    # Play random moves
    for _ in range(random.randint(5, 50)):
        if board.is_game_over():
            break
        moves = list(board.legal_moves)
        if not moves:
            break
        board.push(random.choice(moves))
    return board

def board_to_grid(board, orientation):
    grid = []
    # FEN counts rank 8 down to 1
    # We want file-major or row-major depending on orientation
    for row in range(8):
        for col in range(8):
            # Chess coordinates are file a-h (0-7), rank 1-8 (0-7)
            # Row index 0 corresponds to rank 8, col index 0 to file a
            c_file = col if orientation == 'white' else 7 - col
            c_rank = 7 - row if orientation == 'white' else row
            square = chess.square(c_file, c_rank)
            piece = board.piece_at(square)
            if piece is None:
                grid.append('empty')
            else:
                grid.append(PIECE_TO_CLASS[piece.symbol()])
    return grid

def draw_and_augment_board(board_grid, font_path, theme_name, orientation, coordinates):
    # Set size randomly to simulate different screenshots
    width = random.choice([390, 640, 800, 1024])
    height = int(width * random.uniform(1.2, 1.6)) if width == 390 else int(width * random.uniform(0.6, 0.8))
    
    theme = THEMES[theme_name]
    img = Image.new('RGB', (width, height), theme['bg'])
    draw = ImageDraw.Draw(img)
    
    # Position board randomly
    board_size = int(min(width, height) * random.uniform(0.75, 0.92))
    board_size = (board_size // 8) * 8 # align to 8
    tile_size = board_size // 8
    
    bx = random.randint(5, width - board_size - 5)
    by = random.randint(5, height - board_size - 5)
    
    # Draw squares
    for row in range(8):
        for col in range(8):
            x1 = bx + col * tile_size
            y1 = by + row * tile_size
            color = theme['light'] if (row + col) % 2 == 0 else theme['dark']
            draw.rectangle([x1, y1, x1 + tile_size, y1 + tile_size], fill=color)
            
    # Draw pieces
    piece_font = ImageFont.truetype(font_path, int(tile_size * random.uniform(0.68, 0.76)))
    for index in range(64):
        piece = board_grid[index]
        if piece == 'empty':
            continue
        row = index // 8
        col = index % 8
        
        # Center piece glyph
        px = bx + col * tile_size + int(tile_size * random.uniform(0.1, 0.14))
        py = by + row * tile_size + int(tile_size * random.uniform(0.02, 0.08))
        
        is_white = piece.startswith('w')
        fill_color = '#ffffff' if is_white else '#0c0c0c'
        draw.text((px, py), GLYPHS[piece], fill=fill_color, font=piece_font)
        
    # Warp perspective with small random offset on corners (up to 2%)
    max_offset = int(board_size * 0.015)
    dx0 = random.randint(-max_offset, max_offset)
    dy0 = random.randint(-max_offset, max_offset)
    dx1 = random.randint(-max_offset, max_offset)
    dy1 = random.randint(-max_offset, max_offset)
    dx2 = random.randint(-max_offset, max_offset)
    dy2 = random.randint(-max_offset, max_offset)
    dx3 = random.randint(-max_offset, max_offset)
    dy3 = random.randint(-max_offset, max_offset)
    
    # Projective warp to 256x256
    warped = img.transform((256, 256), Image.QUAD, [
        bx + dx0, by + dy0, # TL
        bx + dx1, by + board_size + dy1, # BL
        bx + board_size + dx2, by + board_size + dy2, # BR
        bx + board_size + dx3, by + dy3 # TR
    ])
    
    # Apply augmentations:
    # 1. Random contrast
    if random.random() < 0.5:
        enhancer = ImageEnhance.Contrast(warped)
        warped = enhancer.enhance(random.uniform(0.7, 1.3))
    # 2. Random brightness
    if random.random() < 0.5:
        enhancer = ImageEnhance.Brightness(warped)
        warped = enhancer.enhance(random.uniform(0.7, 1.3))
    # 3. Random blur
    if random.random() < 0.3:
        warped = warped.filter(ImageFilter.GaussianBlur(random.uniform(0.2, 0.8)))
    # 4. Random noise (simulated by small resolution resizing)
    if random.random() < 0.3:
        sz = random.choice([200, 220, 240])
        warped = warped.resize((sz, sz), Image.BILINEAR).resize((256, 256), Image.BILINEAR)
        
    return warped

def build_dataset(num_boards, fonts, themes, orientations):
    X = []
    Y_bin = []
    Y_class = []
    
    for b_idx in range(num_boards):
        board = generate_legal_board()
        font = random.choice(fonts)
        theme = random.choice(themes)
        orient = random.choice(orientations)
        coord = random.choice([True, False])
        
        grid = board_to_grid(board, orient)
        warped = draw_and_augment_board(grid, font, theme, orient, coord)
        
        # Convert to grayscale
        gray = warped.convert('L')
        gray_arr = np.array(gray, dtype=np.float32) / 255.0
        
        # Slice into 64 tiles
        for index in range(64):
            row = index // 8
            col = index % 8
            tile = gray_arr[row*32:(row+1)*32, col*32:(col+1)*32]
            
            piece = grid[index]
            cls_idx = CLASS_MAP[piece]
            
            X.append(tile)
            if cls_idx == 0:
                Y_bin.append(0)
                Y_class.append(0) # placeholder, won't train piece model on empty squares
            else:
                Y_bin.append(1)
                Y_class.append(cls_idx - 1) # 0 to 11
                
    X = np.expand_dims(np.array(X), -1) # shape (N, 32, 32, 1)
    Y_bin = np.array(Y_bin)
    Y_class = np.array(Y_class)
    
    return X, Y_bin, Y_class

def main():
    print("Generating dataset...")
    # Training fonts: Segoe UI Symbol and SimSun
    train_fonts = ['C:\\Windows\\Fonts\\seguisym.ttf', 'C:\\Windows\\Fonts\\simsun.ttc']
    # Test font: MS Gothic (completely unseen during training to measure generalization)
    test_fonts = ['C:\\Windows\\Fonts\\msgothic.ttc']
    
    themes = list(THEMES.keys())
    orientations = ['white', 'black']
    
    # We generate a compact but highly augmented dataset
    X_train, Y_bin_train, Y_class_train = build_dataset(350, train_fonts, themes, orientations)
    X_val, Y_bin_val, Y_class_val = build_dataset(50, train_fonts, themes, orientations)
    X_test, Y_bin_test, Y_class_test = build_dataset(50, test_fonts, themes, orientations)
    
    print(f"Train dataset size: {X_train.shape[0]} tiles")
    print(f"Validation dataset size: {X_val.shape[0]} tiles")
    print(f"Test (unseen style) size: {X_test.shape[0]} tiles")
    
    # ----------------------------------------------------
    # Stage 1: Binary empty-vs-occupied model
    # ----------------------------------------------------
    print("\n--- Training Stage 1: Empty vs Occupied ---")
    bin_model = models.Sequential([
        layers.Input(shape=(32, 32, 1)),
        layers.Conv2D(16, (3, 3), activation='relu'),
        layers.MaxPooling2D((2, 2)),
        layers.Flatten(),
        layers.Dense(64, activation='relu'),
        layers.Dense(1, activation='sigmoid')
    ])
    bin_model.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])
    bin_model.fit(X_train, Y_bin_train, epochs=5, batch_size=64, validation_data=(X_val, Y_bin_val))
    
    # Evaluate binary model on unseen test piece set
    _, bin_test_acc = bin_model.evaluate(X_test, Y_bin_test)
    print(f"Binary model accuracy on unseen test set: {bin_test_acc * 100:.2f}%")
    
    # ----------------------------------------------------
    # Stage 2: 12-class piece classifier for occupied squares
    # ----------------------------------------------------
    print("\n--- Training Stage 2: Piece Classifier ---")
    # Only train on occupied squares
    occupied_train_mask = (Y_bin_train == 1)
    X_train_occupied = X_train[occupied_train_mask]
    Y_class_train_occupied = Y_class_train[occupied_train_mask]
    
    occupied_val_mask = (Y_bin_val == 1)
    X_val_occupied = X_val[occupied_val_mask]
    Y_class_val_occupied = Y_class_val[occupied_val_mask]
    
    occupied_test_mask = (Y_bin_test == 1)
    X_test_occupied = X_test[occupied_test_mask]
    Y_class_test_occupied = Y_class_test[occupied_test_mask]
    
    piece_model = models.Sequential([
        layers.Input(shape=(32, 32, 1)),
        layers.Conv2D(32, (3, 3), activation='relu'),
        layers.MaxPooling2D((2, 2)),
        layers.Conv2D(64, (3, 3), activation='relu'),
        layers.MaxPooling2D((2, 2)),
        layers.Flatten(),
        layers.Dense(128, activation='relu'),
        layers.Dense(12, activation='softmax')
    ])
    piece_model.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])
    piece_model.fit(X_train_occupied, Y_class_train_occupied, epochs=8, batch_size=32, validation_data=(X_val_occupied, Y_class_val_occupied))
    
    _, piece_test_acc = piece_model.evaluate(X_test_occupied, Y_class_test_occupied)
    print(f"Piece model accuracy on unseen test set: {piece_test_acc * 100:.2f}%")
    
    # ----------------------------------------------------
    # Combine Model A and B into a Single Multi-Output/Combined Model
    # ----------------------------------------------------
    print("\nBuilding combined inference model...")
    inputs = layers.Input(shape=(64, 1024), name='Input')
    keep_prob = layers.Input(shape=(), name='KeepProb') # match old model's contract
    
    # Reshape tiles to [64, 32, 32, 1]
    tiles = layers.Reshape((64, 32, 32, 1))(inputs)
    
    # Run binary and piece classifier on all tiles using TimeDistributed
    occupied_prob = layers.TimeDistributed(bin_model)(tiles) # shape [64, 1]
    pieces_prob = layers.TimeDistributed(piece_model)(tiles) # shape [64, 12]
    
    # Compute output probabilities [64, 13]
    @tf.keras.utils.register_keras_serializable()
    class SubtractFromOne(layers.Layer):
        def call(self, inputs):
            return 1.0 - inputs
            
    empty_prob = SubtractFromOne()(occupied_prob)
    pieces_prob_scaled = layers.Multiply()([occupied_prob, pieces_prob])
    
    probabilities = layers.Concatenate(axis=-1, name='probabilities')([empty_prob, pieces_prob_scaled])
    
    combined_model = tf.keras.Model(inputs=[inputs, keep_prob], outputs=probabilities)
    
    # Save model locally in Keras format
    temp_dir = 'temp_keras_model'
    os.makedirs(temp_dir, exist_ok=True)
    model_path = os.path.join(temp_dir, 'combined_model.h5')
    combined_model.save(model_path)
    print(f"Saved combined Keras model to {model_path}")
    
    # Export Keras model to TensorFlow.js GraphModel
    print("Converting to TensorFlow.js GraphModel format...")
    output_web_dir = 'public/models/chess-ocr-new'
    os.makedirs(output_web_dir, exist_ok=True)
    
    # Run the converter using Python module execution
    import subprocess
    cmd = [
        'C:\\Users\\advit\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
        '-m', 'tensorflowjs.converters.converter',
        '--input_format=keras',
        '--output_format=tfjs_graph_model',
        model_path,
        output_web_dir
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print("CONVERSION ERROR:")
        print(res.stderr)
        raise RuntimeError("tfjs conversion failed")
        
    print(f"Successfully exported new GraphModel to {output_web_dir}")

if __name__ == '__main__':
    main()
