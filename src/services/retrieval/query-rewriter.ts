import type { LlmTaskAssistant, QueryRewriter, RewriteOutput } from './types.js';

const SYNONYM_GROUPS: ReadonlyArray<readonly string[]> = [
  ['下班', '加班', '收工', '结束工作'],
  ['几点', '时间', '何时', '什么时候'],
];

export class RuleBasedQueryRewriter implements QueryRewriter {
  rewrite(query: string): Promise<RewriteOutput> {
    const normalized = query.replace(/：/g, ':').trim();
    const variants = new Set<string>([normalized]);

    for (const group of SYNONYM_GROUPS) {
      const presentTerms = group.filter(term => normalized.includes(term));
      if (presentTerms.length === 0) continue;

      for (const from of presentTerms) {
        for (const to of group) {
          if (from === to) continue;
          variants.add(normalized.replaceAll(from, to));
        }
      }
    }

    return Promise.resolve({
      normalized,
      variants: Array.from(variants).slice(0, 8),
    });
  }
}

export interface AssistedQueryRewriterConfig {
  readonly assistant: LlmTaskAssistant;
  readonly fallback: QueryRewriter;
}

export class AssistedQueryRewriter implements QueryRewriter {
  private readonly assistant: LlmTaskAssistant;
  private readonly fallback: QueryRewriter;

  constructor(config: AssistedQueryRewriterConfig) {
    this.assistant = config.assistant;
    this.fallback = config.fallback;
  }

  async rewrite(query: string): Promise<RewriteOutput> {
    const [llmResult, ruleResult] = await Promise.allSettled([
      this.assistant.rewriteQuery(query),
      this.fallback.rewrite(query),
    ]);

    const ruleOutput =
      ruleResult.status === 'fulfilled'
        ? ruleResult.value
        : { normalized: query, variants: [query] };

    if (llmResult.status !== 'fulfilled' || !llmResult.value) {
      return ruleOutput;
    }

    // 合并 LLM 和规则的变体，去重，保持原查询在第一位
    const merged = new Set<string>([query]);
    for (const v of llmResult.value.variants) merged.add(v);
    for (const v of ruleOutput.variants) merged.add(v);

    return {
      normalized: llmResult.value.normalized || ruleOutput.normalized,
      variants: Array.from(merged).slice(0, 8),
    };
  }
}
