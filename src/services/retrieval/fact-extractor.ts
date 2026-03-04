import type { MemoryFact } from '../../contracts/types.js';
import type { FactExtractor, LlmTaskAssistant } from './types.js';

const TIME_PATTERN =
  /(加班到|下班(?:时间)?(?:是|到)?|工作到)\s*(\d{1,2}(?::|：)\d{2}|\d{1,2}点半?)/;

function normalizeTime(raw: string): string | null {
  const time = raw.replace(/：/g, ':').trim();
  const hhmm = time.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const hour = Number(hhmm[1]);
    const minute = Number(hhmm[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const dian = time.match(/^(\d{1,2})点(半)?$/);
  if (!dian) return null;
  const hour = Number(dian[1]);
  if (hour < 0 || hour > 23) return null;
  const minute = dian[2] ? 30 : 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export class RuleBasedFactExtractor implements FactExtractor {
  extract(input: { title: string; content: string }): Promise<readonly MemoryFact[]> {
    const text = `${input.title}\n${input.content}`;
    const matched = text.match(TIME_PATTERN);
    if (!matched) return Promise.resolve([]);

    const normalized = normalizeTime(matched[2]);
    if (!normalized) return Promise.resolve([]);

    return Promise.resolve([
      {
        key: 'work_schedule.off_time',
        value: normalized,
        confidence: 0.95,
        source: 'rule',
      },
    ]);
  }
}

export interface AssistedFactExtractorConfig {
  readonly assistant: LlmTaskAssistant;
  readonly fallback: FactExtractor;
}

export class AssistedFactExtractor implements FactExtractor {
  private readonly assistant: LlmTaskAssistant;
  private readonly fallback: FactExtractor;

  constructor(config: AssistedFactExtractorConfig) {
    this.assistant = config.assistant;
    this.fallback = config.fallback;
  }

  async extract(input: { title: string; content: string }): Promise<readonly MemoryFact[]> {
    const [llmResult, ruleResult] = await Promise.allSettled([
      this.assistant.extractFacts(input),
      this.fallback.extract(input),
    ]);

    const ruleFacts = ruleResult.status === 'fulfilled' ? ruleResult.value : [];

    if (llmResult.status !== 'fulfilled' || !llmResult.value) {
      return ruleFacts;
    }

    // 校验 LLM 事实，过滤无效值
    const validLlmFacts: MemoryFact[] = [];
    for (const fact of llmResult.value) {
      const validated = this.validateFact(fact);
      if (validated) validLlmFacts.push(validated);
    }

    // 合并：LLM 事实优先，规则兜底
    if (validLlmFacts.length > 0) {
      return validLlmFacts;
    }

    return ruleFacts;
  }

  private validateFact(fact: MemoryFact): MemoryFact | null {
    // 对时间类型进行格式校验
    if (fact.key.includes('time') || fact.key.includes('off_time')) {
      const normalized = normalizeTime(fact.value);
      if (!normalized) return null;
      return { ...fact, value: normalized };
    }

    // 其他类型暂时信任
    return fact;
  }
}
