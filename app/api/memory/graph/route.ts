import { NextResponse } from "next/server";
import { memoryGraph } from "@/lib/memory";

export const dynamic = "force-dynamic";

// Every record as a light node for the Visual cortex.
export async function GET() {
  return NextResponse.json(await memoryGraph());
}
