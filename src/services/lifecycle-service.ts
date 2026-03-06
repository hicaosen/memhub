/**
 * Lifecycle Service - Memory upgrade/downgrade/evaluation logic.
 *
 * Implements memory lifecycle management:
 * - Evaluate upgrade/downgrade opportunities
 * - Track access patterns for lifecycle decisions
 * - Suggest lifecycle actions based on rules
 *
 * @see docs/layered-index-design.md
 */

import type { Memory, TTLLevel } from '../contracts/types.js';
import type { MemoryLayer } from './retrieval/layer-types.js';
import { determineLayer } from './retrieval/layer-types.js';

/**
 * Lifecycle action types
 */
export type LifecycleAction = 'upgrade_to_core' | 'upgrade_to_journey' | 'downgrade_to_moment' | 'archive' | 'keep';

/**
 * Reason for lifecycle recommendation
 */
export type LifecycleReason =
  | 'frequent_access'
  | 'user_confirmed'
  | 'long_unused'
  | 'expiring_soon'
  | 'permanent_preference'
  | 'permanent_decision'
  | 'already_optimal';

/**
 * Result of lifecycle evaluation
 */
export interface LifecycleEvaluation {
  /** Memory being evaluated */
  readonly memoryId: string;
  /** Current layer */
  readonly currentLayer: MemoryLayer;
  /** Recommended action */
  readonly action: LifecycleAction;
  /** Reason for recommendation */
  readonly reason: LifecycleReason;
  /** Access count in the evaluation period */
  readonly accessCount: number;
  /** Days since last access */
  readonly daysSinceAccess: number;
  /** Days until expiration (if applicable) */
  readonly daysUntilExpiry: number | null;
  /** Confidence level (0-1) */
  readonly confidence: number;
}

/**
 * Configuration for lifecycle evaluation
 */
export interface LifecycleConfig {
  /** Number of accesses to consider for upgrade */
  readonly upgradeAccessThreshold: number;
  /** Days without access to consider downgrade */
  readonly downgradeIdleDays: number;
  /** Days before expiry to consider archival */
  readonly archiveExpiryDays: number;
  /** Minimum confidence to recommend action */
  readonly minConfidence: number;
}

/**
 * Default lifecycle configuration
 */
export const DEFAULT_LIFECYCLE_CONFIG: LifecycleConfig = {
  upgradeAccessThreshold: 5,
  downgradeIdleDays: 30,
  archiveExpiryDays: 7,
  minConfidence: 0.6,
};

/**
 * Access tracking record
 */
interface AccessRecord {
  readonly memoryId: string;
  readonly accessCount: number;
  readonly lastAccessAt: Date;
  readonly firstAccessAt: Date;
}

/**
 * Service for managing memory lifecycle.
 */
export class LifecycleService {
  private readonly accessLog: Map<string, AccessRecord> = new Map();

  constructor(private readonly config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG) {}

  /**
   * Records an access to a memory (for lifecycle tracking).
   *
   * @param memoryId - ID of the accessed memory
   * @param accessedAt - When the access occurred (default: now)
   */
  recordAccess(memoryId: string, accessedAt: Date = new Date()): void {
    const existing = this.accessLog.get(memoryId);
    if (existing) {
      this.accessLog.set(memoryId, {
        memoryId,
        accessCount: existing.accessCount + 1,
        lastAccessAt: accessedAt,
        firstAccessAt: existing.firstAccessAt,
      });
    } else {
      this.accessLog.set(memoryId, {
        memoryId,
        accessCount: 1,
        lastAccessAt: accessedAt,
        firstAccessAt: accessedAt,
      });
    }
  }

  /**
   * Gets access statistics for a memory.
   *
   * @param memoryId - Memory ID to check
   * @returns Access record or undefined if never accessed
   */
  getAccessStats(memoryId: string): AccessRecord | undefined {
    return this.accessLog.get(memoryId);
  }

  /**
   * Evaluates a memory for lifecycle action.
   *
   * @param memory - Memory to evaluate
   * @param now - Current timestamp (default: new Date())
   * @returns Lifecycle evaluation result
   */
  evaluate(memory: Memory, now: Date = new Date()): LifecycleEvaluation {
    const currentLayer = determineLayer(memory.entryType, memory.ttl);
    const accessRecord = this.accessLog.get(memory.id);

    const accessCount = accessRecord?.accessCount ?? 0;
    const lastAccessAt = accessRecord?.lastAccessAt ?? new Date(memory.updatedAt);
    const daysSinceAccess = Math.floor(
      (now.getTime() - lastAccessAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    let daysUntilExpiry: number | null = null;
    if (memory.expiresAt) {
      const expiryDate = new Date(memory.expiresAt);
      daysUntilExpiry = Math.floor(
        (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    // Determine recommended action
    const evaluation = this.determineAction(
      memory,
      currentLayer,
      accessCount,
      daysSinceAccess,
      daysUntilExpiry
    );

    return {
      memoryId: memory.id,
      currentLayer,
      action: evaluation.action,
      reason: evaluation.reason,
      accessCount,
      daysSinceAccess,
      daysUntilExpiry,
      confidence: evaluation.confidence,
    };
  }

  /**
   * Determines the lifecycle action for a memory.
   */
  private determineAction(
    memory: Memory,
    currentLayer: MemoryLayer,
    accessCount: number,
    daysSinceAccess: number,
    daysUntilExpiry: number | null
  ): { action: LifecycleAction; reason: LifecycleReason; confidence: number } {
    // Core layer: already optimal, never suggest changes
    if (currentLayer === 'core') {
      return { action: 'keep', reason: 'already_optimal', confidence: 1.0 };
    }

    // Journey layer: consider upgrade to core
    if (currentLayer === 'journey') {
      // Can only upgrade to core if it's a preference/decision
      if (memory.entryType === 'preference' || memory.entryType === 'decision') {
        if (accessCount >= this.config.upgradeAccessThreshold) {
          // Confidence: starts at 0.6 when threshold is met, grows to 1.0 at 2x threshold
          const confidence = Math.min(1, 0.6 + (accessCount - this.config.upgradeAccessThreshold) / (this.config.upgradeAccessThreshold * 2.5));
          return {
            action: 'upgrade_to_core',
            reason: 'frequent_access',
            confidence,
          };
        }
      }

      // Consider downgrade if long unused
      if (daysSinceAccess >= this.config.downgradeIdleDays) {
        return {
          action: 'downgrade_to_moment',
          reason: 'long_unused',
          confidence: Math.min(1, daysSinceAccess / (this.config.downgradeIdleDays * 2)),
        };
      }

      // Consider archive if expiring soon
      if (daysUntilExpiry !== null && daysUntilExpiry <= this.config.archiveExpiryDays) {
        return {
          action: 'archive',
          reason: 'expiring_soon',
          confidence: 0.8,
        };
      }

      return { action: 'keep', reason: 'already_optimal', confidence: 1.0 };
    }

    // Moment layer: consider upgrade to journey
    if (currentLayer === 'moment') {
      // Check for upgrade potential
      if (accessCount >= this.config.upgradeAccessThreshold) {
        // Confidence: starts at 0.6 when threshold is met, grows to 1.0 at 2x threshold
        const confidence = Math.min(1, 0.6 + (accessCount - this.config.upgradeAccessThreshold) / (this.config.upgradeAccessThreshold * 2.5));
        return {
          action: 'upgrade_to_journey',
          reason: 'frequent_access',
          confidence,
        };
      }

      // Consider archive if expiring soon
      if (daysUntilExpiry !== null && daysUntilExpiry <= this.config.archiveExpiryDays) {
        return {
          action: 'archive',
          reason: 'expiring_soon',
          confidence: 0.8,
        };
      }

      return { action: 'keep', reason: 'already_optimal', confidence: 1.0 };
    }

    return { action: 'keep', reason: 'already_optimal', confidence: 1.0 };
  }

  /**
   * Batch evaluates multiple memories.
   *
   * @param memories - Memories to evaluate
   * @param now - Current timestamp
   * @returns Evaluations for each memory
   */
  batchEvaluate(memories: readonly Memory[], now: Date = new Date()): LifecycleEvaluation[] {
    return memories.map(memory => this.evaluate(memory, now));
  }

  /**
   * Gets memories that should be upgraded.
   *
   * @param memories - Memories to filter
   * @param now - Current timestamp
   * @returns Memories recommended for upgrade
   */
  getUpgradeCandidates(
    memories: readonly Memory[],
    now: Date = new Date()
  ): LifecycleEvaluation[] {
    return this.batchEvaluate(memories, now).filter(
      e =>
        (e.action === 'upgrade_to_core' || e.action === 'upgrade_to_journey') &&
        e.confidence >= this.config.minConfidence
    );
  }

  /**
   * Gets memories that should be downgraded.
   *
   * @param memories - Memories to filter
   * @param now - Current timestamp
   * @returns Memories recommended for downgrade
   */
  getDowngradeCandidates(
    memories: readonly Memory[],
    now: Date = new Date()
  ): LifecycleEvaluation[] {
    return this.batchEvaluate(memories, now).filter(
      e => e.action === 'downgrade_to_moment' && e.confidence >= this.config.minConfidence
    );
  }

  /**
   * Gets memories that should be archived.
   *
   * @param memories - Memories to filter
   * @param now - Current timestamp
   * @returns Memories recommended for archival
   */
  getArchiveCandidates(
    memories: readonly Memory[],
    now: Date = new Date()
  ): LifecycleEvaluation[] {
    return this.batchEvaluate(memories, now).filter(
      e => e.action === 'archive' && e.confidence >= this.config.minConfidence
    );
  }

  /**
   * Calculates the new TTL for an upgrade action.
   *
   * @param action - Lifecycle action
   * @param currentTTL - Current TTL level
   * @returns New TTL level
   */
  getUpgradeTTL(action: LifecycleAction, currentTTL: TTLLevel | undefined): TTLLevel {
    switch (action) {
      case 'upgrade_to_core':
        return 'permanent';
      case 'upgrade_to_journey':
        return 'medium';
      default:
        return currentTTL ?? 'medium';
    }
  }

  /**
   * Clears access tracking data.
   */
  clearAccessLog(): void {
    this.accessLog.clear();
  }

  /**
   * Gets the number of tracked memories.
   */
  getTrackedCount(): number {
    return this.accessLog.size;
  }
}
