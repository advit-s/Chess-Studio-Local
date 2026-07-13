import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { pieceGlyph } from '../lib/chessUtils';
import { validatePosition, hasValidKings } from '../lib/fenValidation';
import { loadScanHistory, saveScan, deleteScan, clearScanHistory, type ScannedPosition } from '../lib/scanHistory';

interface Props {
  onOpenAnalysis: (fen: string) => void;
  onOpenPlay: (fen: string, color: 'w' | 'b') => void;
  onOpenEditor?: (fen: string) => void;
  onSaveToArchive: (pgn: string, fen: string) => void;
  showToast: (message: string) => void;
}

interface CornerPoint { x: number; y: number }
interface Corners {
  topLeft: CornerPoint;
  topRight: CornerPoint;
  bottomLeft: CornerPoint;
  bottomRight: CornerPoint;
}

// ---------------------------------------------------------------------------
// Letterbox coordinate mapping
// ---------------------------------------------------------------------------

/**
 * Compute the rendered rectangle of an image displayed with object-fit: contain
 * inside a container. Returns the offset and scale relative to the container.
 */
function getContainedImageRect(
  containerW: number,
  containerH: number,
  imageW: number,
  imageH: number,
): { offsetX: number; offsetY: number; renderW: number; renderH: number } {
  const containerAspect = containerW / containerH;
  const imageAspect = imageW / imageH;
  let renderW: number, renderH: number;

  if (imageAspect > containerAspect) {
    // Image is wider — letterbox top/bottom
    renderW = containerW;
    renderH = containerW / imageAspect;
  } else {
    // Image is taller — letterbox left/right
    renderH = containerH;
    renderW = containerH * imageAspect;
  }

  return {
    offsetX: (containerW - renderW) / 2,
    offsetY: (containerH - renderH) / 2,
    renderW,
    renderH,
  };
}

export function ScanPanel({ onOpenAnalysis, onOpenPlay, onSaveToArchive, showToast }: Props) {
  // Image & Upload state
  const [imageSrc, setImageSrc] = useState<string>('');
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [errorMsg, setErrorMsg] = useState<string>('');

  // OCR state
  const [corners, setCorners] = useState<Corners>({
    topLeft: { x: 0, y: 0 },
    topRight: { x: 0, y: 0 },
    bottomLeft: { x: 0, y: 0 },
    bottomRight: { x: 0, y: 0 }
  });
  const [draggingCorner, setDraggingCorner] = useState<keyof Corners | null>(null);
  const [progressStep, setProgressStep] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [boardDetectionQuality, setBoardDetectionQuality] = useState<'good' | 'fair' | 'manual'>('manual');

  // Editor board state
  const [grid, setGrid] = useState<string[]>(Array(64).fill('empty'));
  const [originalGrid, setOriginalGrid] = useState<string[]>(Array(64).fill('empty'));
  const [confidences, setConfidences] = useState<number[]>(Array(64).fill(100));
  const [margins, setMargins] = useState<number[]>(Array(64).fill(100));
  const [modelLoaded, setModelLoaded] = useState<boolean | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white');
  const [showOrientationConfirm, setShowOrientationConfirm] = useState<boolean>(false);

  const [selectedPalettePiece, setSelectedPalettePiece] = useState<string>('empty');

  // Drag & drop between squares
  const [dragSourceIdx, setDragSourceIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // History / Undo / Redo
  const [history, setHistory] = useState<string[][]>([Array(64).fill('empty')]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [historyList, setHistoryList] = useState<ScannedPosition[]>([]);
  const [notes, setNotes] = useState<string>('');

  // FEN configuration
  const [turn, setTurn] = useState<'w' | 'b'>('w');
  const [castling, setCastling] = useState({ wK: false, wQ: false, bK: false, bQ: false });
  const [enPassant, setEnPassant] = useState<string>('-');
  const [halfmove, setHalfmove] = useState<number>(0);
  const [fullmove, setFullmove] = useState<number>(1);
  const [manualFen, setManualFen] = useState<string>('');

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const croppedCanvasRef = useRef<HTMLCanvasElement>(null);
  const rawImagePixelsRef = useRef<ImageData | null>(null);
  const mountedRef = useRef<boolean>(true);
  const requestIdRef = useRef<number>(0);

  // Dragging corner: use ref to avoid stale closure
  const cornersRef = useRef<Corners>(corners);
  cornersRef.current = corners;

  // Load IndexedDB History on Mount
  const loadHistory = useCallback(async () => {
    const list = await loadScanHistory();
    if (mountedRef.current) setHistoryList(list);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Track mount state for safe setState
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Web Worker Initialization — use scanWorker.js (not the deleted ocrWorker.js)
  useEffect(() => {
    const base = new URL(import.meta.env.BASE_URL, window.location.href);
    const workerUrl = new URL('scanWorker.js', base).toString();
    const worker = new Worker(workerUrl);
    workerRef.current = worker;

    worker.onmessage = (event) => {
      if (!mountedRef.current) return; // ignore after unmount

      const { requestId, status, step, result, message } = event.data;

      // Ignore stale responses
      if (requestId !== requestIdRef.current) return;

      if (status === 'progress') {
        setProgressStep(step);
      } else if (status === 'complete') {
        setIsProcessing(false);
        setProgressStep('');

        if (event.data.action === 'detect') {
          setCorners(result.corners);
          setBoardDetectionQuality(result.quality);

          if (result.found) {
            showToast(
              result.quality === 'good'
                ? 'Board detected — adjust corners if needed'
                : 'Board region estimated — please adjust corners manually'
            );
          } else {
            showToast('Could not detect board — please crop manually');
          }

          // Generate warp preview and recognize pieces
          if (rawImagePixelsRef.current) {
            triggerRecognize(rawImagePixelsRef.current, result.corners);
          }
        } else if (event.data.action === 'warp') {
          renderCroppedCanvas(result.warpedPixels, result.warpedSize);
        } else if (event.data.action === 'recognize') {
          setModelLoaded(result.modelLoaded);
          setModelError(result.modelError || null);

          if (result.modelLoaded) {
            setGrid(result.grid);
            setOriginalGrid(result.grid);
            setConfidences(result.confidences);
            setMargins(result.margins || Array(64).fill(100));
            setHistory([result.grid]);
            setHistoryIndex(0);
            setShowOrientationConfirm(true);

            const validation = validatePosition(result.grid);
            if (validation.valid) {
              showToast('Piece recognition complete');
            } else {
              showToast('Auto-recognition complete with warnings/errors.');
            }
          } else {
            // Model not found or failed, keep empty/manual layout
            setConfidences(Array(64).fill(100));
            setMargins(Array(64).fill(100));
            setShowOrientationConfirm(false);
          }

          renderCroppedCanvas(result.warpedPixels, result.warpedSize);
        }
      } else if (status === 'error') {
        setIsProcessing(false);
        setProgressStep('');
        setErrorMsg(message || 'Processing failed');
      }
    };

    return () => {
      worker.terminate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warp rendering helper
  const renderCroppedCanvas = (pixels: Uint8ClampedArray, size: number) => {
    const canvas = croppedCanvasRef.current;
    if (!canvas) return;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imgData = ctx.createImageData(size, size);
    imgData.data.set(pixels);
    ctx.putImageData(imgData, 0, 0);
  };

  // Trigger perspective warp in the worker (no piece classification)
  const triggerWarp = (pixels: ImageData, targetCorners: Corners) => {
    if (!workerRef.current) return;
    const id = ++requestIdRef.current;
    setIsProcessing(true);
    workerRef.current.postMessage({
      action: 'warp',
      requestId: id,
      imageData: pixels,
      corners: targetCorners,
    });
  };

  // Trigger perspective warp and piece recognition in the worker
  const triggerRecognize = (pixels: ImageData, targetCorners: Corners) => {
    if (!workerRef.current) return;
    const id = ++requestIdRef.current;
    setIsProcessing(true);
    workerRef.current.postMessage({
      action: 'recognize',
      requestId: id,
      imageData: pixels,
      corners: targetCorners,
    });
  };

  // Handle uploaded file
  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Unsupported format. Please upload PNG, JPG, JPEG, or WebP.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg('Image size exceeds the 10MB limit.');
      return;
    }

    // Cancel any in-flight recognition
    requestIdRef.current++;
    setErrorMsg('');

    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      if (!mountedRef.current) return;
      setImageSrc(src);

      const img = new Image();
      img.onload = () => {
        if (!mountedRef.current) return;
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        setImageDimensions({ width, height });

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const raw = ctx.getImageData(0, 0, width, height);
          rawImagePixelsRef.current = raw;

          // Request board detection
          const id = ++requestIdRef.current;
          setIsProcessing(true);
          workerRef.current?.postMessage({
            action: 'detect',
            requestId: id,
            imageData: raw,
          });
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  // Clipboard Paste Support
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            const file = items[i].getAsFile();
            if (file) processFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Grid editing helpers
  const handleSquareClick = (index: number) => {
    const nextGrid = [...grid];
    nextGrid[index] = selectedPalettePiece;
    updateGridState(nextGrid);
  };

  const updateGridState = (nextGrid: string[]) => {
    setGrid(nextGrid);
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push(nextGrid);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setGrid(history[historyIndex - 1]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setGrid(history[historyIndex + 1]);
    }
  };

  const handleClearBoard = () => {
    updateGridState(Array(64).fill('empty'));
  };

  const handleRestoreOriginal = () => {
    updateGridState(originalGrid);
  };

  // Drag & drop between squares
  const handleSquareDragStart = (gridIdx: number) => (e: React.DragEvent) => {
    if (grid[gridIdx] === 'empty') {
      e.preventDefault();
      return;
    }
    setDragSourceIdx(gridIdx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(gridIdx));
  };

  const handleSquareDragOver = (gridIdx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(gridIdx);
  };

  const handleSquareDragLeave = () => {
    setDragOverIdx(null);
  };

  const handleSquareDrop = (targetIdx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverIdx(null);
    const sourceIdx = dragSourceIdx;
    setDragSourceIdx(null);

    if (sourceIdx === null || sourceIdx === targetIdx) return;

    const nextGrid = [...grid];
    nextGrid[targetIdx] = nextGrid[sourceIdx];
    nextGrid[sourceIdx] = 'empty';
    updateGridState(nextGrid);
  };

  const handleSquareDragEnd = () => {
    setDragSourceIdx(null);
    setDragOverIdx(null);
  };

  // FEN builders
  const generateFenString = useCallback(() => {
    const fenRows: string[] = [];
    for (let r = 0; r < 8; r++) {
      let emptyCount = 0;
      let rowStr = '';
      for (let c = 0; c < 8; c++) {
        const idx = boardOrientation === 'white' ? (r * 8 + c) : ((7 - r) * 8 + (7 - c));
        const piece = grid[idx];
        if (piece === 'empty') {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            rowStr += emptyCount;
            emptyCount = 0;
          }
          const type = piece[1];
          const char = piece[0] === 'w' ? type.toUpperCase() : type.toLowerCase();
          rowStr += char;
        }
      }
      if (emptyCount > 0) {
        rowStr += emptyCount;
      }
      fenRows.push(rowStr);
    }

    const castlingPart = [
      castling.wK ? 'K' : '',
      castling.wQ ? 'Q' : '',
      castling.bK ? 'k' : '',
      castling.bQ ? 'q' : ''
    ].join('') || '-';

    const ep = enPassant.trim() || '-';

    return `${fenRows.join('/')} ${turn} ${castlingPart} ${ep} ${halfmove} ${fullmove}`;
  }, [grid, turn, castling, enPassant, halfmove, fullmove, boardOrientation]);

  // Synchronize manual FEN edit
  useEffect(() => {
    setManualFen(generateFenString());
  }, [generateFenString]);

  // Apply FEN to grid state
  const handleLoadFenString = (fen: string) => {
    try {
      const chess = new Chess(fen.trim());
      const nextGrid = Array(64).fill('empty');
      const board = chess.board();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const piece = board[r][c];
          const idx = boardOrientation === 'white' ? (r * 8 + c) : ((7 - r) * 8 + (7 - c));
          if (piece) {
            nextGrid[idx] = piece.color + piece.type;
          }
        }
      }
      updateGridState(nextGrid);

      const parts = fen.trim().split(/\s+/);
      setTurn((parts[1] === 'b' ? 'b' : 'w'));
      setCastling({
        wK: parts[2]?.includes('K') || false,
        wQ: parts[2]?.includes('Q') || false,
        bK: parts[2]?.includes('k') || false,
        bQ: parts[2]?.includes('q') || false
      });
      setEnPassant(parts[3] || '-');
      setHalfmove(Number(parts[4]) || 0);
      setFullmove(Number(parts[5]) || 1);
      showToast('FEN loaded successfully');
    } catch (e) {
      showToast('Invalid FEN syntax');
    }
  };

  // Drag handles management — FIXED: use letterbox-aware coordinate mapping
  const handlePointerDown = (corner: keyof Corners) => (e: React.PointerEvent) => {
    e.preventDefault();
    setDraggingCorner(corner);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingCorner || !imageContainerRef.current) return;
    const containerRect = imageContainerRef.current.getBoundingClientRect();

    // Account for object-fit: contain letterboxing
    const imgRect = getContainedImageRect(
      containerRect.width,
      containerRect.height,
      imageDimensions.width,
      imageDimensions.height,
    );

    // Mouse position relative to the rendered image (not the container)
    const relX = e.clientX - containerRect.left - imgRect.offsetX;
    const relY = e.clientY - containerRect.top - imgRect.offsetY;

    // Map to original image coordinates
    const x = Math.max(0, Math.min(imageDimensions.width, (relX / imgRect.renderW) * imageDimensions.width));
    const y = Math.max(0, Math.min(imageDimensions.height, (relY / imgRect.renderH) * imageDimensions.height));

    setCorners((prev) => ({
      ...prev,
      [draggingCorner]: { x, y }
    }));
  };

  const handlePointerUp = () => {
    if (draggingCorner) {
      setDraggingCorner(null);
      // Increment request ID to cancel any in-flight recognition
      requestIdRef.current++;
      setConfidences(Array(64).fill(100));
      setMargins(Array(64).fill(100));
      setModelLoaded(null);
      setShowOrientationConfirm(false);
      // Use current ref value (not stale closure)
      if (rawImagePixelsRef.current) {
        triggerWarp(rawImagePixelsRef.current, cornersRef.current);
      }
    }
  };

  // Image rotation
  const handleRotateImage = () => {
    if (!rawImagePixelsRef.current) return;
    const w = imageDimensions.width;
    const h = imageDimensions.height;

    const canvas = document.createElement('canvas');
    canvas.width = h;
    canvas.height = w;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      if (!mountedRef.current) return;
      ctx.translate(h / 2, w / 2);
      ctx.rotate((90 * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);

      const rotated = ctx.getImageData(0, 0, h, w);
      rawImagePixelsRef.current = rotated;
      setImageSrc(canvas.toDataURL());
      setImageDimensions({ width: h, height: w });

      // Detect board on rotated image
      const id = ++requestIdRef.current;
      setIsProcessing(true);
      workerRef.current?.postMessage({
        action: 'detect',
        requestId: id,
        imageData: rotated,
      });
    };
    img.src = imageSrc;
  };

  // Save Scan to IndexedDB History
  const handleSaveScan = async () => {
    const id = String(Date.now());
    const originalBase64 = imageSrc;
    const croppedBase64 = croppedCanvasRef.current?.toDataURL() || '';
    const scanItem: ScannedPosition = {
      id,
      date: new Date().toISOString(),
      originalImage: originalBase64,
      croppedImage: croppedBase64,
      detectedFen: exportPgnFen(originalGrid),
      correctedFen: manualFen,
      confidence: 0, // No fake confidence
      notes: notes.trim()
    };
    const success = await saveScan(scanItem);
    if (success) {
      showToast('Scan saved in history');
      setNotes('');
      loadHistory();
    } else {
      showToast('Could not save scan locally');
    }
  };

  const exportPgnFen = (targetGrid: string[]) => {
    const rows: string[] = [];
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      let row = '';
      for (let c = 0; c < 8; c++) {
        const piece = targetGrid[r * 8 + c];
        if (piece === 'empty') empty++;
        else {
          if (empty > 0) { row += empty; empty = 0; }
          row += piece[0] === 'w' ? piece[1].toUpperCase() : piece[1].toLowerCase();
        }
      }
      if (empty > 0) row += empty;
      rows.push(row);
    }
    return `${rows.join('/')} w - - 0 1`;
  };

  const handleDeleteHistoryItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const success = await deleteScan(id);
    if (success) {
      showToast('Scan deleted');
      loadHistory();
    }
  };

  const handleLoadHistoryItem = (item: ScannedPosition) => {
    setImageSrc(item.originalImage || '');
    handleLoadFenString(item.correctedFen);
    setNotes(item.notes);
    showToast('Loaded scanned position from history');
  };

  // Position validation using the new library
  const positionValidation = validatePosition(grid);

  // FEN syntax validation (can chess.js parse it?)
  const fenSyntaxValid = (() => {
    try {
      new Chess(manualFen);
      return true;
    } catch {
      return false;
    }
  })();

  const canOpenInAnalysis = fenSyntaxValid && hasValidKings(grid);

  // Compute image-to-view coordinate mapping for SVG overlay
  const getViewCoords = useCallback(
    (pt: CornerPoint): CornerPoint | null => {
      if (!imageContainerRef.current || imageDimensions.width === 0) return null;
      const containerRect = imageContainerRef.current.getBoundingClientRect();
      const imgRect = getContainedImageRect(
        containerRect.width,
        containerRect.height,
        imageDimensions.width,
        imageDimensions.height,
      );
      return {
        x: imgRect.offsetX + (pt.x / imageDimensions.width) * imgRect.renderW,
        y: imgRect.offsetY + (pt.y / imageDimensions.height) * imgRect.renderH,
      };
    },
    [imageDimensions],
  );

  return (
    <div className="workspace" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(360px, 0.75fr)', gap: '22px' }}>

      {/* Left Column: Image Area & Corner Alignment */}
      <section className="board-column" aria-label="OCR Scanner Input">
        <div className="panel" style={{ minHeight: '420px', display: 'flex', flexDirection: 'column' }}>
          <div className="panel-title-row" style={{ marginBottom: '14px' }}>
            <div>
              <p className="eyebrow">Image Recognition</p>
              <h2>Position Scanner</h2>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>
                Images are processed locally in your browser and are not uploaded.
              </p>
            </div>
            <span className="pill" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
              Local processing only
            </span>
          </div>

          {errorMsg && (
            <div className="state-error" style={{ marginBottom: '12px', padding: '8px 12px', background: 'rgba(255, 116, 116, 0.1)', borderRadius: '8px' }}>
              <strong>Error: </strong> {errorMsg}
            </div>
          )}

          {!imageSrc ? (
            // Upload Dropzone
            <div
              className="dropzone"
              style={{
                flex: 1,
                border: '2px dashed var(--border)',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 20px',
                cursor: 'pointer',
                background: 'rgba(255,255,255,0.01)',
                transition: 'border-color 0.2s'
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) processFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <span style={{ fontSize: '48px', marginBottom: '12px' }}>📸</span>
              <p style={{ margin: '0 0 6px', fontWeight: 'bold' }}>Drop a chessboard screenshot here</p>
              <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--muted)' }}>
                or click to upload, or paste directly with Ctrl+V
              </p>
              <button className="secondary-button" type="button">Select Image</button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) processFile(file);
                }}
              />
            </div>
          ) : (
            // Preview & Corners Editor
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                ref={imageContainerRef}
                style={{
                  position: 'relative',
                  width: '100%',
                  maxHeight: '440px',
                  background: '#040608',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  touchAction: 'none'
                }}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              >
                <img
                  src={imageSrc}
                  alt="Scanned Chessboard"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '440px',
                    objectFit: 'contain',
                    pointerEvents: 'none',
                    userSelect: 'none'
                  }}
                />

                {/* Corner markers overlay */}
                {imageDimensions.width > 0 && imageContainerRef.current && (
                  <svg
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none'
                    }}
                  >
                    {(() => {
                      const cTL = getViewCoords(corners.topLeft);
                      const cTR = getViewCoords(corners.topRight);
                      const cBL = getViewCoords(corners.bottomLeft);
                      const cBR = getViewCoords(corners.bottomRight);

                      if (!cTL || !cTR || !cBL || !cBR) return null;

                      return (
                        <>
                          {/* Board outline quadrilateral */}
                          <polygon
                            points={`${cTL.x},${cTL.y} ${cTR.x},${cTR.y} ${cBR.x},${cBR.y} ${cBL.x},${cBL.y}`}
                            fill="rgba(142, 208, 79, 0.15)"
                            stroke="var(--accent)"
                            strokeWidth="2"
                          />

                          {/* 8×8 grid lines */}
                          {[1, 2, 3, 4, 5, 6, 7].map((i) => {
                            const t = i / 8;
                            // Horizontal lines
                            const hLeft = {
                              x: cTL.x + (cBL.x - cTL.x) * t,
                              y: cTL.y + (cBL.y - cTL.y) * t,
                            };
                            const hRight = {
                              x: cTR.x + (cBR.x - cTR.x) * t,
                              y: cTR.y + (cBR.y - cTR.y) * t,
                            };
                            // Vertical lines
                            const vTop = {
                              x: cTL.x + (cTR.x - cTL.x) * t,
                              y: cTL.y + (cTR.y - cTL.y) * t,
                            };
                            const vBottom = {
                              x: cBL.x + (cBR.x - cBL.x) * t,
                              y: cBL.y + (cBR.y - cBL.y) * t,
                            };
                            return (
                              <g key={i}>
                                <line
                                  x1={hLeft.x} y1={hLeft.y} x2={hRight.x} y2={hRight.y}
                                  stroke="var(--accent)" strokeWidth="0.5" strokeOpacity="0.4"
                                />
                                <line
                                  x1={vTop.x} y1={vTop.y} x2={vBottom.x} y2={vBottom.y}
                                  stroke="var(--accent)" strokeWidth="0.5" strokeOpacity="0.4"
                                />
                              </g>
                            );
                          })}

                          {/* 4 Interactive Handles */}
                          {(['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as Array<keyof Corners>).map((corner) => {
                            const pt = getViewCoords(corners[corner]);
                            if (!pt) return null;
                            return (
                              <circle
                                key={corner}
                                cx={pt.x}
                                cy={pt.y}
                                r="12"
                                fill="var(--accent)"
                                stroke="white"
                                strokeWidth="2"
                                style={{ pointerEvents: 'auto', cursor: 'move' }}
                                onPointerDown={handlePointerDown(corner)}
                              />
                            );
                          })}
                        </>
                      );
                    })()}
                  </svg>
                )}

                {/* Processing Loader */}
                {isProcessing && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(10, 14, 18, 0.85)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 10
                    }}
                  >
                    <div className="status-dot" style={{ width: '22px', height: '22px', background: 'var(--accent)', animation: 'pulse 1s infinite' }} />
                    <p style={{ marginTop: '16px', fontWeight: 'bold' }}>{progressStep || 'Processing Image...'}</p>
                  </div>
                )}
              </div>

              {/* Crop Controls */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="secondary-button" onClick={handleRotateImage}>Rotate 90°</button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      const padX = Math.floor(imageDimensions.width * 0.1);
                      const padY = Math.floor(imageDimensions.height * 0.1);
                      const size = Math.min(imageDimensions.width - 2 * padX, imageDimensions.height - 2 * padY);
                      const startX = Math.floor((imageDimensions.width - size) / 2);
                      const startY = Math.floor((imageDimensions.height - size) / 2);
                      const newCorners = {
                        topLeft: { x: startX, y: startY },
                        topRight: { x: startX + size, y: startY },
                        bottomLeft: { x: startX, y: startY + size },
                        bottomRight: { x: startX + size, y: startY + size }
                      };
                      requestIdRef.current++;
                      setConfidences(Array(64).fill(100));
                      setMargins(Array(64).fill(100));
                      setModelLoaded(null);
                      setShowOrientationConfirm(false);
                      setCorners(newCorners);
                      if (rawImagePixelsRef.current) triggerWarp(rawImagePixelsRef.current, newCorners);
                    }}
                  >
                    Reset Crop
                  </button>
                  <button
                    className="danger-button"
                    onClick={() => {
                      requestIdRef.current++; // cancel in-flight
                      setImageSrc('');
                      setGrid(Array(64).fill('empty'));
                      setOriginalGrid(Array(64).fill('empty'));
                    }}
                  >
                    Remove Image
                  </button>
                  <button
                    className="secondary-button"
                    style={{ border: modelLoaded ? '1px solid #e6a817' : '1px solid var(--border)' }}
                    disabled={modelLoaded === false}
                    onClick={() => {
                      if (rawImagePixelsRef.current) {
                        triggerRecognize(rawImagePixelsRef.current, corners);
                      }
                    }}
                    title={modelLoaded === false ? 'Model file not found in public/models/chess-ocr/' : 'Run local piece recognition'}
                  >
                    Auto-Recognize {modelLoaded === false ? '(Failed to load)' : ''}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '14px', fontSize: '12px', alignItems: 'center' }}>
                  {modelLoaded === false && (
                    <span style={{ color: 'var(--danger)', fontSize: '11px' }}>
                      ⚠️ Model failed to load ({modelError || 'Files missing'})
                    </span>
                  )}
                  {modelLoaded === true && (
                    <span className="experimental-badge">
                      🤖 OCR Active
                    </span>
                  )}
                  <span
                    className={`pill ${boardDetectionQuality === 'good' ? '' : boardDetectionQuality === 'fair' ? 'experimental-badge' : ''}`}
                    style={{
                      borderColor: boardDetectionQuality === 'good' ? 'var(--accent)' : boardDetectionQuality === 'fair' ? '#e6a817' : 'var(--danger)',
                      color: boardDetectionQuality === 'good' ? 'var(--accent)' : boardDetectionQuality === 'fair' ? '#e6a817' : 'var(--danger)',
                    }}
                  >
                    {boardDetectionQuality === 'good' ? '✓ Board detected' : boardDetectionQuality === 'fair' ? '~ Board estimated' : '✎ Manual crop'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Right Column: Mini Editor Board & Settings Panel */}
      <section className="side-column">
        {/* Warp Crop Preview Canvas */}
        <div className="panel" style={{ padding: '12px' }}>
          <p className="eyebrow" style={{ marginBottom: '6px' }}>Warp Preview</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <canvas
              ref={croppedCanvasRef}
              style={{
                width: '76px',
                height: '76px',
                background: '#18212a',
                borderRadius: '6px',
                border: '1px solid var(--border)'
              }}
            />
            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
              Adjust the 4 corners on the left image to align with the board edges. Use the grid editor below to place pieces manually.
            </div>
          </div>
        </div>

        {/* Board Orientation Selector */}
        <div className="panel" style={{ padding: '12px' }}>
          <p className="eyebrow" style={{ marginBottom: '8px' }}>Board Orientation</p>
          <div className="orientation-selector" style={{ display: 'flex', gap: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
              <input
                type="radio"
                name="boardOrientation"
                checked={boardOrientation === 'white'}
                onChange={() => setBoardOrientation('white')}
              />
              <span>White at bottom</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
              <input
                type="radio"
                name="boardOrientation"
                checked={boardOrientation === 'black'}
                onChange={() => setBoardOrientation('black')}
              />
              <span>Black at bottom</span>
            </label>
          </div>
        </div>

        {showOrientationConfirm && (
          <div
            className="panel"
            style={{
              background: 'rgba(142, 208, 79, 0.1)',
              border: '1px solid var(--accent)',
              padding: '12px',
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              marginBottom: '10px'
            }}
          >
            <div style={{ fontWeight: 'bold', fontSize: '13px' }}>
              🔍 Confirm Board Orientation
            </div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
              The scanner detected pieces assuming <strong>{boardOrientation === 'white' ? 'White at bottom' : 'Black at bottom'}</strong>.
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                className="primary-button"
                style={{ padding: '6px 12px', fontSize: '12px', height: 'auto' }}
                onClick={() => setShowOrientationConfirm(false)}
              >
                Confirm ({boardOrientation === 'white' ? 'White' : 'Black'} at bottom)
              </button>
              <button
                type="button"
                className="secondary-button"
                style={{ padding: '6px 12px', fontSize: '12px', height: 'auto' }}
                onClick={() => {
                  setBoardOrientation(prev => prev === 'white' ? 'black' : 'white');
                  setShowOrientationConfirm(false);
                  showToast('Board orientation flipped');
                }}
              >
                Flip Board ({boardOrientation === 'white' ? 'Black' : 'White'} at bottom)
              </button>
            </div>
          </div>
        )}

        {/* Board Editor Grid */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <h2>Board Editor</h2>

          <div style={{ width: '100%', aspectRatio: '1/1', background: '#0a0e12', padding: '4px', borderRadius: '8px' }}>
            <div
              data-testid="board-editor-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(8, 1fr)',
                gridTemplateRows: 'repeat(8, 1fr)',
                width: '100%',
                height: '100%',
                borderRadius: '6px',
                overflow: 'hidden'
              }}
            >
              {Array(64).fill(0).map((_, i) => {
                const row = Math.floor(i / 8);
                const col = i % 8;

                const gridIdx = boardOrientation === 'white' ? i : ((7 - row) * 8 + (7 - col));
                const piece = grid[gridIdx];
                const confidence = confidences[gridIdx];
                const margin = margins[gridIdx];

                const isLightSquare = (row + col) % 2 === 0;
                const squareBg = isLightSquare ? 'var(--board-light)' : 'var(--board-dark)';

                const isDragSource = dragSourceIdx === gridIdx;
                const isDragTarget = dragOverIdx === gridIdx;

                const isUncertain = modelLoaded && piece !== 'empty' && (confidence < 75 || margin < 20);

                return (
                  <button
                    key={i}
                    type="button"
                    draggable={piece !== 'empty'}
                    className={`${isDragSource ? 'drag-source' : ''} ${isDragTarget ? 'drag-target' : ''} ${isUncertain ? 'square-uncertain' : ''}`}
                    style={{
                      background: isDragTarget ? 'rgba(142, 208, 79, 0.35)' : squareBg,
                      border: isUncertain ? '3px dashed #e6a817' : 'none',
                      padding: 0,
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: piece !== 'empty' ? 'grab' : 'pointer',
                      opacity: isDragSource ? 0.4 : 1,
                      boxShadow: isUncertain ? 'inset 0 0 12px rgba(230, 168, 23, 0.4)' : 'none'
                    }}
                    onClick={() => handleSquareClick(gridIdx)}
                    onDragStart={handleSquareDragStart(gridIdx)}
                    onDragOver={handleSquareDragOver(gridIdx)}
                    onDragLeave={handleSquareDragLeave}
                    onDrop={handleSquareDrop(gridIdx)}
                    onDragEnd={handleSquareDragEnd}
                  >
                    {piece !== 'empty' && (
                      <span
                        className={`piece piece-${piece[0]}`}
                        style={{
                          fontSize: '24px',
                          textShadow: piece[0] === 'w' ? '0 0 1px #111' : 'none',
                          pointerEvents: 'none',
                        }}
                      >
                        {pieceGlyph(piece[0] as 'w' | 'b', piece[1])}
                      </span>
                    )}
                    {modelLoaded && piece !== 'empty' && (
                      <span
                        style={{
                          position: 'absolute',
                          bottom: '1px',
                          right: '2px',
                          fontSize: '8px',
                          opacity: 0.75,
                          color: (confidence < 75 || margin < 20) ? '#e6a817' : 'var(--text)',
                          fontWeight: 'bold'
                        }}
                      >
                        {confidence}%
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Piece Palette */}
          <div>
            <p className="eyebrow" style={{ marginBottom: '6px' }}>Palette Selector</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', background: 'var(--surface-2)', padding: '6px', borderRadius: '8px' }}>
              {(['wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'bk', 'bq', 'br', 'bb', 'bn', 'bp'] as const).map((piece) => (
                <button
                  key={piece}
                  className={`icon-action ${selectedPalettePiece === piece ? 'active' : ''}`}
                  style={{
                    width: '36px',
                    height: '36px',
                    padding: 0,
                    fontSize: '22px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onClick={() => setSelectedPalettePiece(piece)}
                >
                  <span className={`piece-${piece[0]}`}>{pieceGlyph(piece[0] as 'w' | 'b', piece[1])}</span>
                </button>
              ))}
              <button
                className={`icon-action ${selectedPalettePiece === 'empty' ? 'active' : ''}`}
                style={{
                  width: '36px',
                  height: '36px',
                  padding: 0,
                  fontSize: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                onClick={() => setSelectedPalettePiece('empty')}
                title="Eraser / Empty Square"
              >
                ❌
              </button>
            </div>
          </div>

          {/* Editor Actions */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button className="secondary-button" style={{ flex: 1 }} onClick={handleUndo} disabled={historyIndex <= 0}>Undo</button>
            <button className="secondary-button" style={{ flex: 1 }} onClick={handleRedo} disabled={historyIndex >= history.length - 1}>Redo</button>
            <button className="danger-button" onClick={handleClearBoard}>Clear</button>
            <button className="secondary-button" onClick={handleRestoreOriginal}>Restore</button>
          </div>
        </div>

        {/* FEN Parameters & Controls */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <h2>FEN Configuration</h2>

          <div className="settings-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <label>Side to move
              <select value={turn} onChange={(e) => setTurn(e.target.value as 'w' | 'b')}>
                <option value="w">White to move</option>
                <option value="b">Black to move</option>
              </select>
            </label>

            <label>En-passant target
              <input
                type="text"
                maxLength={2}
                style={{ height: '38px', padding: '6px', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '8px' }}
                value={enPassant}
                onChange={(e) => setEnPassant(e.target.value)}
              />
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: 'var(--muted)' }}>Castling Rights</label>
            <div style={{ display: 'flex', gap: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer' }}>
                <input type="checkbox" checked={castling.wK} onChange={(e) => setCastling({ ...castling, wK: e.target.checked })} />
                White O-O
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer' }}>
                <input type="checkbox" checked={castling.wQ} onChange={(e) => setCastling({ ...castling, wQ: e.target.checked })} />
                White O-O-O
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer' }}>
                <input type="checkbox" checked={castling.bK} onChange={(e) => setCastling({ ...castling, bK: e.target.checked })} />
                Black O-O
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer' }}>
                <input type="checkbox" checked={castling.bQ} onChange={(e) => setCastling({ ...castling, bQ: e.target.checked })} />
                Black O-O-O
              </label>
            </div>
            <p style={{ margin: '2px 0 0', fontSize: '10px', color: 'var(--danger)' }}>
              ⚠️ Defaulting castling to disabled (uncertain from image).
            </p>
          </div>

          {/* FEN Box */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: 'var(--muted)' }}>Generated FEN</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={manualFen}
                onChange={(e) => {
                  setManualFen(e.target.value);
                  try {
                    const trimmed = e.target.value.trim();
                    const parts = trimmed.split(/\s+/);
                    if (parts.length >= 1) {
                      const chess = new Chess(trimmed);
                      const nextGrid = Array(64).fill('empty');
                      const board = chess.board();
                      for (let r = 0; r < 8; r++) {
                        for (let c = 0; c < 8; c++) {
                          const piece = board[r][c];
                          const idx = boardOrientation === 'white' ? (r * 8 + c) : ((7 - r) * 8 + (7 - c));
                          if (piece) {
                            nextGrid[idx] = piece.color + piece.type;
                          }
                        }
                      }
                      setGrid(nextGrid);
                      setTurn(parts[1] === 'b' ? 'b' : 'w');
                      setCastling({
                        wK: parts[2]?.includes('K') || false,
                        wQ: parts[2]?.includes('Q') || false,
                        bK: parts[2]?.includes('k') || false,
                        bQ: parts[2]?.includes('q') || false
                      });
                      setEnPassant(parts[3] || '-');
                      setHalfmove(Number(parts[4]) || 0);
                      setFullmove(Number(parts[5]) || 1);
                    }
                  } catch (err) {
                    // Ignore syntax errors while typing
                  }
                }}
                style={{
                  flex: 1,
                  height: '38px',
                  padding: '8px',
                  background: 'var(--surface-3)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: 'var(--text)'
                }}
              />
              <button
                className="secondary-button"
                onClick={() => {
                  navigator.clipboard.writeText(manualFen);
                  showToast('FEN copied to clipboard');
                }}
              >
                Copy
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  navigator.clipboard.readText().then((val) => {
                    handleLoadFenString(val);
                  });
                }}
              >
                Paste
              </button>
            </div>
          </div>

          {/* Position validation */}
          {(!positionValidation.valid || positionValidation.warnings.length > 0) && (
            <div
              style={{
                padding: '10px',
                background: positionValidation.valid ? 'rgba(230, 168, 23, 0.1)' : 'rgba(255, 116, 116, 0.1)',
                border: `1px solid ${positionValidation.valid ? '#e6a817' : 'var(--danger)'}`,
                borderRadius: '8px',
                fontSize: '11px'
              }}
            >
              {positionValidation.errors.length > 0 && (
                <>
                  <strong style={{ color: 'var(--danger)' }}>Position Errors: </strong>
                  <ul style={{ margin: '4px 0 0', paddingLeft: '16px' }}>
                    {positionValidation.errors.map((err, idx) => <li key={`e${idx}`}>{err}</li>)}
                  </ul>
                </>
              )}
              {positionValidation.warnings.length > 0 && (
                <>
                  <strong style={{ color: '#e6a817', marginTop: positionValidation.errors.length > 0 ? '8px' : '0', display: 'block' }}>
                    Warnings:
                  </strong>
                  <ul style={{ margin: '4px 0 0', paddingLeft: '16px' }}>
                    {positionValidation.warnings.map((w, idx) => <li key={`w${idx}`}>{w}</li>)}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* Action Triggers */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
            <button
              className="primary-button"
              disabled={!canOpenInAnalysis}
              onClick={() => onOpenAnalysis(manualFen)}
            >
              Open in Analysis
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="secondary-button"
                style={{ flex: 1 }}
                disabled={!canOpenInAnalysis}
                onClick={() => onOpenPlay(manualFen, 'b')}
              >
                Play vs Stockfish
              </button>
              <button
                className="secondary-button"
                style={{ flex: 1 }}
                disabled={!canOpenInAnalysis}
                onClick={() => onSaveToArchive('Scanned Position', manualFen)}
              >
                Save to Archive
              </button>
            </div>
          </div>
        </div>

        {/* Scan History IndexedDB List */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '340px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>History</h2>
            {historyList.length > 0 && (
              <button
                className="text-button"
                onClick={async () => {
                  if (confirm('Clear all scans from history?')) {
                    await clearScanHistory();
                    loadHistory();
                    showToast('History cleared');
                  }
                }}
              >
                Clear All
              </button>
            )}
          </div>

          <div
            style={{
              overflowY: 'auto',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              paddingRight: '4px'
            }}
          >
            {historyList.length === 0 ? (
              <p style={{ margin: '14px 0', fontSize: '12px', color: 'var(--muted)', textAlign: 'center' }}>
                No local scans saved yet.
              </p>
            ) : (
              historyList.map((item) => (
                <div
                  key={item.id}
                  className="pv-line"
                  style={{
                    gridTemplateColumns: '50px 1fr auto',
                    alignItems: 'center',
                    padding: '8px',
                    gap: '10px',
                    borderRadius: '8px',
                    cursor: 'pointer'
                  }}
                  onClick={() => handleLoadHistoryItem(item)}
                >
                  <img
                    src={item.croppedImage || ''}
                    alt="cropped"
                    style={{
                      width: '44px',
                      height: '44px',
                      background: '#18212a',
                      borderRadius: '4px',
                      border: '1px solid var(--border)'
                    }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontSize: '11px', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.notes || new Date(item.date).toLocaleDateString()}
                    </span>
                    <span style={{ fontSize: '9px', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.correctedFen}
                    </span>
                  </div>
                  <button
                    className="text-button"
                    style={{ color: 'var(--danger)', padding: '4px 6px' }}
                    onClick={(e) => handleDeleteHistoryItem(item.id, e)}
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>

          {/* History Save Form */}
          {imageSrc && (
            <div style={{ display: 'flex', gap: '6px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
              <input
                type="text"
                placeholder="Scan name or notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={{
                  flex: 1,
                  height: '34px',
                  padding: '6px',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text)',
                  fontSize: '12px'
                }}
              />
              <button
                className="secondary-button"
                style={{ height: '34px', padding: '0 12px', fontSize: '12px' }}
                onClick={handleSaveScan}
              >
                Save Scan
              </button>
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
