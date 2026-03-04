import { describe, expect, it } from 'vitest';
import { RuleBasedQueryRewriter } from '../../../src/services/retrieval/query-rewriter.js';

describe('RuleBasedQueryRewriter', () => {
  const rewriter = new RuleBasedQueryRewriter();

  it('keeps original query first and expands Chinese schedule synonyms', () => {
    const rewritten = rewriter.rewrite('我几点下班');
    expect(rewritten.variants[0]).toBe('我几点下班');
    expect(rewritten.variants).toContain('我几点加班');
  });

  it('normalizes full-width colon for time expressions', () => {
    const rewritten = rewriter.rewrite('加班到21：00');
    expect(rewritten.normalized).toContain('21:00');
  });
});
