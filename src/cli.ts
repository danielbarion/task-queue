#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { TaskConfig, TaskState } from './types';
import { TaskQueue } from './queue';
import { WorkerPool } from './worker';
import { Persistence } from './persistence';

const COMMANDS = ['enqueue', 'run-workers', 'status', 'replay-failures', 'inspect'] as const;

function printUsage(): void {
  console.log(`
Usage: npx queue <command> [options]

Commands:
  enqueue <tasks.json>          Enqueue tasks from a JSON file
  run-workers --count <n>       Run worker pool to process tasks
  status                        Show queue status summary
  replay-failures               Re-enqueue dead-lettered tasks
  inspect <task-id>             Show details for a specific task
`);
}

function loadTasksFile(filePath: string): TaskConfig[] {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: File not found: ${resolved}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(resolved, 'utf-8');
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : [data];
}

function formatState(state: TaskState): string {
  const colors: Record<TaskState, string> = {
    'queued': '\x1b[33m',
    'running': '\x1b[36m',
    'succeeded': '\x1b[32m',
    'failed': '\x1b[31m',
    'retrying': '\x1b[35m',
    'dead-lettered': '\x1b[91m',
  };
  return `${colors[state] ?? ''}${state}\x1b[0m`;
}

async function commandEnqueue(args: string[]): Promise<void> {
  const file = args[0];
  if (!file) {
    console.error('Error: Please provide a tasks JSON file');
    process.exit(1);
  }

  const configs = loadTasksFile(file);
  const queue = new TaskQueue();
  let enqueued = 0;
  let skipped = 0;

  for (const config of configs) {
    try {
      queue.enqueue(config);
      console.log(`  Enqueued: ${config.id} (type: ${config.type})`);
      enqueued++;
    } catch (e) {
      console.log(`  Skipped: ${config.id} (${(e as Error).message})`);
      skipped++;
    }
  }

  console.log(`\nDone. Enqueued: ${enqueued}, Skipped: ${skipped}`);
}

async function commandRunWorkers(args: string[]): Promise<void> {
  let count = 2;
  const countIdx = args.indexOf('--count');
  if (countIdx !== -1 && args[countIdx + 1]) {
    count = parseInt(args[countIdx + 1], 10);
    if (isNaN(count) || count < 1) {
      console.error('Error: --count must be a positive integer');
      process.exit(1);
    }
  }

  console.log(`Starting ${count} worker(s)...\n`);

  const queue = new TaskQueue();
  const pool = new WorkerPool(queue, {
    workerCount: count,
    onTaskStart: (wid, task) => {
      console.log(`  [${wid}] Starting task ${task.id}`);
    },
    onTaskComplete: (wid, task) => {
      console.log(`  [${wid}] \x1b[32mCompleted\x1b[0m task ${task.id}`);
    },
    onTaskFail: (wid, task, error) => {
      console.log(`  [${wid}] \x1b[31mFailed\x1b[0m task ${task.id}: ${error}`);
    },
    onWorkerCrash: (wid, task) => {
      console.log(`  [${wid}] \x1b[91mCRASHED\x1b[0m while processing ${task.id}`);
    },
    onTaskTimeout: (wid, task) => {
      console.log(`  [${wid}] \x1b[33mTimed out\x1b[0m on task ${task.id}`);
    },
  });

  await pool.run();

  pool.printTimeline();

  const workers = pool.getWorkers();
  console.log('\nWorker Summary:');
  for (const w of workers) {
    console.log(`  ${w.id}: completed=${w.tasksCompleted}, failed=${w.tasksFailed}`);
  }

  queue.reload();
  const allTasks = queue.getAllTasks();
  const summary: Record<string, number> = {};
  for (const t of allTasks) {
    summary[t.state] = (summary[t.state] ?? 0) + 1;
  }
  console.log('\nFinal Queue State:');
  for (const [state, ct] of Object.entries(summary)) {
    console.log(`  ${formatState(state as TaskState)}: ${ct}`);
  }
}

async function commandStatus(): Promise<void> {
  const queue = new TaskQueue();
  const tasks = queue.getAllTasks();

  if (tasks.length === 0) {
    console.log('Queue is empty.');
    return;
  }

  const summary: Record<string, number> = {};
  for (const t of tasks) {
    summary[t.state] = (summary[t.state] ?? 0) + 1;
  }

  console.log(`\nQueue Status (${tasks.length} total tasks):\n`);
  for (const [state, count] of Object.entries(summary)) {
    console.log(`  ${formatState(state as TaskState)}: ${count}`);
  }

  const dlq = queue.getDeadLetterQueue();
  if (dlq.length > 0) {
    console.log(`\nDead-Letter Queue (${dlq.length}):`);
    for (const t of dlq) {
      console.log(`  ${t.id}: ${t.error ?? 'unknown error'}`);
    }
  }

  console.log('');
}

async function commandReplayFailures(): Promise<void> {
  const queue = new TaskQueue();
  const replayed = queue.replayFailures();

  if (replayed.length === 0) {
    console.log('No dead-lettered tasks to replay.');
    return;
  }

  console.log(`Re-enqueued ${replayed.length} task(s):`);
  for (const t of replayed) {
    console.log(`  ${t.id} (type: ${t.type})`);
  }
}

async function commandInspect(args: string[]): Promise<void> {
  const taskId = args[0];
  if (!taskId) {
    console.error('Error: Please provide a task ID');
    process.exit(1);
  }

  const queue = new TaskQueue();
  const task = queue.getTask(taskId);

  if (!task) {
    console.error(`Error: Task ${taskId} not found`);
    process.exit(1);
  }

  console.log(`\nTask: ${task.id}`);
  console.log(`  Type:          ${task.type}`);
  console.log(`  State:         ${formatState(task.state)}`);
  console.log(`  Payload:       ${JSON.stringify(task.payload)}`);
  console.log(`  Max Retries:   ${task.maxRetries}`);
  console.log(`  Retry Count:   ${task.retryCount}`);
  console.log(`  Timeout:       ${task.timeoutMs}ms`);
  console.log(`  Created:       ${new Date(task.createdAt).toISOString()}`);
  console.log(`  Started:       ${task.startedAt ? new Date(task.startedAt).toISOString() : 'N/A'}`);
  console.log(`  Completed:     ${task.completedAt ? new Date(task.completedAt).toISOString() : 'N/A'}`);
  console.log(`  Worker:        ${task.assignedWorker ?? 'N/A'}`);
  console.log(`  Error:         ${task.error ?? 'None'}`);

  if (task.history.length > 0) {
    console.log(`\n  Event History:`);
    for (const event of task.history) {
      const time = new Date(event.timestamp).toISOString();
      const worker = event.workerId ? ` (${event.workerId})` : '';
      const error = event.error ? ` - ${event.error}` : '';
      console.log(`    ${time}  ${formatState(event.state)}${worker}${error}`);
    }
  }
  console.log('');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  switch (command) {
    case 'enqueue':
      await commandEnqueue(commandArgs);
      break;
    case 'run-workers':
      await commandRunWorkers(commandArgs);
      break;
    case 'status':
      await commandStatus();
      break;
    case 'replay-failures':
      await commandReplayFailures();
      break;
    case 'inspect':
      await commandInspect(commandArgs);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});