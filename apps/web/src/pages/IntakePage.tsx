import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { apiRequest, todayDateString } from '../lib/api.js';

type SearchResult = {
  entry_id: number;
  primary_spelling: string | null;
  primary_reading: string | null;
  glosses: string[];
  is_common: boolean;
  readings: Array<{ text: string; no_kanji: boolean }>;
  spellings: Array<{ text: string; is_primary: boolean }>;
  today_assigned: boolean;
  match_type: string;
};

type SearchResponse = { results: SearchResult[] };

type DashboardStatsResponse = {
  today: { total: number };
  overdue: { total_pending: number; incomplete_days: number; oldest_date: string | null };
};

export function IntakePage() {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [selectedReading, setSelectedReading] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [intakeStats, setIntakeStats] = useState<DashboardStatsResponse | null>(null);

  const selectedEntry = useMemo(
    () => results.find((entry) => entry.entry_id === selectedEntryId) ?? null,
    [results, selectedEntryId]
  );

  async function loadIntakeStats() {
    try {
      const dashboardStats = await apiRequest<DashboardStatsResponse>('/stats/dashboard');
      setIntakeStats(dashboardStats);
    } catch {
      setIntakeStats(null);
    }
  }

  useEffect(() => {
    loadIntakeStats();
    searchInputRef.current?.focus();
  }, []);

  async function onSearch(event: FormEvent) {
    event.preventDefault();

    if (isSearching) {
      return;
    }

    setError(null);
    setStatus(null);
    setSelectedEntryId(null);
    setSelectedReading('');
    setResults([]);

    if (!query.trim()) {
      setError('Please enter a word to search.');
      return;
    }

    setIsSearching(true);

    try {
      const response = await apiRequest<SearchResponse>(`/dictionary/search?q=${encodeURIComponent(query.trim())}`);
      setResults(response.results);
      if (response.results.length === 1) {
        const onlyResult = response.results[0];
        if (onlyResult) {
          setSelectedEntryId(onlyResult.entry_id);
        }

        if (onlyResult?.readings.length === 1) {
          const onlyReading = onlyResult.readings[0];
          if (onlyReading) {
            setSelectedReading(onlyReading.text);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }

  async function onCreate() {
    if (!selectedEntry) {
      setError('Select a dictionary entry first.');
      return;
    }

    if (!selectedReading) {
      setError('Select a reading.');
      return;
    }

    if (isCreating) {
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const surfaceForm = selectedEntry.primary_spelling ?? query.trim();
      await apiRequest('/study-items/intake', {
        method: 'POST',
        body: JSON.stringify({
          surface_form: surfaceForm,
          selected_reading: selectedReading,
          dictionary_entry_id: selectedEntry.entry_id,
          source_type: 'manual',
          assigned_for_date: todayDateString()
        })
      });

      setStatus(`Added ${surfaceForm} (${selectedReading}) to today's assignments.`);
      setQuery('');
      setResults([]);
      setSelectedEntryId(null);
      setSelectedReading('');
      await loadIntakeStats();
      searchInputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create assignment');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <section>
      <h2>Manual Intake</h2>

      <div className="intake-stats intake-stats-desktop" aria-label="intake context stats">
        <article className="intake-stat-pill">
          <span>Today Assigned</span>
          <strong>{intakeStats?.today.total ?? 0}</strong>
        </article>
        <article className="intake-stat-pill">
          <span>Incomplete Days</span>
          <strong>{intakeStats?.overdue.incomplete_days ?? 0}</strong>
        </article>
        <article className="intake-stat-pill">
          <span>Backlog Words</span>
          <strong>{intakeStats?.overdue.total_pending ?? 0}</strong>
        </article>
      </div>

      <details className="intake-stats intake-stats-mobile" aria-label="intake context stats">
        <summary>
          Today Assigned: <strong>{intakeStats?.today.total ?? 0}</strong>
        </summary>
        <div className="intake-stats-mobile-body">
          <p>
            Incomplete Days: <strong>{intakeStats?.overdue.incomplete_days ?? 0}</strong>
          </p>
          <p>
            Backlog Words: <strong>{intakeStats?.overdue.total_pending ?? 0}</strong>
          </p>
        </div>
      </details>

      <div className="intake-toprow">
        <form className="intake-search" onSubmit={onSearch}>
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a word, e.g. 食べる"
          />
          <button className="button" type="submit" disabled={isSearching} aria-disabled={isSearching}>
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {(error || status) ? (
        <div className="intake-feedback" aria-live="polite">
          {error ? <p className="error">{error}</p> : null}
          {status ? <p className="success">{status}</p> : null}
        </div>
      ) : null}

      {isSearching || results.length > 0 ? (
        <div className="card section-card intake-results-card">
          <h3>Candidate Entries</h3>
          {isSearching ? (
            <div className="intake-loading" role="status" aria-live="polite" aria-busy="true">
              <span className="loading-spinner" aria-hidden="true" />
              <p>Searching dictionary...</p>
            </div>
          ) : (
            <div className="candidate-list candidate-list-scroll">
              {results.map((entry) => (
                <button
                  key={entry.entry_id}
                  className={`candidate ${selectedEntryId === entry.entry_id ? 'selected' : ''} ${
                    entry.today_assigned ? 'today-assigned' : ''
                  }`}
                  onClick={() => {
                    setSelectedEntryId(entry.entry_id);
                    if (entry.readings.length === 1) {
                      const onlyReading = entry.readings[0];
                      if (onlyReading) {
                        setSelectedReading(onlyReading.text);
                      }
                    } else {
                      setSelectedReading('');
                    }
                  }}
                >
                  <strong>{entry.primary_spelling ?? entry.primary_reading}</strong>
                  <p className="kana">{entry.primary_reading ?? '-'}</p>
                  <p>{entry.glosses.join('; ') || 'No gloss available'}</p>
                  <small className="candidate-badges">
                    {entry.today_assigned && <span className="badge badge-today" title="Already added today">✓</span>}
                    {entry.is_common && <span className="badge badge-common" title="Common word">★</span>}
                    <span
                      className={`badge badge-match ${entry.match_type.includes('exact') ? 'badge-exact' : 'badge-prefix'}`}
                      title={entry.is_common ? 'common' : 'uncommon'}
                    >
                      {entry.match_type.includes('spelling') ? '字' : '音'}
                    </span>
                  </small>
                </button>
              ))}
            </div>
          )}

          {selectedEntry && !isSearching ? (
            <div className="reading-picker">
              <label htmlFor="reading-select">Reading</label>
              <select
                id="reading-select"
                value={selectedReading}
                onChange={(event) => setSelectedReading(event.target.value)}
              >
                <option value="">Select a reading</option>
                {selectedEntry.readings.map((reading) => (
                  <option key={reading.text} value={reading.text}>
                    {reading.text}
                  </option>
                ))}
              </select>

              <button 
                type="button" 
                className="button" 
                onClick={onCreate}
                disabled={isCreating}
              >
                {isCreating ? 'Adding...' : 'Add Assignment'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
