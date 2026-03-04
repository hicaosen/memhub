import { describe, expect, it } from 'vitest';
import { RuleBasedIntentRouter } from '../../../src/services/retrieval/intent-router.js';

describe('RuleBasedIntentRouter', () => {
  const router = new RuleBasedIntentRouter();

  it('routes schedule questions to fact_lookup', () => {
    const routed = router.route('你知道我每天几点下班吗');
    expect(routed.intent).toBe('fact_lookup');
    expect(routed.primary).toBe('fact');
  });

  it('routes explicit search commands to keyword_lookup', () => {
    const routed = router.route('用加班搜一下');
    expect(routed.intent).toBe('keyword_lookup');
    expect(routed.primary).toBe('hybrid');
  });

  it('defaults to semantic lookup for normal questions', () => {
    const routed = router.route('我们上次为什么选这个方案');
    expect(routed.intent).toBe('semantic_lookup');
  });
});
