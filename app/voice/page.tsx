import { Composer } from "@/components/composer";
import { PageHeader } from "@/components/kit";
import { page } from "@/lib/guard";

function NewChatPage() {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="New chat" sub="Pick an agent and a repo, then talk or type." />
      <Composer />
    </div>
  );
}

export default page(NewChatPage, { owner: true });
