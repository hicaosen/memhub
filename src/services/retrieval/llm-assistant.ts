import type { MemoryFact } from '../../contracts/types.js';
import type { IntentRoute, LlmAssistantConfig, LlmTaskAssistant, RewriteOutput } from './types.js';
import { getModelByKind, resolveModelPath } from '../model-manager/index.js';
import { createLogger, type Logger } from '../../utils/logger.js';

const DEFAULT_THREADS = 4;

// Lazy-initialized logger
let _logger: Logger | null = null;
function getLogger(): Logger {
  if (!_logger) {
    _logger = createLogger();
  }
  return _logger;
}

const INTENT_PROMPT = `分析用户查询的检索意图，返回JSON格式：
{"intent":"fact_lookup|keyword_lookup|semantic_lookup","confidence":0-1,"primary":"fact|hybrid"}

规则：
- fact_lookup: 查询特定事实（时间、地点、数值等具体信息）
- keyword_lookup: 显式搜索请求（"搜"、"找"、"查"等）
- semantic_lookup: 语义相关查询（背景、原因、方案等）

查询：`;

const REWRITE_PROMPT = `改写查询以提升召回，返回JSON格式：
{"normalized":"标准化查询","variants":["变体1","变体2"]}

规则：
- 保留原意，扩展同义表达
- 修正可能的错别字
- 变体数量3-5个

查询：`;

const FACT_PROMPT = `从文本中抽取结构化事实，返回JSON数组：
[{"key":"命名空间.字段名","value":"值","confidence":0-1}]

规则：
- key使用snake_case命名空间格式
- value保持原始值格式
- 只抽取明确提到的事实

文本：`;

function safeParseJson<T>(raw: string, validator: (obj: unknown) => obj is T): T | null {
  try {
    let jsonStr = raw.trim();

    // 如果包含markdown代码块，提取内容
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // 尝试找到JSON对象或数组的边界
    const firstBrace = jsonStr.indexOf('{');
    const firstBracket = jsonStr.indexOf('[');

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      const lastBrace = jsonStr.lastIndexOf('}');
      if (lastBrace > firstBrace) {
        jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
      }
    } else if (firstBracket !== -1) {
      const lastBracket = jsonStr.lastIndexOf(']');
      if (lastBracket > firstBracket) {
        jsonStr = jsonStr.slice(firstBracket, lastBracket + 1);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const parsed = JSON.parse(jsonStr);
    return validator(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isValidIntentRoute(obj: unknown): obj is IntentRoute {
  if (typeof obj !== 'object' || obj === null) return false;
  const route = obj as Record<string, unknown>;
  return (
    typeof route.intent === 'string' &&
    ['fact_lookup', 'keyword_lookup', 'semantic_lookup'].includes(route.intent) &&
    typeof route.confidence === 'number' &&
    route.confidence >= 0 &&
    route.confidence <= 1 &&
    typeof route.primary === 'string' &&
    ['fact', 'hybrid'].includes(route.primary)
  );
}

function isValidRewriteOutput(obj: unknown): obj is RewriteOutput {
  if (typeof obj !== 'object' || obj === null) return false;
  const output = obj as Record<string, unknown>;
  return (
    typeof output.normalized === 'string' &&
    Array.isArray(output.variants) &&
    output.variants.every(v => typeof v === 'string')
  );
}

function isValidFactArray(obj: unknown): obj is readonly MemoryFact[] {
  if (!Array.isArray(obj)) return false;
  return obj.every(item => {
    if (typeof item !== 'object' || item === null) return false;
    const fact = item as Record<string, unknown>;
    return (
      typeof fact.key === 'string' &&
      typeof fact.value === 'string' &&
      typeof fact.confidence === 'number'
    );
  });
}

export interface LlamaClient {
  complete(prompt: string): Promise<string>;
}

export class NodeLlamaTaskAssistant implements LlmTaskAssistant {
  private readonly client: LlamaClient;

  constructor(config: LlmAssistantConfig, client?: LlamaClient) {
    if (client) {
      this.client = client;
    } else {
      const modelPath = config.modelPath ?? NodeLlamaTaskAssistant.getDefaultModelPath();
      const threads = config.threads ?? DEFAULT_THREADS;
      this.client = new NodeLlamaClient(modelPath, threads);
    }
  }

  /**
   * Get the default model path from model-manager
   */
  static getDefaultModelPath(): string {
    const model = getModelByKind('llm');
    if (!model) {
      throw new Error('LLM model not found in model configuration');
    }
    const resolved = resolveModelPath(model);
    return resolved.modelFile;
  }

  async routeIntent(query: string): Promise<IntentRoute | null> {
    const startTime = Date.now();
    await getLogger().debug('llm_route_intent_start', `Routing intent for query`);

    const raw = await this.client.complete(INTENT_PROMPT + query);
    const result = safeParseJson(raw, isValidIntentRoute);

    await getLogger().info(
      'llm_route_intent_complete',
      `Intent routed: ${result?.intent ?? 'unknown'}`,
      {
        durationMs: Date.now() - startTime,
        meta: { intent: result?.intent, confidence: result?.confidence, queryLength: query.length },
      }
    );

    return result;
  }

  async rewriteQuery(query: string): Promise<RewriteOutput | null> {
    const startTime = Date.now();
    await getLogger().debug('llm_rewrite_query_start', `Rewriting query`);

    const raw = await this.client.complete(REWRITE_PROMPT + query);
    const result = safeParseJson(raw, isValidRewriteOutput);
    if (!result) {
      await getLogger().warn('llm_rewrite_query_failed', `Failed to parse rewrite output`);
      return null;
    }

    // 确保原始查询在variants第一位
    const variants = new Set([query, ...result.variants]);
    const output = {
      normalized: result.normalized,
      variants: Array.from(variants).slice(0, 8),
    };

    await getLogger().info(
      'llm_rewrite_query_complete',
      `Query rewritten with ${output.variants.length} variants`,
      {
        durationMs: Date.now() - startTime,
        meta: { variantCount: output.variants.length },
      }
    );

    return output;
  }

  async extractFacts(input: {
    title: string;
    content: string;
  }): Promise<readonly MemoryFact[] | null> {
    const startTime = Date.now();
    await getLogger().debug('llm_extract_facts_start', `Extracting facts from memory`);

    const text = `标题: ${input.title}\n内容: ${input.content}`;
    const raw = await this.client.complete(FACT_PROMPT + text);
    const facts = safeParseJson(raw, isValidFactArray);
    if (!facts) {
      await getLogger().warn('llm_extract_facts_failed', `Failed to parse facts output`);
      return null;
    }

    const result = facts.map(fact => ({
      ...fact,
      source: 'llm' as const,
    }));

    await getLogger().info('llm_extract_facts_complete', `Extracted ${result.length} facts`, {
      durationMs: Date.now() - startTime,
      meta: { factCount: result.length },
    });

    return result;
  }
}

class NodeLlamaClient implements LlamaClient {
  private readonly modelPath: string;
  private readonly threads: number;
  private initPromise: Promise<{
    complete(prompt: string): Promise<string>;
  }> | null = null;

  constructor(modelPath: string, threads: number) {
    this.modelPath = modelPath;
    this.threads = threads;
  }

  private async getEngine(): Promise<{
    complete(prompt: string): Promise<string>;
  }> {
    if (!this.initPromise) {
      this.initPromise = this.initEngine();
    }
    return this.initPromise;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async initEngine(): Promise<{
    complete(prompt: string): Promise<string>;
  }> {
    const startTime = Date.now();
    await getLogger().info('llm_init_start', 'Initializing LLM engine');

    try {
      // 动态导入 node-llama-cpp (ESM only)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      const { getLlama, LlamaChatSession } = await import('node-llama-cpp');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const llama = await getLlama();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const model = await llama.loadModel({ modelPath: this.modelPath });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const context = await model.createContext({ threads: this.threads });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const sequence = context.getSequence();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const session = new LlamaChatSession({ contextSequence: sequence });

      await getLogger().info('llm_init_complete', 'LLM engine initialized', {
        durationMs: Date.now() - startTime,
        meta: { threads: this.threads },
      });

      return {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
        async complete(prompt: string): Promise<string> {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
          const response = await session.prompt(prompt, {
            maxTokens: 256,
            temperature: 0.1,
          });
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return response;
        },
      };
    } catch (error) {
      await getLogger().error(
        'llm_init_failed',
        `Failed to initialize LLM: ${error instanceof Error ? error.message : String(error)}`,
        {
          durationMs: Date.now() - startTime,
        }
      );
      throw error;
    }
  }

  async complete(prompt: string): Promise<string> {
    const engine = await this.getEngine();
    return engine.complete(prompt);
  }
}

// 保留旧的导出名称作为别名，方便迁移
export const OllamaLlmTaskAssistant = NodeLlamaTaskAssistant;
