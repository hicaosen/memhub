import { describe, expect, it } from 'vitest';
import {
  MODELS,
  getModelByKind,
  getModelByName,
  TOTAL_DOWNLOAD_SIZE,
  formatBytes,
  type ModelKind,
} from '../../../src/services/model-manager/types.js';

describe('model-manager types', () => {
  describe('MODELS', () => {
    it('contains 2 models', () => {
      expect(MODELS).toHaveLength(2);
    });

    it('has embedding model', () => {
      const embedding = MODELS.find(m => m.kind === 'embedding');
      expect(embedding).toBeDefined();
      expect(embedding?.name).toBe('nomic-embed-text-v2-moe');
    });

    it('has reranker model', () => {
      const reranker = MODELS.find(m => m.kind === 'reranker');
      expect(reranker).toBeDefined();
      expect(reranker?.name).toBe('bge-reranker-v2-m3');
    });

    it('all models have required fields', () => {
      for (const model of MODELS) {
        expect(model.kind).toBeDefined();
        expect(model.name).toBeDefined();
        expect(model.filename).toBeDefined();
        expect(model.hfRepo).toBeDefined();
        expect(model.hfFile).toBeDefined();
        expect(model.sizeBytes).toBeGreaterThan(0);
      }
    });
  });

  describe('getModelByKind', () => {
    it('returns embedding model', () => {
      const model = getModelByKind('embedding');
      expect(model?.kind).toBe('embedding');
    });

    it('returns reranker model', () => {
      const model = getModelByKind('reranker');
      expect(model?.kind).toBe('reranker');
    });

    it('returns undefined for invalid kind', () => {
      const model = getModelByKind('invalid' as ModelKind);
      expect(model).toBeUndefined();
    });
  });

  describe('getModelByName', () => {
    it('returns model by name', () => {
      const model = getModelByName('nomic-embed-text-v2-moe');
      expect(model?.kind).toBe('embedding');
    });

    it('returns undefined for unknown name', () => {
      const model = getModelByName('unknown-model');
      expect(model).toBeUndefined();
    });
  });

  describe('TOTAL_DOWNLOAD_SIZE', () => {
    it('sums all model sizes', () => {
      const expectedSum = MODELS.reduce((sum, m) => sum + m.sizeBytes, 0);
      expect(TOTAL_DOWNLOAD_SIZE).toBe(expectedSum);
    });
  });

  describe('formatBytes', () => {
    it('formats bytes', () => {
      expect(formatBytes(500)).toBe('500.0 B');
    });

    it('formats kilobytes', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('formats megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
      expect(formatBytes(560 * 1024 * 1024)).toBe('560.0 MB');
    });

    it('formats gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
      expect(formatBytes(1.2 * 1024 * 1024 * 1024)).toBe('1.2 GB');
    });
  });
});
