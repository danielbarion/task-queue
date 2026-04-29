export type TaskState = 'queued' | 'running' | 'succeeded' | 'failed' | 'retrying' | 'dead-lettered';
export interface TaskConfig {
    id: string;
    type: string;
    payload: Record<string, unknown>;
    maxRetries: number;
    timeoutMs: number;
}
export interface TaskRecord {
    id: string;
    type: string;
    payload: Record<string, unknown>;
    maxRetries: number;
    timeoutMs: number;
    state: TaskState;
    retryCount: number;
    nextRetryAt: number | null;
    createdAt: number;
    startedAt: number | null;
    completedAt: number | null;
    assignedWorker: string | null;
    error: string | null;
    history: TaskEvent[];
}
export interface TaskEvent {
    timestamp: number;
    state: TaskState;
    workerId?: string;
    error?: string;
}
export interface QueueState {
    tasks: Record<string, TaskRecord>;
    deadLetterQueue: string[];
}
export interface WorkerInfo {
    id: string;
    busy: boolean;
    currentTaskId: string | null;
    tasksCompleted: number;
    tasksFailed: number;
    crashed: boolean;
}
//# sourceMappingURL=types.d.ts.map