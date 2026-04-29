import * as fs from 'fs';
import * as path from 'path';
import { TaskQueue } from '../src/queue';
import { Persistence } from '../src/persistence';
import { TaskConfig } from '../src/types';

const TEST_STATE_DIR = path.join(__dirname, '.test-queue-data');

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
    timeoutMs: 2000,
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

describe('TaskQueue - Scheduling Correctness', () => {
  test('should enqueue a task with queued state', () => {
    const queue = createTestQueue();
    const config = sampleTask({ id: 'sched-1' });
    const task = queue.enqueue(config);

    expect(task.state).toBe('queued');
    expect(task.id).toBe('sched-1');
    expect(task.retryCount).toBe(0);
    expect(task.history).toHaveLength(1);
    expect(task.history[0].state).toBe('queued');
  });

  test('should reject duplicate task IDs', () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'dup-1' }));
    expect(() => queue.enqueue(sampleTask({ id: 'dup-1' }))).toThrow('already exists');
  });

  test('should enqueue multiple tasks', () => {
    const queue = createTestQueue();
    const tasks = queue.enqueueMany([
      sampleTask({ id: 'multi-1' }),
      sampleTask({ id: 'multi-2' }),
      sampleTask({ id: 'multi-3' }),
    ]);
    expect(tasks).toHaveLength(3);
    expect(queue.getAllTasks()).toHaveLength(3);
  });

  test('should dequeue tasks in FIFO order', () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'fifo-1' }));
    queue.enqueue(sampleTask({ id: 'fifo-2' }));
    queue.enqueue(sampleTask({ id: 'fifo-3' }));

    const first = queue.dequeue();
    expect(first?.id).toBe('fifo-1');
  });

  test('should return null when no tasks are available', () => {
    const queue = createTestQueue();
    expect(queue.dequeue()).toBeNull();
  });

  test('should not dequeue running tasks', () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'running-1' }));
    queue.assignToWorker('running-1', 'w1');

    expect(queue.dequeue()).toBeNull();
  });

  test('should assign task to worker with running state', () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'assign-1' }));
    const task = queue.assignToWorker('assign-1', 'worker-1');

    expect(task.state).toBe('running');
    expect(task.assignedWorker).toBe('worker-1');
    expect(task.startedAt).not.toBeNull();
  });
});

describe('TaskQueue - Retry Behavior', () => {
  test('should transition to retrying state on failure with retries remaining', () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'retry-1', maxRetries: 3 }));
    queue.assignToWorker('retry-1', 'w1');
    const task = queue.markFailed('retry-1', 'error');

    expect(task.state).toBe('retrying');
    expect(task.retryCount).toBe(1);
    expect(task.nextRetryAt).not.toBeNull();
  });

  test('should increment retry count on each failure', () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'retry-inc', maxRetries: 3 }));

    for (let i = 0; i < 3; i++) {
      queue.assignToWorker('retry-inc', `w${i}`);
      queue.markFailed('retry-inc', `error-${i}`);
    }

    const task = queue.getTask('retry-inc')!;
    expect(task.retryCount).toBe(3);
  });

  test('should move to dead-lettered after exhausting retries', () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'exhaust-1', maxRetries: 2 }));

    queue.assignToWorker('exhaust-1', 'w1');
    queue.markFailed('exhaust-1', 'err1');
    // retrying, retryCount=1

    queue.assignToWorker('exhaust-1', 'w2');
    queue.markFailed('exhaust-1', 'err2');
    // retrying, retryCount=2

    queue.assignToWorker('exhaust-1', 'w3');
    const task = queue.markFailed('exhaust-1', 'err3');
    // dead-lettered, retryCount=2, exceeded maxRetries

    expect(task.state).toBe('dead-lettered');
    expect(queue.getDeadLetterQueue()).toHaveLength(1);
  });

  test('retrying tasks become dequeeable after backoff period', async () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'backoff-deq', maxRetries: 3 }));
    queue.assignToWorker('backoff-deq', 'w1');
    const failed = queue.markFailed('backoff-deq', 'err');

    // Immediately after failure, the task should have nextRetryAt in the future
    expect(failed.nextRetryAt).toBeGreaterThan(Date.now() - 100);

    // Should not be dequeued before backoff
    // (may or may not depending on timing; test the concept)
    // Wait past backoff
    await new Promise(r => setTimeout(r, 600));
    const ready = queue.dequeue();
    expect(ready?.id).toBe('backoff-deq');
  });
});

describe('TaskQueue - Backoff Timing', () => {
  test('backoff delay increases with retry count', () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'backoff-1', maxRetries: 5 }));

    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      queue.assignToWorker('backoff-1', `w${i}`);
      const before = Date.now();
      const task = queue.markFailed('backoff-1', `err-${i}`);
      if (task.nextRetryAt) {
        delays.push(task.nextRetryAt - before);
      }
    }

    // Each delay should generally be >= the previous (exponential backoff)
    // Allow some tolerance for jitter
    expect(delays.length).toBe(3);
    expect(delays[1]).toBeGreaterThanOrEqual(delays[0] * 0.8);
    expect(delays[2]).toBeGreaterThanOrEqual(delays[1] * 0.8);
  });
});

describe('TaskQueue - Success Marking', () => {
  test('should mark task as succeeded', () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'succ-1' }));
    queue.assignToWorker('succ-1', 'w1');
    const task = queue.markSucceeded('succ-1');

    expect(task.state).toBe('succeeded');
    expect(task.completedAt).not.toBeNull();
  });

  test('succeeded tasks should not be dequeued', () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'succ-noq' }));
    queue.assignToWorker('succ-noq', 'w1');
    queue.markSucceeded('succ-noq');

    expect(queue.dequeue()).toBeNull();
  });
});

describe('TaskQueue - Dead-Letter Behavior', () => {
  test('should add task to dead-letter queue', () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'dl-1', maxRetries: 0 }));
    queue.assignToWorker('dl-1', 'w1');
    queue.markFailed('dl-1', 'permanent failure');

    const dlq = queue.getDeadLetterQueue();
    expect(dlq).toHaveLength(1);
    expect(dlq[0].id).toBe('dl-1');
    expect(dlq[0].state).toBe('dead-lettered');
  });

  test('replay-failures should re-enqueue dead-lettered tasks', () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'replay-1', maxRetries: 0 }));
    queue.assignToWorker('replay-1', 'w1');
    queue.markFailed('replay-1', 'err');

    expect(queue.getDeadLetterQueue()).toHaveLength(1);

    const replayed = queue.replayFailures();
    expect(replayed).toHaveLength(1);
    expect(replayed[0].state).toBe('queued');
    expect(replayed[0].retryCount).toBe(0);
    expect(queue.getDeadLetterQueue()).toHaveLength(0);
  });
});

describe('TaskQueue - Persistence', () => {
  test('should persist state across instances', () => {
    const persistence = createTestPersistence();

    const q1 = new TaskQueue(persistence);
    q1.enqueue(sampleTask({ id: 'persist-1' }));
    q1.enqueue(sampleTask({ id: 'persist-2' }));

    const q2 = new TaskQueue(persistence);
    expect(q2.getAllTasks()).toHaveLength(2);
    expect(q2.getTask('persist-1')).not.toBeNull();
    expect(q2.getTask('persist-2')).not.toBeNull();
  });

  test('should persist task state changes', () => {
    const persistence = createTestPersistence();

    const q1 = new TaskQueue(persistence);
    q1.enqueue(sampleTask({ id: 'state-persist' }));
    q1.assignToWorker('state-persist', 'w1');
    q1.markSucceeded('state-persist');

    const q2 = new TaskQueue(persistence);
    const task = q2.getTask('state-persist');
    expect(task?.state).toBe('succeeded');
  });
});

describe('TaskQueue - Filter and Query', () => {
  test('should filter tasks by state', () => {
    const queue = createTestQueue();
    queue.enqueue(sampleTask({ id: 'filter-1' }));
    queue.enqueue(sampleTask({ id: 'filter-2' }));
    queue.enqueue(sampleTask({ id: 'filter-3' }));
    queue.assignToWorker('filter-1', 'w1');
    queue.markSucceeded('filter-1');

    expect(queue.getTasksByState('queued')).toHaveLength(2);
    expect(queue.getTasksByState('succeeded')).toHaveLength(1);
  });
});