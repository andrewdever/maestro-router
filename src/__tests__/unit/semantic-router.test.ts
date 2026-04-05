/**
 * @maestro/router — SemanticRouter unit tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SemanticRouter,
  createDefaultRouter,
  type Route,
} from '../../algorithms/semantic-router.js';

// ── Tests ────────────────────────────────────────────────────────

describe('SemanticRouter', () => {
  let router: SemanticRouter;

  beforeEach(() => {
    router = new SemanticRouter({ threshold: 0.2 });
  });

  // ── classify() with empty router ─────────────────────────────

  it('classify() returns null when no routes are registered', () => {
    const result = router.classify('hello world');
    expect(result).toBeNull();
  });

  // ── classify() matches code-review intent ────────────────────

  it('classify() matches a code-review intent', () => {
    router.addRoute({
      name: 'code-review',
      utterances: [
        'review this code',
        'check the pull request',
        'code quality feedback',
        'review my PR',
      ],
      metadata: { effort: 'standard' },
    });

    const result = router.classify('please review this code for issues');

    expect(result).not.toBeNull();
    expect(result!.route).toBe('code-review');
    expect(result!.score).toBeGreaterThan(0);
    expect(result!.metadata).toEqual({ effort: 'standard' });
  });

  // ── classify() returns best match above threshold ────────────

  it('classify() returns the best match above the threshold', () => {
    router.addRoute({
      name: 'code-review',
      utterances: [
        'review this code',
        'check the pull request',
        'code quality feedback',
      ],
    });
    router.addRoute({
      name: 'summarization',
      utterances: [
        'summarize this document',
        'give me a TLDR',
        'brief overview',
      ],
    });

    const result = router.classify('can you review the code changes');
    expect(result).not.toBeNull();
    expect(result!.route).toBe('code-review');
  });

  // ── classify() returns null for unrelated input ──────────────

  it('classify() returns null when input does not match any route', () => {
    const strictRouter = new SemanticRouter({ threshold: 0.8 });
    strictRouter.addRoute({
      name: 'code-review',
      utterances: [
        'review this code',
        'check the pull request',
      ],
    });

    // Very unrelated input with high threshold
    const result = strictRouter.classify('the weather is nice today');
    expect(result).toBeNull();
  });

  // ── classify() with empty input tokens ───────────────────────

  it('classify() returns null for input that tokenizes to nothing', () => {
    router.addRoute({
      name: 'test',
      utterances: ['real content here'],
    });

    // Stop words and single characters only
    const result = router.classify('a the is');
    expect(result).toBeNull();
  });

  // ── createDefaultRouter() ────────────────────────────────────

  it('createDefaultRouter() has 5 default routes', () => {
    const defaultRouter = createDefaultRouter();
    const names = defaultRouter.getRouteNames();

    expect(names).toHaveLength(5);
    expect(names).toContain('code-review');
    expect(names).toContain('code-generation');
    expect(names).toContain('analysis');
    expect(names).toContain('summarization');
    expect(names).toContain('conversation');
  });

  it('createDefaultRouter() can classify common intents', () => {
    const defaultRouter = createDefaultRouter();

    const reviewMatch = defaultRouter.classify('review this pull request');
    expect(reviewMatch).not.toBeNull();
    expect(reviewMatch!.route).toBe('code-review');

    const summaryMatch = defaultRouter.classify('summarize the meeting notes');
    expect(summaryMatch).not.toBeNull();
    expect(summaryMatch!.route).toBe('summarization');
  });

  it('createDefaultRouter() accepts a custom threshold', () => {
    const strictRouter = createDefaultRouter({ threshold: 0.99 });
    // With extremely high threshold, most queries should not match
    const result = strictRouter.classify('review this code');
    // May or may not match depending on exact score — but it should not throw
    expect(result === null || result.score >= 0.99).toBe(true);
  });

  // ── addRoute() ───────────────────────────────────────────────

  it('addRoute() registers a new route', () => {
    router.addRoute({
      name: 'custom',
      utterances: ['custom utterance'],
    });

    expect(router.getRouteNames()).toContain('custom');
  });

  it('addRoute() throws for empty name', () => {
    expect(() =>
      router.addRoute({ name: '', utterances: ['something'] }),
    ).toThrow(/non-empty/);
  });

  it('addRoute() throws for empty utterances', () => {
    expect(() =>
      router.addRoute({ name: 'empty', utterances: [] }),
    ).toThrow(/at least one utterance/);
  });

  // ── removeRoute() ────────────────────────────────────────────

  it('removeRoute() removes a registered route', () => {
    router.addRoute({
      name: 'to-remove',
      utterances: ['remove me'],
    });

    const removed = router.removeRoute('to-remove');
    expect(removed).toBe(true);
    expect(router.getRouteNames()).not.toContain('to-remove');
  });

  it('removeRoute() returns false for non-existent route', () => {
    const removed = router.removeRoute('nonexistent');
    expect(removed).toBe(false);
  });

  it('removeRoute() makes the removed route no longer matchable', () => {
    router.addRoute({
      name: 'temporary',
      utterances: ['temporary route content'],
    });

    // Verify it matches first
    const before = router.classify('temporary route content');
    expect(before).not.toBeNull();

    router.removeRoute('temporary');

    const after = router.classify('temporary route content');
    expect(after).toBeNull();
  });

  // ── classifyAll() ────────────────────────────────────────────

  it('classifyAll() returns all matches sorted by score', () => {
    router.addRoute({
      name: 'code-review',
      utterances: ['review code', 'code feedback', 'check code quality'],
    });
    router.addRoute({
      name: 'code-generation',
      utterances: ['write code', 'generate code', 'implement feature'],
    });

    const matches = router.classifyAll('code review and feedback');
    expect(Array.isArray(matches)).toBe(true);

    // Matches should be sorted by score descending
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
  });
});
