import { NextResponse } from "next/server";
import { generateAgentProfile, loadActiveAgents } from "@/lib/agents";
import { fail, handleRouteError, UNAUTHORIZED } from "@/lib/api";
import { requireUser } from "@/lib/supabase/server";
import { MAX_ACTIVE_AGENTS, NEUTRAL_PERSONALITY } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 감정 들이기 — 이름과 한 줄 역할만 받아 system_prompt 를 LLM 이 짓는다. */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    if (!user) return UNAUTHORIZED();

    const body = (await request.json()) as {
      name?: string;
      roleLine?: string;
      emoji?: string;
    };

    const name = body.name?.trim() ?? "";
    const roleLine = body.roleLine?.trim() ?? "";

    if (!name) return fail("감정의 이름을 입력해 주세요.");
    if ([...name].length > 10) return fail("이름은 10자까지 지을 수 있습니다.");
    if (!roleLine) return fail("이 감정이 어떤 역할을 하는지 한 줄만 적어 주세요.");

    const active = await loadActiveAgents(supabase, user.id);

    if (active.length >= MAX_ACTIVE_AGENTS) {
      return fail(`감정은 최대 ${MAX_ACTIVE_AGENTS}명까지 함께할 수 있습니다.`);
    }
    if (active.some((a) => a.name === name)) {
      return fail(`'${name}'은(는) 이미 함께하고 있습니다.`);
    }

    const profile = await generateAgentProfile({
      name,
      roleLine,
      emoji: body.emoji,
      existingNames: active.map((a) => a.name),
      index: active.length,
    });

    // 새 감정의 초기 weight 는 기존 활성 감정들의 평균.
    const initialWeight =
      active.length > 0
        ? active.reduce((sum, a) => sum + a.weight, 0) / active.length
        : 0.5;

    const nextSortOrder =
      active.reduce((max, a) => Math.max(max, a.sort_order), 0) + 1;

    const { data, error } = await supabase
      .from("agents")
      .insert({
        user_id: user.id,
        name,
        emoji: profile.emoji,
        color: profile.color,
        role_line: roleLine,
        system_prompt: profile.systemPrompt,
        weight: Number(initialWeight.toFixed(4)),
        personality: NEUTRAL_PERSONALITY,
        is_seed: false,
        sort_order: nextSortOrder,
      })
      .select()
      .single();

    if (error) {
      // DB 트리거가 한국어 메시지로 막아 주는 경우를 그대로 전달한다.
      return fail(error.message);
    }

    return NextResponse.json({ agent: data });
  } catch (error) {
    return handleRouteError(error);
  }
}
