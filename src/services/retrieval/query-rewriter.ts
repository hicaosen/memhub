import type { QueryRewriter, RewriteOutput } from './types.js';

const SYNONYM_GROUPS: ReadonlyArray<readonly string[]> = [
  ['下班', '加班', '收工', '结束工作'],
  ['几点', '时间', '何时', '什么时候'],
];

export class RuleBasedQueryRewriter implements QueryRewriter {
  rewrite(query: string): RewriteOutput {
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

    return {
      normalized,
      variants: Array.from(variants).slice(0, 8),
    };
  }
}
