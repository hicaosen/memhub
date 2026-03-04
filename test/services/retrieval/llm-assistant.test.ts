import { describe, expect, it } from 'vitest';
import { NodeLlamaTaskAssistant } from '../../../src/services/retrieval/llm-assistant.js';

describe('NodeLlamaTaskAssistant', () => {
  it('parses intent routing JSON', async () => {
    const assistant = new NodeLlamaTaskAssistant(
      { mode: 'auto' },
      {
        complete: async () =>
          JSON.stringify({
            intent: 'fact_lookup',
            confidence: 0.91,
            primary: 'fact',
          }),
      }
    );

    const result = await assistant.routeIntent('我几点下班');
    expect(result?.intent).toBe('fact_lookup');
    expect(result?.confidence).toBeGreaterThan(0.8);
  });

  it('parses rewrite JSON and normalizes variants', async () => {
    const assistant = new NodeLlamaTaskAssistant(
      { mode: 'auto' },
      {
        complete: async () =>
          JSON.stringify({
            normalized: '我几点下班',
            variants: ['我下班时间', '我工作到几点'],
          }),
      }
    );

    const result = await assistant.rewriteQuery('我几点下班');
    expect(result?.variants).toContain('我下班时间');
  });

  it('returns null on invalid payload', async () => {
    const assistant = new NodeLlamaTaskAssistant(
      { mode: 'auto' },
      {
        complete: async () => 'not-json',
      }
    );

    const result = await assistant.routeIntent('test');
    expect(result).toBeNull();
  });

  it('parses intent from markdown code block', async () => {
    const assistant = new NodeLlamaTaskAssistant(
      { mode: 'auto' },
      {
        complete: async () =>
          '```json\n{"intent":"keyword_lookup","confidence":0.85,"primary":"hybrid"}\n```',
      }
    );

    const result = await assistant.routeIntent('搜一下');
    expect(result?.intent).toBe('keyword_lookup');
  });

  it('extracts facts from JSON array', async () => {
    const assistant = new NodeLlamaTaskAssistant(
      { mode: 'auto' },
      {
        complete: async () =>
          JSON.stringify([{ key: 'work_schedule.off_time', value: '21:00', confidence: 0.9 }]),
      }
    );

    const result = await assistant.extractFacts({
      title: 'Schedule',
      content: '加班到21:00',
    });
    expect(result).toHaveLength(1);
    expect(result?.[0].key).toBe('work_schedule.off_time');
    expect(result?.[0].source).toBe('llm');
  });

  it('returns null when facts extraction fails', async () => {
    const assistant = new NodeLlamaTaskAssistant(
      { mode: 'auto' },
      {
        complete: async () => 'not an array',
      }
    );

    const result = await assistant.extractFacts({
      title: 'Test',
      content: 'Content',
    });
    expect(result).toBeNull();
  });

  it('returns null when intent validation fails', async () => {
    const assistant = new NodeLlamaTaskAssistant(
      { mode: 'auto' },
      {
        complete: async () =>
          JSON.stringify({
            intent: 'invalid_intent',
            confidence: 0.9,
            primary: 'fact',
          }),
      }
    );

    const result = await assistant.routeIntent('test');
    expect(result).toBeNull();
  });

  it('returns null when rewrite validation fails', async () => {
    const assistant = new NodeLlamaTaskAssistant(
      { mode: 'auto' },
      {
        complete: async () =>
          JSON.stringify({
            normalized: 'test',
            // missing variants
          }),
      }
    );

    const result = await assistant.rewriteQuery('test');
    expect(result).toBeNull();
  });

  it('parses JSON from text with surrounding noise', async () => {
    const assistant = new NodeLlamaTaskAssistant(
      { mode: 'auto' },
      {
        complete: async () =>
          'Here is the result: {"intent":"semantic_lookup","confidence":0.7,"primary":"hybrid"} end.',
      }
    );

    const result = await assistant.routeIntent('test');
    expect(result?.intent).toBe('semantic_lookup');
  });

  it('uses default config when not provided', () => {
    const assistant = new NodeLlamaTaskAssistant({});
    // Should not throw
    expect(assistant).toBeDefined();
  });
});
