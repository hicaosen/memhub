declare module '@clack/prompts' {
  export type CancelSymbol = symbol;

  export interface SelectOption<T> {
    value: T;
    label: string;
    hint?: string;
  }

  export interface ConfirmOptions {
    message: string;
    initialValue?: boolean;
  }

  export interface SelectOptions<T> {
    message: string;
    options: readonly SelectOption<T>[];
  }

  export interface Spinner {
    start(message?: string): void;
    stop(message?: string): void;
    message(message: string): void;
  }

  export const log: {
    info(message: string): void;
    success(message: string): void;
    error(message: string): void;
    warn(message: string): void;
  };

  export function intro(message: string): void;
  export function outro(message: string): void;
  export function cancel(message: string): void;
  export function spinner(): Spinner;
  export function confirm(options: ConfirmOptions): Promise<boolean | CancelSymbol>;
  export function select<T>(options: SelectOptions<T>): Promise<T | CancelSymbol>;
  export function isCancel(value: unknown): value is CancelSymbol;
}

declare module 'smol-toml' {
  export function parse(input: string): unknown;
  export function stringify(input: Record<string, unknown>): string;
}

declare module 'node-llama-cpp' {
  interface LlamaModel {
    createEmbeddingContext(): Promise<object>;
    createContext(): Promise<object>;
  }

  interface Llama {
    loadModel(options: { modelPath: string }): Promise<LlamaModel>;
  }

  export function getLlama(): Promise<Llama>;
}
