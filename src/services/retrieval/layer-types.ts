/**
 * Layer types for the three-tower memory index architecture.
 *
 * Layers simulate human memory patterns:
 * - Core: Permanent, core identity (preferences, decisions)
 * - Journey: Medium-term, project/period-related (procedures, constraints)
 * - Moment: Short-term, current context (session details)
 *
 * @see docs/layered-index-design.md
 */

import type { MemoryEntryType, TTLLevel } from '../../contracts/types.js';

/**
 * Memory layer in the three-tower architecture.
 */
export type MemoryLayer = 'core' | 'journey' | 'moment';

/**
 * Weight multipliers for each memory layer.
 * Core memories are boosted, moment memories are dampened.
 */
export const LAYER_WEIGHTS: Record<MemoryLayer, number> = {
  core: 1.2,
  journey: 1.0,
  moment: 0.8,
} as const;

/**
 * Weight multipliers for each entry type.
 * Decisions and preferences are valued higher than session context.
 */
export const TYPE_WEIGHTS: Record<MemoryEntryType, number> = {
  decision: 1.1,
  preference: 1.0,
  constraint: 1.0,
  procedure: 0.9,
  session: 0.7,
} as const;

/**
 * Determines the memory layer based on entryType and ttl.
 *
 * Layer assignment rules:
 * - Core: entryType ∈ {preference, decision} AND ttl = permanent
 * - Moment: ttl ∈ {short, session}
 * - Journey: everything else (medium/long ttl or procedure/constraint)
 */
export function determineLayer(
  entryType: MemoryEntryType | undefined,
  ttl: TTLLevel | undefined
): MemoryLayer {
  // Core layer: permanent preferences and decisions
  if (
    entryType !== undefined &&
    (entryType === 'preference' || entryType === 'decision') &&
    ttl === 'permanent'
  ) {
    return 'core';
  }

  // Moment layer: short-lived or session content
  if (ttl === 'short' || ttl === 'session') {
    return 'moment';
  }

  // Journey layer: everything else (long/medium ttl, procedures, constraints)
  return 'journey';
}

/**
 * Gets the weight multiplier for a memory layer.
 */
export function getLayerWeight(layer: MemoryLayer): number {
  return LAYER_WEIGHTS[layer];
}

/**
 * Gets the weight multiplier for an entry type.
 * Returns 1.0 for undefined entry type (neutral weight).
 */
export function getTypeWeight(entryType: MemoryEntryType | undefined): number {
  if (entryType === undefined) {
    return 1.0;
  }
  return TYPE_WEIGHTS[entryType];
}

/**
 * Calculates the freshness factor based on time until expiry.
 *
 * The freshness factor gradually decreases as the memory approaches expiry,
 * but never drops below 0.8 (20% reduction at most).
 *
 * @param expiresAt - ISO timestamp when the memory expires (undefined = never expires)
 * @param createdAt - ISO timestamp when the memory was created
 * @param now - Current timestamp
 * @returns Freshness factor between 0.8 and 1.0
 */
export function calculateFreshnessFactor(
  expiresAt: string | undefined,
  createdAt: string,
  now: Date
): number {
  // Permanent memories always have full freshness
  if (expiresAt === undefined) {
    return 1.0;
  }

  const expiresMs = new Date(expiresAt).getTime();
  const createdMs = new Date(createdAt).getTime();
  const nowMs = now.getTime();

  // If already expired, return minimum freshness
  if (nowMs >= expiresMs) {
    return 0.8;
  }

  const totalTTL = expiresMs - createdMs;
  const remaining = expiresMs - nowMs;

  // Avoid division by zero
  if (totalTTL <= 0) {
    return 1.0;
  }

  // Calculate how much of the TTL has passed (0 = just created, 1 = about to expire)
  const elapsedRatio = 1 - remaining / totalTTL;

  // Linear interpolation: 1.0 at creation, 0.8 at expiry
  // Apply at most 20% reduction
  return 1.0 - elapsedRatio * 0.2;
}
