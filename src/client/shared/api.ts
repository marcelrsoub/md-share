export interface ApiErrorBody {
  error: string;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const text = await response.text();
  const body = text ? (JSON.parse(text) as T & ApiErrorBody) : (null as T);

  if (!response.ok) {
    const errorMessage =
      typeof body === 'object' && body && 'error' in body && typeof (body as ApiErrorBody).error === 'string'
        ? (body as ApiErrorBody).error
        : `Request failed (${response.status})`;
    throw new Error(errorMessage);
  }

  return body as T;
}

export function formatTimestamp(value: number | null | undefined): string {
  if (value == null) {
    return 'Never';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

export function shortToken(token: string): string {
  return token.length > 10 ? `${token.slice(0, 6)}…${token.slice(-4)}` : token;
}

export function shareStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'dirty':
      return 'Dirty';
    case 'conflict':
      return 'Conflict';
    case 'expired':
      return 'Expired';
    case 'revoked':
      return 'Revoked';
    default:
      return status;
  }
}

export function statusTone(status: string): 'good' | 'warn' | 'bad' | 'neutral' {
  switch (status) {
    case 'active':
      return 'good';
    case 'dirty':
      return 'warn';
    case 'conflict':
    case 'expired':
    case 'revoked':
      return 'bad';
    default:
      return 'neutral';
  }
}
