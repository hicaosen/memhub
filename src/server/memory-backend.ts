import type {
  MemoryLoadInput,
  MemoryLoadOutput,
  MemoryUpdateInput,
  MemoryUpdateOutput,
} from '../contracts/types.js';

export interface MemoryBackend {
  initialize(): Promise<void>;
  memoryLoad(input: MemoryLoadInput): Promise<MemoryLoadOutput>;
  memoryUpdate(input: MemoryUpdateInput): Promise<MemoryUpdateOutput>;
  close(): Promise<void>;
}
