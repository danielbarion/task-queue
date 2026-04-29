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
export declare class WorkerPool {
    private queue;
    private workers;
    private options;
    private running;
    private timeline;
    constructor(queue: TaskQueue, options: WorkerPoolOptions);
    run(): Promise<void>;
    stop(): void;
    getWorkers(): WorkerInfo[];
    getTimeline(): TimelineEntry[];
    printTimeline(): void;
    private processTask;
    private addTimeline;
    private sleep;
}
export {};
//# sourceMappingURL=worker.d.ts.map