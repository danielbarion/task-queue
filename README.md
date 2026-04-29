# Task Queue Simulator

A distributed task queue simulator implemented entirely in TypeScript. Runs locally with Node.js — no Redis, RabbitMQ, or external services required.

## Overview

This project simulates a distributed job queue on a single machine. It supports task scheduling, concurrent worker processing, retry policies with exponential backoff, worker crash simulation, task timeouts, and dead-letter queuing. All state is persisted locally in JSON files.

## Architecture

```
┌────────────┐     ┌─────────────┐     ┌──────────────┐
│  CLI        │────▶│  TaskQueue   │────▶│  Persistence │
│  (cli.ts)   │     │  (queue.ts)  │     │  (JSON files)│
└────────────┘     └─────────────┘     └──────────────┘
                         │
                   ┌─────┴─────┐
                   │ WorkerPool │
                   │ (worker.ts)│
                   └───────────┘
                     │  │  │  │
                    w1  w2  w3  w4   ← simulated workers
```

### Components

- **TaskQueue** (`src/queue.ts`): Core queue engine managing task lifecycle (queued → running → succeeded/failed → retrying → dead-lettered). Handles enqueueing, dequeuing, state transitions, retry logic, and dead-letter management.

- **WorkerPool** (`src/worker.ts`): Simulates concurrent workers that pull tasks from the queue. Supports configurable worker count, crash simulation, slow task simulation, and timeout enforcement.

- **Persistence** (`src/persistence.ts`): Atomic JSON file persistence with write-ahead temp files. Prevents data corruption on crashes.

- **CLI** (`src/cli.ts`): Command-line interface for all queue operations.

## Task States

```
queued ──▶ running ──▶ succeeded
              │
              ▼
           failed ──▶ retrying ──▶ (back to queued)
              │
              ▼
        dead-lettered ──▶ (replay) ──▶ queued
```

| State | Description |
|-------|-------------|
| `queued` | Task is waiting to be picked up by a worker |
| `running` | Task is currently being processed |
| `succeeded` | Task completed successfully |
| `failed` | Task failed (transient state before retry/dead-letter) |
| `retrying` | Task is waiting for its backoff period before re-entering the queue |
| `dead-lettered` | Task exhausted all retries and was moved to the dead-letter queue |

## Scheduling & Retry Semantics

- **FIFO scheduling**: Tasks are dequeued in the order they were created.
- **Exponential backoff**: Retry delay doubles with each attempt (base 500ms, max 30s), plus 10% random jitter to prevent thundering herd.
- **Retry budget**: Each task specifies `maxRetries`. After exhausting retries, the task moves to the dead-letter queue.
- **Backoff formula**: `delay = min(500ms × 2^(retryCount-1), 30000ms) + jitter`

## Failure Handling

- **Worker crashes**: Workers can randomly crash during execution. The task is marked as failed and the worker restarts after a short delay. The task re-enters the retry cycle.
- **Timeouts**: If a task's execution time exceeds its `timeoutMs`, it is terminated and marked as failed.
- **Simulated failures**: A small percentage of tasks randomly fail to simulate real-world conditions.
- **Dead-letter queue**: Tasks that exhaust all retries are moved to a separate dead-letter queue for later inspection or replay.
- **Task loss prevention**: All state changes are persisted atomically. Tasks never disappear from the queue.
- **Duplicate prevention**: Succeeded tasks are never re-processed. Task IDs enforce uniqueness.

## Installation

```bash
npm install
npm run build
```

## Task Configuration

Tasks are defined in JSON files. Each task has:

```json
{
  "id": "send-email-1",
  "type": "sendEmail",
  "payload": { "to": "user@example.com" },
  "maxRetries": 3,
  "timeoutMs": 2000
}
```

| Field | Description |
|-------|-------------|
| `id` | Unique task identifier |
| `type` | Task type (for categorization) |
| `payload` | Arbitrary JSON payload |
| `maxRetries` | Maximum retry attempts before dead-lettering |
| `timeoutMs` | Maximum execution time in milliseconds |

A file can contain a single task object or an array of tasks. See `examples/tasks.json` for a full example.

## CLI Usage

### Enqueue tasks

```bash
npx queue enqueue examples/tasks.json
```

Loads tasks from a JSON file and adds them to the queue.

### Run workers

```bash
npx queue run-workers --count 4
```

Starts a pool of 4 workers that process tasks concurrently. Workers will process all available tasks and exit when the queue is empty. Prints an execution timeline on completion.

### Check status

```bash
npx queue status
```

Displays a summary of all tasks grouped by state, plus the dead-letter queue contents.

### Replay failures

```bash
npx queue replay-failures
```

Re-enqueues all dead-lettered tasks with reset retry counters.

### Inspect a task

```bash
npx queue inspect send-email-1
```

Shows full details for a specific task including state, payload, retry count, timestamps, and event history.

## Running Tests

```bash
npm test
```

The test suite covers:

- **Scheduling correctness**: FIFO ordering, duplicate rejection, state transitions
- **Retry behavior**: Retry count increments, state transitions on failure
- **Backoff timing**: Exponential delay increases with retry count
- **Worker crash handling**: Tasks recover from worker crashes
- **Timeout handling**: Tasks exceeding timeoutMs are properly timed out
- **Dead-letter behavior**: Exhausted tasks move to DLQ, replay re-enqueues them
- **Persistence**: State survives across queue instances
- **Concurrency limits**: Worker count is respected
- **Task loss prevention**: No tasks disappear during processing
- **Duplicate prevention**: Succeeded tasks are not re-processed

## Project Structure

```
├── src/
│   ├── types.ts          # Type definitions
│   ├── persistence.ts    # JSON file persistence layer
│   ├── queue.ts          # Core task queue engine
│   ├── worker.ts         # Worker pool simulation
│   ├── cli.ts            # CLI entry point
│   └── index.ts          # Public API exports
├── tests/
│   ├── queue.test.ts     # Queue engine tests
│   ├── worker.test.ts    # Worker pool tests
│   └── persistence.test.ts # Persistence layer tests
├── examples/
│   └── tasks.json        # Example task definitions
├── package.json
├── tsconfig.json
└── jest.config.js
```