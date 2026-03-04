import type { IntentRoute, IntentRouter, LlmTaskAssistant } from './types.js';

const FACT_PATTERNS: readonly RegExp[] = [
  /几点/,
  /什么时候/,
  /下班/,
  /加班/,
  /\bwhen\b/i,
  /\btime\b/i,
];

const KEYWORD_PATTERNS: readonly RegExp[] = [/搜/, /搜索/, /\bsearch\b/i, /\bfind\b/i];

const CONFIDENCE_THRESHOLD = 0.7;

export class RuleBasedIntentRouter implements IntentRouter {
  route(query: string): Promise<IntentRoute> {
    const normalized = query.trim();

    if (KEYWORD_PATTERNS.some(pattern => pattern.test(normalized))) {
      return Promise.resolve({ intent: 'keyword_lookup', confidence: 0.8, primary: 'hybrid' });
    }

    if (FACT_PATTERNS.some(pattern => pattern.test(normalized))) {
      return Promise.resolve({ intent: 'fact_lookup', confidence: 0.88, primary: 'fact' });
    }

    return Promise.resolve({ intent: 'semantic_lookup', confidence: 0.6, primary: 'hybrid' });
  }
}

export interface AssistedIntentRouterConfig {
  readonly assistant: LlmTaskAssistant;
  readonly fallback: IntentRouter;
}

export class AssistedIntentRouter implements IntentRouter {
  private readonly assistant: LlmTaskAssistant;
  private readonly fallback: IntentRouter;

  constructor(config: AssistedIntentRouterConfig) {
    this.assistant = config.assistant;
    this.fallback = config.fallback;
  }

  async route(query: string): Promise<IntentRoute> {
    try {
      const llmResult = await this.assistant.routeIntent(query);
      if (llmResult && llmResult.confidence >= CONFIDENCE_THRESHOLD) {
        return llmResult;
      }
    } catch {
      // LLM 失败，静默回退
    }

    return this.fallback.route(query);
  }
}
