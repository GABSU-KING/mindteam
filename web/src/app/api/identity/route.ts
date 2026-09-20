import { NextResponse } from "next/server";
import { loadActiveAgents } from "@/lib/agents";
import { fail, handleRouteError, UNAUTHORIZED } from "@/lib/api";
import { assertAffordable, BudgetExceededError, recordUsage } from "@/lib/budget-server";
import { SNAPSHOT_EVERY, synthesizeIdentity } from "@/lib/identity";
import { modelFor } from "@/lib/models";
import { requireUser } from "@/lib/supabase/server";
import {
  normalizeIdentityAxes,
  type Agent,
  type AgentMessage,
  type IdentitySnapshot,
  type SelfPortrait,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

/** 자아를 합성할 때 읽는 발화 수. 늘리면 입력 토큰이 그만큼 늘어난다. */
const SYNTHESIS_WINDOW = 60;
const INTERVENTION_WINDOW = 30;

/**
 * 자아 스냅샷을 한 장 찍는다.
 *
 * 발화가 SNAPSHOT_EVERY 개 쌓일 때마다 자동으로 불리고, 사용자가 직접 부를 수도 있다.
 * `force` 가 아니면 발화가 충분히 쌓이지 않았을 때 그냥 돌아간다 — 예산을 아끼기 위해서다.
 */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    if (!user) return UNAUTHORIZED();

    const body = (await request.json().catch(() => ({}))) as { force?: boolean };

    const [countResult, latestResult, portraitResult] = await Promise.all([
      supabase
        .from("agent_messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      supabase
        .from("identity_snapshots")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("self_portraits").select("*").eq("user_id", user.id).maybeSingle(),
    ]);

    const messageCount = countResult.count ?? 0;
    const latest = latestResult.data as IdentitySnapshot | null;
    const since = messageCount - (latest?.message_count ?? 0);

    if (messageCount === 0) {
      return fail("아직 대화가 없어서 자아를 그릴 수 없습니다. 감정들이 먼저 이야기해야 합니다.");
    }

    if (!body.force && since < SNAPSHOT_EVERY) {
      // 아직 찍을 때가 아니다. 예산을 쓰지 않고 현재 상태만 돌려준다.
      return NextResponse.json({
        snapshot: latest,
        created: false,
        messagesUntilNext: SNAPSHOT_EVERY - since,
      });
    }

    // 예산 검사를 통과하지 못하면 LLM 을 부르지 않는다.
    const budget = await assertAffordable(supabase, "identity", modelFor("identity"));

    const [messagesResult, interventionsResult, agents] = await Promise.all([
      supabase
        .from("agent_messages")
        .select("agent_id, content, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(SYNTHESIS_WINDOW),
      supabase
        .from("user_interventions")
        .select("content")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(INTERVENTION_WINDOW),
      loadAllAgents(supabase, user.id),
    ]);

    const nameById = new Map(agents.map((a) => [a.id, a.name]));
    const conversation = ((messagesResult.data ?? []) as Pick<
      AgentMessage,
      "agent_id" | "content"
    >[])
      .slice()
      .reverse()
      .map((m) => `${nameById.get(m.agent_id) ?? "알 수 없는 감정"}: ${m.content}`);

    const portraitRow = portraitResult.data as SelfPortrait | null;
    const portrait = portraitRow
      ? {
          content: portraitRow.content,
          axes: portraitRow.axes ? normalizeIdentityAxes(portraitRow.axes) : null,
        }
      : null;

    const synthesis = await synthesizeIdentity({
      conversation,
      interventions: ((interventionsResult.data ?? []) as { content: string }[])
        .slice()
        .reverse()
        .map((row) => row.content),
      agentNames: agents.filter((a) => a.archived_at === null).map((a) => a.name),
      portrait,
      previousSummary: latest?.summary ?? null,
    });

    const cost = await recordUsage(supabase, {
      userId: user.id,
      purpose: "identity",
      model: synthesis.model,
      usage: synthesis.usage,
    });

    if (!synthesis.summary) {
      return fail("자아를 정리하지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
    }

    const { data, error } = await supabase
      .from("identity_snapshots")
      .insert({
        user_id: user.id,
        message_count: messageCount,
        axes: synthesis.axes,
        summary: synthesis.summary,
        drift: synthesis.drift,
        drift_note: synthesis.driftNote || null,
      })
      .select()
      .single();

    if (error) return fail(error.message);

    return NextResponse.json({
      snapshot: data,
      created: true,
      messagesUntilNext: SNAPSHOT_EVERY,
      usage: synthesis.usage,
      model: synthesis.model,
      budget: {
        ...budget,
        spentUsd: budget.spentUsd + cost,
        calls: budget.calls + synthesis.usage.calls,
      },
    });
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return NextResponse.json(
        { error: error.message, budget: error.budget, budgetExhausted: true },
        { status: 429 },
      );
    }
    return handleRouteError(error);
  }
}

/** 보관된 감정도 포함한다 — 과거 발화의 화자 이름이 필요하다. */
async function loadAllAgents(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
): Promise<Agent[]> {
  const { data } = await supabase
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order");

  // 활성 목록은 정규화된 형태가 필요하니 따로 한 번 더 읽는 대신 여기서 합친다.
  const all = (data ?? []) as Agent[];
  if (all.length > 0) return all;
  return loadActiveAgents(supabase, userId);
}
