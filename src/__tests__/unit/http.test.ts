/**
 * @maestro/router — HTTP utility unit tests.
 *
 * Tests for fetchJson() and isReachable() from src/http.ts.
 * Uses vi.mock to stub undici.request so no real network calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchJson, isReachable } from '../../http.js';

// Mock undici
vi.mock('undici', () => ({
  request: vi.fn(),
}));

import { request } from 'undici';
const mockRequest = vi.mocked(request);

// ── Helpers ─────────────────────────────────────────────────────

function mockResponse(
  statusCode: number,
  data: unknown,
  headers: Record<string, string> = {},
) {
  return {
    statusCode,
    headers,
    body: {
      json: vi.fn().mockResolvedValue(data),
      text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── fetchJson ───────────────────────────────────────────────────

describe('fetchJson', () => {
  it('returns status, data, and headers on 200', async () => {
    mockRequest.mockResolvedValue(
      mockResponse(200, { ok: true }, { 'x-request-id': 'abc' }) as never,
    );

    const result = await fetchJson('https://api.example.com/data');
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ ok: true });
    expect(result.headers['x-request-id']).toBe('abc');
  });

  it('throws on 404 with descriptive message', async () => {
    mockRequest.mockResolvedValue(
      mockResponse(404, { error: 'not found' }) as never,
    );

    await expect(fetchJson('https://api.example.com/missing'))
      .rejects.toThrow(/HTTP 404/);
  });

  it('throws on 500 with descriptive message', async () => {
    mockRequest.mockResolvedValue(
      mockResponse(500, { error: 'server error' }) as never,
    );

    await expect(fetchJson('https://api.example.com/broken'))
      .rejects.toThrow(/HTTP 500/);
  });

  it('error message includes the URL', async () => {
    mockRequest.mockResolvedValue(
      mockResponse(502, { error: 'bad gateway' }) as never,
    );

    await expect(fetchJson('https://api.example.com/bad'))
      .rejects.toThrow('https://api.example.com/bad');
  });

  it('truncates error body to 200 characters', async () => {
    const longBody = { data: 'x'.repeat(500) };
    mockRequest.mockResolvedValue(
      mockResponse(400, longBody) as never,
    );

    try {
      await fetchJson('https://api.example.com/long');
      expect.fail('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      // The JSON-stringified body slice is at most 200 chars in the message
      // Total message = "HTTP 400 from <url>: " + slice(0, 200)
      const bodyPart = msg.split(': ').slice(1).join(': ');
      expect(bodyPart.length).toBeLessThanOrEqual(200);
    }
  });

  it('sets default Accept and Content-Type headers', async () => {
    mockRequest.mockResolvedValue(
      mockResponse(200, {}) as never,
    );

    await fetchJson('https://api.example.com/data');

    const callArgs = mockRequest.mock.calls[0];
    const options = callArgs[1] as Record<string, unknown>;
    const headers = options.headers as Record<string, string>;
    expect(headers['Accept']).toBe('application/json');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('passes custom headers through, merging with defaults', async () => {
    mockRequest.mockResolvedValue(
      mockResponse(200, {}) as never,
    );

    await fetchJson('https://api.example.com/data', {
      headers: { 'Authorization': 'Bearer tok' },
    });

    const callArgs = mockRequest.mock.calls[0];
    const options = callArgs[1] as Record<string, unknown>;
    const headers = options.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok');
    expect(headers['Accept']).toBe('application/json');
  });

  it('passes body as JSON string for POST', async () => {
    mockRequest.mockResolvedValue(
      mockResponse(200, { created: true }) as never,
    );

    await fetchJson('https://api.example.com/data', {
      method: 'POST',
      body: { name: 'test' },
    });

    const callArgs = mockRequest.mock.calls[0];
    const options = callArgs[1] as Record<string, unknown>;
    expect(options.method).toBe('POST');
    expect(options.body).toBe(JSON.stringify({ name: 'test' }));
  });

  it('sends undefined body for GET (no body option)', async () => {
    mockRequest.mockResolvedValue(
      mockResponse(200, {}) as never,
    );

    await fetchJson('https://api.example.com/data');

    const callArgs = mockRequest.mock.calls[0];
    const options = callArgs[1] as Record<string, unknown>;
    expect(options.body).toBeUndefined();
  });

  it('respects custom timeout', async () => {
    mockRequest.mockResolvedValue(
      mockResponse(200, {}) as never,
    );

    await fetchJson('https://api.example.com/data', { timeout: 3000 });

    const callArgs = mockRequest.mock.calls[0];
    const options = callArgs[1] as Record<string, unknown>;
    expect(options.headersTimeout).toBe(3000);
    expect(options.bodyTimeout).toBe(3000);
  });

  it('uses default 10s timeout when none specified', async () => {
    mockRequest.mockResolvedValue(
      mockResponse(200, {}) as never,
    );

    await fetchJson('https://api.example.com/data');

    const callArgs = mockRequest.mock.calls[0];
    const options = callArgs[1] as Record<string, unknown>;
    expect(options.headersTimeout).toBe(10_000);
    expect(options.bodyTimeout).toBe(10_000);
  });

  it('propagates network errors', async () => {
    mockRequest.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(fetchJson('https://api.example.com/data'))
      .rejects.toThrow('ECONNREFUSED');
  });

  it('omits undefined header values from response', async () => {
    const resp = mockResponse(200, { ok: true });
    resp.headers = { 'x-ok': 'yes', 'x-empty': undefined as unknown as string };
    mockRequest.mockResolvedValue(resp as never);

    const result = await fetchJson('https://api.example.com/data');
    expect(result.headers['x-ok']).toBe('yes');
    expect('x-empty' in result.headers).toBe(false);
  });
});

// ── isReachable ─────────────────────────────────────────────────

describe('isReachable', () => {
  it('returns true on 200 response', async () => {
    mockRequest.mockResolvedValue(
      mockResponse(200, 'OK') as never,
    );

    expect(await isReachable('https://api.example.com')).toBe(true);
  });

  it('returns false on 404 response (not a healthy endpoint)', async () => {
    mockRequest.mockResolvedValue(
      mockResponse(404, 'not found') as never,
    );

    expect(await isReachable('https://api.example.com')).toBe(false);
  });

  it('returns false on 500 response (server error)', async () => {
    mockRequest.mockResolvedValue(
      mockResponse(500, 'error') as never,
    );

    expect(await isReachable('https://api.example.com')).toBe(false);
  });

  it('returns false on network error (does not throw)', async () => {
    mockRequest.mockRejectedValue(new Error('ECONNREFUSED'));

    expect(await isReachable('https://api.example.com')).toBe(false);
  });

  it('consumes response body to avoid memory leak', async () => {
    const resp = mockResponse(200, 'ok');
    mockRequest.mockResolvedValue(resp as never);

    await isReachable('https://api.example.com');

    expect(resp.body.text).toHaveBeenCalled();
  });

  it('uses 5s default timeout', async () => {
    mockRequest.mockResolvedValue(
      mockResponse(200, 'ok') as never,
    );

    await isReachable('https://api.example.com');

    const callArgs = mockRequest.mock.calls[0];
    const options = callArgs[1] as Record<string, unknown>;
    expect(options.headersTimeout).toBe(5_000);
    expect(options.bodyTimeout).toBe(5_000);
  });

  it('respects custom timeout', async () => {
    mockRequest.mockResolvedValue(
      mockResponse(200, 'ok') as never,
    );

    await isReachable('https://api.example.com', { timeout: 2000 });

    const callArgs = mockRequest.mock.calls[0];
    const options = callArgs[1] as Record<string, unknown>;
    expect(options.headersTimeout).toBe(2000);
    expect(options.bodyTimeout).toBe(2000);
  });
});
