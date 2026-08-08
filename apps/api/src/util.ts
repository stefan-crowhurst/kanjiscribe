export function safeJsonParse<T>(value: string | null): T {
  if (!value) {
    return [] as T;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return [] as T;
  }
}
