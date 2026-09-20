import { NextResponse } from "next/server";
import { loadActiveAgents } from "@/lib/agents";
import { handleRouteError, todaySeoul, UNAUTHORIZED } from "@/lib/api";
import { generateWeeklyNarrative } from "@/lib/scales";
import { requireUser } from "@/lib/supabase/server";
import type { MentalScore } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const DAYS = 7;

/** 주간 요약 — 숫자 없이 이야기 형식으로만 만든다. */
export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    if (!user) return UNAUTHORIZED();

    const today = todaySeoul();
    const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
    const sinceDate = since.slice(0, 10);

    const [scoresResult, interventionsResult, agents] = await Promise.all([
      supabase
        .from("mental_scores")
        .select("*")
        .eq("user_id", user.id)
        .gte("date", sinceDate)
        .lte("date", today)
        .order("date", { ascending: true }),
      supabase
        .from("user_interventions")
        .select("content, created_at")
        .eq("user_id", user.id)
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(60),
      loadActiveAgents(supabase, user.id),
    ]);

    const result = await generateWeeklyNarrative({
      days: (scoresResult.data ?? []) as MentalScore[],
      interventions: (interventionsResult.data ?? []).map((row) => row.content as string),
      agentNames: agents.map((a) => a.name),
    });

    return NextResponse.json({
      narrative: result.narrative,
      usage: result.usage,
      model: result.model,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
