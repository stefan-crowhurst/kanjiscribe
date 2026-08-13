import { z } from 'zod';

import {
  assignmentListResponseSchema,
  assignmentOrderRequestSchema,
  assignmentSummaryResponseSchema,
  assignmentsQuerySchema,
  backlogResponseSchema,
  dashboardQuerySchema,
  dashboardResponseSchema,
  dateSchema,
  dictionarySearchResponseSchema,
  drillPayloadSchema,
  envConfigSchema,
  errorResponseSchema,
  estimatesResponseSchema,
  intakeRequestSchema,
  intakeResponseSchema,
  noContentResponseSchema,
  queueSourceSchema,
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

function getDefaultApiBase(apiPort: number): string {
  if (typeof window === 'undefined') {
    return `http://localhost:${apiPort}`;
  }
  return `${window.location.protocol}//${window.location.hostname}:${apiPort}`;
}

// Parse the build-time API-base/port configuration through the shared env
// schema at module load (ADR-0006): misconfigured env fails loudly instead
// of producing a broken base URL.
const envConfig = envConfigSchema.parse({
  KANJISCRIBE_API_PORT: __API_PORT__,
  VITE_API_BASE: import.meta.env.VITE_API_BASE
});

export const API_BASE =
  envConfig.VITE_API_BASE ?? getDefaultApiBase(envConfig.KANJISCRIBE_API_PORT);

export function apiAssetUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  return `${API_BASE}${path}`;
}

/**
 * Validate a request input against the same shared schema the api enforces
 * at its HTTP seam (ADR-0006): an invalid input rejects here, before any URL
 * or body is built and before any request is sent. Valid inputs are returned
 * as the schema's typed output.
 */
function validateRequestInput<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown
): z.infer<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid request input');
  }
  return parsed.data;
}

/**
 * Content-type and caller headers for a request, shared by apiRequest and
 * apiRequestNoContent: Content-Type is only set when there is a body.
 */
function mergeHeaders(options?: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {};

  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }

  if (options?.headers) {
    Object.entries(options.headers).forEach(([key, value]) => {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    });
  }

  return headers;
}

/**
 * Parse a non-2xx response's error envelope through the shared error schema
 * and reject with a useful message (ADR-0006); a 2xx response returns.
 */
async function throwIfNotOk(response: Response): Promise<void> {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const parsed = errorResponseSchema.safeParse(body);
    const message = parsed.success ? parsed.data.error : undefined;
    throw new Error(message ?? `Request failed (${response.status})`);
  }
}

/**
 * Fetch a JSON endpoint and parse the response through `schema` (ADR-0006):
 * a response that fails the schema rejects with an error naming the endpoint,
 * never a silent pass-through.
 */
async function apiRequest<T extends z.ZodTypeAny>(
  schema: T,
  path: string,
  options?: RequestInit
): Promise<z.infer<T>> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: mergeHeaders(options)
  });

  await throwIfNotOk(response);

  const data: unknown = await response.json();
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid response from ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Fetch a body-less endpoint (e.g. a 204) and validate the empty response
 * through `schema` (ADR-0006): the shared contract for a no-content success
 * is `noContentResponseSchema`; a response that fails the schema rejects
 * with an error naming the endpoint, never a silent pass-through.
 */
async function apiRequestNoContent(
  path: string,
  options?: RequestInit,
  schema: z.ZodTypeAny = noContentResponseSchema
): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: mergeHeaders(options)
  });

  await throwIfNotOk(response);

  const body = await response.text();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Invalid response from ${path}: ${parsed.error.message}`);
  }
}

export async function listAssignments(
  params: z.infer<typeof assignmentsQuerySchema> = {}
): Promise<AssignmentListResponse> {
  const { date, status } = validateRequestInput(assignmentsQuerySchema, params);
  const query = new URLSearchParams();
  if (date) {
    query.set('date', date);
  }
  if (status) {
    query.set('status', status);
  }
  const queryString = query.toString();
  return apiRequest(
    assignmentListResponseSchema,
    `/assignments${queryString ? `?${queryString}` : ''}`
  );
}

export async function reorderAssignments(date: string, assignmentIds: number[]): Promise<void> {
  const validatedDate = validateRequestInput(dateSchema, date);
  const payload = validateRequestInput(assignmentOrderRequestSchema, {
    assignment_ids: assignmentIds
  });
  await apiRequestNoContent(
    `/assignments/${validatedDate}/order`,
    {
      method: 'PUT',
      body: JSON.stringify(payload)
    },
    noContentResponseSchema
  );
}

export async function getBacklog(): Promise<BacklogResponse> {
  return apiRequest(backlogResponseSchema, '/assignments/backlog');
}

export async function getDrillPayload(
  assignmentId: number,
  queueSource?: string
): Promise<DrillPayload> {
  const source = validateRequestInput(queueSourceSchema, queueSource);
  const query = source ? `?queue_source=${encodeURIComponent(source)}` : '';
  return apiRequest(drillPayloadSchema, `/assignments/${assignmentId}/drill${query}`);
}

export async function getViewPayload(assignmentId: number): Promise<ViewPayload> {
  return apiRequest(viewPayloadSchema, `/assignments/${assignmentId}/view`);
}

export async function completeAssignment(
  id: number,
  timeSpentMs: number
): Promise<AssignmentSummaryResponse> {
  return apiRequest(assignmentSummaryResponseSchema, `/assignments/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ time_spent_ms: timeSpentMs })
  });
}

export async function skipAssignment(
  id: number,
  timeSpentMs: number
): Promise<AssignmentSummaryResponse> {
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
  const { from: fromDate, to: toDate } = validateRequestInput(dashboardQuerySchema, { from, to });
  const query = new URLSearchParams();
  if (fromDate) {
    query.set('from', fromDate);
  }
  if (toDate) {
    query.set('to', toDate);
  }
  const queryString = query.toString();
  return apiRequest(
    dashboardResponseSchema,
    `/stats/dashboard${queryString ? `?${queryString}` : ''}`
  );
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
  const validatedDate = validateRequestInput(dateSchema, date);
  const response = await apiRequest(
    estimatesResponseSchema,
    `/estimates/backlog-day?date=${validatedDate}`
  );
  return response.estimated_remaining_ms;
}

export async function searchDictionary(query: string): Promise<DictionarySearchResponse> {
  return apiRequest(
    dictionarySearchResponseSchema,
    `/dictionary/search?q=${encodeURIComponent(query)}`
  );
}

export async function intakeStudyItem(payload: IntakeRequest): Promise<IntakeResponse> {
  const validatedPayload = validateRequestInput(intakeRequestSchema, payload);
  return apiRequest(intakeResponseSchema, '/study-items/intake', {
    method: 'POST',
    body: JSON.stringify(validatedPayload)
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
  // The output is asserted through the shared date schema so every date the
  // web sends matches the server contract (ADR-0006).
  return dateSchema.parse(new Date().toISOString().slice(0, 10));
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
