import { loadActiveAgents } from "@/lib/agents";
import { fail, handleRouteError, UNAUTHORIZED } from "@/lib/api";
import { remainingUsd } from "@/lib/budget";
import {
  assertAffordable,
  BudgetExceededError,
  recordUsage,
  wouldExceed,
} from "@/lib/budget-server";
import { modelFor } from "@/lib/models";
import { buildContextLines, generateUtterance, pickSpeakers } from "@/lib/orchestrator";
import { isRiskLevel } from "@/lib/safety";
import { NDJSON_CONTENT_TYPE, type DialogueEvent } from "@/lib/stream";
import { requireUser } from "@/lib/supabase/server";
import type { Agent, AgentMessage, RiskLevel, ScaleMapping } from "@/lib/types";
import { addUsage, EMPTY_USAGE, type TokenUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 120;

const CONTEXT_WINDOW = 10;
/** 이 시간 안의 개입만 지금 대화의 위험도로 본다. */
const RISK_WINDOW_MINUTES = 15;

/**
 * generate-dialogue 에 해당하는 경로.
 * weight 를 확률로 삼아 2~4명을 뽑고, 순차적으로 발화를 생성해 agent_messages 에 insert 한다.
 * 순차인 이유: 뒤에 말하는 감정이 앞 감정의 방금 그 말을 듣고 반응해야 하기 때문.
 *
 * 예산: 라운드 시작 전에 원장을 합산해 막고, 라운드 안에서도 발화마다 남은 예산을 다시 본다.
 * 클라이언트가 얼마나 자주 부르든 이 지점을 통과하지 못하면 LLM 은 호출되지 않는다.
 *
 * 응답은 NDJSON 스트림이다 — 누가 생각 중인지, 어떤 단계를 밟는지, 예산이 얼마 남았는지를
 * 생성 중에 흘려보낸다. 이벤트 정의는 `lib/stream.ts`.
 */
export async function POST(request: Request) {
  // 인증·예산·데이터 로딩은 스트림을 열기 전에 끝낸다.
  // 실패하면 평범한 JSON 에러로 돌려줘야 클라이언트가 구분할 수 있다.
  let prepared: {
    supabase: Awaited<ReturnType<typeof requireUser>>["supabase"];
    userId: string;
    active: Agent[];
    speakers: Agent[];
    context: ReturnType<typeof buildContextLines>;
    userLine?: string;
    risk: RiskLevel;
    budget: Awaited<ReturnType<typeof assertAffordable>>;
  };

  try {
    const { supabase, user } = await requireUser();
    if (!user) return UNAUTHORIZED();

    const body = (await request.json().catch(() => ({}))) as {
      userLine?: string;
      speakerCount?: number;
    };
    const userLine = body.userLine?.trim() || undefined;
    const purpose = userLine ? "response" : "ambient";

    // ── 예산 검사. 여기서 막히면 LLM 은 한 번도 호출되지 않는다. ──
    const budget = await assertAffordable(supabase, purpose, modelFor(purpose));

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

    prepared = {
      supabase,
      userId: user.id,
      active,
      speakers: pickSpeakers(active, body.speakerCount),
      context: buildContextLines(recent, agentsById),
      userLine,
      risk: await latestRisk(supabase, user.id),
      budget,
    };
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return Response.json(
        { error: error.message, budget: error.budget, budgetExhausted: true },
        { status: 429 },
      );
    }
    return handleRouteError(error);
  }

  const { supabase, userId, active, speakers, context, userLine, risk, budget } = prepared;
  const purpose = userLine ? "response" : "ambient";
  const startedAt = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: DialogueEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        send({ type: "start", model: modelFor(purpose), speakerIds: speakers.map((s) => s.id) });
        send({ type: "budget", budget });

        let roundUsage: TokenUsage = EMPTY_USAGE;
        let roundModel = modelFor(purpose);
        let roundCost = 0;
        let spoke = 0;
        const working = [...context];

        for (const speaker of speakers) {
          // 라운드 안에서도 예산을 다시 본다. 첫 발화가 예상보다 비쌌을 수 있다.
          if (wouldExceed(budget, roundCost, purpose, roundModel)) {
            send({
              type: "budget_exhausted",
              message: "이번 달 예산에 닿아서 여기서 멈췄습니다.",
              budget: { ...budget, spentUsd: budget.spentUsd + roundCost },
            });
            break;
          }

          send({ type: "thinking", agentId: speaker.id });

          let utterance;
          try {
            utterance = await generateUtterance({
              speaker,
              roommates: active,
              context: working,
              userLine,
              risk,
            });
          } catch (error) {
            // 한 명이 실패해도 나머지는 계속 말한다.
            console.error(`utterance failed for ${speaker.name}`, error);
            send({ type: "skipped", agentId: speaker.id, reason: "발화를 만들지 못했습니다" });
            continue;
          }

          roundUsage = addUsage(roundUsage, utterance.usage);
          roundModel = utterance.model;
          roundCost += await recordUsage(supabase, {
            userId,
            purpose,
            model: utterance.model,
            usage: utterance.usage,
          });

          if (utterance.steps.length > 0) {
            send({ type: "steps", agentId: speaker.id, steps: utterance.steps });
          }

          if (!utterance.content) {
            send({ type: "skipped", agentId: speaker.id, reason: "빈 발화" });
            continue;
          }

          const { data, error } = await supabase
            .from("agent_messages")
            .insert({
              user_id: userId,
              agent_id: speaker.id,
              content: utterance.content,
              triggered_by_user: Boolean(userLine),
              thinking_steps: utterance.steps,
              model: utterance.model,
            })
            .select()
            .single();

          if (error) {
            console.error("agent_messages insert failed", error);
            send({ type: "skipped", agentId: speaker.id, reason: "저장에 실패했습니다" });
            continue;
          }

          spoke++;
          working.push({ speaker: speaker.name, content: utterance.content });
          send({
            type: "message",
            message: data as AgentMessage,
            usage: utterance.usage,
            model: utterance.model,
          });
        }

        if (spoke === 0) {
          send({ type: "error", message: "지금은 아무도 입을 열지 못했습니다." });
        }

        // 원장에 막 기록한 만큼을 반영해서 내려보낸다 (재조회 없이).
        send({
          type: "budget",
          budget: { ...budget, spentUsd: budget.spentUsd + roundCost, calls: budget.calls + roundUsage.calls },
        });
        send({
          type: "done",
          usage: roundUsage,
          model: roundModel,
          elapsedMs: Date.now() - startedAt,
        });
      } catch (error) {
        console.error("dialogue stream failed", error);
        send({
          type: "error",
          message: error instanceof Error ? error.message : "대화를 만들지 못했습니다.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": NDJSON_CONTENT_TYPE,
      "Cache-Control": "no-store, no-transform",
      // 프록시가 스트림을 버퍼링하면 실시간 표시가 의미를 잃는다.
      "X-Accel-Buffering": "no",
      // 남은 예산을 헤더로도 알려 준다 (스트림을 읽지 않는 호출자용).
      "X-Budget-Remaining": remainingUsd(budget).toFixed(4),
    },
  });
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
