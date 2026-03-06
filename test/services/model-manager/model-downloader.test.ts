import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  downloadModel,
  downloadAllModels,
  cleanupTempFiles,
  type DownloadProgress,
} from '../../../src/services/model-manager/model-downloader.js';
import { getModelByKind } from '../../../src/services/model-manager/types.js';

// Mock dependencies
vi.mock('fs', () => ({
  createWriteStream: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
  statSync: vi.fn(),
  renameSync: vi.fn(),
}));

vi.mock('../../../src/services/model-manager/model-path-resolver.js', () => ({
  resolveModelPath: vi.fn(),
  getModelsBasePath: vi.fn(() => '/home/testuser/.memhub/models'),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: async () => undefined,
    debug: async () => undefined,
    warn: async () => undefined,
    error: async () => undefined,
  }),
}));

describe('model-downloader', () => {
  let mockExistsSync: ReturnType<typeof vi.fn>;
  let mockStatSync: ReturnType<typeof vi.fn>;
  let mockMkdirSync: ReturnType<typeof vi.fn>;
  let mockCreateWriteStream: ReturnType<typeof vi.fn>;
  let mockRenameSync: ReturnType<typeof vi.fn>;
  let mockUnlinkSync: ReturnType<typeof vi.fn>;
  let mockResolveModelPath: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const fs = await import('fs');
    mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;
    mockStatSync = fs.statSync as ReturnType<typeof vi.fn>;
    mockMkdirSync = fs.mkdirSync as ReturnType<typeof vi.fn>;
    mockCreateWriteStream = fs.createWriteStream as ReturnType<typeof vi.fn>;
    mockRenameSync = fs.renameSync as ReturnType<typeof vi.fn>;
    mockUnlinkSync = fs.unlinkSync as ReturnType<typeof vi.fn>;

    const resolver = await import('../../../src/services/model-manager/model-path-resolver.js');
    mockResolveModelPath = resolver.resolveModelPath as ReturnType<typeof vi.fn>;

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('downloadModel', () => {
    it('skips download when model already exists with valid size', async () => {
      const model = getModelByKind('embedding')!;
      mockResolveModelPath.mockReturnValue({
        modelDir: '/models/test',
        modelFile: '/models/test/model.gguf',
        exists: true,
        sizeBytes: 560_000_000,
      });

      const progressEvents: DownloadProgress[] = [];
      const result = await downloadModel(model, info => progressEvents.push(info));

      expect(result.success).toBe(true);
      expect(progressEvents).toHaveLength(1);
      expect(progressEvents[0].status).toBe('skipped');
      expect(progressEvents[0].percentage).toBe(100);
    });

    it('starts download when model does not exist', async () => {
      const model = getModelByKind('embedding')!;
      mockResolveModelPath
        .mockReturnValueOnce({
          modelDir: '/models/test',
          modelFile: '/models/test/model.gguf',
          exists: false,
          sizeBytes: 0,
        })
        .mockReturnValueOnce({
          modelDir: '/models/test',
          modelFile: '/models/test/model.gguf',
          exists: true,
          sizeBytes: 560_000_000,
        });

      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockReturnValue(undefined);

      // Mock write stream
      const mockStream = {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn((event: string, cb: () => void) => {
          if (event === 'finish') {
            setTimeout(cb, 0);
          }
        }),
      };
      mockCreateWriteStream.mockReturnValue(
        mockStream as unknown as ReturnType<typeof mockCreateWriteStream>
      );
      mockRenameSync.mockReturnValue(undefined);

      // Mock fetch
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
          .mockResolvedValueOnce({ done: true }),
      };
      const mockResponse = {
        ok: true,
        status: 200,
        body: {
          getReader: () => mockReader,
        },
        headers: new Map([['content-length', '1000']]),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const progressEvents: DownloadProgress[] = [];
      const result = await downloadModel(model, info => progressEvents.push(info));

      expect(result.success).toBe(true);
      expect(progressEvents.some(e => e.status === 'downloading')).toBe(true);
      expect(progressEvents[progressEvents.length - 1].status).toBe('completed');
    });

    it('resumes download from existing temp file', async () => {
      const model = getModelByKind('embedding')!;
      mockResolveModelPath
        .mockReturnValueOnce({
          modelDir: '/models/test',
          modelFile: '/models/test/model.gguf',
          exists: false,
          sizeBytes: 0,
        })
        .mockReturnValueOnce({
          modelDir: '/models/test',
          modelFile: '/models/test/model.gguf',
          exists: true,
          sizeBytes: 560_000_000,
        });

      // Temp file exists with partial download
      mockExistsSync.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.includes('.downloading')) {
          return true;
        }
        return false;
      });
      mockStatSync.mockReturnValue({ size: 100_000_000 }); // 100MB already downloaded
      mockMkdirSync.mockReturnValue(undefined);

      const mockStream = {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn((event: string, cb: () => void) => {
          if (event === 'finish') {
            setTimeout(cb, 0);
          }
        }),
      };
      mockCreateWriteStream.mockReturnValue(
        mockStream as unknown as ReturnType<typeof mockCreateWriteStream>
      );
      mockRenameSync.mockReturnValue(undefined);

      // Mock fetch with 206 Partial Content
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
          .mockResolvedValueOnce({ done: true }),
      };
      const mockResponse = {
        ok: true,
        status: 206,
        body: {
          getReader: () => mockReader,
        },
        headers: new Map([['content-length', '460000000']]), // Remaining bytes
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const progressEvents: DownloadProgress[] = [];
      const result = await downloadModel(model, info => progressEvents.push(info));

      expect(result.success).toBe(true);
      expect(progressEvents.some(e => e.status === 'resuming')).toBe(true);
    });

    it('handles HTTP errors', async () => {
      const model = getModelByKind('embedding')!;
      mockResolveModelPath.mockReturnValue({
        modelDir: '/models/test',
        modelFile: '/models/test/model.gguf',
        exists: false,
        sizeBytes: 0,
      });
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockReturnValue(undefined);

      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const progressEvents: DownloadProgress[] = [];
      const result = await downloadModel(model, info => progressEvents.push(info));

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
      expect(progressEvents[progressEvents.length - 1].status).toBe('failed');
    });

    it('handles network errors', async () => {
      const model = getModelByKind('embedding')!;
      mockResolveModelPath.mockReturnValue({
        modelDir: '/models/test',
        modelFile: '/models/test/model.gguf',
        exists: false,
        sizeBytes: 0,
      });
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockReturnValue(undefined);

      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await downloadModel(model);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('handles 416 Range Not Satisfiable when file already complete', async () => {
      const model = getModelByKind('embedding')!;

      // First call: model not found
      mockResolveModelPath
        .mockReturnValueOnce({
          modelDir: '/models/test',
          modelFile: '/models/test/model.gguf',
          exists: false,
          sizeBytes: 0,
        })
        // Second call after 416: model is complete
        .mockReturnValueOnce({
          modelDir: '/models/test',
          modelFile: '/models/test/model.gguf',
          exists: true,
          sizeBytes: 560_000_000,
        });

      // Temp file exists
      mockExistsSync.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.includes('.downloading')) {
          return true;
        }
        return true; // Final file also exists
      });
      mockStatSync.mockReturnValue({ size: 560_000_000 });
      mockMkdirSync.mockReturnValue(undefined);

      // First fetch returns 416
      const mock416Response = {
        ok: false,
        status: 416,
        statusText: 'Range Not Satisfiable',
      };
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(mock416Response as unknown as Response);

      const result = await downloadModel(model);

      expect(result.success).toBe(true);
    });

    it('handles response without body', async () => {
      const model = getModelByKind('embedding')!;
      mockResolveModelPath.mockReturnValue({
        modelDir: '/models/test',
        modelFile: '/models/test/model.gguf',
        exists: false,
        sizeBytes: 0,
      });
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockReturnValue(undefined);

      const mockResponse = {
        ok: true,
        status: 200,
        body: null,
        headers: new Map(),
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const result = await downloadModel(model);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No response body');
    });
  });

  describe('downloadAllModels', () => {
    it('downloads all missing models', async () => {
      mockResolveModelPath.mockReturnValue({
        modelDir: '/models/test',
        modelFile: '/models/test/model.gguf',
        exists: true,
        sizeBytes: 560_000_000,
      });
      mockExistsSync.mockReturnValue(true);

      const result = await downloadAllModels();

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('collects errors from failed downloads', async () => {
      mockResolveModelPath.mockReturnValue({
        modelDir: '/models/test',
        modelFile: '/models/test/model.gguf',
        exists: false,
        sizeBytes: 0,
      });
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockReturnValue(undefined);

      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await downloadAllModels();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('cleanupTempFiles', () => {
    it('removes temp files when final file exists', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.includes('.downloading')) {
          return true;
        }
        return true;
      });
      mockResolveModelPath.mockReturnValue({
        modelDir: '/models/test',
        modelFile: '/models/test/model.gguf',
        exists: true,
        sizeBytes: 560_000_000,
      });
      mockUnlinkSync.mockReturnValue(undefined);

      await cleanupTempFiles();

      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('keeps temp files when final file does not exist', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.includes('.downloading')) {
          return true;
        }
        return false;
      });
      mockResolveModelPath.mockReturnValue({
        modelDir: '/models/test',
        modelFile: '/models/test/model.gguf',
        exists: false,
        sizeBytes: 0,
      });

      await cleanupTempFiles();

      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });
  });
});
