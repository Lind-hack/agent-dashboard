// Shown instantly while a page fetches GitHub / Linear / systemd, so a tap on the phone always
// answers. Shapes follow the page frame (heading, then panels) rather than a spinner.
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6 pt-2 lg:pt-6" aria-busy="true" aria-label="Loading">
      <div className="h-10 w-2/3 max-w-sm rounded-xl bg-white/[0.06]" />
      <div className="h-4 w-1/2 max-w-xs rounded-lg bg-white/[0.04]" />
      <div className="panel h-40" />
      <div className="panel h-56" />
    </div>
  );
}
