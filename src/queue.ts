import { TaskConfig, TaskRecord, TaskState, TaskEvent, QueueState } from './types';
import { Persistence } from './persistence';

export class TaskQueue {
  private state: QueueState;
  private persistence: Persistence;

  constructor(persistence?: Persistence) {
    this.persistence = persistence ?? new Persistence();
    this.state = this.persistence.load();
  }

  enqueue(config: TaskConfig): TaskRecord {
    if (this.state.tasks[config.id]) {
      throw new Error(`Task ${config.id} already exists`);
    }

    const now = Date.now();
    const record: TaskRecord = {
      id: config.id,
      type: config.type,
      payload: config.payload,
      maxRetries: config.maxRetries,
      timeoutMs: config.timeoutMs,
      state: 'queued',
      retryCount: 0,
      nextRetryAt: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      assignedWorker: null,
      error: null,
      history: [{ timestamp: now, state: 'queued' }],
    };

    this.state.tasks[record.id] = record;
    this.persistence.save(this.state);
    return record;
  }

  enqueueMany(configs: TaskConfig[]): TaskRecord[] {
    return configs.map(c => this.enqueue(c));
  }

  dequeue(): TaskRecord | null {
    const now = Date.now();
    const candidates = Object.values(this.state.tasks).filter(t => {
      if (t.state === 'queued') return true;
      if (t.state === 'retrying' && t.nextRetryAt !== null && t.nextRetryAt <= now) return true;
      return false;
    });

    candidates.sort((a, b) => a.createdAt - b.createdAt);
    return candidates[0] ?? null;
  }

  assignToWorker(taskId: string, workerId: string): TaskRecord {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const now = Date.now();
    task.state = 'running';
    task.startedAt = now;
    task.assignedWorker = workerId;
    task.nextRetryAt = null;
    this.addEvent(task, { timestamp: now, state: 'running', workerId });
    this.persistence.save(this.state);
    return task;
  }

  markSucceeded(taskId: string): TaskRecord {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const now = Date.now();
    task.state = 'succeeded';
    task.completedAt = now;
    this.addEvent(task, { timestamp: now, state: 'succeeded' });
    this.persistence.save(this.state);
    return task;
  }

  markFailed(taskId: string, error: string): TaskRecord {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const now = Date.now();
    task.error = error;
    task.assignedWorker = null;

    if (task.retryCount < task.maxRetries) {
      task.state = 'retrying';
      task.retryCount++;
      task.nextRetryAt = now + this.calculateBackoff(task.retryCount);
      this.addEvent(task, { timestamp: now, state: 'retrying', error });
    } else {
      task.state = 'dead-lettered';
      task.completedAt = now;
      this.addEvent(task, { timestamp: now, state: 'dead-lettered', error });
      if (!this.state.deadLetterQueue.includes(taskId)) {
        this.state.deadLetterQueue.push(taskId);
      }
    }

    this.persistence.save(this.state);
    return task;
  }

  replayFailures(): TaskRecord[] {
    const replayed: TaskRecord[] = [];
    const now = Date.now();

    for (const taskId of [...this.state.deadLetterQueue]) {
      const task = this.state.tasks[taskId];
      if (!task) continue;

      task.state = 'queued';
      task.retryCount = 0;
      task.nextRetryAt = null;
      task.error = null;
      task.assignedWorker = null;
      task.completedAt = null;
      task.startedAt = null;
      this.addEvent(task, { timestamp: now, state: 'queued' });
      replayed.push(task);
    }

    this.state.deadLetterQueue = [];
    this.persistence.save(this.state);
    return replayed;
  }

  getTask(taskId: string): TaskRecord | null {
    return this.state.tasks[taskId] ?? null;
  }

  getAllTasks(): TaskRecord[] {
    return Object.values(this.state.tasks);
  }

  getTasksByState(state: TaskState): TaskRecord[] {
    return Object.values(this.state.tasks).filter(t => t.state === state);
  }

  getDeadLetterQueue(): TaskRecord[] {
    return this.state.deadLetterQueue
      .map(id => this.state.tasks[id])
      .filter((t): t is TaskRecord => t !== undefined);
  }

  getState(): QueueState {
    return this.state;
  }

  reload(): void {
    this.state = this.persistence.load();
  }

  private calculateBackoff(retryCount: number): number {
    const baseMs = 500;
    const maxMs = 30000;
    const delay = Math.min(baseMs * Math.pow(2, retryCount - 1), maxMs);
    const jitter = Math.random() * delay * 0.1;
    return Math.floor(delay + jitter);
  }

  private addEvent(task: TaskRecord, event: TaskEvent): void {
    task.history.push(event);
  }
}