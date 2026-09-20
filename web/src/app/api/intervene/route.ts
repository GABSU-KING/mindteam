import { NextResponse } from "next/server";
import { loadActiveAgents } from "@/lib/agents";
import { fail, handleRouteError, todaySeoul, UNAUTHORIZED } from "@/lib/api";
import { applyPersonalityNudge, nextWeight } from "@/lib/orchestrator";
import { analyzeIntervention, blendScores, toObservation } from "@/lib/scales";
import { requireUser } from "@/lib/supabase/server";
import type { MentalScore } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * analyze-intervention 에 해당하는 경로.
 * 사용자 발화 → 감정 신호 추출 → weight 갱신 + personality 미세 이동 → 척도 누적.
 * 대화 생성은 이어서 /api/dialogue 가 맡는다 (응답을 빨리 돌려주기 위해 분리).
 */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    if (!user) return UNAUTHORIZED();

    const body = (await request.json()) as { content?: string };
    const content = body.content?.trim() ?? "";
    if (!content) return fail("하고 싶은 말을 입력해 주세요.");
    if (content.length > 2000) return fail("한 번에 2000자까지 쓸 수 있습니다.");

    const active = await loadActiveAgents(supabase, user.id);
    if (active.length === 0) {
      return fail("먼저 감정을 들여 주세요.");
    }

    const analysis = await analyzeIntervention(content, active);

    // 1) 개입 기록 — 심리 분석의 원천 데이터
    const emotionSignals: Record<string, number> = {};
    for (const signal of analysis.signals) {
      emotionSignals[signal.name] = Number(signal.resonance.toFixed(3));
    }

    const { data: intervention, error: interventionError } = await supabase
      .from("user_interventions")
      .insert({
        user_id: user.id,
        content,
        emotion_signals: emotionSignals,
        scale_mapping: analysis.scales,
      })
      .select()
      .single();

    if (interventionError) return fail(interventionError.message);

    // 2) weight 갱신 + personality 미세 이동 (상한 0.05 는 applyPersonalityNudge 가 보장)
    const byName = new Map(analysis.signals.map((s) => [s.name, s]));
    await Promise.all(
      active.map(async (agent) => {
        const signal = byName.get(agent.name);
        if (!signal) return;

        const weight = nextWeight(agent.weight, signal.resonance);
        const personality = applyPersonalityNudge(agent.personality, signal.nudge);

        const { error } = await supabase
          .from("agents")
          .update({
            weight: Number(weight.toFixed(4)),
            personality,
            updated_at: new Date().toISOString(),
          })
          .eq("id", agent.id);

        if (error) console.error(`weight update failed for ${agent.name}`, error);
      }),
    );

    // 3) 오늘치 심리 점수 누적 (내부 저장만 — 화면에는 숫자가 나가지 않는다)
    const date = todaySeoul();
    const observation = toObservation(analysis.scales);
    const hasObservation = Object.values(observation).some((v) => v !== null);

    if (hasObservation || analysis.dayNote) {
      const { data: existing } = await supabase
        .from("mental_scores")
        .select("depression, anxiety, wellbeing, social, note")
        .eq("user_id", user.id)
        .eq("date", date)
        .maybeSingle();

      const blended = blendScores(
        (existing as Pick<MentalScore, "depression" | "anxiety" | "wellbeing" | "social">) ??
          null,
        observation,
      );

      const { error } = await supabase.from("mental_scores").upsert(
        {
          user_id: user.id,
          date,
          ...blended,
          note: analysis.dayNote || existing?.note || null,
        },
        { onConflict: "user_id,date" },
      );

      if (error) console.error("mental_scores upsert failed", error);
    }

    return NextResponse.json({
      intervention,
      risk: analysis.risk,
      // 화면의 모델·토큰 표시에 쓰인다. 분석 호출 1건의 사용량이다.
      usage: analysis.usage,
      model: analysis.model,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
