import type { RetrievalCandidate, Reranker } from './types.js';

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const latin = lower.split(/\s+/).filter(Boolean);
  const cjk = (text.match(/[\u4e00-\u9fff]{1,}/g) ?? []).flatMap(token =>
    token.length > 1 ? [token, ...Array.from(token)] : [token]
  );
  return [...latin, ...cjk];
}

export class LightweightCrossEncoderReranker implements Reranker {
  rerank(input: {
    query: string;
    candidates: readonly RetrievalCandidate[];
  }): Promise<readonly RetrievalCandidate[]> {
    const qTokens = new Set(tokenize(input.query));

    const scored = input.candidates.map(candidate => {
      const text = `${candidate.memory.title}\n${candidate.memory.content}`;
      const mTokens = tokenize(text);
      const hitCount = mTokens.reduce((acc, token) => (qTokens.has(token) ? acc + 1 : acc), 0);
      const denom = Math.max(1, qTokens.size + mTokens.length * 0.2);
      const rerankScore = Math.min(1, hitCount / denom);

      return {
        candidate,
        rerankScore,
      };
    });

    return Promise.resolve(
      scored.sort((a, b) => b.rerankScore - a.rerankScore).map(item => item.candidate)
    );
  }
}
