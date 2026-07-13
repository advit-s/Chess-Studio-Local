import type { ReviewMove } from '../types/chess';
import { accuracyFromReview, cpToPawns } from '../lib/chessUtils';

interface Props {
  review: ReviewMove[];
  running: boolean;
  progress: number;
  onStart: () => void;
  onCancel: () => void;
  onSelect: (item: ReviewMove) => void;
}

export function ReviewPanel({ review, running, progress, onStart, onCancel, onSelect }: Props) {
  const whiteAccuracy = accuracyFromReview(review, 'w');
  const blackAccuracy = accuracyFromReview(review, 'b');

  return (
    <section className="panel review-panel">
      <div className="panel-title-row">
        <div><p className="eyebrow">Game report</p><h2>Move-by-move review</h2></div>
        {running
          ? <button className="secondary-button" onClick={onCancel}>Cancel</button>
          : <button className="primary-button" onClick={onStart}>{review.length ? 'Run again' : 'Analyze game'}</button>}
      </div>
      {running && <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>}
      {review.length > 0 && (
        <>
          <div className="accuracy-grid">
            <div><span>White accuracy</span><strong>{whiteAccuracy.toFixed(1)}</strong></div>
            <div><span>Black accuracy</span><strong>{blackAccuracy.toFixed(1)}</strong></div>
          </div>
          <div className="review-list">
            {review.map((item) => (
              <button key={item.ply} className="review-move" onClick={() => onSelect(item)}>
                <span className={`classification ${item.classification}`}>{item.classification[0].toUpperCase()}</span>
                <strong>{Math.ceil(item.ply / 2)}{item.mover === 'w' ? '.' : '…'} {item.san}</strong>
                <span>{cpToPawns(item.evalAfter)}</span>
                <small>loss {Math.round(item.loss)} cp</small>
              </button>
            ))}
          </div>
        </>
      )}
      {!running && review.length === 0 && <div className="empty-note large">Analyze every move locally and classify inaccuracies, mistakes, and blunders.</div>}
    </section>
  );
}
