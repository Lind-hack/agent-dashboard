// Video links Lind saves to Memory: where to play them inside the dashboard. Pure functions — the
// item sheet, the learning dashboard and the runner all share them.

export type VideoProvider = "youtube" | "vimeo" | "file";
export type VideoLink = {
  provider: VideoProvider;
  id?: string;
  /** Playable inside the dashboard (iframe for platforms, direct URL for media files). */
  embed: string;
  /** The original page or file. */
  watch: string;
};

const YOUTUBE = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;
const VIMEO = /^(?:www\.|player\.)?vimeo\.com$/i;
const FILE = /\.(mp4|m4v|webm|ogv|ogg|mov)(?:[?#]|$)/i;

function youtubeId(url: URL): string | null {
  if (url.hostname.toLowerCase() === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? null;
  const v = url.searchParams.get("v");
  if (v) return v;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") return parts[1] ?? null;
  return null;
}

function vimeoId(url: URL): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  const n = parts[0] === "video" ? parts[1] : parts[0];
  return n && /^\d+$/.test(n) ? n : null;
}

export function videoLink(raw?: string | null): VideoLink | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  if (YOUTUBE.test(url.hostname)) {
    const id = youtubeId(url);
    if (!id) return null;
    return { provider: "youtube", id, embed: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`, watch: raw };
  }
  if (VIMEO.test(url.hostname)) {
    const id = vimeoId(url);
    if (!id) return null;
    return { provider: "vimeo", id, embed: `https://player.vimeo.com/video/${encodeURIComponent(id)}`, watch: raw };
  }
  if (FILE.test(url.pathname + url.search)) return { provider: "file", embed: raw, watch: raw };
  return null;
}

export const isVideoUrl = (raw?: string | null): boolean => !!videoLink(raw);
