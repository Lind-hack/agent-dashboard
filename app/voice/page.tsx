import { Composer } from "@/components/composer";
import { PageHeader } from "@/components/kit";

export default function NewChatPage() {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="New chat" sub="Pick an agent and a repo, then talk or type." />
      <Composer />
    </div>
  );
}
