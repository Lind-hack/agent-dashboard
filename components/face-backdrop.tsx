import { cn } from "@/lib/utils";

// The face behind the verdict (v5.2): Lind's chosen image, black-and-white, crushed and grained, so
// the numbers on top read like a reckoning. Without an image: black with grain.
export function FaceBackdrop({ face, className, strength = "hard" }: { face: boolean; className?: string; strength?: "hard" | "soft" }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden bg-black", className)}>
      {face && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/api/mirror/face"
          alt=""
          className={cn("absolute inset-0 h-full w-full object-cover object-[50%_25%] grayscale", strength === "hard" ? "brightness-[0.42] contrast-[1.35]" : "brightness-[0.3] contrast-[1.2]")}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/20" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgb(0_0_0/0.85)_100%)]" />
      <div className="grain absolute -inset-[10%]" />
    </div>
  );
}
