import { asUser } from "@/lib/guard";

// Coding agents are the owner's alone.
export default async function OwnerOnly({ children }: { children: React.ReactNode }) {
  await asUser(() => null, { owner: true });
  return children;
}
