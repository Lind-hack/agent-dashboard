import { widgetAccess, widgetError } from "@/lib/widget/auth";
import { readWidgetData } from "@/lib/widget/data";
import { renderWidget, WIDGET_SIZES, type WidgetSize, type WidgetView } from "@/lib/widget/image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const denied = widgetAccess(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const view = params.get("view");
  const size = params.get("size");
  if (!view || !["today", "goals", "focus"].includes(view) || !size || !Object.hasOwn(WIDGET_SIZES, size)
      || params.getAll("view").length !== 1 || params.getAll("size").length !== 1
      || [...params.keys()].some((key) => key !== "view" && key !== "size")) {
    return widgetError(400, "Expected view=today|goals|focus and size=small|medium|large");
  }
  try {
    return await renderWidget(readWidgetData(), view as WidgetView, size as WidgetSize);
  } catch {
    // Never log request headers, URLs, source data, or error messages containing secrets.
    return widgetError(500, "Widget unavailable");
  }
}

// Avoid Next's automatic HEAD rendering or framework-generated method responses without our headers.
const unsupported = (request: Request) => widgetAccess(request) ?? widgetError(405, "Method not allowed");
export { unsupported as HEAD, unsupported as POST, unsupported as PUT, unsupported as PATCH, unsupported as DELETE, unsupported as OPTIONS };
