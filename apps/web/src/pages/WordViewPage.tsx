import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { apiAssetUrl, apiRequest, formatMs } from '../lib/api.js';

type ViewPayload = {
  assignment: { 
    id: number; 
    assigned_for_date: string; 
    status: string; 
    origin: string;
    time_spent_ms: number | null;
  };
  study_item: { id: number; surface_form: string; selected_reading: string };
  dictionary_entry: {
    id: number;
    is_common: boolean;
    primary_spelling: string;
    primary_reading: string;
    senses: Array<{ sense_index: number; glosses: string[]; parts_of_speech: string[] }>;
  };
  kanji: Array<{
    literal: string;
    position: number;
    meanings: string[];
    onyomi: string[];
    kunyomi: string[];
    stroke_count: number;
    grade: number | null;
    stroke_asset_url: string | null;
  }>;
};

export function WordViewPage() {
  const { assignmentId } = useParams();
  const [params] = useSearchParams();
  const dayDate = params.get('day');
  const [data, setData] = useState<ViewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const idsParam = params.get('ids');
  const ids = useMemo(() => {
    if (!idsParam) return [];
    return idsParam.split(',').map(Number).filter(id => id > 0);
  }, [idsParam]);
  
  const currentIndex = useMemo(() => {
    if (!assignmentId || ids.length === 0) return -1;
    return ids.findIndex(id => id === Number(assignmentId));
  }, [assignmentId, ids]);

  const prevId = currentIndex > 0 ? ids[currentIndex - 1] : null;
  const nextId = currentIndex >= 0 && currentIndex < ids.length - 1 ? ids[currentIndex + 1] : null;

  useEffect(() => {
    if (!assignmentId) {
      return;
    }

    setError(null);

    apiRequest<ViewPayload>(`/assignments/${assignmentId}/view`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load word details'));
  }, [assignmentId]);

  const gloss = useMemo(() => data?.dictionary_entry.senses[0]?.glosses?.join('; ') ?? '-', [data]);

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (!data) {
    return <p className="muted">Loading word details...</p>;
  }

  const backLink = dayDate ? `/day/${dayDate}` : '/';
  
  const buildNavUrl = (targetId: number) => {
    const query = new URLSearchParams();
    query.set('day', dayDate ?? '');
    if (ids.length > 0) {
      query.set('ids', ids.join(','));
    }
    return `/word/${targetId}?${query.toString()}`;
  };

  return (
    <section className="drill-screen">
      <div className="card section-card drill-hero drill-hero--completed">
        <small className="drill-queue">
          Viewing word {currentIndex >= 0 ? `${currentIndex + 1}/${ids.length}` : 'details'}
          {data.assignment.time_spent_ms !== null && (
            <span className="drill-time-spent"> • Time spent: {formatMs(data.assignment.time_spent_ms)}</span>
          )}
        </small>
        <div className="drill-hero-content">
          <div className="drill-word-block">
            <h2 className="drill-word-title">
              <ruby>
                {data.study_item.surface_form}
                <rt>{data.study_item.selected_reading}</rt>
              </ruby>
            </h2>
          </div>
          <div className="drill-gloss-block">
            <p>{gloss}</p>
          </div>
        </div>
      </div>

      <div className="kanji-grid">
        {data.kanji.length === 0 ? (
          <article className="card">
            <p className="muted">Kana-only word. No kanji panels for this entry.</p>
          </article>
        ) : (
          data.kanji.map((item) => (
            <article className="card kanji-card" key={`${item.literal}-${item.position}`}>
              <h3>{item.literal}</h3>
              <p>
                <strong>Meanings:</strong> {item.meanings.join(', ') || '-'}
              </p>
              <p>
                <strong>Kun:</strong> {item.kunyomi.join(', ') || '-'}
              </p>
              <p>
                <strong>On:</strong> {item.onyomi.join(', ') || '-'}
              </p>
              <p>
                <strong>Strokes:</strong> {item.stroke_count}
              </p>
              {item.stroke_asset_url ? (
                <img src={apiAssetUrl(item.stroke_asset_url)} alt={`${item.literal} stroke order`} loading="lazy" />
              ) : (
                <p className="muted">No stroke asset available.</p>
              )}
            </article>
          ))
        )}
      </div>

      <footer className="drill-footer card">
        <Link className="button button-secondary" to={backLink}>
          Back to day
        </Link>
        <div>
          {prevId ? (
            <Link className="button button-secondary" to={buildNavUrl(prevId)}>
              Previous
            </Link>
          ) : null}
          {nextId ? (
            <Link className="button" to={buildNavUrl(nextId)}>
              Next
            </Link>
          ) : null}
        </div>
      </footer>
    </section>
  );
}
