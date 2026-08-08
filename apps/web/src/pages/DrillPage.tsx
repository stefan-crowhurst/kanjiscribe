import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { type DrillPayload } from '@kanjiscribe/shared';

import {
  apiAssetUrl,
  completeAssignment,
  formatMs,
  getDrillPayload,
  listAssignments,
  reopenAssignment,
  skipAssignment
} from '../lib/api.js';

export function DrillPage() {
  const { assignmentId } = useParams();
  const [params] = useSearchParams();
  const queueSource = params.get('queue_source');
  const queueLabel = params.get('queue_label');
  const navigate = useNavigate();

  const [data, setData] = useState<DrillPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isReopening, setIsReopening] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
  const nextAssignmentIdForRender = hasCustomQueue ? customNextAssignmentId : data?.queue.next_assignment_id ?? null;

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
    setIsReopening(false);
    setIsSubmitting(false);

    getDrillPayload(Number(assignmentId), queueSource ?? undefined)
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

  const isCompleted = data?.assignment.status === 'completed';

  async function updateAssignment(action: 'complete' | 'skip') {
    if (!data || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (action === 'complete') {
        await completeAssignment(data.assignment.id, elapsedMs);
      } else {
        await skipAssignment(data.assignment.id, elapsedMs);
      }

      let nextAssignmentId: number | null;

      if (hasCustomQueue) {
        nextAssignmentId = customNextAssignmentId;
      } else if (queueSource === 'today' && data.queue.next_assignment_id) {
        nextAssignmentId = data.queue.next_assignment_id;
      } else {
        const today = data.assignment.assigned_for_date;
        const pendingRes = await listAssignments({ status: 'pending', date: today });
        nextAssignmentId = pendingRes.assignments[0]?.id ?? null;
      }

      if (nextAssignmentId) {
        navigate(`/drill/${nextAssignmentId}${drillQuery}`);
      } else if (queueSource === 'backlog') {
        navigate('/backlog');
      } else {
        navigate('/today');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update assignment');
      setIsSubmitting(false);
    }
  }

  async function handleReopen() {
    if (!data) {
      return;
    }

    setIsReopening(true);
    setError(null);

    try {
      await reopenAssignment(data.assignment.id);

      // Reset timer and refresh data
      setElapsedMs(0);

      const refreshedData = await getDrillPayload(Number(assignmentId), queueSource ?? undefined);
      setData(refreshedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reopen assignment');
    } finally {
      setIsReopening(false);
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
      <div className={`card section-card drill-hero ${isCompleted ? 'drill-hero--completed' : ''}`}>
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
        <p>
          This word: {formatMs(elapsedMs)} - Total: {formatMs((data?.day_total_time_ms ?? 0) + elapsedMs)}
        </p>
        <div>
          {isCompleted ? (
            <button 
              className="button" 
              onClick={handleReopen}
              disabled={isReopening}
            >
              {isReopening ? 'Reopening...' : 'Reopen'}
            </button>
          ) : (
            <>
              <button 
                className="button" 
                onClick={() => updateAssignment('complete')}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Processing...' : 'Complete'}
              </button>
              {nextAssignmentIdForRender ? (
                <button 
                  className="button button-secondary" 
                  onClick={() => updateAssignment('skip')}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Processing...' : 'Skip'}
                </button>
              ) : null}
            </>
          )}
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
