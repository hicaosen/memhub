/**
 * LayeredVectorIndex - Three-tower LanceDB vector index.
 *
 * Implements the physical layering architecture:
 * - Core tower: Permanent preferences and decisions (never expires)
 * - Journey tower: Long/medium TTL content (90-day cleanup)
 * - Moment tower: Short/session TTL content (7-day cleanup)
 *
 * @see docs/layered-index-design.md
 */

import * as lancedb from '@lancedb/lancedb';
import { mkdir, access, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';
import type { Memory } from '../contracts/types.js';
import { VECTOR_DIM } from '../services/embedding-service.js';
import { determineLayer, type MemoryLayer } from '../services/retrieval/layer-types.js';
import { getLanceDBPath } from './paths.js';

const INDEX_SCHEMA_VERSION = 2; // Bumped for layered architecture

/** Table names for each layer */
const TABLE_NAMES: Record<MemoryLayer, string> = {
  core: 'memories_core',
  journey: 'memories_journey',
  moment: 'memories_moment',
} as const;

const METADATA_FILE = 'layered-index.meta.json';

/** Escape single quotes in id strings to prevent SQL injection */
function escapeId(id: string): string {
  return id.replace(/'/g, "''");
}

/**
 * Row stored in the LanceDB table.
 * The `vector` field is the only one required by LanceDB; all others are metadata filters.
 */
export interface VectorRow {
  id: string;
  vector: number[];
  title: string;
  importance: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  entryType?: string;
  ttl?: string;
  /** WAL offset for this entry (used for recovery) */
  walOffset: number;
}

export interface VectorSearchResult {
  id: string;
  /** Cosine distance (lower = more similar). Converted to 0-1 score by caller. */
  _distance: number;
  /** Layer this result came from */
  _layer: MemoryLayer;
}

interface LayeredIndexMetadata {
  schemaVersion: number;
  vectorDim: number;
  updatedAt: string;
}

interface TableVectorInfo {
  hasVectorField: boolean;
  vectorDim: number | null;
}

/**
 * Three-tower LanceDB vector index.
 * Data lives at `{storagePath}/.internal/lancedb/`.
 */
export class LayeredVectorIndex {
  private readonly dbPath: string;
  private readonly metadataPath: string;
  private db: lancedb.Connection | null = null;
  private readonly tables: Map<MemoryLayer, lancedb.Table> = new Map();
  private initPromise: Promise<void> | null = null;

  constructor(storagePath: string) {
    this.dbPath = getLanceDBPath(storagePath);
    this.metadataPath = join(this.dbPath, METADATA_FILE);
  }

  /** Idempotent initialisation — safe to call multiple times. */
  async initialize(): Promise<void> {
    if (this.tables.size === 3) return;

    if (!this.initPromise) {
      this.initPromise = this._init();
    }
    await this.initPromise;
  }

  private async _init(): Promise<void> {
    // Ensure the directory exists
    try {
      await access(this.dbPath, constants.F_OK);
    } catch {
      await mkdir(this.dbPath, { recursive: true });
    }

    this.db = await lancedb.connect(this.dbPath);

    const existingTables = await this.db.tableNames();

    // Initialize all three layer tables
    for (const layer of ['core', 'journey', 'moment'] as const) {
      const tableName = TABLE_NAMES[layer];
      if (existingTables.includes(tableName)) {
        const table = await this.db.openTable(tableName);
        if (await this.needsRebuild(table)) {
          await this.db.dropTable(tableName);
          this.tables.set(layer, await this.createTable(layer));
        } else {
          this.tables.set(layer, table);
        }
      } else {
        this.tables.set(layer, await this.createTable(layer));
      }
    }

    await this.writeMetadata();
  }

  private async createTable(layer: MemoryLayer): Promise<lancedb.Table> {
    // Create table with a dummy row so schema is established, then delete it
    const dummy: VectorRow = {
      id: '__init__',
      vector: new Array(VECTOR_DIM).fill(0) as number[],
      title: '',
      importance: 0,
      createdAt: '',
      updatedAt: '',
      expiresAt: '',
      entryType: '',
      ttl: '',
      walOffset: -1,
    };

    const tableName = TABLE_NAMES[layer];
    const table = await this.db!.createTable(tableName, [
      dummy as unknown as Record<string, unknown>,
    ]);
    await table.delete(`id = '__init__'`);
    return table;
  }

  private async rebuildTable(layer: MemoryLayer): Promise<void> {
    const tableName = TABLE_NAMES[layer];
    await this.db!.dropTable(tableName);
    this.tables.set(layer, await this.createTable(layer));
    await this.writeMetadata();
  }

  private async readMetadata(): Promise<LayeredIndexMetadata | null> {
    try {
      const raw = await readFile(this.metadataPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<LayeredIndexMetadata>;
      if (
        typeof parsed.schemaVersion === 'number' &&
        typeof parsed.vectorDim === 'number'
      ) {
        return {
          schemaVersion: parsed.schemaVersion,
          vectorDim: parsed.vectorDim,
          updatedAt:
            typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  private async writeMetadata(): Promise<void> {
    const metadata: LayeredIndexMetadata = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      vectorDim: VECTOR_DIM,
      updatedAt: new Date().toISOString(),
    };
    await writeFile(this.metadataPath, JSON.stringify(metadata), 'utf-8');
  }

  private async inspectTableVector(table: lancedb.Table): Promise<TableVectorInfo> {
    const schema = await table.schema();
    const vectorField = schema.fields.find(field => field.name === 'vector');
    if (!vectorField) return { hasVectorField: false, vectorDim: null };
    const dataType = vectorField.type as { listSize?: number };
    return {
      hasVectorField: true,
      vectorDim: typeof dataType.listSize === 'number' ? dataType.listSize : null,
    };
  }

  private async needsRebuild(table: lancedb.Table): Promise<boolean> {
    const vectorInfo = await this.inspectTableVector(table);

    // Legacy/corrupt table without `vector` column cannot be searched and must be rebuilt.
    if (!vectorInfo.hasVectorField) {
      return true;
    }

    if (vectorInfo.vectorDim !== null) {
      return vectorInfo.vectorDim !== VECTOR_DIM;
    }

    const metadata = await this.readMetadata();
    if (!metadata) return false;
    if (metadata.schemaVersion !== INDEX_SCHEMA_VERSION) return true;
    return metadata.vectorDim !== VECTOR_DIM;
  }

  private assertVectorDim(vector: number[], operation: 'upsert' | 'search'): void {
    if (vector.length !== VECTOR_DIM) {
      throw new Error(
        `LayeredVectorIndex: ${operation} expects ${VECTOR_DIM} dimensions, got ${vector.length}`
      );
    }
  }

  /**
   * Upserts a memory row into the appropriate layer table.
   * LanceDB doesn't have a native upsert so we delete-then-add.
   */
  async upsert(memory: Memory, vector: number[], walOffset = -1): Promise<void> {
    this.assertVectorDim(vector, 'upsert');
    await this.initialize();

    // Determine which layer this memory belongs to
    const layer = determineLayer(memory.entryType, memory.ttl);
    const table = this.tables.get(layer)!;

    // Remove existing row from all tables (in case layer changed)
    await this.delete(memory.id);

    const row: VectorRow = {
      id: memory.id,
      vector,
      title: memory.title,
      importance: memory.importance,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      expiresAt: memory.expiresAt,
      entryType: memory.entryType,
      ttl: memory.ttl,
      walOffset,
    };

    await table.add([row as unknown as Record<string, unknown>]);
  }

  /**
   * Removes a memory from all layer tables by ID.
   */
  async delete(id: string): Promise<void> {
    await this.initialize();
    for (const table of this.tables.values()) {
      await table.delete(`id = '${escapeId(id)}'`);
    }
  }

  /**
   * Searches for nearest neighbours across all layers.
   * Results are merged and sorted by distance.
   *
   * @param vector - Query embedding (must be VECTOR_DIM-dim)
   * @param limit  - Max results to return
   * @returns Array ordered by ascending distance (most similar first)
   */
  async search(vector: number[], limit = 10): Promise<VectorSearchResult[]> {
    this.assertVectorDim(vector, 'search');
    await this.initialize();

    const allResults: VectorSearchResult[] = [];

    // Search all layers in order: core -> journey -> moment
    for (const layer of ['core', 'journey', 'moment'] as const) {
      const table = this.tables.get(layer)!;
      try {
        const results = (await table.vectorSearch(vector)
          .limit(limit)
          .toArray()) as VectorSearchResult[];

        for (const row of results) {
          allResults.push({
            id: row.id,
            _distance: row._distance,
            _layer: layer,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const shouldRebuild =
          message.includes('No vector column found to match with the query vector dimension') ||
          message.includes('query vector dimension');
        if (!shouldRebuild) throw error;
        await this.rebuildTable(layer);
        const results = (await table.vectorSearch(vector)
          .limit(limit)
          .toArray()) as VectorSearchResult[];
        for (const row of results) {
          allResults.push({
            id: row.id,
            _distance: row._distance,
            _layer: layer,
          });
        }
      }
    }

    // Sort by distance and return top results
    allResults.sort((a, b) => a._distance - b._distance);
    return allResults.slice(0, limit);
  }

  /**
   * Searches for nearest neighbours within a specific layer.
   *
   * @param vector - Query embedding (must be VECTOR_DIM-dim)
   * @param layer - Memory layer to search within
   * @param limit - Max results to return
   * @returns Array ordered by ascending distance (most similar first)
   */
  async searchByLayer(
    vector: number[],
    layer: MemoryLayer,
    limit = 10
  ): Promise<VectorSearchResult[]> {
    this.assertVectorDim(vector, 'search');
    await this.initialize();

    const table = this.tables.get(layer)!;
    let results: VectorSearchResult[];
    try {
      results = (await table.vectorSearch(vector)
        .limit(limit)
        .toArray()) as VectorSearchResult[];
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const shouldRebuild =
        message.includes('No vector column found to match with the query vector dimension') ||
        message.includes('query vector dimension');
      if (!shouldRebuild) throw error;
      await this.rebuildTable(layer);
      results = (await table.vectorSearch(vector)
        .limit(limit)
        .toArray()) as VectorSearchResult[];
    }

    return results.map(row => ({
      id: row.id,
      _distance: row._distance,
      _layer: layer,
    }));
  }

  /**
   * Returns the total number of rows across all layers.
   */
  async count(): Promise<{ total: number; core: number; journey: number; moment: number }> {
    await this.initialize();
    const core = await this.tables.get('core')!.countRows();
    const journey = await this.tables.get('journey')!.countRows();
    const moment = await this.tables.get('moment')!.countRows();
    return { total: core + journey + moment, core, journey, moment };
  }

  /**
   * Returns the number of rows in a specific layer.
   */
  async countByLayer(layer: MemoryLayer): Promise<number> {
    await this.initialize();
    return this.tables.get(layer)!.countRows();
  }

  /**
   * Deletes expired memories from a specific layer.
   * Used by the cleanup service.
   *
   * @param layer - Layer to clean up
   * @param now - Current timestamp
   * @returns Number of deleted rows
   */
  async deleteExpired(layer: MemoryLayer, now: Date = new Date()): Promise<number> {
    await this.initialize();
    const table = this.tables.get(layer)!;
    const beforeCount = await table.countRows();
    await table.delete(`expiresAt != '' AND expiresAt < '${now.toISOString()}'`);
    const afterCount = await table.countRows();
    return beforeCount - afterCount;
  }
}
