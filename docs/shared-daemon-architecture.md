# Shared Daemon Architecture (Draft)

## Goal

Allow multiple CLI sessions to start MemHub safely while sharing one database instance and one embedding/vector model instance.

## Process Model

1. Every CLI session still starts its own MCP stdio process.
2. Exactly one process becomes `daemon` for a storage path.
3. Other processes become `client` and proxy `memory_load` / `memory_update` requests to the daemon.

## Election Model

1. Use `{storagePath}/.memhub-daemon.lock` as atomic election lock.
2. First process creating lock with `flag=wx` becomes daemon.
3. If lock exists, check lock PID liveness:
- alive -> stay client
- dead -> recover stale lock and retry election
4. Daemon publishes endpoint metadata in `{storagePath}/.memhub-daemon.json`.

## IPC Protocol

Transport: localhost TCP (JSON lines)

Request:
- `id: string`
- `method: memory_load | memory_update`
- `params: tool input`

Response:
- `id: string`
- `ok: boolean`
- `result?: tool output`
- `error?: string`

Compatibility guard:
- `protocolVersion` in endpoint file must match client expectation.

## Failover

When client request fails:
1. Client clears cached endpoint.
2. Client attempts election.
3. Winner becomes new daemon and serves request locally.
4. Losers wait for endpoint publication and reconnect.

## Interfaces

- `MemoryBackend`
  - `initialize()`
  - `memoryLoad(input)`
  - `memoryUpdate(input)`
  - `close()`

- `SharedMemoryBackend`
  - Implements role election + daemon server + client proxy
  - Uses existing `MemoryService` as daemon local execution engine

## Integration

`createMcpServer()` now depends on `MemoryBackend` abstraction and uses `SharedMemoryBackend` by default.

This keeps MCP tool behavior unchanged while moving heavy resources to one shared daemon process per storage path.
