import { describe, expect, it } from 'vitest';
import {
  AssistedQueryRewriter,
  RuleBasedQueryRewriter,
} from '../../../src/services/retrieval/query-rewriter.js';
import type { LlmTaskAssistant } from '../../../src/services/retrieval/types.js';

describe('RuleBasedQueryRewriter', () => {
  const rewriter = new RuleBasedQueryRewriter();

  it('keeps original query first and expands Chinese schedule synonyms', async () => {
    const rewritten = await rewriter.rewrite('我几点下班');
    expect(rewritten.variants[0]).toBe('我几点下班');
    expect(rewritten.variants).toContain('我几点加班');
  });

  it('normalizes full-width colon for time expressions', async () => {
    const rewritten = await rewriter.rewrite('加班到21：00');
    expect(rewritten.normalized).toContain('21:00');
  });
});

describe('AssistedQueryRewriter', () => {
  it('merges llm variants with rule variants', async () => {
    const assistant: LlmTaskAssistant = {
      routeIntent: async () => null,
      rewriteQuery: async () => ({
        normalized: '我几点下班',
        variants: ['我下班时间', '我收工时间'],
      }),
      extractFacts: async () => null,
    };
    const rewriter = new AssistedQueryRewriter({
      assistant,
      fallback: new RuleBasedQueryRewriter(),
    });

    const rewritten = await rewriter.rewrite('我几点下班');
    expect(rewritten.variants).toContain('我下班时间');
    expect(rewritten.variants[0]).toBe('我几点下班');
  });
});
