# Explicit Daemon Architecture

## Goal

Keep one long-running MemHub backend per storage path while making MCP processes thin clients.

## Commands

- `memhub daemon` / `memhub daemon start`: start the daemon in the background.
- `memhub daemon run`: run the daemon in the foreground.
- `memhub daemon status`: show PID, endpoint, lock path, and endpoint file.
- `memhub daemon stop`: stop the daemon.
- `memhub daemon restart`: restart the daemon in the background.
- `memhub daemon logs`: print the daemon log directory and recent log files.

## Process Model

1. `memhub daemon run` owns `MemoryService`, Markdown storage, WAL, LanceDB, and local models.
2. Background start spawns `memhub daemon run` as a detached process.
3. MCP stdio processes use `DaemonClientBackend`; they never become the daemon.
4. If MCP cannot find a daemon, it starts one automatically unless `MEMHUB_DAEMON_AUTO_START=false`.

## Single-Instance Lock

1. The daemon uses `{storagePath}/.internal/daemon.lock` as an atomic single-instance lock.
2. A running daemon publishes `{storagePath}/.internal/daemon.json` with its localhost TCP endpoint.
3. Stale lock and endpoint files are removed when their PID is no longer alive.

This lock protects daemon startup only. It is not an MCP process election mechanism.

## IPC Protocol

Transport: localhost TCP with JSON lines.

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

- `protocolVersion` in the endpoint file must match the client expectation.

## Integration

`createMcpServer()` depends on the `MemoryBackend` interface and uses `DaemonClientBackend` by default. `DaemonClientBackend` discovers the endpoint, optionally starts the daemon, and forwards `memory_load` / `memory_update` requests over IPC.
