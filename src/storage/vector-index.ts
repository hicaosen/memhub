/**
 * VectorIndex - LanceDB-backed vector search index for memories.
 *
 * This is a search cache only. Markdown files remain the source of truth.
 * The index can be rebuilt from Markdown files at any time.
 */

import * as lancedb from '@lancedb/lancedb';
import { mkdir, access, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';
import type { Memory } from '../contracts/types.js';
import { VECTOR_DIM } from '../services/embedding-service.js';

const INDEX_SCHEMA_VERSION = 1;

const TABLE_NAME = 'memories';
const METADATA_FILE = `${TABLE_NAME}.meta.json`;

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
  category: string;
  tags: string; // JSON-serialised string[]
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
}

interface VectorIndexMetadata {
  schemaVersion: number;
  tableName: string;
  vectorDim: number;
  updatedAt: string;
}

/**
 * LanceDB vector index wrapper.
 * Data lives at `{storagePath}/.lancedb/`.
 */
export class VectorIndex {
  private readonly dbPath: string;
  private readonly metadataPath: string;
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(storagePath: string) {
    this.dbPath = join(storagePath, '.lancedb');
    this.metadataPath = join(this.dbPath, METADATA_FILE);
  }

  /** Idempotent initialisation — safe to call multiple times. */
  async initialize(): Promise<void> {
    if (this.table) return;

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
    if (existingTables.includes(TABLE_NAME)) {
      this.table = await this.db.openTable(TABLE_NAME);
      if (await this.needsRebuild()) {
        await this.db.dropTable(TABLE_NAME);
        this.table = await this.createTable();
      }
    } else {
      this.table = await this.createTable();
    }

    await this.writeMetadata();
  }

  private async createTable(): Promise<lancedb.Table> {
    // Create table with a dummy row so schema is established, then delete it
    const dummy: VectorRow = {
      id: '__init__',
      vector: new Array(VECTOR_DIM).fill(0) as number[],
      title: '',
      category: '',
      tags: '[]',
      importance: 0,
      createdAt: '',
      updatedAt: '',
      expiresAt: undefined,
      entryType: undefined,
      ttl: undefined,
      walOffset: -1,
    };
    // LanceDB expects Record<string, unknown>[] but our VectorRow is typed more strictly
    // Cast is safe here as VectorRow is a subset of Record<string, unknown>
    const table = await this.db!.createTable(TABLE_NAME, [dummy as unknown as Record<string, unknown>]);
    await table.delete(`id = '__init__'`);
    return table;
  }

  private async readMetadata(): Promise<VectorIndexMetadata | null> {
    try {
      const raw = await readFile(this.metadataPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<VectorIndexMetadata>;
      if (
        typeof parsed.schemaVersion === 'number' &&
        typeof parsed.tableName === 'string' &&
        typeof parsed.vectorDim === 'number'
      ) {
        return {
          schemaVersion: parsed.schemaVersion,
          tableName: parsed.tableName,
          vectorDim: parsed.vectorDim,
          updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  private async writeMetadata(): Promise<void> {
    const metadata: VectorIndexMetadata = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      tableName: TABLE_NAME,
      vectorDim: VECTOR_DIM,
      updatedAt: new Date().toISOString(),
    };
    await writeFile(this.metadataPath, JSON.stringify(metadata), 'utf-8');
  }

  private async detectTableVectorDim(): Promise<number | null> {
    const schema = await this.table!.schema();
    const vectorField = schema.fields.find(field => field.name === 'vector');
    if (!vectorField) return null;
    const dataType = vectorField.type as { listSize?: number };
    return typeof dataType.listSize === 'number' ? dataType.listSize : null;
  }

  private async needsRebuild(): Promise<boolean> {
    const metadata = await this.readMetadata();
    const schemaVectorDim = await this.detectTableVectorDim();

    if (schemaVectorDim !== null) {
      return schemaVectorDim !== VECTOR_DIM;
    }

    if (!metadata) return false;
    if (metadata.tableName !== TABLE_NAME) return true;
    if (metadata.schemaVersion !== INDEX_SCHEMA_VERSION) return true;
    return metadata.vectorDim !== VECTOR_DIM;
  }

  private assertVectorDim(vector: number[], operation: 'upsert' | 'search'): void {
    if (vector.length !== VECTOR_DIM) {
      throw new Error(
        `VectorIndex: ${operation} expects ${VECTOR_DIM} dimensions, got ${vector.length}`
      );
    }
  }

  /**
   * Upserts a memory row into the index.
   * LanceDB doesn't have a native upsert so we delete-then-add.
   */
  async upsert(memory: Memory, vector: number[], walOffset = -1): Promise<void> {
    this.assertVectorDim(vector, 'upsert');
    await this.initialize();
    const table = this.table!;

    // Remove existing row (if any)
    await table.delete(`id = '${escapeId(memory.id)}'`);

    const row: VectorRow = {
      id: memory.id,
      vector,
      title: memory.title,
      category: memory.category,
      tags: JSON.stringify(memory.tags),
      importance: memory.importance,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      expiresAt: memory.expiresAt,
      entryType: memory.entryType,
      ttl: memory.ttl,
      walOffset,
    };

    // LanceDB expects Record<string, unknown>[] but our VectorRow is typed more strictly
    await table.add([row as unknown as Record<string, unknown>]);
  }

  /**
   * Removes a memory from the index by ID.
   */
  async delete(id: string): Promise<void> {
    await this.initialize();
    await this.table!.delete(`id = '${escapeId(id)}'`);
  }

  /**
   * Searches for the nearest neighbours to `vector`.
   *
   * @param vector - Query embedding (must be VECTOR_DIM-dim)
   * @param limit  - Max results to return
   * @returns Array ordered by ascending distance (most similar first)
   */
  async search(vector: number[], limit = 10): Promise<VectorSearchResult[]> {
    this.assertVectorDim(vector, 'search');
    await this.initialize();

    const results = await this.table!.vectorSearch(vector).limit(limit).toArray();

    return results.map((row: Record<string, unknown>) => ({
      id: row['id'] as string,
      _distance: row['_distance'] as number,
    }));
  }

  /**
   * Returns the number of rows in the index.
   */
  async count(): Promise<number> {
    await this.initialize();
    return this.table!.countRows();
  }
}
