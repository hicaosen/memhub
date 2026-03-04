import type { RetrievalIntent } from './types.js';

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function freshnessBoost(updatedAt: string, now: Date): number {
  const updated = new Date(updatedAt);
  const ageMs = Math.max(0, now.getTime() - updated.getTime());
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.max(0, 0.06 * Math.exp(-ageDays / 30));
}

export function scoreCandidate(input: {
  intent: RetrievalIntent;
  vectorScore: number;
  keywordScore: number;
  factScore: number;
  importance: number;
  updatedAt: string;
  now: Date;
  rerankScore?: number;
}): {
  vector: number;
  keyword: number;
  fact: number;
  importanceBoost: number;
  freshnessBoost: number;
  rerank: number;
  finalScore: number;
} {
  let weights: { vector: number; keyword: number; fact: number };
  switch (input.intent) {
    case 'fact_lookup':
      weights = { vector: 0.2, keyword: 0.35, fact: 0.45 };
      break;
    case 'keyword_lookup':
      weights = { vector: 0.25, keyword: 0.55, fact: 0.2 };
      break;
    default:
      weights = { vector: 0.55, keyword: 0.35, fact: 0.1 };
      break;
  }

  const importanceBoost = clamp01(input.importance / 5) * 0.08;
  const freshBoost = freshnessBoost(input.updatedAt, input.now);
  const rerank = clamp01(input.rerankScore ?? 0) * 0.08;
  const finalScore = clamp01(
    input.vectorScore * weights.vector +
      input.keywordScore * weights.keyword +
      input.factScore * weights.fact +
      importanceBoost +
      freshBoost +
      rerank
  );

  return {
    vector: input.vectorScore,
    keyword: input.keywordScore,
    fact: input.factScore,
    importanceBoost,
    freshnessBoost: freshBoost,
    rerank,
    finalScore,
  };
}
