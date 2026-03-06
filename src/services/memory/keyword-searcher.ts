import type { Memory, SearchMemoryInput, SearchResult, ListResult } from '../../contracts/types.js';

/** Interface for list operation */
interface IListProvider {
  list(input: { limit: number }): Promise<ListResult>;
  listAll?(): Promise<readonly Memory[]>;
}

/**
 * Keyword-based memory searcher
 */
export class KeywordSearcher {
  private readonly listProvider: IListProvider;

  constructor(listProvider: IListProvider) {
    this.listProvider = listProvider;
  }

  /**
   * Performs keyword-based search on memories
   */
  async search(input: SearchMemoryInput): Promise<{ results: SearchResult[]; total: number }> {
    const memories = this.listProvider.listAll
      ? await this.listProvider.listAll()
      : (await this.listProvider.list({ limit: 10000 })).memories;

    const query = input.query.toLowerCase();
    const keywords = query.split(/\s+/).filter(k => k.length > 0);
    const results: SearchResult[] = [];

    for (const memory of memories) {
      let score = 0;
      const matches: string[] = [];

      // Title matching
      const titleLower = memory.title.toLowerCase();
      if (titleLower.includes(query)) {
        score += 10;
        matches.push(memory.title);
      } else {
        for (const keyword of keywords) {
          if (titleLower.includes(keyword)) {
            score += 5;
            if (!matches.includes(memory.title)) matches.push(memory.title);
          }
        }
      }

      // Content matching
      const contentLower = memory.content.toLowerCase();
      if (contentLower.includes(query)) {
        score += 3;
        const index = contentLower.indexOf(query);
        const start = Math.max(0, index - 50);
        const end = Math.min(contentLower.length, index + query.length + 50);
        matches.push(memory.content.slice(start, end));
      } else {
        for (const keyword of keywords) {
          if (contentLower.includes(keyword)) {
            score += 1;
            const index = contentLower.indexOf(keyword);
            const start = Math.max(0, index - 30);
            const end = Math.min(contentLower.length, index + keyword.length + 30);
            const snippet = memory.content.slice(start, end);
            if (!matches.some(m => m.includes(snippet))) matches.push(snippet);
          }
        }
      }

      if (score > 0) {
        results.push({
          memory,
          score: Math.min(score / 20, 1),
          matches: matches.slice(0, 3),
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const limit = input.limit ?? 10;
    return { results: results.slice(0, limit), total: results.length };
  }
}
