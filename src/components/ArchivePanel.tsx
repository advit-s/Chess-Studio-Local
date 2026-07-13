import type { SavedGame } from '../types/chess';

interface Props {
  games: SavedGame[];
  onOpen: (game: SavedGame) => void;
  onDelete: (id: string) => void;
}

export function ArchivePanel({ games, onOpen, onDelete }: Props) {
  return (
    <section className="panel archive-panel">
      <div className="panel-title-row"><div><p className="eyebrow">On this device</p><h2>Game archive</h2></div><span className="pill">{games.length} saved</span></div>
      {games.length === 0 && <div className="empty-note large">Save a game from the toolbar to keep it in your local Chrome storage.</div>}
      <div className="archive-list">
        {games.map((game) => (
          <article className="archive-card" key={game.id}>
            <button className="archive-main" onClick={() => onOpen(game)}>
              <strong>{game.name}</strong>
              <span>{game.moveCount} moves · {game.result}</span>
              <small>{new Date(game.updatedAt).toLocaleString()}</small>
            </button>
            <button className="danger-button" onClick={() => onDelete(game.id)}>Delete</button>
          </article>
        ))}
      </div>
    </section>
  );
}
