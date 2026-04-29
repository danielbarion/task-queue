"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskQueue = void 0;
const persistence_1 = require("./persistence");
class TaskQueue {
    state;
    persistence;
    constructor(persistence) {
        this.persistence = persistence ?? new persistence_1.Persistence();
        this.state = this.persistence.load();
    }
    enqueue(config) {
        if (this.state.tasks[config.id]) {
            throw new Error(`Task ${config.id} already exists`);
        }
        const now = Date.now();
        const record = {
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
    enqueueMany(configs) {
        return configs.map(c => this.enqueue(c));
    }
    dequeue() {
        const now = Date.now();
        const candidates = Object.values(this.state.tasks).filter(t => {
            if (t.state === 'queued')
                return true;
            if (t.state === 'retrying' && t.nextRetryAt !== null && t.nextRetryAt <= now)
                return true;
            return false;
        });
        candidates.sort((a, b) => a.createdAt - b.createdAt);
        return candidates[0] ?? null;
    }
    assignToWorker(taskId, workerId) {
        const task = this.getTask(taskId);
        if (!task)
            throw new Error(`Task ${taskId} not found`);
        const now = Date.now();
        task.state = 'running';
        task.startedAt = now;
        task.assignedWorker = workerId;
        task.nextRetryAt = null;
        this.addEvent(task, { timestamp: now, state: 'running', workerId });
        this.persistence.save(this.state);
        return task;
    }
    markSucceeded(taskId) {
        const task = this.getTask(taskId);
        if (!task)
            throw new Error(`Task ${taskId} not found`);
        const now = Date.now();
        task.state = 'succeeded';
        task.completedAt = now;
        this.addEvent(task, { timestamp: now, state: 'succeeded' });
        this.persistence.save(this.state);
        return task;
    }
    markFailed(taskId, error) {
        const task = this.getTask(taskId);
        if (!task)
            throw new Error(`Task ${taskId} not found`);
        const now = Date.now();
        task.error = error;
        task.assignedWorker = null;
        if (task.retryCount < task.maxRetries) {
            task.state = 'retrying';
            task.retryCount++;
            task.nextRetryAt = now + this.calculateBackoff(task.retryCount);
            this.addEvent(task, { timestamp: now, state: 'retrying', error });
        }
        else {
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
    replayFailures() {
        const replayed = [];
        const now = Date.now();
        for (const taskId of [...this.state.deadLetterQueue]) {
            const task = this.state.tasks[taskId];
            if (!task)
                continue;
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
    getTask(taskId) {
        return this.state.tasks[taskId] ?? null;
    }
    getAllTasks() {
        return Object.values(this.state.tasks);
    }
    getTasksByState(state) {
        return Object.values(this.state.tasks).filter(t => t.state === state);
    }
    getDeadLetterQueue() {
        return this.state.deadLetterQueue
            .map(id => this.state.tasks[id])
            .filter((t) => t !== undefined);
    }
    getState() {
        return this.state;
    }
    reload() {
        this.state = this.persistence.load();
    }
    calculateBackoff(retryCount) {
        const baseMs = 500;
        const maxMs = 30000;
        const delay = Math.min(baseMs * Math.pow(2, retryCount - 1), maxMs);
        const jitter = Math.random() * delay * 0.1;
        return Math.floor(delay + jitter);
    }
    addEvent(task, event) {
        task.history.push(event);
    }
}
exports.TaskQueue = TaskQueue;
//# sourceMappingURL=queue.js.map