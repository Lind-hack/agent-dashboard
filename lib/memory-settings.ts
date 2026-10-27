import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

export type MemorySettings = { enabled: boolean; updatedAt?: string };
const file = () => path.join(DATA_DIR, "memory-settings.json");

export function readMemorySettings(): MemorySettings {
  try {
    const value = JSON.parse(fs.readFileSync(file(), "utf8"));
    return { enabled: value?.enabled === true, updatedAt: value?.updatedAt };
  } catch {
    return { enabled: false };
  }
}

export function writeMemorySettings(enabled: boolean): MemorySettings {
  const value = { enabled, updatedAt: new Date().toISOString() };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file());
  return value;
}
