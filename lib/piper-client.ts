import path from "node:path";
import { Worker } from "node:worker_threads";
import { DATA_DIR } from "./config";

type Pending = { resolve: (wav: Buffer) => void; reject: (error: Error) => void; cleanup: () => void };
type SpeechWorker = { worker?: Worker; status: string; nextId: number; pending: Map<number, Pending> };
// Next route bundles share one model worker per web process.
const shared = globalThis as typeof globalThis & { __dashboardPiper?: SpeechWorker };
const state: SpeechWorker = shared.__dashboardPiper ??= { status: "loads on first use", nextId: 0, pending: new Map() };

function worker(): Worker {
  if (state.worker) return state.worker;
  const current = new Worker(path.join(process.cwd(), "lib/speech-worker.mjs"), { workerData: { dataDir: DATA_DIR } });
  state.worker = current;
  state.status = "loading";
  const fail = (error: Error) => {
    if (state.worker !== current) return;
    state.worker = undefined; state.status = `off: ${error.message}`;
    for (const item of state.pending.values()) { item.cleanup(); item.reject(error); }
    state.pending.clear();
  };
  current.on("message", (message: { id?: number; status?: string; wav?: Uint8Array; error?: string }) => {
    if (message.status) state.status = message.status;
    if (message.id === undefined) return;
    const item = state.pending.get(message.id);
    if (!item) return;
    state.pending.delete(message.id); item.cleanup();
    if (message.wav) item.resolve(Buffer.from(message.wav));
    else item.reject(new Error(message.error ?? "Speech worker returned no audio"));
    if (!state.pending.size) current.unref();
  });
  current.on("error", fail);
  current.on("exit", (code) => fail(new Error(`Speech worker exited (${code})`)));
  current.unref();
  return current;
}

export function warmPiper() { worker().postMessage({ type: "warm" }); }
export function piperStatus() { return state.status; }

export function piperWav(text: string, signal?: AbortSignal): Promise<Buffer> {
  if (signal?.aborted) return Promise.reject(new Error("cancelled"));
  if (state.pending.size >= 4) return Promise.reject(new Error("Albanian voice is busy — try again in a moment"));
  const current = worker(), id = ++state.nextId;
  return new Promise((resolve, reject) => {
    const abort = () => {
      current.postMessage({ type: "cancel", id });
      state.pending.delete(id); signal?.removeEventListener("abort", abort);
      if (!state.pending.size) current.unref();
      reject(new Error("cancelled"));
    };
    state.pending.set(id, { resolve, reject, cleanup: () => signal?.removeEventListener("abort", abort) });
    signal?.addEventListener("abort", abort, { once: true });
    current.ref(); current.postMessage({ type: "speak", id, text });
  });
}
