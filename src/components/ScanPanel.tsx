import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { pieceGlyph } from '../lib/chessUtils';
import { validatePosition } from '../lib/fenValidation';
import {
  clearScanHistory,
  createScanFingerprint,
  deleteScan,
  loadScanHistory,
  saveScan,
  type ScannedPosition,
  type StoredScanImage,
} from '../lib/scanHistory';
import { OcrWorkerClient, OcrWorkerError } from '../lib/OcrWorkerClient';
import {
  OfflineOcrCacheClient,
  type OfflineOcrCacheProgress,
  type OfflineOcrCacheStatus,
} from '../lib/offlineOcrCache';
import { decodeScanFile } from '../lib/scanImage';
import {
  canonicalIndexForViewIndex,
  canonicalizeImageOrder,
  canonicalSquareName,
  reverseBoardOrder,
  type ScanOrientation,
} from '../lib/scanOrientation';

interface Props {
  onOpenAnalysis: (fen: string) => void;
  onOpenPlay: (fen: string, color: 'w' | 'b') => void;
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

interface DetectResult {
  found: boolean;
  corners: Corners;
  quality: 'good' | 'fair' | 'manual';
  detectionMs: number;
}

interface WarpResult {
  warpedPixels: Uint8ClampedArray;
  warpedSize: number;
  warpMs: number;
}

interface RecognitionResult extends WarpResult {
  grid: string[];
  scores: Array<number | null>;
  margins: Array<number | null>;
  scoreKind: 'model-score' | 'unavailable';
  modelLoaded: true;
  modelLoadMs: number | null;
  inferenceMs: number;
  numTensors?: number | null;
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
  const [modelScores, setModelScores] = useState<Array<number | null>>(Array(64).fill(null));
  const [scoreMargins, setScoreMargins] = useState<Array<number | null>>(Array(64).fill(null));
  const [scoreKind, setScoreKind] = useState<'model-score' | 'unavailable'>('unavailable');
  const [modelLoaded, setModelLoaded] = useState<boolean | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [useLegacyModel, setUseLegacyModel] = useState<boolean>(() => {
    return localStorage.getItem('chess-ocr-use-legacy') === 'true';
  });
  const [modelVersion, setModelVersion] = useState<string>('');
  const [offlineCacheStatus, setOfflineCacheStatus] = useState<OfflineOcrCacheStatus | null>(null);
  const [offlineCacheProgress, setOfflineCacheProgress] = useState<OfflineOcrCacheProgress | null>(null);
  const [offlineCacheError, setOfflineCacheError] = useState<string>('');
  const [isCachingOfflineModel, setIsCachingOfflineModel] = useState(false);
  // Image orientation determines how pixel-order predictions map to a8-h1.
  // View orientation only controls rendering and must never alter the FEN.
  const [imageOrientation, setImageOrientation] = useState<ScanOrientation>('white');
  const [viewOrientation, setViewOrientation] = useState<ScanOrientation>('white');
  const [showOrientationConfirm, setShowOrientationConfirm] = useState<boolean>(false);

  const [selectedPalettePiece, setSelectedPalettePiece] = useState<string>('empty');

  // Drag & drop between squares
  const [dragSourceIdx, setDragSourceIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [moveSourceIdx, setMoveSourceIdx] = useState<number | null>(null);

  // History / Undo / Redo
  const [history, setHistory] = useState<string[][]>([Array(64).fill('empty')]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [historyList, setHistoryList] = useState<ScannedPosition[]>([]);
  const [historyPreviewUrls, setHistoryPreviewUrls] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<string>('');
  const [saveOriginalImage, setSaveOriginalImage] = useState<boolean>(false);

  // FEN configuration
  const [turn, setTurn] = useState<'w' | 'b'>('w');
  const [castling, setCastling] = useState({ wK: false, wQ: false, bK: false, bQ: false });
  const [enPassant, setEnPassant] = useState<string>('-');
  const [halfmove, setHalfmove] = useState<number>(0);
  const [fullmove, setFullmove] = useState<number>(1);
  const [manualFen, setManualFen] = useState<string>('');
  const [fenDraftDirty, setFenDraftDirty] = useState<boolean>(false);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const workerClientRef = useRef<OcrWorkerClient | null>(null);
  const offlineCacheClientRef = useRef<OfflineOcrCacheClient | null>(null);
  const croppedCanvasRef = useRef<HTMLCanvasElement>(null);
  const boardEditorPanelRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef<boolean>(true);
  const activeImageIdRef = useRef<string>('');
  const previewBlobRef = useRef<Blob | null>(null);
  const previewObjectUrlRef = useRef<string>('');
  const operationTokenRef = useRef<number>(0);
  const decodeTokenRef = useRef<number>(0);
  const draggingCornerRef = useRef<keyof Corners | null>(null);
  const imageOrientationRef = useRef<ScanOrientation>(imageOrientation);

  // Dragging corner: use ref to avoid stale closure
  const cornersRef = useRef<Corners>(corners);
  cornersRef.current = corners;
  imageOrientationRef.current = imageOrientation;

  // Load IndexedDB History on Mount
  const loadHistory = useCallback(async () => {
    try {
      const list = await loadScanHistory();
      if (mountedRef.current) setHistoryList(list);
    } catch (error) {
      if (mountedRef.current) {
        showToast(error instanceof Error ? `Could not load scan history: ${error.message}` : 'Could not load scan history');
      }
    }
  }, [showToast]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const objectUrls: string[] = [];
    const urls: Record<string, string> = {};
    for (const item of historyList) {
      const image = item.croppedImage || item.originalImage;
      if (image instanceof Blob) {
        const url = URL.createObjectURL(image);
        objectUrls.push(url);
        urls[item.id] = url;
      } else if (typeof image === 'string') {
        urls[item.id] = image;
      }
    }
    setHistoryPreviewUrls(urls);
    return () => objectUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [historyList]);

  // Track mount state for safe setState
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // OCR worker lifecycle. The client owns request IDs, timeouts, crash recovery,
  // cancellation and stale-response suppression.
  useEffect(() => {
    const base = new URL(import.meta.env.BASE_URL, window.location.href);
    const workerUrl = new URL(`scanWorker.js?legacy=${useLegacyModel}`, base).toString();
    const client = new OcrWorkerClient(() => new Worker(workerUrl, { name: 'chess-ocr-local' }), {
      defaultTimeoutMs: 45_000,
    });
    workerClientRef.current = client;

    setModelLoaded(null);
    setModelError(null);

    return () => {
      client.dispose();
      workerClientRef.current = null;
    };
  }, [useLegacyModel]);

  // Clean up object URL when component unmounts
  useEffect(() => {
    return () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }
    };
  }, []);

  // Load model version dynamically from metadata.json
  useEffect(() => {
    const base = new URL(import.meta.env.BASE_URL, window.location.href);
    const metadataPath = new URL(useLegacyModel ? 'models/chess-ocr-legacy/metadata.json' : 'models/chess-ocr/metadata.json', base).toString();
    fetch(metadataPath)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        if (data.modelVersion) {
          setModelVersion(data.modelVersion);
        } else if (data.version) {
          setModelVersion(data.version);
        } else {
          setModelVersion(useLegacyModel ? 'v1.0.0-legacy' : 'v0.3.0');
        }
      })
      .catch(() => {
        setModelVersion(useLegacyModel ? 'v1.0.0-legacy' : 'v0.3.0');
      });
  }, [useLegacyModel]);

  // The production service worker keeps OCR in a separately versioned cache.
  // Development intentionally unregisters service workers to avoid stale code.
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const client = new OfflineOcrCacheClient();
    offlineCacheClientRef.current = client;
    let active = true;
    void client.getStatus().then((status) => {
      if (active) setOfflineCacheStatus(status);
    }).catch((error) => {
      if (active) setOfflineCacheError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      active = false;
      offlineCacheClientRef.current = null;
    };
  }, []);

  const handleCacheOfflineModel = async () => {
    const client = offlineCacheClientRef.current;
    if (!client || isCachingOfflineModel) return;
    setIsCachingOfflineModel(true);
    setOfflineCacheError('');
    setOfflineCacheProgress({
      completed: offlineCacheStatus?.completed ?? 0,
      total: offlineCacheStatus?.total ?? 0,
    });
    try {
      const status = await client.cacheModel((progress) => {
        if (mountedRef.current) setOfflineCacheProgress(progress);
      });
      if (!mountedRef.current) return;
      setOfflineCacheStatus(status);
      setOfflineCacheProgress(null);
      showToast('OCR runtime and model are available offline');
    } catch (error) {
      if (mountedRef.current) {
        setOfflineCacheError(error instanceof Error ? error.message : 'The OCR model could not be stored offline.');
      }
    } finally {
      if (mountedRef.current) setIsCachingOfflineModel(false);
    }
  };

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

  const beginOperation = () => {
    const token = ++operationTokenRef.current;
    workerClientRef.current?.cancelAll('Superseded by newer scanner work.');
    setIsProcessing(true);
    setProgressStep('');
    return token;
  };

  const finishOperation = (token: number) => {
    if (mountedRef.current && operationTokenRef.current === token) {
      setIsProcessing(false);
      setProgressStep('');
    }
  };

  const invalidateAutomaticWork = (reason: string) => {
    operationTokenRef.current++;
    workerClientRef.current?.cancelAll(reason);
    setIsProcessing(false);
    setProgressStep('');
  };

  const invalidateScoresForGridChanges = (previousGrid: string[], nextGrid: string[]) => {
    setModelScores((current) => current.map((score, index) => (
      previousGrid[index] === nextGrid[index] ? score : null
    )));
    setScoreMargins((current) => current.map((margin, index) => (
      previousGrid[index] === nextGrid[index] ? margin : null
    )));
  };

  const isSupersededError = (error: unknown) => error instanceof Error
    && (/superseded|cancelled|disposed/i.test(error.message));

  const triggerWarp = async (targetCorners: Corners) => {
    const client = workerClientRef.current;
    const imageId = activeImageIdRef.current;
    if (!client || !imageId) return;
    const token = beginOperation();
    try {
      const result = await client.request<WarpResult>('warp', { imageId, corners: targetCorners }, {
        timeoutMs: 15_000,
        onProgress: setProgressStep,
      });
      if (!mountedRef.current || operationTokenRef.current !== token) return;
      renderCroppedCanvas(result.warpedPixels, result.warpedSize);
      setErrorMsg('');
    } catch (error) {
      if (!isSupersededError(error) && mountedRef.current && operationTokenRef.current === token) {
        setErrorMsg(error instanceof Error ? error.message : 'Perspective correction failed.');
      }
    } finally {
      finishOperation(token);
    }
  };

  const triggerRecognize = async (targetCorners: Corners) => {
    const client = workerClientRef.current;
    const imageId = activeImageIdRef.current;
    if (!client || !imageId) return;
    const token = beginOperation();
    try {
      const result = await client.request<RecognitionResult>('recognize', { imageId, corners: targetCorners }, {
        timeoutMs: 45_000,
        onProgress: setProgressStep,
      });
      console.log(`[ScanPanel] OCR complete, tensors: ${result.numTensors ?? 'null'}, inference time: ${result.inferenceMs}ms`);
      if (!mountedRef.current || operationTokenRef.current !== token) return;
      const orientation = imageOrientationRef.current;
      const canonicalGrid = canonicalizeImageOrder(result.grid, orientation);
      const canonicalScores = canonicalizeImageOrder(result.scores, orientation);
      const canonicalMargins = canonicalizeImageOrder(result.margins, orientation);
      setModelLoaded(true);
      setModelError(null);
      setGrid(canonicalGrid);
      setOriginalGrid(canonicalGrid);
      setModelScores(canonicalScores);
      setScoreMargins(canonicalMargins);
      setScoreKind(result.scoreKind);
      setHistory([canonicalGrid]);
      setHistoryIndex(0);
      setShowOrientationConfirm(true);
      renderCroppedCanvas(result.warpedPixels, result.warpedSize);
      setErrorMsg('');

      const validation = validatePosition(canonicalGrid);
      showToast(validation.valid
        ? 'Local piece recognition complete — verify the position'
        : 'Recognition needs manual correction');
    } catch (error) {
      if (isSupersededError(error) || !mountedRef.current || operationTokenRef.current !== token) return;
      const workerError = error instanceof OcrWorkerError ? error : null;
      const fallback = workerError?.response?.result as Partial<WarpResult> | undefined;
      if (fallback?.warpedPixels && fallback.warpedSize) {
        renderCroppedCanvas(fallback.warpedPixels, fallback.warpedSize);
      }
      const message = error instanceof Error ? error.message : 'Automatic recognition failed.';
      setModelLoaded(false);
      setModelError(message);
      setShowOrientationConfirm(false);
      setErrorMsg(`${message} The image, crop, FEN draft and manual board remain available.`);
    } finally {
      finishOperation(token);
    }
  };

  const detectTransferredImage = async (imageData: ImageData, imageId: string) => {
    const client = workerClientRef.current;
    if (!client) return;
    const token = beginOperation();
    try {
      const result = await client.request<DetectResult>('detect', { imageId, imageData }, {
        timeoutMs: 15_000,
        transfer: [imageData.data.buffer],
        onProgress: setProgressStep,
      });
      if (!mountedRef.current || operationTokenRef.current !== token || activeImageIdRef.current !== imageId) return;
      setCorners(result.corners);
      cornersRef.current = result.corners;
      setBoardDetectionQuality(result.quality);
      if (result.found) {
        showToast(result.quality === 'good'
          ? 'Board candidate detected — verify the four corners'
          : 'Board candidate estimated — verify the four corners');
        await triggerRecognize(result.corners);
      } else {
        showToast('No reliable board candidate found — adjust the four corners, then run OCR or edit manually');
        await triggerWarp(result.corners);
      }
    } catch (error) {
      if (!isSupersededError(error) && mountedRef.current && operationTokenRef.current === token) {
        setErrorMsg(error instanceof Error ? error.message : 'Board detection failed.');
      }
    } finally {
      finishOperation(token);
    }
  };

  const replacePreview = (blob: Blob) => {
    if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
    const objectUrl = URL.createObjectURL(blob);
    previewObjectUrlRef.current = objectUrl;
    previewBlobRef.current = blob;
    setImageSrc(objectUrl);
  };

  // Handle uploaded or pasted file. Existing work is preserved until the new
  // file has passed validation and decoding.
  const processFile = async (file: File, options: { preserveManualState?: boolean } = {}) => {
    const decodeToken = ++decodeTokenRef.current;
    setErrorMsg('');
    setProgressStep('Validating and decoding image');
    setIsProcessing(true);
    try {
      const decoded = await decodeScanFile(file);
      if (!mountedRef.current || decodeTokenRef.current !== decodeToken) return;
      const imageId = `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      activeImageIdRef.current = imageId;
      replacePreview(decoded.previewBlob);
      setImageDimensions({ width: decoded.width, height: decoded.height });
      if (!options.preserveManualState) {
        imageOrientationRef.current = 'white';
        setImageOrientation('white');
        setViewOrientation('white');
        setGrid(Array(64).fill('empty'));
        setOriginalGrid(Array(64).fill('empty'));
        setModelScores(Array(64).fill(null));
        setScoreMargins(Array(64).fill(null));
        setScoreKind('unavailable');
        setModelLoaded(null);
        setModelError(null);
        setShowOrientationConfirm(false);
        setHistory([Array(64).fill('empty')]);
        setHistoryIndex(0);
      }
      if (decoded.scaled) {
        showToast(`Large image safely resized from ${decoded.originalWidth}×${decoded.originalHeight} for local processing`);
      }
      await detectTransferredImage(decoded.imageData, imageId);
    } catch (error) {
      if (mountedRef.current && decodeTokenRef.current === decodeToken) {
        setErrorMsg(error instanceof Error ? error.message : 'The selected image could not be decoded.');
      }
    } finally {
      if (mountedRef.current && decodeTokenRef.current === decodeToken) {
        setIsProcessing(false);
        setProgressStep('');
      }
    }
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
    if (selectedPalettePiece === 'move') {
      if (moveSourceIdx === null) {
        if (grid[index] === 'empty') {
          showToast('Choose an occupied square to move');
          return;
        }
        setMoveSourceIdx(index);
        return;
      }
      if (moveSourceIdx === index) {
        setMoveSourceIdx(null);
        return;
      }
      const movedGrid = [...grid];
      movedGrid[index] = movedGrid[moveSourceIdx];
      movedGrid[moveSourceIdx] = 'empty';
      setMoveSourceIdx(null);
      updateGridState(movedGrid);
      return;
    }
    const nextGrid = [...grid];
    nextGrid[index] = selectedPalettePiece;
    updateGridState(nextGrid);
  };

  const updateGridState = (nextGrid: string[]) => {
    invalidateAutomaticWork('Cancelled because the board was edited manually.');
    invalidateScoresForGridChanges(grid, nextGrid);
    setGrid(nextGrid);
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push(nextGrid);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      invalidateAutomaticWork('Cancelled because a manual correction was undone.');
      invalidateScoresForGridChanges(grid, history[historyIndex - 1]);
      setHistoryIndex(historyIndex - 1);
      setGrid(history[historyIndex - 1]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      invalidateAutomaticWork('Cancelled because a manual correction was redone.');
      invalidateScoresForGridChanges(grid, history[historyIndex + 1]);
      setHistoryIndex(historyIndex + 1);
      setGrid(history[historyIndex + 1]);
    }
  };

  const handleClearBoard = () => {
    setMoveSourceIdx(null);
    updateGridState(Array(64).fill('empty'));
  };

  const handleRestoreOriginal = () => {
    updateGridState(originalGrid);
  };

  const handleImageOrientationChange = (nextOrientation: ScanOrientation) => {
    if (nextOrientation === imageOrientationRef.current) return;
    invalidateAutomaticWork('Cancelled because the image orientation changed.');
    imageOrientationRef.current = nextOrientation;
    setImageOrientation(nextOrientation);

    // Reinterpret every image-linked value together. The canonical board is
    // rotated once; the independently controlled editor view is untouched.
    setGrid((current) => reverseBoardOrder(current));
    setOriginalGrid((current) => reverseBoardOrder(current));
    setModelScores((current) => reverseBoardOrder(current));
    setScoreMargins((current) => reverseBoardOrder(current));
    setHistory((current) => current.map((entry) => reverseBoardOrder(entry)));
    setMoveSourceIdx(null);
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
        const piece = grid[r * 8 + c];
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
  }, [grid, turn, castling, enPassant, halfmove, fullmove]);

  // Synchronize manual FEN edit
  useEffect(() => {
    if (!fenDraftDirty) setManualFen(generateFenString());
  }, [fenDraftDirty, generateFenString]);

  // Apply FEN to grid state
  const handleLoadFenString = (fen: string) => {
    try {
      const chess = new Chess(fen.trim());
      const nextGrid = Array(64).fill('empty');
      const board = chess.board();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const piece = board[r][c];
          if (piece) {
            nextGrid[r * 8 + c] = piece.color + piece.type;
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
      setManualFen(fen.trim());
      setFenDraftDirty(false);
      showToast('FEN loaded successfully');
    } catch (e) {
      showToast('Invalid FEN syntax');
    }
  };

  // Drag handles management — FIXED: use letterbox-aware coordinate mapping
  const handlePointerDown = (corner: keyof Corners) => (e: React.PointerEvent) => {
    e.preventDefault();
    draggingCornerRef.current = corner;
    setDraggingCorner(corner);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const activeCorner = draggingCornerRef.current;
    if (!activeCorner || !imageContainerRef.current) return;
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

    const nextCorners = {
      ...cornersRef.current,
      [activeCorner]: { x, y }
    };
    cornersRef.current = nextCorners;
    setCorners(nextCorners);
  };

  const handlePointerUp = () => {
    if (draggingCornerRef.current) {
      draggingCornerRef.current = null;
      setDraggingCorner(null);
      setModelScores(Array(64).fill(null));
      setScoreMargins(Array(64).fill(null));
      setScoreKind('unavailable');
      setModelLoaded(null);
      setShowOrientationConfirm(false);
      void triggerWarp(cornersRef.current);
    }
  };

  const handleCornerKeyDown = (corner: keyof Corners) => (event: React.KeyboardEvent<SVGCircleElement>) => {
    const offsets: Partial<Record<string, { x: number; y: number }>> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const current = cornersRef.current[corner];
    const nextCorners = {
      ...cornersRef.current,
      [corner]: {
        x: Math.max(0, Math.min(imageDimensions.width, current.x + offset.x * step)),
        y: Math.max(0, Math.min(imageDimensions.height, current.y + offset.y * step)),
      },
    };
    cornersRef.current = nextCorners;
    setCorners(nextCorners);
    setModelScores(Array(64).fill(null));
    setScoreMargins(Array(64).fill(null));
    setScoreKind('unavailable');
    setModelLoaded(null);
    setShowOrientationConfirm(false);
    void triggerWarp(nextCorners);
  };

  // Image rotation
  const handleRotateImage = async () => {
    const blob = previewBlobRef.current;
    if (!blob) return;
    setIsProcessing(true);
    setProgressStep('Rotating image');
    try {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.height;
      canvas.height = bitmap.width;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('The browser could not allocate a rotation canvas.');
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(Math.PI / 2);
      context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
      bitmap.close();
      const rotatedBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result
          ? resolve(result)
          : reject(new Error('The rotated image could not be encoded.')), 'image/png');
      });
      canvas.width = 1;
      canvas.height = 1;
      await processFile(new File([rotatedBlob], 'rotated-scan.png', { type: 'image/png' }));
    } catch (error) {
      if (mountedRef.current) setErrorMsg(error instanceof Error ? error.message : 'Image rotation failed.');
    } finally {
      if (mountedRef.current) {
        setIsProcessing(false);
        setProgressStep('');
      }
    }
  };

  // Save Scan to IndexedDB History
  const handleSaveScan = async () => {
    const canvas = croppedCanvasRef.current;
    if (!canvas || !imageSrc) {
      showToast('Load and crop an image before saving a scan');
      return;
    }
    if (fenDraftDirty) {
      showToast('Apply or reset the FEN draft before saving this scan');
      return;
    }
    if (!fenSyntaxValid || !validatePosition(grid).valid) {
      showToast('Correct the FEN and position errors before saving this scan');
      return;
    }
    const croppedImage = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', 0.86);
    });
    if (!croppedImage) {
      showToast('Could not compress the cropped board image');
      return;
    }

    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now());
    const fingerprint = await createScanFingerprint(croppedImage, manualFen, imageOrientation);
    const castlingPart = [
      castling.wK ? 'K' : '', castling.wQ ? 'Q' : '', castling.bK ? 'k' : '', castling.bQ ? 'q' : '',
    ].join('') || '-';
    const scanItem: ScannedPosition = {
      version: 3,
      id,
      date: new Date().toISOString(),
      fingerprint,
      originalImage: saveOriginalImage ? previewBlobRef.current || undefined : undefined,
      croppedImage,
      recognizedGrid: [...originalGrid],
      correctedGrid: [...grid],
      imageOrientation,
      viewOrientation,
      fenOptions: {
        turn,
        castling: castlingPart,
        enPassant: enPassant.trim() || '-',
        halfmove,
        fullmove,
      },
      detectedFen: exportPgnFen(originalGrid),
      correctedFen: manualFen,
      modelScores: [...modelScores],
      scoreMargins: [...scoreMargins],
      scoreKind,
      model: modelLoaded ? {
        name: 'Elucidation/ChessboardFenTensorflowJs',
        revision: 'c75063981c4f781f63ac90c0c026402e23ebbef6',
      } : undefined,
      correctionHistory: history.slice(-20).map((entry) => [...entry]),
      notes: notes.trim(),
    };
    const result = await saveScan(scanItem);
    if (result.success) {
      showToast('Scan saved in history');
      setNotes('');
      await loadHistory();
    } else {
      showToast(result.message || 'Could not save scan locally');
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
    const result = await deleteScan(id);
    if (result.success) {
      showToast('Scan deleted');
      await loadHistory();
    } else {
      showToast(result.message || 'Could not delete the scan');
    }
  };

  const storedImageToBlob = async (image: StoredScanImage): Promise<Blob> => {
    if (image instanceof Blob) return image;
    const response = await fetch(image);
    return response.blob();
  };

  const renderStoredCrop = async (image: StoredScanImage | undefined) => {
    if (!image) return;
    const blob = await storedImageToBlob(image);
    const bitmap = await createImageBitmap(blob);
    const canvas = croppedCanvasRef.current;
    if (canvas) {
      canvas.width = 256;
      canvas.height = 256;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, 256, 256);
    }
    bitmap.close();
  };

  const handleLoadHistoryItem = async (item: ScannedPosition) => {
    workerClientRef.current?.cancelAll('A saved scan was opened.');
    activeImageIdRef.current = '';
    const displayImage = item.originalImage || item.croppedImage;
    if (displayImage instanceof Blob) {
      replacePreview(displayImage);
    } else if (typeof displayImage === 'string') {
      if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = '';
      previewBlobRef.current = await storedImageToBlob(displayImage);
      setImageSrc(displayImage);
    }
    if (displayImage) {
      const source = displayImage instanceof Blob ? previewObjectUrlRef.current : displayImage;
      const image = new Image();
      image.onload = () => {
        if (!mountedRef.current) return;
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        setImageDimensions({ width, height });
        const size = Math.min(width, height);
        const left = (width - size) / 2;
        const top = (height - size) / 2;
        const restoredCorners = {
          topLeft: { x: left, y: top },
          topRight: { x: left + size, y: top },
          bottomLeft: { x: left, y: top + size },
          bottomRight: { x: left + size, y: top + size },
        };
        cornersRef.current = restoredCorners;
        setCorners(restoredCorners);
      };
      image.src = source;
    }
    await renderStoredCrop(item.croppedImage);
    setOriginalGrid([...item.recognizedGrid]);
    setGrid([...item.correctedGrid]);
    setModelScores([...item.modelScores]);
    setScoreMargins([...item.scoreMargins]);
    setScoreKind(item.scoreKind);
    setModelLoaded(item.model ? true : null);
    setModelError(null);
    imageOrientationRef.current = item.imageOrientation;
    setImageOrientation(item.imageOrientation);
    setViewOrientation(item.viewOrientation);
    setTurn(item.fenOptions.turn);
    setCastling({
      wK: item.fenOptions.castling.includes('K'),
      wQ: item.fenOptions.castling.includes('Q'),
      bK: item.fenOptions.castling.includes('k'),
      bQ: item.fenOptions.castling.includes('q'),
    });
    setEnPassant(item.fenOptions.enPassant);
    setHalfmove(item.fenOptions.halfmove);
    setFullmove(item.fenOptions.fullmove);
    const restoredHistory = item.correctionHistory?.length
      ? item.correctionHistory.map((entry) => [...entry])
      : [[...item.correctedGrid]];
    setHistory(restoredHistory);
    setHistoryIndex(restoredHistory.length - 1);
    setManualFen(item.correctedFen);
    setFenDraftDirty(false);
    setNotes(item.notes);
    setBoardDetectionQuality('manual');
    setShowOrientationConfirm(false);
    showToast('Loaded scanned position from history');
  };

  const handleRerunHistoryItem = async (item: ScannedPosition, e: React.MouseEvent) => {
    e.stopPropagation();
    const image = item.originalImage || item.croppedImage;
    if (!image) {
      showToast('This saved scan has no image available for OCR');
      return;
    }
    try {
      const blob = await storedImageToBlob(image);
      const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
      await processFile(new File([blob], `saved-scan.${extension}`, { type: blob.type }), {
        preserveManualState: true,
      });
    } catch (error) {
      showToast(error instanceof Error ? `Could not rerun OCR: ${error.message}` : 'Could not rerun OCR');
    }
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

  // Downstream actions use the applied canonical editor position, never a
  // valid-looking text draft that has not yet been reconciled with the grid.
  const canOpenInAnalysis = fenSyntaxValid && !fenDraftDirty && positionValidation.valid;

  const handleValidateFenDraft = () => {
    try {
      const chess = new Chess(manualFen.trim());
      const draftGrid = Array(64).fill('empty');
      chess.board().forEach((row, rowIndex) => row.forEach((piece, columnIndex) => {
        if (piece) draftGrid[rowIndex * 8 + columnIndex] = piece.color + piece.type;
      }));
      const result = validatePosition(draftGrid);
      if (!result.valid) showToast(`FEN position error: ${result.errors[0]}`);
      else if (result.warnings.length) showToast(`FEN is usable with warning: ${result.warnings[0]}`);
      else showToast('FEN syntax and position checks passed');
    } catch {
      showToast('Invalid FEN syntax');
    }
  };

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
    <div data-testid="scan-workspace" className="scan-workspace">

      {/* Left Column: Image Area & Corner Alignment */}
      <section className="board-column scan-input-column" aria-label="OCR Scanner Input">
        <div className="panel scan-input-panel">
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

          {import.meta.env.PROD && (
            <div className="offline-model-control" aria-live="polite">
              <div>
                <strong>Offline OCR model</strong>
                <span>
                  {offlineCacheStatus?.complete
                    ? 'Ready for recognition without a network connection.'
                    : isCachingOfflineModel && offlineCacheProgress?.total
                      ? `Saving locally: ${offlineCacheProgress.completed} of ${offlineCacheProgress.total} files.`
                      : 'Save the local runtime and model for cold-offline scans.'}
                </span>
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={isCachingOfflineModel || offlineCacheStatus?.complete === true}
                onClick={() => void handleCacheOfflineModel()}
              >
                {offlineCacheStatus?.complete
                  ? 'OCR model available offline'
                  : isCachingOfflineModel
                    ? 'Downloading…'
                    : 'Download offline OCR model'}
              </button>
              {isCachingOfflineModel && offlineCacheProgress?.total ? (
                <progress
                  max={offlineCacheProgress.total}
                  value={offlineCacheProgress.completed}
                  aria-label="Offline OCR model download progress"
                />
              ) : null}
              {offlineCacheError ? <span className="state-error">{offlineCacheError}</span> : null}
            </div>
          )}

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
              <span className="scan-upload-mark" aria-hidden="true">8×8</span>
              <p style={{ margin: '0 0 6px', fontWeight: 'bold' }}>Drop a chessboard screenshot here</p>
              <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--muted)' }}>
                or click to upload, or paste directly with Ctrl+V
              </p>
              <button className="secondary-button" type="button">Select Image</button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
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
                                role="button"
                                tabIndex={0}
                                aria-label={`${corner === 'topLeft' ? 'Top left' : corner === 'topRight' ? 'Top right' : corner === 'bottomLeft' ? 'Bottom left' : 'Bottom right'} crop corner`}
                                aria-description="Drag this handle, or use the arrow keys; hold Shift for ten-pixel steps."
                                cx={pt.x}
                                cy={pt.y}
                                r="12"
                                fill="var(--accent)"
                                stroke="white"
                                strokeWidth="2"
                                style={{ pointerEvents: 'auto', cursor: 'move' }}
                                onPointerDown={handlePointerDown(corner)}
                                onKeyDown={handleCornerKeyDown(corner)}
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
              <div className="scan-crop-toolbar">
                <div className="scan-crop-actions">
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
                      setModelScores(Array(64).fill(null));
                      setScoreMargins(Array(64).fill(null));
                      setScoreKind('unavailable');
                      setModelLoaded(null);
                      setShowOrientationConfirm(false);
                      setCorners(newCorners);
                      cornersRef.current = newCorners;
                      void triggerWarp(newCorners);
                    }}
                  >
                    Reset Crop
                  </button>
                  <button
                    className="danger-button"
                    onClick={() => {
                      decodeTokenRef.current++;
                      operationTokenRef.current++;
                      workerClientRef.current?.cancelAll('Image removed.');
                      if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current);
                      previewObjectUrlRef.current = '';
                      previewBlobRef.current = null;
                      activeImageIdRef.current = '';
                      setImageSrc('');
                      setImageDimensions({ width: 0, height: 0 });
                      setGrid(Array(64).fill('empty'));
                      setOriginalGrid(Array(64).fill('empty'));
                      setModelScores(Array(64).fill(null));
                      setScoreMargins(Array(64).fill(null));
                      setModelLoaded(null);
                      setModelError(null);
                      setIsProcessing(false);
                      setErrorMsg('');
                    }}
                  >
                    Remove Image
                  </button>
                  <button
                    className="secondary-button"
                    style={{ border: modelLoaded ? '1px solid #e6a817' : '1px solid var(--border)' }}
                    disabled={isProcessing || !activeImageIdRef.current}
                    onClick={() => {
                      void triggerRecognize(cornersRef.current);
                    }}
                    title="Run or retry local piece recognition"
                  >
                    {modelLoaded === false ? 'Retry OCR' : 'Run OCR'}
                  </button>
                </div>

                <div className="scan-crop-status">
                  {modelLoaded === false && (
                    <span style={{ color: 'var(--danger)', fontSize: '11px' }}>
                      Model unavailable: {modelError || 'files missing'}
                    </span>
                  )}
                  {modelLoaded === true && (
                    <span
                      className="experimental-badge"
                      style={!positionValidation.valid ? {
                        backgroundColor: 'var(--danger)',
                        color: '#fff',
                        borderColor: 'var(--danger)'
                      } : undefined}
                    >
                      {!positionValidation.valid ? 'Recognition needs manual correction' : 'OCR Active (Experimental)'}
                    </span>
                  )}
                  <span
                    className={`pill ${boardDetectionQuality === 'good' ? '' : boardDetectionQuality === 'fair' ? 'experimental-badge' : ''}`}
                    style={{
                      borderColor: boardDetectionQuality === 'good' ? 'var(--accent)' : boardDetectionQuality === 'fair' ? '#e6a817' : 'var(--danger)',
                      color: boardDetectionQuality === 'good' ? 'var(--accent)' : boardDetectionQuality === 'fair' ? '#e6a817' : 'var(--danger)',
                    }}
                  >
                    {boardDetectionQuality === 'good' ? 'Board detected' : boardDetectionQuality === 'fair' ? 'Board estimated' : 'Manual crop'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: '11px', color: 'var(--muted)' }}>
                  <span>Model: <strong>{modelVersion || 'loading...'}</strong></span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', marginLeft: 'auto' }}>
                    <input
                      type="checkbox"
                      checked={useLegacyModel}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setUseLegacyModel(val);
                        localStorage.setItem('chess-ocr-use-legacy', String(val));
                      }}
                      style={{ cursor: 'pointer', margin: 0 }}
                    />
                    <span>Use Legacy Fallback</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Right Column: Mini Editor Board & Settings Panel */}
      <section className="side-column scan-side-column">
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

        {/* Image interpretation and editor view are deliberately independent. */}
        <div className="panel" style={{ padding: '12px' }}>
          <p className="eyebrow" style={{ marginBottom: '8px' }}>Image Orientation</p>
          <div className="orientation-selector">
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
              <input
                type="radio"
                name="imageOrientation"
                checked={imageOrientation === 'white'}
                onChange={() => handleImageOrientationChange('white')}
              />
              <span>White at bottom</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
              <input
                type="radio"
                name="imageOrientation"
                checked={imageOrientation === 'black'}
                onChange={() => handleImageOrientationChange('black')}
              />
              <span>Black at bottom</span>
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setViewOrientation((current) => current === 'white' ? 'black' : 'white')}
              title="Rotate only the editor view; the FEN and position remain unchanged"
            >
              Flip editor view ({viewOrientation === 'white' ? 'White' : 'Black'} at bottom)
            </button>
          </div>
          <p className="helper-text">Image orientation maps detected pixels to chess coordinates. Flipping the editor view never changes the position.</p>
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
              Confirm Board Orientation
            </div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
              The scanner interpreted the screenshot with <strong>{imageOrientation === 'white' ? 'White at bottom' : 'Black at bottom'}</strong>.
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                className="primary-button"
                style={{ padding: '6px 12px', fontSize: '12px', height: 'auto' }}
                onClick={() => setShowOrientationConfirm(false)}
              >
                Confirm ({imageOrientation === 'white' ? 'White' : 'Black'} at bottom)
              </button>
              <button
                type="button"
                className="secondary-button"
                style={{ padding: '6px 12px', fontSize: '12px', height: 'auto' }}
                onClick={() => {
                  handleImageOrientationChange(imageOrientation === 'white' ? 'black' : 'white');
                  setShowOrientationConfirm(false);
                  showToast('Screenshot orientation reinterpreted');
                }}
              >
                Use {imageOrientation === 'white' ? 'Black' : 'White'} at bottom
              </button>
            </div>
          </div>
        )}

        {/* Board Editor Grid */}
        <div ref={boardEditorPanelRef} tabIndex={-1} className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <h2>Board Editor</h2>

          <div className="scan-board-frame">
            <div
              data-testid="board-editor-grid"
              className="scan-board-grid"
            >
              {Array(64).fill(0).map((_, i) => {
                const row = Math.floor(i / 8);
                const col = i % 8;

                const gridIdx = canonicalIndexForViewIndex(i, viewOrientation);
                const piece = grid[gridIdx];
                const modelScore = modelScores[gridIdx];
                const scoreMargin = scoreMargins[gridIdx];

                const isLightSquare = (row + col) % 2 === 0;
                const squareBg = isLightSquare ? 'var(--board-light)' : 'var(--board-dark)';

                const isDragSource = dragSourceIdx === gridIdx;
                const isDragTarget = dragOverIdx === gridIdx;
                const isMoveSource = moveSourceIdx === gridIdx;
                const squareName = canonicalSquareName(gridIdx);
                const pieceName = piece === 'empty'
                  ? 'empty'
                  : `${piece[0] === 'w' ? 'white' : 'black'} ${({ k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' } as Record<string, string>)[piece[1]]}`;

                const isUncertain = Boolean(modelLoaded && piece !== 'empty' && (
                  scoreKind === 'unavailable'
                  || modelScore === null
                  || scoreMargin === null
                  || modelScore < 0.75
                  || scoreMargin < 0.2
                ));

                return (
                  <button
                    key={i}
                    type="button"
                    aria-label={`${squareName}, ${pieceName}${isMoveSource ? ', selected to move' : ''}`}
                    aria-pressed={isMoveSource}
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
                      boxShadow: isMoveSource
                        ? 'inset 0 0 0 4px var(--accent)'
                        : isUncertain ? 'inset 0 0 12px rgba(230, 168, 23, 0.4)' : 'none'
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
                          textShadow: piece[0] === 'w' ? '0 0 1px #111' : 'none',
                          pointerEvents: 'none',
                        }}
                      >
                        {pieceGlyph(piece[0] as 'w' | 'b', piece[1])}
                      </span>
                    )}
                    {modelLoaded && piece !== 'empty' && (
                      <span
                        aria-label={scoreKind === 'model-score' && modelScore !== null
                          ? `Model score ${Math.round(modelScore * 100)} percent${scoreMargin !== null ? `; score margin ${Math.round(scoreMargin * 100)} percent` : ''}`
                          : 'Model score unavailable'}
                        title={scoreKind === 'model-score' && modelScore !== null
                          ? `Model score: ${Math.round(modelScore * 100)}%${scoreMargin !== null ? `; score margin: ${Math.round(scoreMargin * 100)}%` : ''}`
                          : 'Model score unavailable'}
                        style={{
                          position: 'absolute',
                          bottom: '1px',
                          right: '2px',
                          fontSize: '8px',
                          opacity: 0.75,
                          color: isUncertain ? '#e6a817' : 'var(--text)',
                          fontWeight: 'bold'
                        }}
                      >
                        {scoreKind === 'model-score' && modelScore !== null
                          ? `${Math.round(modelScore * 100)}%`
                          : '—'}
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
                  aria-label={`Place ${piece[0] === 'w' ? 'white' : 'black'} ${piece[1]}`}
                  aria-pressed={selectedPalettePiece === piece}
                  title={`Place ${piece}`}
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
                aria-pressed={selectedPalettePiece === 'empty'}
                aria-label="Erase piece"
                title="Eraser / Empty Square"
              >
                ×
              </button>
              <button
                className={`icon-action ${selectedPalettePiece === 'move' ? 'active' : ''}`}
                style={{ minWidth: '58px', height: '36px', padding: '0 8px' }}
                onClick={() => {
                  setSelectedPalettePiece('move');
                  setMoveSourceIdx(null);
                }}
                aria-pressed={selectedPalettePiece === 'move'}
                title="Move a piece with two taps or clicks"
              >
                Move
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

          <div className="settings-grid scan-fen-settings">
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
            <div className="scan-castling-options">
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
              Castling starts disabled because it cannot be inferred reliably from an image.
            </p>
          </div>

          {/* FEN Box */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: 'var(--muted)' }} htmlFor="scan-fen-draft">
              Editable FEN {fenDraftDirty ? '(draft — apply when ready)' : '(matches board editor)'}
            </label>
            <div className="scan-fen-row">
              <input
                id="scan-fen-draft"
                type="text"
                value={manualFen}
                onChange={(e) => {
                  setManualFen(e.target.value);
                  setFenDraftDirty(true);
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
                disabled={!fenDraftDirty || !fenSyntaxValid}
                onClick={() => handleLoadFenString(manualFen)}
              >
                Apply FEN
              </button>
              <button className="secondary-button" onClick={handleValidateFenDraft}>
                Validate FEN
              </button>
              {fenDraftDirty && (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setManualFen(generateFenString());
                    setFenDraftDirty(false);
                  }}
                >
                  Reset
                </button>
              )}
              <button
                className="secondary-button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(manualFen);
                    showToast('FEN copied to clipboard');
                  } catch {
                    showToast('Clipboard access failed; select and copy the FEN manually');
                  }
                }}
              >
                Copy
              </button>
              <button
                className="secondary-button"
                onClick={async () => {
                  try {
                    handleLoadFenString(await navigator.clipboard.readText());
                  } catch {
                    showToast('Clipboard access failed; paste into the FEN field manually');
                  }
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
              Analyze position
            </button>
            <div className="scan-action-row">
              <button
                className="secondary-button"
                style={{ flex: 1 }}
                disabled={!canOpenInAnalysis}
                onClick={() => onOpenPlay(manualFen, 'w')}
              >
                Play as White
              </button>
              <button
                className="secondary-button"
                style={{ flex: 1 }}
                disabled={!canOpenInAnalysis}
                onClick={() => onOpenPlay(manualFen, 'b')}
              >
                Play as Black
              </button>
            </div>
            <div className="scan-action-row">
              <button
                className="secondary-button"
                style={{ flex: 1 }}
                onClick={() => {
                  boardEditorPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  boardEditorPanelRef.current?.focus({ preventScroll: true });
                }}
              >
                Open in Board Editor
              </button>
              <button
                className="secondary-button"
                style={{ flex: 1 }}
                disabled={!canOpenInAnalysis}
                onClick={() => onSaveToArchive('Scanned Position', manualFen)}
              >
                Save to Archive
              </button>
              <button
                className="secondary-button"
                style={{ flex: 1 }}
                disabled={!imageSrc}
                onClick={() => void handleSaveScan()}
              >
                Save scan
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
                    const result = await clearScanHistory();
                    if (result.success) {
                      await loadHistory();
                      showToast('History cleared');
                    } else {
                      showToast(result.message || 'Could not clear scan history');
                    }
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
                  onClick={() => void handleLoadHistoryItem(item)}
                >
                  <img
                    src={historyPreviewUrls[item.id] || ''}
                    alt="Saved cropped chessboard"
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <button
                      className="text-button"
                      style={{ padding: '4px 6px' }}
                      onClick={(e) => void handleRerunHistoryItem(item, e)}
                    >
                      Rerun OCR
                    </button>
                    <button
                      className="text-button"
                      style={{ color: 'var(--danger)', padding: '4px 6px' }}
                      onClick={(e) => void handleDeleteHistoryItem(item.id, e)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* History Save Form */}
          {imageSrc && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
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
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--muted)', width: '100%' }}>
                <input
                  type="checkbox"
                  checked={saveOriginalImage}
                  onChange={(event) => setSaveOriginalImage(event.target.checked)}
                />
                Include the original working image (uses more local storage)
              </label>
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
