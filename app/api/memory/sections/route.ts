import { NextResponse } from "next/server";
import { addSection, listItems, mirrorItem, readSections, saveItem, slugId, writeSections } from "@/lib/library";

export const dynamic = "force-dynamic";

// POST { name, description? } adds a section; PATCH { id, name } renames one.
export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as { name?: string; description?: string } | null;
  const s = addSection((b?.name ?? "").toString(), (b?.description ?? "").toString(), "lind");
  if (!s) return NextResponse.json({ error: "Give it a name (there's a 24-section limit)." }, { status: 400 });
  return NextResponse.json({ section: s, sections: readSections() });
}

export async function PATCH(request: Request) {
  const b = (await request.json().catch(() => null)) as { id?: string; name?: string } | null;
  const name = (b?.name ?? "").toString().replace(/\s+/g, " ").trim().slice(0, 40);
  const all = readSections();
  const s = all.find((x) => x.id === b?.id);
  if (!s || !name) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (all.some((x) => x !== s && (x.name.toLowerCase() === name.toLowerCase() || x.id === slugId(name)))) {
    return NextResponse.json({ error: "A section with that name exists." }, { status: 409 });
  }
  s.name = name; // the id stays, so items keep pointing at it
  writeSections(all);
  for (const it of listItems().filter((i) => i.section === s.id && i.mirror)) {
    mirrorItem(it);
    saveItem(it);
  }
  return NextResponse.json({ sections: all });
}
