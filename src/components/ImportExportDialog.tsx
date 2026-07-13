import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  fen: string;
  pgn: string;
  onClose: () => void;
  onLoadFen: (fen: string) => void;
  onLoadPgn: (pgn: string) => void;
}

export function ImportExportDialog({ open, fen, pgn, onClose, onLoadFen, onLoadPgn }: Props) {
  const [tab, setTab] = useState<'fen' | 'pgn'>('pgn');
  const [value, setValue] = useState(pgn);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setValue(tab === 'fen' ? fen : pgn);
      setError('');
    }
  }, [open, tab, fen, pgn]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  const apply = () => {
    try {
      if (tab === 'fen') onLoadFen(value.trim());
      else onLoadPgn(value.trim());
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setError('');
    } catch {
      setError('Chrome could not access the clipboard. Select the text and copy it manually.');
    }
  };

  const downloadPgn = () => {
    const blob = new Blob([value], { type: 'application/x-chess-pgn;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chess-studio-game.pgn';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="panel-title-row">
          <div><p className="eyebrow">Position data</p><h2>Import or export</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="segmented">
          <button className={tab === 'pgn' ? 'active' : ''} onClick={() => setTab('pgn')}>PGN</button>
          <button className={tab === 'fen' ? 'active' : ''} onClick={() => setTab('fen')}>FEN</button>
        </div>
        <textarea
          aria-label={tab === 'fen' ? 'FEN text' : 'PGN text'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoFocus
        />
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="dialog-actions">
          {tab === 'pgn' && <button className="secondary-button" onClick={downloadPgn}>Download PGN</button>}
          <button className="secondary-button" onClick={copy}>Copy</button>
          <button className="primary-button" onClick={apply}>Load {tab.toUpperCase()}</button>
        </div>
      </div>
    </div>
  );
}
