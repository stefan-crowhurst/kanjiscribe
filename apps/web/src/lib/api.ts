function getDefaultApiBase(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:3000';
  }
  return `${window.location.protocol}//${window.location.hostname}:3000`;
}

export const API_BASE = import.meta.env.VITE_API_BASE ?? getDefaultApiBase();

export function apiAssetUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  return `${API_BASE}${path}`;
}

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
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

  return (await response.json()) as T;
}

export function formatMs(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
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
