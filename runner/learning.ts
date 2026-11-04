import { groqModel } from "../lib/config";
import { groqJSON } from "../lib/groq";
import { emptyDigest, learningMaterial, normalizeDigest, type RawDigest } from "../lib/learning";
import { listItems, mirrorItem, readItem, saveItem } from "../lib/library";

// The Learning pass: read one saved video/link/note into core concepts, key points and recall
// questions. It runs beside the capture automation, one item at a time, so a slow or rate-limited
// model never holds up the Library itself. A failure keeps the item and retries with backoff.

const MAX_ATTEMPTS = 3;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "learning:", ...a);

let busy = false;

export function learningTick() {
  if (busy) return;
  const now = Date.now();
  const next = listItems().find((i) => {
    const l = i.learning;
    if (!l) return false;
    if (l.state === "queued" && (!l.nextAt || Date.parse(l.nextAt) <= now)) return true;
    return l.state === "analyzing" && now - Date.parse(i.updatedAt) > 15 * 60_000;
  });
  if (!next) return;
  busy = true;
  void analyze(next.id)
    .catch((e) => log(next.id, e instanceof Error ? e.message : e))
    .finally(() => (busy = false));
}

const SYSTEM = `You turn one piece of Lind's saved material into durable learning notes. Lind is a CS student in Kosovo who saves videos, talks and long notes to Memory; he wants to understand the core ideas, not memorise the wording.
Return JSON: {"thesis": string, "concepts": [{"term": string, "explanation": string, "at": number|null}], "key_points": string[], "questions": [{"q": string, "a": string, "at": number|null, "kind": "recall"|"code"|"interview"}], "language": string}.
- thesis: the single main claim of the material, 1-2 sentences.
- concepts: 4-10 core ideas. term ≤8 words; explanation 1-3 sentences in plain language. at = the second in the video where it is discussed, or null.
- key_points: 3-8 specific takeaways (names, numbers, steps).
- questions: 4-8 active-recall questions answerable from the material; the answer is what a good attempt should contain. kind: "code" for implementation/algorithm details, "interview" for questions worth being asked in an interview, else "recall".
- Never invent facts that are not in the material. Write in English unless the material is clearly Albanian.`;

async function analyze(id: string) {
  const it = readItem(id);
  if (!it?.learning) return;
  it.learning.state = "analyzing";
  it.learning.attempts = (it.learning.attempts ?? 0) + 1;
  saveItem(it);
  log("analyzing", it.id, it.kind);

  try {
    const material = learningMaterial(it);
    if (material.trim().length < 200) throw new Error("Not enough text to study yet — a transcript or description is needed.");
    const out = await groqJSON<RawDigest>(
      SYSTEM,
      [
        `Title: ${it.title || it.kind}`,
        `Source: ${it.kind}${it.url ? ` — ${it.url}` : ""}`,
        it.summary ? `Summary: ${it.summary}` : "",
        it.note ? `Lind's note: ${it.note}` : "",
        "",
        "Material:",
        material,
      ]
        .filter(Boolean)
        .join("\n"),
      0.2,
      { maxTokens: 2600 },
    );
    if (!out) throw new Error("The analyser (Groq) didn't answer — will retry.");
    const digest = normalizeDigest(out);
    if (!digest.concepts.length && !digest.keyPoints.length && !digest.questions.length) throw new Error("The analyser returned nothing usable — will retry.");

    const fresh = readItem(id);
    if (!fresh) return;
    fresh.learning = {
      state: "ready",
      thesis: digest.thesis ?? fresh.learning?.thesis,
      concepts: digest.concepts,
      keyPoints: digest.keyPoints,
      questions: digest.questions,
      language: digest.language,
      model: groqModel(),
      attempts: fresh.learning?.attempts,
      at: new Date().toISOString(),
    };
    mirrorItem(fresh);
    saveItem(fresh);
    log("ready", fresh.id, `${digest.concepts.length} concepts, ${digest.questions.length} questions`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const fresh = readItem(id);
    if (!fresh?.learning) return;
    const attempts = fresh.learning.attempts ?? 1;
    fresh.learning = {
      ...emptyDigest(),
      ...fresh.learning,
      attempts,
      error: msg.slice(0, 300),
      ...(attempts >= MAX_ATTEMPTS ? { state: "failed" as const, nextAt: undefined } : { state: "queued" as const, nextAt: new Date(Date.now() + 60_000 * 4 ** attempts).toISOString() }),
    };
    saveItem(fresh);
    log("failed", id, msg);
  }
}
