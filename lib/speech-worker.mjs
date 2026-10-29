// Native model initialization and inference stay off the web server's event loop.
import { parentPort, workerData } from "node:worker_threads";
import { tsImport } from "tsx/esm/api";
process.env.DATA_DIR = workerData.dataDir;
const piper = await tsImport("./piper.ts", import.meta.url);
const active = new Map();
parentPort.on("message", async (message) => {
  if (message.type === "cancel") { active.get(message.id)?.abort(); return; }
  if (message.type === "warm") {
    const ready = piper.warmPiper();
    parentPort.postMessage({ status: piper.piperStatus() });
    await ready;
    parentPort.postMessage({ status: piper.piperStatus() });
    return;
  }
  if (message.type !== "speak") return;
  const ctl = new AbortController(); active.set(message.id, ctl);
  try {
    const wav = await piper.piperWav(message.text, ctl.signal);
    parentPort.postMessage({ id: message.id, wav, status: piper.piperStatus() });
  } catch (error) {
    parentPort.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error), status: piper.piperStatus() });
  } finally { active.delete(message.id); }
});
