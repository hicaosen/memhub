import type { TTLLevel } from '../../contracts/types.js';

/** TTL durations in milliseconds */
export const TTL_DURATIONS: Record<TTLLevel, number | null> = {
  permanent: null, // Never expire
  long: 90 * 24 * 60 * 60 * 1000, // 90 days
  medium: 30 * 24 * 60 * 60 * 1000, // 30 days
  short: 7 * 24 * 60 * 60 * 1000, // 7 days
  session: 24 * 60 * 60 * 1000, // 24 hours
};

/**
 * Calculates expiration timestamp from TTL level
 * @param ttl - The TTL level
 * @param createdAt - The creation timestamp
 * @returns ISO8601 expiration timestamp or undefined if permanent
 */
export function calculateExpiresAt(ttl: TTLLevel, createdAt: string): string | undefined {
  const duration = TTL_DURATIONS[ttl];
  if (duration === null) return undefined;
  return new Date(new Date(createdAt).getTime() + duration).toISOString();
}

/**
 * Checks if a memory has expired
 * @param expiresAt - The expiration timestamp (undefined means never expires)
 * @param now - Current date/time
 * @returns true if the memory has expired
 */
export function isExpired(expiresAt: string | undefined, now: Date): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < now;
}
