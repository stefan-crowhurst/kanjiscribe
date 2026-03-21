import { useEffect, useState } from 'react';

import { AssignmentList } from '../components/AssignmentList.js';
import { apiRequest, todayDateString } from '../lib/api.js';

type AssignmentsResponse = {
  assignments: Array<{
    id: number;
    assigned_for_date: string;
    status: string;
    study_item: { surface_form: string; selected_reading: string; first_gloss: string | null };
  }>;
};

export function TodayPage() {
  const [data, setData] = useState<AssignmentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const today = todayDateString();
    apiRequest<AssignmentsResponse>(`/assignments?status=pending&date=${today}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load today assignments'));
  }, []);

  return (
    <section>
      <h2>Today</h2>
      <p className="muted">Pending assignments for today.</p>
      {error ? <p className="error">{error}</p> : null}
      <AssignmentList assignments={data?.assignments ?? []} queueSource="today" />
    </section>
  );
}
