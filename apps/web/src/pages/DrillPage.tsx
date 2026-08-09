import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  pathIdSchema,
  queueIdsSchema,
  queueLabelSchema,
  queueSourceSchema,
  type DrillPayload
} from '@kanjiscribe/shared';

import { LoadingState } from '../components/LoadingState.js';
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
  const navigate = useNavigate();

  // URL params parse through the shared schemas (ADR-0006): a junk
  // `queue_source` or `queue_label` degrades to absent rather than ever
  // reaching the api or the navigation links.
  const queueSourceParse = queueSourceSchema.safeParse(params.get('queue_source') ?? undefined);
  const queueSource = queueSourceParse.success ? queueSourceParse.data : undefined;
  const queueLabelParse = queueLabelSchema.safeParse(params.get('queue_label') ?? undefined);
  const queueLabel = queueLabelParse.success ? queueLabelParse.data : undefined;

  const [data, setData] = useState<DrillPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isReopening, setIsReopening] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fetchIdRef = useRef(0);

  const customQueueIds = useMemo(() => {
    const parsed = queueIdsSchema.safeParse(params.get('queue_ids') ?? undefined);
    return parsed.success ? parsed.data : [];
  }, [params]);

  // Route id through the shared path-id schema: junk ids are caught by the
  // fetch effect below (error state, no request); the queue math only runs
  // with valid ids once data has loaded.
  const assignmentIdParse = useMemo(() => pathIdSchema.safeParse(assignmentId), [assignmentId]);
  const parsedAssignmentId = assignmentIdParse.success ? assignmentIdParse.data : null;
  const currentAssignmentId = parsedAssignmentId ?? NaN;
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
    const fetchId = ++fetchIdRef.current;
    setData(null);
    setElapsedMs(0);
    setError(null);
    setIsReopening(false);
    setIsSubmitting(false);

    if (!assignmentIdParse.success) {
      // A malformed route id never reaches the api: surface the same 400
      // message the drill route would return through the existing error
      // state, without a request (no hang, no double-load).
      setError('Invalid assignment id');
      return;
    }

    getDrillPayload(assignmentIdParse.data, queueSource)
      .then((payload) => {
        if (fetchId === fetchIdRef.current) {
          setData(payload);
        }
      })
      .catch((err) => {
        if (fetchId === fetchIdRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load drill payload');
        }
      });
  }, [assignmentIdParse, queueSource]);

  useEffect(() => {
    if (!data || isSubmitting || isReopening) {
      return;
    }

    const timer = setInterval(() => {
      setElapsedMs((current) => current + 1000);
    }, 1000);
    return () => clearInterval(timer);
  }, [data, isSubmitting, isReopening]);

  const gloss = useMemo(() => data?.dictionary_entry.senses[0]?.glosses?.join('; ') ?? '-', [data]);

  const isCompleted = data?.assignment.status === 'completed';
  const isTransitioning = isSubmitting || isReopening;

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
    // Only reachable with loaded data, which implies a valid route id.
    if (!data || parsedAssignmentId === null) {
      return;
    }

    setIsReopening(true);
    setError(null);

    try {
      await reopenAssignment(data.assignment.id);

      // Reset timer and refresh data
      setElapsedMs(0);

      const refreshedData = await getDrillPayload(parsedAssignmentId, queueSource);
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

  if (isTransitioning) {
    return <LoadingState message="Loading next word..." />;
  }

  if (!data) {
    return <LoadingState message="Loading drill item..." />;
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
