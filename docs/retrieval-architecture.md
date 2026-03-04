# Retrieval Architecture (Hybrid + Rewrite + Facts + Router + Rerank)

## Goals

- Keep memory transparent and Git-friendly (Markdown as source of truth)
- Improve Chinese retrieval recall and precision
- Use staged retrieval with clear module boundaries

## Package Boundaries

- `src/services/retrieval/intent-router.ts`
  - Rule-based intent routing (`fact_lookup`, `keyword_lookup`, `semantic_lookup`)
- `src/services/retrieval/query-rewriter.ts`
  - Query normalization and synonym expansion (rule-based)
- `src/services/retrieval/fact-extractor.ts`
  - Structured fact extraction at write time (currently `work_schedule.off_time`)
- `src/services/retrieval/vector-retriever.ts`
  - Adapter for embedding + vector index retrieval
- `src/services/retrieval/hybrid-scorer.ts`
  - Fused scoring (`vector + keyword + fact + importance + freshness + rerank`)
- `src/services/retrieval/reranker.ts`
  - Cross-encoder style re-rank abstraction with a lightweight default implementation
- `src/services/retrieval/pipeline.ts`
  - Orchestrates route -> rewrite -> recall -> fuse -> rerank

## Data Flow

1. Router classifies user query intent.
2. Rewriter generates normalized query and variants.
3. Candidate recall:
   - keyword recall from markdown memories
   - vector recall (if enabled)
   - fact match boost from structured facts
4. Hybrid scorer computes final score per candidate.
5. Reranker reorders top candidates.
6. Return `SearchResult[]` to `MemoryService.search`.

## Interfaces

Defined in `src/services/retrieval/types.ts`:

- `IntentRouter`
- `QueryRewriter`
- `FactExtractor`
- `VectorRetriever`
- `Reranker`
- `RetrievalPipelineContext`
- `RetrievalCandidate` with score breakdown

## Write-Time Fact Extraction

- `Memory.facts` is optional and persisted in YAML front matter.
- Current rule:
  - Detects overtime/off-time expressions like `加班到21:00`, `下班时间是9点半`
  - Normalizes to `HH:MM`
  - Emits:
    - `key: work_schedule.off_time`
    - `source: rule`

## TDD Flow Used

1. Add failing tests for router/rewriter/fact/pipeline and memory-service integration.
2. Implement modules to make tests pass.
3. Run typecheck and full test suite.
