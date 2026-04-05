/**
 * @maestro/router — Shared HTTP utilities for provider plugins.
 *
 * Thin wrapper around undici providing typed JSON fetching with
 * timeouts, error handling, and header management.
 */

import { request } from 'undici';

export interface HttpOptions {
  headers?: Record<string, string>;
  timeout?: number;
  body?: unknown;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
}

export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
  headers: Record<string, string | string[]>;
}

const DEFAULT_TIMEOUT = 10_000; // 10 seconds

/**
 * Validate a base URL string.
 * Ensures the URL is well-formed. Returns the validated URL or null if invalid.
 */
export function validateBaseUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Fetch JSON from a URL.
 * Throws on non-2xx status codes with a descriptive message.
 */
export async function fetchJson<T = unknown>(
  url: string,
  options: HttpOptions = {},
): Promise<HttpResponse<T>> {
  const { headers = {}, timeout = DEFAULT_TIMEOUT, body, method = 'GET' } = options;

  const response = await request(url, {
    method,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    headersTimeout: timeout,
    bodyTimeout: timeout,
  });

  const data = await response.body.json() as T;

  if (response.statusCode < 200 || response.statusCode >= 300) {
    // Redact 4xx response bodies — they may contain reflected API keys or credentials
    const detail = response.statusCode >= 400 && response.statusCode < 500
      ? '[client error response redacted]'
      : JSON.stringify(data).slice(0, 200);
    throw new Error(`HTTP ${response.statusCode} from ${url}: ${detail}`);
  }

  const responseHeaders: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(response.headers)) {
    if (value !== undefined) {
      responseHeaders[key] = value;
    }
  }

  return { status: response.statusCode, data, headers: responseHeaders };
}

/**
 * Check if a URL is reachable (GET request, returns boolean).
 * Swallows errors and returns false on failure.
 */
export async function isReachable(
  url: string,
  options: HttpOptions = {},
): Promise<boolean> {
  try {
    const response = await request(url, {
      method: 'GET',
      headers: options.headers ?? {},
      headersTimeout: options.timeout ?? 5_000,
      bodyTimeout: options.timeout ?? 5_000,
    });
    // Consume body to avoid memory leak
    await response.body.text();
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch {
    return false;
  }
}
