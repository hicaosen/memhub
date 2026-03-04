import { describe, expect, it } from 'vitest';
import {
  AssistedIntentRouter,
  RuleBasedIntentRouter,
} from '../../../src/services/retrieval/intent-router.js';
import type { LlmTaskAssistant } from '../../../src/services/retrieval/types.js';

describe('RuleBasedIntentRouter', () => {
  const router = new RuleBasedIntentRouter();

  it('routes schedule questions to fact_lookup', async () => {
    const routed = await router.route('你知道我每天几点下班吗');
    expect(routed.intent).toBe('fact_lookup');
    expect(routed.primary).toBe('fact');
  });

  it('routes explicit search commands to keyword_lookup', async () => {
    const routed = await router.route('用加班搜一下');
    expect(routed.intent).toBe('keyword_lookup');
    expect(routed.primary).toBe('hybrid');
  });

  it('defaults to semantic lookup for normal questions', async () => {
    const routed = await router.route('我们上次为什么选这个方案');
    expect(routed.intent).toBe('semantic_lookup');
  });
});

describe('AssistedIntentRouter', () => {
  it('prefers llm route when confidence is high', async () => {
    const assistant: LlmTaskAssistant = {
      routeIntent: async () => ({ intent: 'fact_lookup', confidence: 0.93, primary: 'fact' }),
      rewriteQuery: async () => null,
      extractFacts: async () => null,
    };
    const router = new AssistedIntentRouter({ assistant, fallback: new RuleBasedIntentRouter() });

    const routed = await router.route('普通问题');
    expect(routed.intent).toBe('fact_lookup');
  });

  it('falls back to rule when llm response confidence is low', async () => {
    const assistant: LlmTaskAssistant = {
      routeIntent: async () => ({ intent: 'semantic_lookup', confidence: 0.2, primary: 'hybrid' }),
      rewriteQuery: async () => null,
      extractFacts: async () => null,
    };
    const router = new AssistedIntentRouter({ assistant, fallback: new RuleBasedIntentRouter() });

    const routed = await router.route('用加班搜一下');
    expect(routed.intent).toBe('keyword_lookup');
  });
});
