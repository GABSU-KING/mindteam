import { RoomView } from "@/components/RoomView";
import { isRiskLevel } from "@/lib/safety";
import { createClient } from "@/lib/supabase/server";
import {
  normalizePersonality,
  type Agent,
  type AgentMessage,
  type TimelineItem,
  type UserIntervention,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const HISTORY = 60;

export default async function RoomPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const [agentsResult, messagesResult, interventionsResult] = await Promise.all([
    // 보관된 감정도 가져온다 — 과거 발화의 이름·색을 보여 주려면 필요하다.
    supabase.from("agents").select("*").eq("user_id", userId).order("sort_order"),
    supabase
      .from("agent_messages")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(HISTORY),
    supabase
      .from("user_interventions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(HISTORY),
  ]);

  const agents = ((agentsResult.data ?? []) as Agent[]).map((row) => ({
    ...row,
    personality: normalizePersonality(row.personality),
  }));

  const timeline: TimelineItem[] = [
    ...((messagesResult.data ?? []) as AgentMessage[]).map((m) => ({
      kind: "agent" as const,
      id: m.id,
      createdAt: m.created_at,
      agentId: m.agent_id,
      content: m.content,
    })),
    ...((interventionsResult.data ?? []) as UserIntervention[]).map((i) => ({
      kind: "user" as const,
      id: i.id,
      createdAt: i.created_at,
      content: i.content,
      risk: isRiskLevel(i.scale_mapping?.risk) ? i.scale_mapping.risk : ("none" as const),
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return <RoomView userId={userId} agents={agents} initialTimeline={timeline} />;
}
