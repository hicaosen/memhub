import { describe, expect, it } from 'vitest';
import { RuleBasedFactExtractor } from '../../../src/services/retrieval/fact-extractor.js';

describe('RuleBasedFactExtractor', () => {
  const extractor = new RuleBasedFactExtractor();

  it('extracts off_time fact from Chinese overtime sentence', () => {
    const facts = extractor.extract({
      title: 'Work schedule',
      content: '用户一般每天加班到21:00，工作时间较长。',
    });

    expect(facts).toHaveLength(1);
    expect(facts[0].key).toBe('work_schedule.off_time');
    expect(facts[0].value).toBe('21:00');
  });

  it('extracts half-hour format from 点半 expression', () => {
    const facts = extractor.extract({
      title: 'Schedule',
      content: '通常下班时间是9点半。',
    });

    expect(facts[0].value).toBe('09:30');
  });

  it('returns empty when text has no schedule signal', () => {
    const facts = extractor.extract({
      title: 'General note',
      content: '今天写了很多代码。',
    });
    expect(facts).toEqual([]);
  });

  it('returns empty for invalid clock values', () => {
    const facts = extractor.extract({
      title: 'Broken time',
      content: '用户一般每天加班到25:90。',
    });
    expect(facts).toEqual([]);
  });
});
