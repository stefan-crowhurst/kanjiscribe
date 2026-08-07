import { z } from 'zod';

import { assignmentSummaryResponseSchema } from '@kanjiscribe/shared';

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

export async function archiveAssignment(id: number): Promise<void> {
  await apiRequest(assignmentSummaryResponseSchema, `/assignments/${id}/archive`, {
    method: 'POST'
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
