import { AgentsView } from "@/components/AgentsView";
import { createClient } from "@/lib/supabase/server";
import { normalizePersonality, type Agent } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from("agents")
    .select("*")
    .eq("user_id", user!.id)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });

  const agents = ((data ?? []) as Agent[]).map((row) => ({
    ...row,
    personality: normalizePersonality(row.personality),
  }));

  return <AgentsView initialAgents={agents} userId={user!.id} />;
}
