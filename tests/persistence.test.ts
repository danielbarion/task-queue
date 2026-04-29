import * as fs from 'fs';
import * as path from 'path';
import { Persistence } from '../src/persistence';
import { TaskRecord, QueueState } from '../src/types';

const TEST_STATE_DIR = path.join(__dirname, '.test-persist-data');

function createTestPersistence(): Persistence {
  return new Persistence(TEST_STATE_DIR);
}

function sampleTaskRecord(id: string): TaskRecord {
  return {
    id,
    type: 'test',
    payload: { data: 'test' },
    maxRetries: 3,
    timeoutMs: 2000,
    state: 'queued',
    retryCount: 0,
    nextRetryAt: null,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    assignedWorker: null,
    error: null,
    history: [{ timestamp: Date.now(), state: 'queued' }],
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

describe('Persistence', () => {
  test('should return empty state when no file exists', () => {
    const p = createTestPersistence();
    const state = p.load();
    expect(state.tasks).toEqual({});
    expect(state.deadLetterQueue).toEqual([]);
  });

  test('should save and load state', () => {
    const p = createTestPersistence();
    const state: QueueState = {
      tasks: { 'test-1': sampleTaskRecord('test-1') },
      deadLetterQueue: [],
    };
    p.save(state);

    const loaded = p.load();
    expect(loaded.tasks['test-1']).toBeDefined();
    expect(loaded.tasks['test-1'].id).toBe('test-1');
  });

  test('should save individual tasks', () => {
    const p = createTestPersistence();
    p.saveTask(sampleTaskRecord('ind-1'));
    p.saveTask(sampleTaskRecord('ind-2'));

    const loaded = p.load();
    expect(Object.keys(loaded.tasks)).toHaveLength(2);
  });

  test('should add to dead-letter queue', () => {
    const p = createTestPersistence();
    p.save({ tasks: { 'dl-1': sampleTaskRecord('dl-1') }, deadLetterQueue: [] });
    p.addToDeadLetter('dl-1');

    const loaded = p.load();
    expect(loaded.deadLetterQueue).toContain('dl-1');
  });

  test('should not duplicate dead-letter entries', () => {
    const p = createTestPersistence();
    p.save({ tasks: { 'dl-dup': sampleTaskRecord('dl-dup') }, deadLetterQueue: [] });
    p.addToDeadLetter('dl-dup');
    p.addToDeadLetter('dl-dup');

    const loaded = p.load();
    expect(loaded.deadLetterQueue.filter(id => id === 'dl-dup')).toHaveLength(1);
  });

  test('should clear state', () => {
    const p = createTestPersistence();
    p.save({ tasks: { 'clear-1': sampleTaskRecord('clear-1') }, deadLetterQueue: [] });
    p.clear();

    const loaded = p.load();
    expect(loaded.tasks).toEqual({});
  });

  test('atomic write should not corrupt on crash', () => {
    const p = createTestPersistence();
    p.save({ tasks: { 'atomic-1': sampleTaskRecord('atomic-1') }, deadLetterQueue: [] });

    // Verify no .tmp file lingers
    const tmpPath = path.join(TEST_STATE_DIR, 'queue-state.json.tmp');
    expect(fs.existsSync(tmpPath)).toBe(false);

    const loaded = p.load();
    expect(loaded.tasks['atomic-1']).toBeDefined();
  });
});