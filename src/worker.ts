import { TaskQueue } from './queue';
import { WorkerInfo, TaskRecord } from './types';

export interface WorkerPoolOptions {
  workerCount: number;
  crashProbability?: number;
  slowTaskProbability?: number;
  slowTaskMultiplier?: number;
  onTaskStart?: (workerId: string, task: TaskRecord) => void;
  onTaskComplete?: (workerId: string, task: TaskRecord) => void;
  onTaskFail?: (workerId: string, task: TaskRecord, error: string) => void;
  onWorkerCrash?: (workerId: string, task: TaskRecord) => void;
  onTaskTimeout?: (workerId: string, task: TaskRecord) => void;
}

interface TimelineEntry {
  timestamp: number;
  workerId: string;
  taskId: string;
  event: string;
  detail?: string;
}

export class WorkerPool {
  private queue: TaskQueue;
  private workers: Map<string, WorkerInfo> = new Map();
  private options: Required<WorkerPoolOptions>;
  private running = false;
  private timeline: TimelineEntry[] = [];

  constructor(queue: TaskQueue, options: WorkerPoolOptions) {
    this.queue = queue;
    this.options = {
      workerCount: options.workerCount,
      crashProbability: options.crashProbability ?? 0.05,
      slowTaskProbability: options.slowTaskProbability ?? 0.1,
      slowTaskMultiplier: options.slowTaskMultiplier ?? 3,
      onTaskStart: options.onTaskStart ?? (() => {}),
      onTaskComplete: options.onTaskComplete ?? (() => {}),
      onTaskFail: options.onTaskFail ?? (() => {}),
      onWorkerCrash: options.onWorkerCrash ?? (() => {}),
      onTaskTimeout: options.onTaskTimeout ?? (() => {}),
    };

    for (let i = 0; i < options.workerCount; i++) {
      const id = `worker-${i + 1}`;
      this.workers.set(id, {
        id,
        busy: false,
        currentTaskId: null,
        tasksCompleted: 0,
        tasksFailed: 0,
        crashed: false,
      });
    }
  }

  async run(): Promise<void> {
    this.running = true;

    while (this.running) {
      const availableWorkers = [...this.workers.values()].filter(w => !w.busy && !w.crashed);

      if (availableWorkers.length === 0) {
        await this.sleep(50);
        continue;
      }

      const task = this.queue.dequeue();
      if (!task) {
        const hasRunning = [...this.workers.values()].some(w => w.busy);
        if (!hasRunning) break;
        await this.sleep(50);
        continue;
      }

      const worker = availableWorkers[0];
      worker.busy = true;
      worker.currentTaskId = task.id;

      this.processTask(worker, task);
      await this.sleep(10);
    }

    // Wait for all busy workers to finish
    while ([...this.workers.values()].some(w => w.busy)) {
      await this.sleep(50);
    }
  }

  stop(): void {
    this.running = false;
  }

  getWorkers(): WorkerInfo[] {
    return [...this.workers.values()];
  }

  getTimeline(): TimelineEntry[] {
    return [...this.timeline];
  }

  printTimeline(): void {
    if (this.timeline.length === 0) {
      console.log('No events recorded.');
      return;
    }

    const startTime = this.timeline[0].timestamp;
    console.log('\n--- Execution Timeline ---\n');
    console.log(`${'Time (ms)'.padStart(10)}  ${'Worker'.padEnd(12)}  ${'Task'.padEnd(20)}  ${'Event'.padEnd(12)}  Detail`);
    console.log('-'.repeat(80));

    for (const entry of this.timeline) {
      const relTime = (entry.timestamp - startTime).toString().padStart(10);
      const worker = entry.workerId.padEnd(12);
      const task = entry.taskId.padEnd(20);
      const event = entry.event.padEnd(12);
      const detail = entry.detail ?? '';
      console.log(`${relTime}  ${worker}  ${task}  ${event}  ${detail}`);
    }
    console.log('');
  }

  private async processTask(worker: WorkerInfo, task: TaskRecord): Promise<void> {
    this.queue.assignToWorker(task.id, worker.id);
    this.addTimeline(worker.id, task.id, 'START');
    this.options.onTaskStart(worker.id, task);

    // Worker crash check
    if (Math.random() < this.options.crashProbability) {
      this.addTimeline(worker.id, task.id, 'CRASH', 'Worker crashed during execution');
      this.options.onWorkerCrash(worker.id, task);
      worker.crashed = true;
      worker.tasksFailed++;

      this.queue.markFailed(task.id, 'Worker crash');
      worker.busy = false;
      worker.currentTaskId = null;

      // Restart worker after a delay
      setTimeout(() => {
        worker.crashed = false;
      }, 200);
      return;
    }

    // Task execution time
    let executionTime = Math.random() * 200 + 50;
    if (Math.random() < this.options.slowTaskProbability) {
      executionTime *= this.options.slowTaskMultiplier;
      this.addTimeline(worker.id, task.id, 'SLOW', `Slow task: ${Math.round(executionTime)}ms`);
    }

    // Check timeout
    const timeoutMs = task.timeoutMs;
    const timedOut = executionTime > timeoutMs;

    await this.sleep(Math.min(executionTime, timeoutMs));

    if (timedOut) {
      this.addTimeline(worker.id, task.id, 'TIMEOUT', `Exceeded ${timeoutMs}ms`);
      this.options.onTaskTimeout(worker.id, task);
      worker.tasksFailed++;
      this.queue.markFailed(task.id, `Timeout after ${timeoutMs}ms`);
    } else {
      // Random task failures (10% chance)
      if (Math.random() < 0.1) {
        const err = 'Task execution error';
        this.addTimeline(worker.id, task.id, 'FAIL', err);
        this.options.onTaskFail(worker.id, task, err);
        worker.tasksFailed++;
        this.queue.markFailed(task.id, err);
      } else {
        this.addTimeline(worker.id, task.id, 'DONE');
        this.options.onTaskComplete(worker.id, task);
        worker.tasksCompleted++;
        this.queue.markSucceeded(task.id);
      }
    }

    worker.busy = false;
    worker.currentTaskId = null;
  }

  private addTimeline(workerId: string, taskId: string, event: string, detail?: string): void {
    this.timeline.push({ timestamp: Date.now(), workerId, taskId, event, detail });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}