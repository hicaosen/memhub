# MemHub 架构图

## 1. 整体系统架构

```mermaid
graph TB
    subgraph "Client Layer"
        Client[MCP Client<br/>Claude Desktop / IDE]
    end

    subgraph "Protocol Layer"
        MCP[MCP Protocol<br/>stdio transport]
    end

    subgraph "Application Layer"
        Server[MCP Server<br/>mcp-server.ts]
        Router[Tool Router<br/>memory_load / memory_update]
    end

    subgraph "Service Layer"
        MemoryService[Memory Service<br/>Business Logic]
        EmbeddingService[Embedding Service<br/>ONNX Model]
    end

    subgraph "Storage Layer"
        MarkdownStorage[Markdown Storage<br/>File System]
        VectorIndex[Vector Index<br/>LanceDB]
    end

    subgraph "Data Layer"
        Files[Markdown Files<br/>.md]
        VectorDB[LanceDB<br/>.lancedb/]
    end

    Client -->|stdio| MCP
    MCP --> Server
    Server --> Router
    Router --> MemoryService
    MemoryService --> MarkdownStorage
    MemoryService --> EmbeddingService
    MemoryService --> VectorIndex
    EmbeddingService -.->|embeddings| VectorIndex
    MarkdownStorage --> Files
    VectorIndex --> VectorDB

    style Client fill:#e1f5ff
    style Server fill:#fff4e1
    style MemoryService fill:#f0f0f0
    style Files fill:#e8f5e9
    style VectorDB fill:#e8f5e9
```

## 2. 核心组件架构

```mermaid
graph LR
    subgraph "MCP Server"
        A[Server Initialization]
        B[Tool Registration]
        C[Request Handler]
        D[Response Formatter]
    end

    subgraph "Memory Service"
        E[CRUD Operations]
        F[Search Logic]
        G[Validation]
        H[Error Handling]
    end

    subgraph "Storage Components"
        I[Markdown Storage]
        J[FrontMatter Parser]
        K[Vector Index]
        L[Embedding Service]
    end

    A --> B
    B --> C
    C --> E
    E --> I
    E --> L
    E --> K
    I --> J
    F --> K
    L -.->|384-dim vectors| K
    C --> D
    E --> G
    E --> H

    style A fill:#ffebee
    style E fill:#e3f2fd
    style I fill:#f1f8e9
```

## 3. 数据流图

### 3.1 Memory Load 流程

```mermaid
sequenceDiagram
    participant Client as MCP Client
    participant Server as MCP Server
    participant Service as Memory Service
    participant Storage as Markdown Storage
    participant Vector as Vector Index
    participant Embed as Embedding Service

    Client->>Server: memory_load(query, tags, category)
    Server->>Service: memoryLoad(input)

    alt Vector Search Enabled
        Service->>Embed: embed(query)
        Embed-->>Service: 384-dim vector
        Service->>Vector: search(vector, limit)
        Vector-->>Service: ranked IDs
        Service->>Storage: read(ids)
        Storage-->>Service: Memory objects
    else Tag/Category Filter
        Service->>Storage: list(filters)
        Storage-->>Service: filtered memories
    end

    Service-->>Server: MemoryLoadOutput
    Server-->>Client: JSON Response
```

### 3.2 Memory Update 流程

```mermaid
sequenceDiagram
    participant Client as MCP Client
    participant Server as MCP Server
    participant Service as Memory Service
    participant Storage as Markdown Storage
    participant Vector as Vector Index
    participant Embed as Embedding Service

    Client->>Server: memory_update(content, title, tags)
    Server->>Service: memoryUpdate(input)
    Service->>Service: Generate UUID & timestamp
    Service->>Storage: write(memory)
    Storage-->>Service: file path

    alt Vector Search Enabled
        Service->>Embed: embedMemory(title, content)
        Embed-->>Service: 384-dim vector
        Service->>Vector: upsert(memory, vector)
    end

    Service-->>Server: MemoryUpdateOutput
    Server-->>Client: JSON Response
```

## 4. 存储架构

```mermaid
graph TB
    subgraph "File System Structure"
        Root[memories/]
        DateDir[YYYY-MM-DD/]
        SessionDir[session_uuid/]
        File[title-slug.md]
    end

    subgraph "Markdown File Format"
        YAML[YAML Front Matter<br/>---<br/>id: uuid<br/>tags: array<br/>category: string<br/>importance: 1-5<br/>---]
        Content[Markdown Content<br/># Title<br/><br/>Body text...]
    end

    subgraph "Vector Database"
        LanceDB[LanceDB<br/>.lancedb/]
        Table[memories table]
        VectorCol[vector: float32[384]]
        MetaCol[metadata columns<br/>id, title, category, tags]
    end

    Root --> DateDir
    DateDir --> SessionDir
    SessionDir --> File
    File --> YAML
    File --> Content

    LanceDB --> Table
    Table --> VectorCol
    Table --> MetaCol

    style Root fill:#fff9c4
    style LanceDB fill:#e1bee7
```

## 5. 技术栈架构

```mermaid
mindmap
  root((MemHub))
    Runtime
      Node.js 18+
      TypeScript 5.9+
    Protocol
      MCP SDK
      stdio transport
      JSON-RPC
    Storage
      Markdown
        YAML Front Matter
        Git-friendly
      Vector DB
        LanceDB
        384-dim vectors
    ML/AI
      Embedding
        ONNX Runtime
        MiniLM-L6-v2
    Validation
      Zod schemas
      TypeScript types
    Testing
      Vitest
      80%+ coverage
    Quality
      ESLint
      Prettier
      TypeScript strict
```

## 6. 部署架构

```mermaid
graph TB
    subgraph "Development"
        DevCode[Source Code<br/>TypeScript]
        DevTest[Unit Tests<br/>Vitest]
        DevBuild[Build<br/>tsc]
    end

    subgraph "Distribution"
        NPM[npm package<br/>@synth-coder/memhub]
        Dist[dist/<br/>JavaScript + .d.ts]
    end

    subgraph "Runtime"
        MCPClient[MCP Client<br/>Claude/IDE]
        NPX[npx execution]
        NodeEnv[Node.js Environment<br/>MEMHUB_STORAGE_PATH]
    end

    subgraph "Data Storage"
        MemDir[memories/<br/>Markdown Files]
        VectorDir[.lancedb/<br/>Vector Index]
        HFModel[~/.cache/huggingface/<br/>ONNX Model Cache]
    end

    DevCode --> DevTest
    DevTest --> DevBuild
    DevBuild --> NPM
    NPM --> NPX
    NPX --> NodeEnv
    MCPClient --> NPX
    NodeEnv --> MemDir
    NodeEnv --> VectorDir
    NodeEnv --> HFModel

    style DevCode fill:#e3f2fd
    style NPM fill:#fff3e0
    style MCPClient fill:#f3e5f5
    style MemDir fill:#e8f5e9
```

## 7. 错误处理架构

```mermaid
graph TD
    A[Client Request] --> B{Parameter Validation}
    B -->|Invalid| C[ZodError]
    B -->|Valid| D{Service Operation}

    D --> E{Storage Operation}
    E -->|File Error| F[StorageError]
    E -->|Success| G[Memory Object]

    D --> H{Vector Operation}
    H -->|Index Error| I[ServiceError]
    H -->|Success| J[Vector Result]

    G --> K{Embedding}
    J --> K
    K -->|Model Error| L[ServiceError]
    K -->|Success| M[Success Response]

    C --> N[Error Response]
    F --> N
    I --> N
    L --> N
    M --> O[Success Response]

    N --> P[Client]
    O --> P

    style C fill:#ffcdd2
    style F fill:#ffcdd2
    style I fill:#ffcdd2
    style L fill:#ffcdd2
    style M fill:#c8e6c9
    style O fill:#c8e6c9
```

## 8. 性能优化架构

```mermaid
graph LR
    subgraph "Lazy Loading"
        A1[Service Initialization]
        A2[Embedding Model]
        A3[Vector Index]
    end

    subgraph "Caching"
        B1[Model Cache<br/>~/.cache/huggingface]
        B2[Vector Cache<br/>LanceDB]
        B3[File Handle Pool]
    end

    subgraph "Async Operations"
        C1[Non-blocking I/O]
        C2[Background Index Update]
        C3[Parallel Processing]
    end

    A1 --> A2
    A2 --> A3
    A2 --> B1
    A3 --> B2
    C1 --> C2
    C2 --> C3

    style A1 fill:#e1f5fe
    style B1 fill:#fff9c4
    style C1 fill:#f3e5f5
```

## 关键设计特性

### 1. **分层架构**

- **协议层**: MCP 协议处理
- **应用层**: 服务器和路由逻辑
- **服务层**: 核心业务逻辑
- **存储层**: 数据持久化

### 2. **可扩展性**

- 模块化设计，易于添加新的存储后端
- 支持插件式的 embedding 服务
- 可配置的向量搜索开关

### 3. **容错性**

- 优雅的错误处理和降级
- 向量搜索失败不影响基本功能
- Markdown 作为唯一数据源

### 4. **开发体验**

- 完整的 TypeScript 类型支持
- Zod schema 验证
- 详尽的测试覆盖

### 5. **运维友好**

- 纯文本存储，易于备份和迁移
- Git 原生支持版本控制
- 无外部依赖数据库
