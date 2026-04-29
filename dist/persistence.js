"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Persistence = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DEFAULT_STATE_DIR = path.join(process.cwd(), '.queue-data');
const STATE_FILE = 'queue-state.json';
class Persistence {
    stateDir;
    statePath;
    constructor(stateDir) {
        this.stateDir = stateDir ?? DEFAULT_STATE_DIR;
        this.statePath = path.join(this.stateDir, STATE_FILE);
    }
    ensureDir() {
        if (!fs.existsSync(this.stateDir)) {
            fs.mkdirSync(this.stateDir, { recursive: true });
        }
    }
    load() {
        if (!fs.existsSync(this.statePath)) {
            return { tasks: {}, deadLetterQueue: [] };
        }
        const raw = fs.readFileSync(this.statePath, 'utf-8');
        return JSON.parse(raw);
    }
    save(state) {
        this.ensureDir();
        const tmp = this.statePath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
        fs.renameSync(tmp, this.statePath);
    }
    saveTask(task) {
        const state = this.load();
        state.tasks[task.id] = task;
        this.save(state);
    }
    addToDeadLetter(taskId) {
        const state = this.load();
        if (!state.deadLetterQueue.includes(taskId)) {
            state.deadLetterQueue.push(taskId);
        }
        this.save(state);
    }
    clear() {
        if (fs.existsSync(this.statePath)) {
            fs.unlinkSync(this.statePath);
        }
    }
}
exports.Persistence = Persistence;
//# sourceMappingURL=persistence.js.map