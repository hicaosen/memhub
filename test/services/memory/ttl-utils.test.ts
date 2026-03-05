/**
 * TTL Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import {
  TTL_DURATIONS,
  calculateExpiresAt,
  isExpired,
} from '../../../src/services/memory/ttl-utils.js';
import type { TTLLevel } from '../../../src/contracts/types.js';

describe('TTL Utilities', () => {
  describe('TTL_DURATIONS', () => {
    it('should have permanent as null (never expires)', () => {
      expect(TTL_DURATIONS.permanent).toBeNull();
    });

    it('should have long as 90 days in milliseconds', () => {
      const expected = 90 * 24 * 60 * 60 * 1000;
      expect(TTL_DURATIONS.long).toBe(expected);
    });

    it('should have medium as 30 days in milliseconds', () => {
      const expected = 30 * 24 * 60 * 60 * 1000;
      expect(TTL_DURATIONS.medium).toBe(expected);
    });

    it('should have short as 7 days in milliseconds', () => {
      const expected = 7 * 24 * 60 * 60 * 1000;
      expect(TTL_DURATIONS.short).toBe(expected);
    });

    it('should have session as 24 hours in milliseconds', () => {
      const expected = 24 * 60 * 60 * 1000;
      expect(TTL_DURATIONS.session).toBe(expected);
    });
  });

  describe('calculateExpiresAt', () => {
    it('should return undefined for permanent TTL', () => {
      const createdAt = '2024-01-01T00:00:00.000Z';
      const result = calculateExpiresAt('permanent', createdAt);
      expect(result).toBeUndefined();
    });

    it('should calculate correct expiration for long TTL (90 days)', () => {
      const createdAt = '2024-01-01T00:00:00.000Z';
      const result = calculateExpiresAt('long', createdAt);
      const expected = new Date('2024-01-01T00:00:00.000Z').getTime() + 90 * 24 * 60 * 60 * 1000;
      expect(new Date(result!).getTime()).toBe(expected);
    });

    it('should calculate correct expiration for medium TTL (30 days)', () => {
      const createdAt = '2024-01-01T00:00:00.000Z';
      const result = calculateExpiresAt('medium', createdAt);
      const expected = new Date('2024-01-01T00:00:00.000Z').getTime() + 30 * 24 * 60 * 60 * 1000;
      expect(new Date(result!).getTime()).toBe(expected);
    });

    it('should calculate correct expiration for short TTL (7 days)', () => {
      const createdAt = '2024-01-01T00:00:00.000Z';
      const result = calculateExpiresAt('short', createdAt);
      const expected = new Date('2024-01-01T00:00:00.000Z').getTime() + 7 * 24 * 60 * 60 * 1000;
      expect(new Date(result!).getTime()).toBe(expected);
    });

    it('should calculate correct expiration for session TTL (24 hours)', () => {
      const createdAt = '2024-01-01T00:00:00.000Z';
      const result = calculateExpiresAt('session', createdAt);
      const expected = new Date('2024-01-01T00:00:00.000Z').getTime() + 24 * 60 * 60 * 1000;
      expect(new Date(result!).getTime()).toBe(expected);
    });

    it('should return ISO 8601 formatted string', () => {
      const createdAt = '2024-01-01T00:00:00.000Z';
      const result = calculateExpiresAt('session', createdAt);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('isExpired', () => {
    it('should return false when expiresAt is undefined', () => {
      const now = new Date('2024-06-01T00:00:00.000Z');
      expect(isExpired(undefined, now)).toBe(false);
    });

    it('should return false when expiresAt is in the future', () => {
      const expiresAt = '2024-12-01T00:00:00.000Z';
      const now = new Date('2024-06-01T00:00:00.000Z');
      expect(isExpired(expiresAt, now)).toBe(false);
    });

    it('should return true when expiresAt is in the past', () => {
      const expiresAt = '2024-01-01T00:00:00.000Z';
      const now = new Date('2024-06-01T00:00:00.000Z');
      expect(isExpired(expiresAt, now)).toBe(true);
    });

    it('should return false when expiresAt equals now (boundary)', () => {
      const expiresAt = '2024-06-01T00:00:00.000Z';
      const now = new Date('2024-06-01T00:00:00.000Z');
      expect(isExpired(expiresAt, now)).toBe(false);
    });

    it('should return true when expiresAt is 1ms before now', () => {
      const expiresAt = '2024-06-01T00:00:00.000Z';
      const now = new Date('2024-06-01T00:00:00.001Z');
      expect(isExpired(expiresAt, now)).toBe(true);
    });
  });
});
