import { z } from 'zod';

import {
  assignmentListResponseSchema,
  assignmentSummaryResponseSchema,
  backlogResponseSchema,
  dashboardResponseSchema,
  dictionarySearchResponseSchema,
  drillPayloadSchema,
  estimatesResponseSchema,
  intakeResponseSchema,
  slowestWordsResponseSchema,
  topKanjiResponseSchema,
  topWordsResponseSchema,
  viewPayloadSchema,
  type AssignmentListResponse,
  type AssignmentSummaryResponse,
  type BacklogResponse,
  type DashboardResponse,
  type DictionarySearchResponse,
  type DrillPayload,
  type IntakeRequest,
  type IntakeResponse,
  type SlowestWordsResponse,
  type TopKanjiResponse,
  type TopWordsResponse,
  type ViewPayload
} from '@kanjiscribe/shared';

declare const __API_PORT__: string;

function getDefaultApiBase(): string {
  const apiPort = __API_PORT__;
  if (typeof window === 'undefined') {
    return `http://localhost:${apiPort}`;
  }
  return `${window.location.protocol}//${window.location.hostname}:${apiPort}`;
}

export const API_BASE = import.meta.env.VITE_API_BASE ?? getDefaultApiBase();

export function apiAssetUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  return `${API_BASE}${path}`;
}

/**
 * Fetch a JSON endpoint and parse the response through `schema` (ADR-0006):
 * a response that fails the schema rejects with an error naming the endpoint,
 * never a silent pass-through.
 */
export async function apiRequest<T extends z.ZodTypeAny>(
  schema: T,
  path: string,
  options?: RequestInit
): Promise<z.infer<T>> {
  const headers: Record<string, string> = {};

  // Only set Content-Type if there's a body to send
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }

  // Merge any additional headers from options
  if (options?.headers) {
    Object.entries(options.headers).forEach(([key, value]) => {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    });
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }

  const data: unknown = await response.json();
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid response from ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function listAssignments(params: { date?: string; status?: string } = {}): Promise<AssignmentListResponse> {
  const query = new URLSearchParams();
  if (params.date) {
    query.set('date', params.date);
  }
  if (params.status) {
    query.set('status', params.status);
  }
  const queryString = query.toString();
  return apiRequest(assignmentListResponseSchema, `/assignments${queryString ? `?${queryString}` : ''}`);
}

export async function getBacklog(): Promise<BacklogResponse> {
  return apiRequest(backlogResponseSchema, '/assignments/backlog');
}

export async function getDrillPayload(assignmentId: number, queueSource?: string): Promise<DrillPayload> {
  const query = queueSource ? `?queue_source=${encodeURIComponent(queueSource)}` : '';
  return apiRequest(drillPayloadSchema, `/assignments/${assignmentId}/drill${query}`);
}

export async function getViewPayload(assignmentId: number): Promise<ViewPayload> {
  return apiRequest(viewPayloadSchema, `/assignments/${assignmentId}/view`);
}

export async function completeAssignment(id: number, timeSpentMs: number): Promise<AssignmentSummaryResponse> {
  return apiRequest(assignmentSummaryResponseSchema, `/assignments/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ time_spent_ms: timeSpentMs })
  });
}

export async function skipAssignment(id: number, timeSpentMs: number): Promise<AssignmentSummaryResponse> {
  return apiRequest(assignmentSummaryResponseSchema, `/assignments/${id}/skip`, {
    method: 'POST',
    body: JSON.stringify({ time_spent_ms: timeSpentMs })
  });
}

export async function reopenAssignment(id: number): Promise<AssignmentSummaryResponse> {
  return apiRequest(assignmentSummaryResponseSchema, `/assignments/${id}/reopen`, {
    method: 'POST'
  });
}

export async function archiveAssignment(id: number): Promise<void> {
  await apiRequest(assignmentSummaryResponseSchema, `/assignments/${id}/archive`, {
    method: 'POST'
  });
}

export async function getDashboardStats(from?: string, to?: string): Promise<DashboardResponse> {
  const query = new URLSearchParams();
  if (from) {
    query.set('from', from);
  }
  if (to) {
    query.set('to', to);
  }
  const queryString = query.toString();
  return apiRequest(dashboardResponseSchema, `/stats/dashboard${queryString ? `?${queryString}` : ''}`);
}

export async function getTopWords(): Promise<TopWordsResponse> {
  return apiRequest(topWordsResponseSchema, '/stats/top-words');
}

export async function getSlowestWords(): Promise<SlowestWordsResponse> {
  return apiRequest(slowestWordsResponseSchema, '/stats/slowest-words');
}

export async function getTopKanji(): Promise<TopKanjiResponse> {
  return apiRequest(topKanjiResponseSchema, '/stats/top-kanji');
}

export async function getTodayEstimate(): Promise<number> {
  const response = await apiRequest(estimatesResponseSchema, '/estimates/today');
  return response.estimated_remaining_ms;
}

export async function getBacklogDaysEstimate(): Promise<number> {
  const response = await apiRequest(estimatesResponseSchema, '/estimates/backlog-days');
  return response.estimated_remaining_ms;
}

export async function getBacklogDayEstimate(date: string): Promise<number> {
  const response = await apiRequest(estimatesResponseSchema, `/estimates/backlog-day?date=${date}`);
  return response.estimated_remaining_ms;
}

export async function searchDictionary(query: string): Promise<DictionarySearchResponse> {
  return apiRequest(dictionarySearchResponseSchema, `/dictionary/search?q=${encodeURIComponent(query)}`);
}

export async function intakeStudyItem(payload: IntakeRequest): Promise<IntakeResponse> {
  return apiRequest(intakeResponseSchema, '/study-items/intake', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

function formatMsWithRounding(ms: number, roundSeconds: (seconds: number) => number): string {
  const totalSeconds = roundSeconds(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function formatMs(ms: number): string {
  return formatMsWithRounding(ms, Math.floor);
}

export function formatMsEstimate(ms: number): string {
  return formatMsWithRounding(ms, Math.ceil);
}

export function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatShortDate(value: string): string {
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) {
    return value;
  }
  return `${day}/${month}/${year.slice(-2)}`;
}

export function formatJapaneseDate(value: string): string {
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) {
    return value;
  }
  return `${year}年${Number(month)}月${Number(day)}日`;
}
