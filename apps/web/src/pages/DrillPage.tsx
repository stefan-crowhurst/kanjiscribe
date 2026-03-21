import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { apiAssetUrl, apiRequest, formatMs } from '../lib/api.js';

type DrillPayload = {
  assignment: { id: number; assigned_for_date: string; status: string; origin: string };
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
  queue: {
    current_index: number;
    total: number;
    next_assignment_id: number | null;
    prev_assignment_id: number | null;
    day_completed_count: number;
    day_total_count: number;
  };
};

export function DrillPage() {
  const { assignmentId } = useParams();
  const [params] = useSearchParams();
  const queueSource = params.get('queue_source');
  const queueLabel = params.get('queue_label');
  const navigate = useNavigate();

  const [data, setData] = useState<DrillPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const customQueueIds = useMemo(() => {
    const raw = params.get('queue_ids');
    if (!raw) {
      return [] as number[];
    }

    const parsedIds = raw
      .split(',')
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);

    return Array.from(new Set(parsedIds));
  }, [params]);

  const currentAssignmentId = Number(assignmentId);
  const customQueueIndex = customQueueIds.findIndex((id) => id === currentAssignmentId);
  const hasCustomQueue = customQueueIndex >= 0;
  const customNextAssignmentId = hasCustomQueue ? customQueueIds[customQueueIndex + 1] ?? null : null;
  const customPrevAssignmentId = hasCustomQueue ? customQueueIds[customQueueIndex - 1] ?? null : null;

  const drillQuery = useMemo(() => {
    const query = new URLSearchParams();

    if (queueSource) {
      query.set('queue_source', queueSource);
    }

    if (hasCustomQueue) {
      query.set('queue_ids', customQueueIds.join(','));
      if (queueLabel) {
        query.set('queue_label', queueLabel);
      }
    }

    const asText = query.toString();
    return asText ? `?${asText}` : '';
  }, [customQueueIds, hasCustomQueue, queueLabel, queueSource]);

  useEffect(() => {
    if (!assignmentId) {
      return;
    }

    setElapsedMs(0);
    setError(null);

    const query = queueSource ? `?queue_source=${encodeURIComponent(queueSource)}` : '';
    apiRequest<DrillPayload>(`/assignments/${assignmentId}/drill${query}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load drill payload'));
  }, [assignmentId, queueSource]);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedMs((current) => current + 1000);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const gloss = useMemo(() => data?.dictionary_entry.senses[0]?.glosses?.join('; ') ?? '-', [data]);

  async function updateAssignment(action: 'complete' | 'skip') {
    if (!data) {
      return;
    }

    try {
      await apiRequest(`/assignments/${data.assignment.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ time_spent_ms: elapsedMs })
      });

      if (hasCustomQueue && customNextAssignmentId) {
        navigate(`/drill/${customNextAssignmentId}${drillQuery}`);
      } else if (hasCustomQueue && customPrevAssignmentId) {
        navigate(`/drill/${customPrevAssignmentId}${drillQuery}`);
      } else if (data.queue.next_assignment_id) {
        navigate(`/drill/${data.queue.next_assignment_id}${drillQuery}`);
      } else if (queueSource && data.queue.prev_assignment_id) {
        navigate(`/drill/${data.queue.prev_assignment_id}${drillQuery}`);
      } else {
        navigate(queueSource === 'backlog' ? '/backlog' : '/today');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update assignment');
    }
  }

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (!data) {
    return <p className="muted">Loading drill item...</p>;
  }

  return (
    <section className="drill-screen">
      <div className="card section-card drill-hero">
        <small className="drill-queue">
          {hasCustomQueue
            ? `${queueLabel ?? 'Backlog selection'} ${customQueueIndex + 1}/${customQueueIds.length}`
            : `Day completed ${data.queue.day_completed_count}/${data.queue.day_total_count}`}
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
        <p>Elapsed: {formatMs(elapsedMs)}</p>
        <div>
          <button className="button" onClick={() => updateAssignment('complete')}>
            Complete
          </button>
          <button className="button button-secondary" onClick={() => updateAssignment('skip')}>
            Skip
          </button>
          {(hasCustomQueue ? customPrevAssignmentId : data.queue.prev_assignment_id) ? (
            <Link
              className="button button-secondary"
              to={`/drill/${hasCustomQueue ? customPrevAssignmentId : data.queue.prev_assignment_id}${drillQuery}`}
            >
              Previous
            </Link>
          ) : null}
        </div>
      </footer>
    </section>
  );
}
