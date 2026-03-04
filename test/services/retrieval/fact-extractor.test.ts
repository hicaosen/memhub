import { describe, expect, it } from 'vitest';
import {
  AssistedFactExtractor,
  RuleBasedFactExtractor,
} from '../../../src/services/retrieval/fact-extractor.js';
import type { LlmTaskAssistant } from '../../../src/services/retrieval/types.js';

describe('RuleBasedFactExtractor', () => {
  const extractor = new RuleBasedFactExtractor();

  it('extracts off_time fact from Chinese overtime sentence', async () => {
    const facts = await extractor.extract({
      title: 'Work schedule',
      content: '用户一般每天加班到21:00，工作时间较长。',
    });

    expect(facts).toHaveLength(1);
    expect(facts[0].key).toBe('work_schedule.off_time');
    expect(facts[0].value).toBe('21:00');
  });

  it('extracts half-hour format from 点半 expression', async () => {
    const facts = await extractor.extract({
      title: 'Schedule',
      content: '通常下班时间是9点半。',
    });

    expect(facts[0].value).toBe('09:30');
  });

  it('returns empty when text has no schedule signal', async () => {
    const facts = await extractor.extract({
      title: 'General note',
      content: '今天写了很多代码。',
    });
    expect(facts).toEqual([]);
  });

  it('returns empty for invalid clock values', async () => {
    const facts = await extractor.extract({
      title: 'Broken time',
      content: '用户一般每天加班到25:90。',
    });
    expect(facts).toEqual([]);
  });
});

describe('AssistedFactExtractor', () => {
  it('accepts llm facts after validation and merges with rule facts', async () => {
    const assistant: LlmTaskAssistant = {
      routeIntent: async () => null,
      rewriteQuery: async () => null,
      extractFacts: async () => [
        { key: 'work_schedule.off_time', value: '21:00', confidence: 0.8, source: 'llm' },
      ],
    };
    const extractor = new AssistedFactExtractor({
      assistant,
      fallback: new RuleBasedFactExtractor(),
    });

    const facts = await extractor.extract({
      title: 'Schedule',
      content: '一般加班到21:00',
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toBe('21:00');
  });

  it('drops invalid llm facts and keeps rule fallback facts', async () => {
    const assistant: LlmTaskAssistant = {
      routeIntent: async () => null,
      rewriteQuery: async () => null,
      extractFacts: async () => [
        { key: 'work_schedule.off_time', value: '99:99', confidence: 0.9, source: 'llm' },
      ],
    };
    const extractor = new AssistedFactExtractor({
      assistant,
      fallback: new RuleBasedFactExtractor(),
    });

    const facts = await extractor.extract({
      title: 'Schedule',
      content: '通常下班时间是9点半。',
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toBe('09:30');
  });
});
