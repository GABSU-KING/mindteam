import { NextResponse } from "next/server";
import { loadActiveAgents } from "@/lib/agents";
import { fail, handleRouteError, UNAUTHORIZED } from "@/lib/api";
import { buildContextLines, generateUtterance, pickSpeakers } from "@/lib/orchestrator";
import { isRiskLevel } from "@/lib/safety";
import { requireUser } from "@/lib/supabase/server";
import type { Agent, AgentMessage, RiskLevel, ScaleMapping } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const CONTEXT_WINDOW = 10;
/** 이 시간 안의 개입만 지금 대화의 위험도로 본다. */
const RISK_WINDOW_MINUTES = 15;

/**
 * generate-dialogue 에 해당하는 경로.
 * weight 를 확률로 삼아 2~4명을 뽑고, 순차적으로 발화를 생성해 agent_messages 에 insert 한다.
 * 순차인 이유: 뒤에 말하는 감정이 앞 감정의 방금 그 말을 듣고 반응해야 하기 때문.
 * insert 될 때마다 Supabase Realtime 이 화면으로 밀어 준다.
 */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    if (!user) return UNAUTHORIZED();

    const body = (await request.json().catch(() => ({}))) as {
      userLine?: string;
      speakerCount?: number;
    };

    const active = await loadActiveAgents(supabase, user.id);
    if (active.length === 0) return fail("먼저 감정을 들여 주세요.");

    // 최근 맥락 (오래된 것 → 최신 순)
    const { data: recentRaw, error: recentError } = await supabase
      .from("agent_messages")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(CONTEXT_WINDOW);

    if (recentError) return fail(recentError.message);

    const recent = ((recentRaw ?? []) as AgentMessage[]).slice().reverse();

    // 보관된 감정의 과거 발화도 맥락에 남아 있으므로 이름을 찾으려면 전체가 필요하다.
    const agentsById = await loadAgentNameMap(supabase, user.id, active);
    const context = buildContextLines(recent, agentsById);

    const risk = await latestRisk(supabase, user.id);
    const triggeredByUser = Boolean(body.userLine?.trim());
    const speakers = pickSpeakers(active, body.speakerCount);

    const inserted: AgentMessage[] = [];
    const working = [...context];

    for (const speaker of speakers) {
      let content: string;
      try {
        content = await generateUtterance({
          speaker,
          roommates: active,
          context: working,
          userLine: body.userLine?.trim() || undefined,
          risk,
        });
      } catch (error) {
        // 한 명이 실패해도 나머지는 계속 말한다.
        console.error(`utterance failed for ${speaker.name}`, error);
        continue;
      }

      if (!content) continue;

      const { data, error } = await supabase
        .from("agent_messages")
        .insert({
          user_id: user.id,
          agent_id: speaker.id,
          content,
          triggered_by_user: triggeredByUser,
        })
        .select()
        .single();

      if (error) {
        console.error("agent_messages insert failed", error);
        continue;
      }

      inserted.push(data as AgentMessage);
      working.push({ speaker: speaker.name, content });
    }

    if (inserted.length === 0) {
      return fail("지금은 아무도 입을 열지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
    }

    return NextResponse.json({ messages: inserted, risk });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** 보관된 감정까지 포함해 id → Agent 로 찾을 수 있게 한다. */
async function loadAgentNameMap(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
  active: Agent[],
): Promise<Map<string, Agent>> {
  const map = new Map(active.map((a) => [a.id, a]));

  const { data } = await supabase
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .not("archived_at", "is", null);

  for (const row of (data ?? []) as Agent[]) {
    if (!map.has(row.id)) map.set(row.id, row);
  }
  return map;
}

/** 방금 전 개입에서 위험 신호가 잡혔으면 발화 지침에 반영한다. */
async function latestRisk(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
): Promise<RiskLevel> {
  const since = new Date(Date.now() - RISK_WINDOW_MINUTES * 60_000).toISOString();

  const { data } = await supabase
    .from("user_interventions")
    .select("scale_mapping, created_at")
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const risk = (data?.scale_mapping as ScaleMapping | null)?.risk;
  return isRiskLevel(risk) ? risk : "none";
}
