import type { IntentRoute, IntentRouter } from './types.js';

const FACT_PATTERNS: readonly RegExp[] = [
  /几点/,
  /什么时候/,
  /下班/,
  /加班/,
  /\bwhen\b/i,
  /\btime\b/i,
];

const KEYWORD_PATTERNS: readonly RegExp[] = [/搜/, /搜索/, /\bsearch\b/i, /\bfind\b/i];

export class RuleBasedIntentRouter implements IntentRouter {
  route(query: string): IntentRoute {
    const normalized = query.trim();

    if (KEYWORD_PATTERNS.some(pattern => pattern.test(normalized))) {
      return { intent: 'keyword_lookup', confidence: 0.8, primary: 'hybrid' };
    }

    if (FACT_PATTERNS.some(pattern => pattern.test(normalized))) {
      return { intent: 'fact_lookup', confidence: 0.88, primary: 'fact' };
    }

    return { intent: 'semantic_lookup', confidence: 0.6, primary: 'hybrid' };
  }
}
