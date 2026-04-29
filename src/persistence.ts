import * as fs from 'fs';
import * as path from 'path';
import { QueueState, TaskRecord } from './types';

const DEFAULT_STATE_DIR = path.join(process.cwd(), '.queue-data');
const STATE_FILE = 'queue-state.json';

export class Persistence {
  private stateDir: string;
  private statePath: string;

  constructor(stateDir?: string) {
    this.stateDir = stateDir ?? DEFAULT_STATE_DIR;
    this.statePath = path.join(this.stateDir, STATE_FILE);
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
  }

  load(): QueueState {
    if (!fs.existsSync(this.statePath)) {
      return { tasks: {}, deadLetterQueue: [] };
    }
    const raw = fs.readFileSync(this.statePath, 'utf-8');
    return JSON.parse(raw) as QueueState;
  }

  save(state: QueueState): void {
    this.ensureDir();
    const tmp = this.statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, this.statePath);
  }

  saveTask(task: TaskRecord): void {
    const state = this.load();
    state.tasks[task.id] = task;
    this.save(state);
  }

  addToDeadLetter(taskId: string): void {
    const state = this.load();
    if (!state.deadLetterQueue.includes(taskId)) {
      state.deadLetterQueue.push(taskId);
    }
    this.save(state);
  }

  clear(): void {
    if (fs.existsSync(this.statePath)) {
      fs.unlinkSync(this.statePath);
    }
  }
}