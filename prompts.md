Implement a distributed task queue simulator in TypeScript.

Requirements:

Support enqueueing tasks
Support multiple simulated workers
Support task states:
queued
running
succeeded
failed
retrying
dead-lettered
Support retry policies
Support exponential backoff
Support worker crashes
Support task timeouts
Support concurrency limits
Include tests

Then implement a local task processing CLI.

Build a TypeScript CLI tool that simulates a distributed job queue on one machine.

Task definitions must be loaded from JSON.

Example task config:

{
"id": "send-email-1",
"type": "sendEmail",
"payload": { "to": "user@example.com" },
"maxRetries": 3,
"timeoutMs": 2000
}

CLI commands:

npx queue enqueue tasks.json
npx queue run-workers --count 4
npx queue status
npx queue replay-failures
npx queue inspect send-email-1

Features:

Persist queue state locally in JSON files
Simulate worker failures
Simulate slow tasks
Prevent task loss
Prevent duplicate successful processing
Move permanently failed tasks to a dead-letter queue
Print execution timeline

Tests:

Scheduling correctness
Retry behavior
Backoff timing
Worker crash handling
Timeout handling
Dead-letter behavior

Constraints:

Do NOT use Redis, BullMQ, RabbitMQ, or queue libraries
Do NOT use external services or APIs
Must run locally with Node.js
Must be implemented in TypeScript

Deliverables:

Full TypeScript source code
Example task files
CLI usage instructions
Test suite
Explanation of scheduling, retry semantics, and failure handling

Create a readme with the summary about the project and how it works
