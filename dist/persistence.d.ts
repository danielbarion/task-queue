import { QueueState, TaskRecord } from './types';
export declare class Persistence {
    private stateDir;
    private statePath;
    constructor(stateDir?: string);
    private ensureDir;
    load(): QueueState;
    save(state: QueueState): void;
    saveTask(task: TaskRecord): void;
    addToDeadLetter(taskId: string): void;
    clear(): void;
}
//# sourceMappingURL=persistence.d.ts.map