import { TaskConfig, TaskRecord, TaskState, QueueState } from './types';
import { Persistence } from './persistence';
export declare class TaskQueue {
    private state;
    private persistence;
    constructor(persistence?: Persistence);
    enqueue(config: TaskConfig): TaskRecord;
    enqueueMany(configs: TaskConfig[]): TaskRecord[];
    dequeue(): TaskRecord | null;
    assignToWorker(taskId: string, workerId: string): TaskRecord;
    markSucceeded(taskId: string): TaskRecord;
    markFailed(taskId: string, error: string): TaskRecord;
    replayFailures(): TaskRecord[];
    getTask(taskId: string): TaskRecord | null;
    getAllTasks(): TaskRecord[];
    getTasksByState(state: TaskState): TaskRecord[];
    getDeadLetterQueue(): TaskRecord[];
    getState(): QueueState;
    reload(): void;
    private calculateBackoff;
    private addEvent;
}
//# sourceMappingURL=queue.d.ts.map