import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./tenant";


// The face behind the mirror and the morning push (v5.2): an image Lind picks and uploads himself,
// kept in data/coach/face.bin with its type next to it. Private to his dashboard.
const bin = () => path.join(dataDir(), "coach", "face.bin");
const meta = () => path.join(dataDir(), "coach", "face.json");

export const faceSet = () => fs.existsSync(bin());

export function readFace(): { data: Buffer; mime: string } | null {
  try {
    const { mime } = JSON.parse(fs.readFileSync(meta(), "utf8")) as { mime?: string };
    return { data: fs.readFileSync(bin()), mime: mime || "image/jpeg" };
  } catch {
    return null;
  }
}

export function saveFace(data: Buffer, mime: string) {
  fs.mkdirSync(path.dirname(bin()), { recursive: true });
  fs.writeFileSync(`${bin()}.tmp`, data);
  fs.renameSync(`${bin()}.tmp`, bin());
  fs.writeFileSync(meta(), JSON.stringify({ mime, at: new Date().toISOString() }));
}

export function clearFace() {
  fs.rmSync(bin(), { force: true });
  fs.rmSync(meta(), { force: true });
}
