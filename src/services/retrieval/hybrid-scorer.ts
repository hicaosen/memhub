import type { MemoryEntryType, TTLLevel } from '../../contracts/types.js';
import {
  determineLayer,
  getLayerWeight,
  getTypeWeight,
  calculateFreshnessFactor,
} from './layer-types.js';

/** Internal scoring intent type (maps from caller's RetrievalIntent) */
type ScoringIntent = 'keyword_lookup' | 'semantic_lookup';

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function recencyBoost(updatedAt: string, now: Date): number {
  const updated = new Date(updatedAt);
  const ageMs = Math.max(0, now.getTime() - updated.getTime());
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.max(0, 0.06 * Math.exp(-ageDays / 30));
}

export interface ScoreCandidateInput {
  readonly intent: ScoringIntent;
  readonly vectorScore: number;
  readonly keywordScore: number;
  readonly importance: number;
  readonly updatedAt: string;
  readonly now: Date;
  readonly rerankScore?: number;
  /** Entry type for layer and type weight calculation */
  readonly entryType?: MemoryEntryType;
  /** TTL level for layer determination */
  readonly ttl?: TTLLevel;
  /** Expiration timestamp for freshness factor */
  readonly expiresAt?: string;
  /** Creation timestamp for freshness factor */
  readonly createdAt?: string;
}

export interface ScoreCandidateResult {
  readonly vector: number;
  readonly keyword: number;
  readonly importanceBoost: number;
  readonly recencyBoost: number;
  readonly rerank: number;
  readonly layerWeight: number;
  readonly typeWeight: number;
  readonly freshnessFactor: number;
  readonly finalScore: number;
}

export function scoreCandidate(input: ScoreCandidateInput): ScoreCandidateResult {
  let weights: { vector: number; keyword: number };
  switch (input.intent) {
    case 'keyword_lookup':
      weights = { vector: 0.35, keyword: 0.65 };
      break;
    default:
      weights = { vector: 0.65, keyword: 0.35 };
      break;
  }

  const importanceBoost = clamp01(input.importance / 5) * 0.08;
  const recencyBoostValue = recencyBoost(input.updatedAt, input.now);
  const rerank = clamp01(input.rerankScore ?? 0) * 0.08;

  // Calculate layer-based weights
  const layer = determineLayer(input.entryType, input.ttl);
  const layerWeight = getLayerWeight(layer);
  const typeWeight = getTypeWeight(input.entryType);
  const freshnessFactor =
    input.createdAt !== undefined
      ? calculateFreshnessFactor(input.expiresAt, input.createdAt, input.now)
      : 1.0;

  // Base score from vector/keyword hybrid
  const baseScore =
    input.vectorScore * weights.vector + input.keywordScore * weights.keyword;

  // Apply layer weights to base score
  const weightedScore = baseScore * layerWeight * typeWeight * freshnessFactor;

  // Add boost components (these are not affected by layer weights)
  const finalScore = clamp01(weightedScore + importanceBoost + recencyBoostValue + rerank);

  return {
    vector: input.vectorScore,
    keyword: input.keywordScore,
    importanceBoost,
    recencyBoost: recencyBoostValue,
    rerank,
    layerWeight,
    typeWeight,
    freshnessFactor,
    finalScore,
  };
}
