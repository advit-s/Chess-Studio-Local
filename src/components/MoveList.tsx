import type { Move } from 'chess.js';

interface Props {
  moves: Move[];
  currentPly: number;
  onJump: (ply: number) => void;
}

export function MoveList({ moves, currentPly, onJump }: Props) {
  const rows: Array<{ number: number; white?: Move; black?: Move; whitePly: number; blackPly: number }> = [];
  for (let index = 0; index < moves.length; index += 2) {
    rows.push({
      number: index / 2 + 1,
      white: moves[index],
      black: moves[index + 1],
      whitePly: index + 1,
      blackPly: index + 2,
    });
  }

  return (
    <div className="move-list" aria-label="Move history">
      {rows.length === 0 && <div className="empty-note">Moves will appear here.</div>}
      {rows.map((row) => (
        <div className="move-row" key={row.number}>
          <span className="move-number">{row.number}.</span>
          <button className={currentPly === row.whitePly ? 'active' : ''} onClick={() => onJump(row.whitePly)}>{row.white?.san}</button>
          <button className={currentPly === row.blackPly ? 'active' : ''} onClick={() => row.black && onJump(row.blackPly)}>{row.black?.san}</button>
        </div>
      ))}
    </div>
  );
}
