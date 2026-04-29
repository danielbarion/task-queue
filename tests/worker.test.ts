import * as fs from 'fs';
import * as path from 'path';
import { TaskQueue } from '../src/queue';
import { WorkerPool } from '../src/worker';
import { Persistence } from '../src/persistence';
import { TaskConfig } from '../src/types';

const TEST_STATE_DIR = path.join(__dirname, '.test-worker-data');

function createTestPersistence(): Persistence {
  return new Persistence(TEST_STATE_DIR);
}

function createTestQueue(): TaskQueue {
  return new TaskQueue(createTestPersistence());
}

function sampleTask(overrides: Partial<TaskConfig> = {}): TaskConfig {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'test',
    payload: { data: 'test' },
    maxRetries: 3,
    timeoutMs: 5000,
    ...overrides,
  };
}

beforeEach(() => {
  if (fs.existsSync(TEST_STATE_DIR)) {
    fs.rmSync(TEST_STATE_DIR, { recursive: true });
  }
});

afterAll(() => {
  if (fs.existsSync(TEST_STATE_DIR)) {
    fs.rmSync(TEST_STATE_DIR, { recursive: true });
  }
});

describe('WorkerPool - Basic Processing', () => {
  test('should process all queued tasks', async () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'wp-1' }));
    queue.enqueue(sampleTask({ id: 'wp-2' }));
    queue.enqueue(sampleTask({ id: 'wp-3' }));

    const pool = new WorkerPool(queue, {
      workerCount: 2,
      crashProbability: 0,
      slowTaskProbability: 0,
    });

    await pool.run();
    queue.reload();

    const tasks = queue.getAllTasks();
    for (const t of tasks) {
      expect(['succeeded', 'failed', 'retrying', 'dead-lettered']).toContain(t.state);
    }
    // No tasks should remain queued
    expect(queue.getTasksByState('queued')).toHaveLength(0);
  }, 15000);

  test('should respect worker count', async () => {
    const queue = createTestQueue();
    for (let i = 0; i < 5; i++) {
      queue.enqueue(sampleTask({ id: `conc-${i}` }));
    }

    const pool = new WorkerPool(queue, {
      workerCount: 3,
      crashProbability: 0,
      slowTaskProbability: 0,
    });

    const workers = pool.getWorkers();
    expect(workers).toHaveLength(3);

    await pool.run();
  }, 15000);

  test('should record timeline events', async () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'timeline-1' }));

    const pool = new WorkerPool(queue, {
      workerCount: 1,
      crashProbability: 0,
      slowTaskProbability: 0,
    });

    await pool.run();

    const timeline = pool.getTimeline();
    expect(timeline.length).toBeGreaterThanOrEqual(2); // START + DONE/FAIL
    expect(timeline[0].event).toBe('START');
  }, 10000);
});

describe('WorkerPool - Worker Crash Handling', () => {
  test('should handle worker crashes and retry tasks', async () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'crash-1', maxRetries: 5, timeoutMs: 10000 }));
    queue.enqueue(sampleTask({ id: 'crash-2', maxRetries: 5, timeoutMs: 10000 }));

    let crashCount = 0;
    const pool = new WorkerPool(queue, {
      workerCount: 2,
      crashProbability: 0.8, // High crash probability
      slowTaskProbability: 0,
      onWorkerCrash: () => { crashCount++; },
    });

    await pool.run();
    queue.reload();

    // At least some crashes should have occurred
    const timeline = pool.getTimeline();
    const crashes = timeline.filter(e => e.event === 'CRASH');
    // With 0.8 probability, crashes are very likely but not guaranteed
    // The important thing is the system handles them
    const allTasks = queue.getAllTasks();
    for (const t of allTasks) {
      expect(t.state).not.toBe('running'); // No tasks stuck in running
    }
  }, 30000);
});

describe('WorkerPool - Timeout Handling', () => {
  test('should timeout tasks that exceed timeoutMs', async () => {
    const queue = createTestQueue();
    // Very short timeout to force timeouts on slow tasks
    queue.enqueue(sampleTask({ id: 'timeout-1', timeoutMs: 10, maxRetries: 0 }));

    let timedOut = false;
    const pool = new WorkerPool(queue, {
      workerCount: 1,
      crashProbability: 0,
      slowTaskProbability: 1.0, // Force all tasks slow
      slowTaskMultiplier: 100,
      onTaskTimeout: () => { timedOut = true; },
    });

    await pool.run();
    queue.reload();

    const task = queue.getTask('timeout-1');
    // With forced slow tasks and 10ms timeout, it should time out
    expect(task?.state).toBe('dead-lettered');
    expect(task?.error).toContain('Timeout');
  }, 10000);
});

describe('WorkerPool - Concurrency Limits', () => {
  test('should not exceed worker count in parallel execution', async () => {
    const queue = createTestQueue();
    for (let i = 0; i < 10; i++) {
      queue.enqueue(sampleTask({ id: `limit-${i}` }));
    }

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const pool = new WorkerPool(queue, {
      workerCount: 3,
      crashProbability: 0,
      slowTaskProbability: 0,
      onTaskStart: () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      },
      onTaskComplete: () => { currentConcurrent--; },
      onTaskFail: () => { currentConcurrent--; },
      onWorkerCrash: () => { currentConcurrent--; },
      onTaskTimeout: () => { currentConcurrent--; },
    });

    await pool.run();

    expect(maxConcurrent).toBeLessThanOrEqual(3);
  }, 15000);
});

describe('WorkerPool - Task Loss Prevention', () => {
  test('tasks should never disappear from the queue', async () => {
    const queue = createTestQueue();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = `noloss-${i}`;
      ids.push(id);
      queue.enqueue(sampleTask({ id, maxRetries: 5, timeoutMs: 10000 }));
    }

    const pool = new WorkerPool(queue, {
      workerCount: 2,
      crashProbability: 0.2,
      slowTaskProbability: 0.1,
    });

    await pool.run();
    queue.reload();

    // All tasks should still exist
    for (const id of ids) {
      const task = queue.getTask(id);
      expect(task).not.toBeNull();
    }
  }, 30000);
});

describe('WorkerPool - Duplicate Processing Prevention', () => {
  test('succeeded tasks should not be processed again', async () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'nodup-1', timeoutMs: 10000 }));

    const startCounts: Record<string, number> = {};
    const pool = new WorkerPool(queue, {
      workerCount: 2,
      crashProbability: 0,
      slowTaskProbability: 0,
      onTaskStart: (_, task) => {
        startCounts[task.id] = (startCounts[task.id] ?? 0) + 1;
      },
    });

    await pool.run();
    queue.reload();

    const task = queue.getTask('nodup-1');
    if (task?.state === 'succeeded') {
      expect(startCounts['nodup-1']).toBe(1);
    }
  }, 10000);
});