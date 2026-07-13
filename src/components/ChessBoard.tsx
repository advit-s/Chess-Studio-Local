import { memo, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { FILES, RANKS, pieceGlyph, squareColor } from '../lib/chessUtils';
import type { BoardOrientation } from '../types/chess';

interface BoardPiece { color: Color; type: PieceSymbol }
interface Arrow { from: Square; to: Square; tone?: 'primary' | 'secondary' | 'danger' }
interface TouchDrag {
  from: Square;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  piece: BoardPiece;
}

interface Props {
  position: Map<Square, BoardPiece>;
  orientation: BoardOrientation;
  selected?: Square;
  legalTargets: Square[];
  lastMove?: { from: Square; to: Square };
  checkSquare?: Square;
  arrows?: Arrow[];
  disabled?: boolean;
  onSquareClick: (square: Square) => void;
  onDrop: (from: Square, to: Square) => boolean;
}

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

export const ChessBoard = memo(function ChessBoard({
  position, orientation, selected, legalTargets, lastMove, checkSquare, arrows = [], disabled, onSquareClick, onDrop,
}: Props) {
  const files = useMemo(
    () => orientation === 'white' ? [...FILES] : [...FILES].reverse(),
    [orientation],
  );
  const ranks = useMemo(
    () => orientation === 'white' ? [...RANKS] : [...RANKS].reverse(),
    [orientation],
  );
  const squares = useMemo(
    () => ranks.flatMap((rank) => files.map((file) => (file + rank) as Square)),
    [files, ranks],
  );
  const targetSet = useMemo(() => new Set(legalTargets), [legalTargets]);
  const touchDragRef = useRef<TouchDrag | undefined>(undefined);
  const [touchDrag, setTouchDrag] = useState<TouchDrag>();

  const center = (square: Square) => {
    const fileIndex = files.indexOf(square[0] as (typeof FILES)[number]);
    const rankIndex = ranks.indexOf(square[1] as (typeof RANKS)[number]);
    return { x: (fileIndex + 0.5) * 12.5, y: (rankIndex + 0.5) * 12.5 };
  };

  const beginTouchDrag = (
    event: ReactPointerEvent<HTMLSpanElement>,
    square: Square,
    piece: BoardPiece,
  ) => {
    if (event.pointerType === 'mouse' || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const drag: TouchDrag = {
      from: square,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      piece,
    };
    touchDragRef.current = drag;
    setTouchDrag(drag);
  };

  const moveTouchDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = touchDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const moved = drag.moved || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6;
    const next = { ...drag, x: event.clientX, y: event.clientY, moved };
    touchDragRef.current = next;
    setTouchDrag(next);
  };

  const finishTouchDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = touchDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const target = element?.closest<HTMLElement>('[data-square]')?.dataset.square as Square | undefined;
    if (drag.moved && target) onDrop(drag.from, target);
    else onSquareClick(drag.from);
    touchDragRef.current = undefined;
    setTouchDrag(undefined);
  };

  return (
    <div className="board-shell" id="chessboard-container" aria-label="Chess board">
      <div className={'chessboard' + (disabled ? ' board-disabled' : '')} data-testid="chessboard">
        {squares.map((square, index) => {
          const piece = position.get(square);
          const isTarget = targetSet.has(square);
          const isSelected = square === selected;
          const wasMoved = square === lastMove?.from || square === lastMove?.to;
          const isCheck = square === checkSquare;
          const row = Math.floor(index / 8);
          const col = index % 8;
          const classes = [
            'square',
            squareColor(square),
            isSelected ? 'selected' : '',
            wasMoved ? 'last-move' : '',
            isCheck ? 'in-check' : '',
          ].filter(Boolean).join(' ');
          return (
            <button
              key={square}
              type="button"
              data-square={square}
              className={classes}
              onClick={() => !disabled && onSquareClick(square)}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = event.dataTransfer.getData('text/chess-square') as Square;
                if (from && !disabled) onDrop(from, square);
              }}
              aria-label={
                square +
                (piece ? ' ' + (piece.color === 'w' ? 'white' : 'black') + ' ' + PIECE_NAMES[piece.type] : '')
              }
            >
              {col === 0 && <span className="coord rank-coord">{square[1]}</span>}
              {row === 7 && <span className="coord file-coord">{square[0]}</span>}
              {isTarget && <span className={'move-dot' + (piece ? ' capture' : '')} />}
              {piece && (
                <span
                  className={'piece piece-' + piece.color}
                  data-piece={piece.color + piece.type}
                  draggable={!disabled}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/chess-square', square);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onPointerDown={(event) => beginTouchDrag(event, square, piece)}
                  onPointerMove={moveTouchDrag}
                  onPointerUp={finishTouchDrag}
                  onPointerCancel={() => {
                    touchDragRef.current = undefined;
                    setTouchDrag(undefined);
                  }}
                >
                  {pieceGlyph(piece.color, piece.type)}
                </span>
              )}
            </button>
          );
        })}
        <svg className="board-arrows" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            {(['primary', 'secondary', 'danger'] as const).map((tone) => (
              <marker key={tone} id={'arrow-' + tone} markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
                <path d="M0,0 L4,2 L0,4 Z" />
              </marker>
            ))}
          </defs>
          {arrows.map((arrow, index) => {
            const from = center(arrow.from);
            const to = center(arrow.to);
            const tone = arrow.tone ?? 'primary';
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const length = Math.sqrt(dx * dx + dy * dy) || 1;
            const endX = to.x - (dx / length) * 3.4;
            const endY = to.y - (dy / length) * 3.4;
            return (
              <line
                key={arrow.from + '-' + arrow.to + '-' + index}
                className={'arrow-' + tone}
                x1={from.x}
                y1={from.y}
                x2={endX}
                y2={endY}
                markerEnd={'url(#arrow-' + tone + ')'}
              />
            );
          })}
        </svg>
      </div>
      {touchDrag && (
        <span
          className={'drag-ghost piece piece-' + touchDrag.piece.color}
          style={{ left: touchDrag.x, top: touchDrag.y }}
          aria-hidden="true"
        >
          {pieceGlyph(touchDrag.piece.color, touchDrag.piece.type)}
        </span>
      )}
    </div>
  );
});
