import type { Seat } from "@/lib/council";
import { cn } from "@/lib/utils";

// A council seat's mark: initials on a rounded square in the seat's colour (agents keep their real
// logos; seats are personas, so they get a monogram, never a face).
const SIZE = { sm: "h-7 w-7 rounded-[8px] text-[10px]", md: "h-9 w-9 rounded-[10px] text-[11.5px]", lg: "h-12 w-12 rounded-[14px] text-sm" } as const;

export function SeatBadge({ seat, size = "md", active, className }: { seat: Pick<Seat, "initials" | "color" | "name">; size?: keyof typeof SIZE; active?: boolean; className?: string }) {
  return (
    <span
      className={cn("grid shrink-0 place-items-center font-mono font-semibold tracking-[0.02em] transition-shadow duration-300", SIZE[size], className)}
      style={{
        color: seat.color,
        background: `color-mix(in oklab, ${seat.color}, transparent ${active ? 78 : 88}%)`,
        boxShadow: `0 0 0 1px color-mix(in oklab, ${seat.color}, transparent ${active ? 40 : 75}%) inset${active ? `, 0 0 16px -4px ${seat.color}` : ""}`,
      }}
      title={seat.name}
      aria-hidden
    >
      {seat.initials}
    </span>
  );
}
