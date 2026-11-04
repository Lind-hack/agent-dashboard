"use client";

import type { LibraryItem } from "@/lib/library";
import { cn } from "@/lib/utils";
import { videoLink } from "@/lib/video-links";

// The player for a memory: an uploaded file streams from /api/memory/media with range support; a
// saved YouTube/Vimeo link plays in place; a direct video URL plays natively. `canWatch` lets the
// callers show a Watch control only when there is something to play.

type Watchable = Pick<LibraryItem, "kind" | "url" | "media">;

export const canWatch = (it: Watchable): boolean => (it.kind === "video" && !!it.media) || !!videoLink(it.url);

export function VideoPlayer({ item, className }: { item: LibraryItem; className?: string }) {
  if (item.kind === "video" && item.media) {
    return (
      <video
        src={`/api/memory/media/${item.id}`}
        poster={item.media.poster ? `/api/memory/media/${item.id}?poster=1` : undefined}
        controls
        playsInline
        preload="metadata"
        className={cn("w-full bg-black", className)}
      />
    );
  }
  const link = videoLink(item.url);
  if (!link) return null;
  if (link.provider === "file") {
    return <video src={link.embed} controls playsInline preload="metadata" className={cn("w-full bg-black", className)} />;
  }
  return (
    <iframe
      src={link.embed}
      title={item.title || "Video"}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      className={cn("aspect-video w-full border-0 bg-black", className)}
    />
  );
}
