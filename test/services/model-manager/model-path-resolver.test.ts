import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import {
  getModelsBasePath,
  resolveModelPath,
  areAllModelsDownloaded,
  getMissingModels,
  getDownloadStatus,
} from '../../../src/services/model-manager/model-path-resolver.js';
import { getModelByKind } from '../../../src/services/model-manager/types.js';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

// Mock os module
vi.mock('os', () => ({
  homedir: () => '/home/testuser',
}));

describe('model-path-resolver', () => {
  let mockExistsSync: ReturnType<typeof vi.fn>;
  let mockStatSync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const fs = await import('fs');
    mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;
    mockStatSync = fs.statSync as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getModelsBasePath', () => {
    it('returns ~/.memhub/models path', () => {
      const path = getModelsBasePath();
      expect(path).toBe(join('/home/testuser', '.memhub', 'models'));
    });
  });

  describe('resolveModelPath', () => {
    it('resolves model path correctly', () => {
      const model = getModelByKind('llm')!;
      mockExistsSync.mockReturnValue(false);

      const result = resolveModelPath(model);

      expect(result.modelDir).toBe(join('/home/testuser/.memhub/models', model.name));
      expect(result.modelFile).toBe(join(result.modelDir, model.filename));
      expect(result.exists).toBe(false);
      expect(result.sizeBytes).toBe(0);
    });

    it('detects existing model file', () => {
      const model = getModelByKind('embedding')!;
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 560_000_000 });

      const result = resolveModelPath(model);

      expect(result.exists).toBe(true);
      expect(result.sizeBytes).toBe(560_000_000);
    });

    it('handles stat errors gracefully', () => {
      const model = getModelByKind('reranker')!;
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockImplementation(() => {
        throw new Error('Stat error');
      });

      const result = resolveModelPath(model);

      expect(result.exists).toBe(true);
      expect(result.sizeBytes).toBe(0);
    });
  });

  describe('areAllModelsDownloaded', () => {
    it('returns true when all models exist', async () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 1000000 });

      const result = await areAllModelsDownloaded();

      expect(result).toBe(true);
    });

    it('returns false when some models are missing', async () => {
      mockExistsSync.mockReturnValue(false);

      const result = await areAllModelsDownloaded();

      expect(result).toBe(false);
    });
  });

  describe('getMissingModels', () => {
    it('returns all models when none are downloaded', async () => {
      mockExistsSync.mockReturnValue(false);

      const missing = await getMissingModels();

      expect(missing).toHaveLength(3);
    });

    it('returns empty array when all are downloaded', async () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 1000000 });

      const missing = await getMissingModels();

      expect(missing).toHaveLength(0);
    });

    it('returns only missing models', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        // Only LLM model exists
        return path.includes('qwen2');
      });
      mockStatSync.mockReturnValue({ size: 1000000 });

      const missing = await getMissingModels();

      expect(missing).toHaveLength(2);
      expect(missing.map(m => m.kind)).toEqual(expect.arrayContaining(['embedding', 'reranker']));
    });
  });

  describe('getDownloadStatus', () => {
    it('returns correct status when nothing downloaded', async () => {
      mockExistsSync.mockReturnValue(false);

      const status = await getDownloadStatus();

      expect(status.total).toBe(3);
      expect(status.downloaded).toBe(0);
      expect(status.missing).toBe(3);
    });

    it('returns correct status when all downloaded', async () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 1000000 });

      const status = await getDownloadStatus();

      expect(status.total).toBe(3);
      expect(status.downloaded).toBe(3);
      expect(status.missing).toBe(0);
    });
  });
});
