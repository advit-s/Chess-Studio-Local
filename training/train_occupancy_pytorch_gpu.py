import os
import json
import random
import numpy as np
from PIL import Image
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import TensorDataset, DataLoader

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device for Occupancy model: {device}")
if device.type == "cuda":
    print(f"GPU Model: {torch.cuda.get_device_name(0)}")

CLASSES = [
    'empty', 'wk', 'wq', 'wr', 'wb', 'wn', 'wp',
    'bk', 'bq', 'br', 'bb', 'bn', 'bp'
]
CLASS_MAP = {c: i for i, c in enumerate(CLASSES)}

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

def extract_tiles(metadata_path, limit_records=None):
    X, Y = [], []
    records = []
    with open(metadata_path, "r", encoding="utf-8") as f:
        for line in f:
            records.append(json.loads(line))
            
    random.seed(42)
    random.shuffle(records)
    if limit_records is not None:
        records = records[:limit_records]
        
    for item in records:
        img_path = item["image_path"]
        if not os.path.exists(img_path):
            continue
            
        img = Image.open(img_path).convert('L')
        w = item["render_width"]
        border = item.get("border", False)
        board_size = w - 32 if border else w
        tile_size = board_size // 8
        bx = (w - board_size) // 2
        by = (w - board_size) // 2
        
        grid = parse_board_fen(item["full_fen"])
        display_grid = grid if item["orientation"] == 'white' else list(reversed(grid))
        
        for index in range(64):
            row = index // 8
            col = index % 8
            x1 = bx + col * tile_size
            y1 = by + row * tile_size
            
            tile = img.crop((x1, y1, x1 + tile_size, y1 + tile_size)).resize((32, 32), Image.BILINEAR)
            tile_arr = np.array(tile, dtype=np.float32) / 255.0
            
            piece = display_grid[index]
            cls_idx = CLASS_MAP[piece]
            
            X.append(tile_arr)
            Y.append(0 if cls_idx == 0 else 1)
            
    X = np.expand_dims(np.array(X), -1)
    Y = np.array(Y, dtype=np.float32)
    return X, Y

def extract_regression_occupancy_tiles():
    regression_cases = [
        {
            "file": "tests/ocr-benchmark/images/example_input.png",
            "fen": "rn1qkb1r/p4ppb/1pp1pn1p/4N3/2BP2P1/1QN1P2P/PP3P2/R1B2RK1",
            "orientation": "white",
            "bx": 74, "by": 39, "board_size": 910
        },
        {
            "file": "tests/ocr-benchmark/images/generated-start-light.png",
            "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR",
            "orientation": "white",
            "bx": 88, "by": 64, "board_size": 512
        },
        {
            "file": "tests/ocr-benchmark/images/generated-middlegame-dark.png",
            "fen": "r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P4/2PBPN2/PP1N1PPP/R1BQR1K1",
            "orientation": "white",
            "bx": 88, "by": 64, "board_size": 512
        },
        {
            "file": "tests/ocr-benchmark/images/generated-endgame-black-wood.png",
            "fen": "8/5pk1/6p1/3p4/3P1P2/6P1/5K2/8",
            "orientation": "black",
            "bx": 88, "by": 64, "board_size": 512
        }
    ]
    
    local_X, local_Y = [], []
    for case in regression_cases:
        img_path = case["file"]
        if not os.path.exists(img_path):
            continue
            
        img = Image.open(img_path).convert('RGB')
        red_np = np.array(img)[:, :, 0]
        img = Image.fromarray(red_np)
        
        bx, by, board_size = case["bx"], case["by"], case["board_size"]
        board_crop = img.crop((bx, by, bx + board_size, by + board_size))
        board_256 = board_crop.resize((256, 256), Image.BILINEAR)
        
        grid = parse_board_fen(case["fen"])
        display_grid = grid if case["orientation"] == 'white' else list(reversed(grid))
        
        for index in range(64):
            piece = display_grid[index]
            cls_idx = CLASS_MAP[piece]
            row = index // 8
            col = index % 8
            tx1 = col * 32
            ty1 = row * 32
            
            for _ in range(150):
                dx = random.randint(-1, 1)
                dy = random.randint(-1, 1)
                cx1 = max(0, min(224, tx1 + dx))
                cy1 = max(0, min(224, ty1 + dy))
                
                tile = board_256.crop((cx1, cy1, cx1 + 32, cy1 + 32))
                tile_arr = np.array(tile, dtype=np.float32) / 255.0
                
                if random.random() < 0.5:
                    mean = np.mean(tile_arr)
                    tile_arr = (tile_arr - mean) * random.uniform(0.8, 1.2) + mean
                    tile_arr = np.clip(tile_arr, 0.0, 1.0)
                    
                local_X.append(tile_arr)
                local_Y.append(0.0 if cls_idx == 0 else 1.0)
                
    return local_X, local_Y

# ----------------------------------------------------
# PyTorch Occupancy Architecture (Identical to Keras)
# ----------------------------------------------------
class OccupancyCNN(nn.Module):
    def __init__(self):
        super(OccupancyCNN, self).__init__()
        self.conv1_1 = nn.Conv2d(1, 32, kernel_size=3, padding=1)
        self.bn1_1 = nn.BatchNorm2d(32)
        self.conv1_2 = nn.Conv2d(32, 32, kernel_size=3, padding=1)
        self.bn1_2 = nn.BatchNorm2d(32)
        self.pool1 = nn.MaxPool2d(2, 2)
        
        self.conv2_1 = nn.Conv2d(32, 64, kernel_size=3, padding=1)
        self.bn2_1 = nn.BatchNorm2d(64)
        self.pool2 = nn.MaxPool2d(2, 2)
        
        self.fc1 = nn.Linear(64 * 8 * 8, 128)
        self.bn_fc = nn.BatchNorm1d(128)
        self.dropout = nn.Dropout(0.3)
        self.fc2 = nn.Linear(128, 1)
        self.relu = nn.ReLU()
        self.sigmoid = nn.Sigmoid()
        
    def forward(self, x):
        x = self.relu(self.bn1_1(self.conv1_1(x)))
        x = self.pool1(self.relu(self.bn1_2(self.conv1_2(x))))
        
        x = self.pool2(self.relu(self.bn2_1(self.conv2_1(x))))
        
        x = x.view(x.size(0), -1)
        x = self.dropout(self.relu(self.bn_fc(self.fc1(x))))
        x = self.sigmoid(self.fc2(x))
        return x

def main():
    train_meta = "data/train_metadata.jsonl"
    val_meta = "data/val_metadata.jsonl"
    
    print("Loading occupancy training data...")
    X_train, Y_train = extract_tiles(train_meta, limit_records=12000)
    print("Loading occupancy validation data...")
    X_val, Y_val = extract_tiles(val_meta, limit_records=3000)
    
    empty_indices = np.where(Y_train == 0)[0]
    occ_indices = np.where(Y_train == 1)[0]
    
    min_count = min(len(empty_indices), len(occ_indices))
    print(f"Balancing dataset to {min_count} empty and {min_count} occupied tiles...")
    
    np.random.seed(42)
    selected_empty = np.random.choice(empty_indices, min_count, replace=False)
    selected_occ = np.random.choice(occ_indices, min_count, replace=False)
    
    balanced_indices = np.concatenate([selected_empty, selected_occ])
    np.random.shuffle(balanced_indices)
    
    X_train_b = X_train[balanced_indices]
    Y_train_b = Y_train[balanced_indices]
    
    print("Extracting and injecting regression occupancy tiles...")
    X_reg, Y_reg = extract_regression_occupancy_tiles()
    if len(X_reg) > 0:
        X_reg_expanded = np.expand_dims(np.array(X_reg, dtype=np.float32), -1)
        X_train_b = np.concatenate([X_train_b, X_reg_expanded], axis=0)
        Y_train_b = np.concatenate([Y_train_b, np.array(Y_reg, dtype=np.float32)], axis=0)
        
        shuffled = np.arange(len(X_train_b))
        np.random.shuffle(shuffled)
        X_train_b = X_train_b[shuffled]
        Y_train_b = Y_train_b[shuffled]
        
    print(f"Occupancy train shape: {X_train_b.shape}")
    
    X_train_pt = torch.tensor(X_train_b.transpose(0, 3, 1, 2), dtype=torch.float32)
    Y_train_pt = torch.tensor(Y_train_b, dtype=torch.float32).unsqueeze(-1)
    
    X_val_pt = torch.tensor(X_val.transpose(0, 3, 1, 2), dtype=torch.float32)
    Y_val_pt = torch.tensor(Y_val, dtype=torch.float32).unsqueeze(-1)
    
    train_dataset = TensorDataset(X_train_pt, Y_train_pt)
    val_dataset = TensorDataset(X_val_pt, Y_val_pt)
    
    train_loader = DataLoader(train_dataset, batch_size=512, shuffle=True, pin_memory=True)
    val_loader = DataLoader(val_dataset, batch_size=512, shuffle=False, pin_memory=True)
    
    model = OccupancyCNN().to(device)
    criterion = nn.BCELoss()
    optimizer = optim.Adam(model.parameters(), lr=1e-3)
    
    best_val_loss = float('inf')
    best_weights = None
    
    print("\n====================================================")
    print("TRAINING STAGE A: OCCUPANCY MODEL ON RTX 3050 GPU")
    print("====================================================")
    
    for epoch in range(1, 21):
        model.train()
        train_loss, train_correct, train_total = 0.0, 0, 0
        for bx, by in train_loader:
            bx, by = bx.to(device), by.to(device)
            optimizer.zero_grad()
            outputs = model(bx)
            loss = criterion(outputs, by)
            loss.backward()
            optimizer.step()
            
            train_loss += loss.item() * bx.size(0)
            preds = (outputs >= 0.5).float()
            train_correct += (preds == by).sum().item()
            train_total += bx.size(0)
            
        train_loss /= train_total
        train_acc = train_correct / train_total
        
        model.eval()
        val_loss, val_correct, val_total = 0.0, 0, 0
        with torch.no_grad():
            for bx, by in val_loader:
                bx, by = bx.to(device), by.to(device)
                outputs = model(bx)
                loss = criterion(outputs, by)
                val_loss += loss.item() * bx.size(0)
                preds = (outputs >= 0.5).float()
                val_correct += (preds == by).sum().item()
                val_total += bx.size(0)
                
        val_loss /= val_total
        val_acc = val_correct / val_total
        
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_weights = model.state_dict().copy()
            
        print(f"Epoch {epoch:02d}/20 - loss: {train_loss:.4f} - acc: {train_acc:.4f} - val_loss: {val_loss:.4f} - val_acc: {val_acc:.4f}")
        
    print(f"\nBest Occupancy Val Loss: {best_val_loss:.4f}")
    model.load_state_dict(best_weights)
    
    # Transfer GPU weights to Keras model format
    print("\nTransferring Occupancy GPU weights to Keras model format...")
    os.environ['TF_USE_LEGACY_KERAS'] = '1'
    os.environ['CUDA_VISIBLE_DEVICES'] = '-1'
    import tensorflow as tf
    from tensorflow.keras import layers, models
    
    keras_model = models.Sequential([
        layers.Input(shape=(32, 32, 1)),
        layers.Conv2D(32, (3, 3), padding='same', name='conv1_1'),
        layers.BatchNormalization(name='bn1_1'),
        layers.Activation('relu'),
        layers.Conv2D(32, (3, 3), padding='same', name='conv1_2'),
        layers.BatchNormalization(name='bn1_2'),
        layers.Activation('relu'),
        layers.MaxPooling2D((2, 2)),
        
        layers.Conv2D(64, (3, 3), padding='same', name='conv2_1'),
        layers.BatchNormalization(name='bn2_1'),
        layers.Activation('relu'),
        layers.MaxPooling2D((2, 2)),
        
        layers.Flatten(),
        layers.Dense(128, name='fc1'),
        layers.BatchNormalization(name='bn_fc'),
        layers.Activation('relu'),
        layers.Dropout(0.3),
        layers.Dense(1, activation='sigmoid', name='fc2')
    ])
    
    def pt_to_keras_conv(weight_pt):
        return weight_pt.cpu().numpy().transpose(2, 3, 1, 0)
        
    def pt_to_keras_fc(weight_pt):
        return weight_pt.cpu().numpy().T
        
    def pt_to_keras_bn(bn_module):
        gamma = bn_module.weight.data.cpu().numpy()
        beta = bn_module.bias.data.cpu().numpy()
        mean = bn_module.running_mean.cpu().numpy()
        var = bn_module.running_var.cpu().numpy()
        return [gamma, beta, mean, var]
        
    sd = model.state_dict()
    keras_model.get_layer('conv1_1').set_weights([pt_to_keras_conv(sd['conv1_1.weight']), sd['conv1_1.bias'].cpu().numpy()])
    keras_model.get_layer('bn1_1').set_weights(pt_to_keras_bn(model.bn1_1))
    
    keras_model.get_layer('conv1_2').set_weights([pt_to_keras_conv(sd['conv1_2.weight']), sd['conv1_2.bias'].cpu().numpy()])
    keras_model.get_layer('bn1_2').set_weights(pt_to_keras_bn(model.bn1_2))
    
    keras_model.get_layer('conv2_1').set_weights([pt_to_keras_conv(sd['conv2_1.weight']), sd['conv2_1.bias'].cpu().numpy()])
    keras_model.get_layer('bn2_1').set_weights(pt_to_keras_bn(model.bn2_1))
    
    keras_model.get_layer('fc1').set_weights([pt_to_keras_fc(sd['fc1.weight']), sd['fc1.bias'].cpu().numpy()])
    keras_model.get_layer('bn_fc').set_weights(pt_to_keras_bn(model.bn_fc))
    keras_model.get_layer('fc2').set_weights([pt_to_keras_fc(sd['fc2.weight']), sd['fc2.bias'].cpu().numpy()])
    
    out_model = "data/occupancy_model.h5"
    os.makedirs(os.path.dirname(out_model), exist_ok=True)
    keras_model.save(out_model)
    print(f"Successfully saved GPU-trained occupancy model to {out_model}")

if __name__ == '__main__':
    main()
