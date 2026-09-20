import { InsightsView } from "@/components/InsightsView";
import { todaySeoul } from "@/lib/api";
import { describeDimension, DIMENSION_LABELS } from "@/lib/scales";
import { createClient } from "@/lib/supabase/server";
import type { MentalScore } from "@/lib/types";

export const dynamic = "force-dynamic";

const DIMENSIONS = ["depression", "anxiety", "wellbeing", "social"] as const;

export default async function InsightsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [scoresResult, countResult] = await Promise.all([
    supabase
      .from("mental_scores")
      .select("*")
      .eq("user_id", userId)
      .gte("date", sinceDate)
      .order("date", { ascending: true }),
    supabase
      .from("user_interventions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", `${sinceDate}T00:00:00Z`),
  ]);

  const days = (scoresResult.data ?? []) as MentalScore[];
  const today = days.find((d) => d.date === todaySeoul()) ?? days.at(-1) ?? null;

  /**
   * 점수는 서버에서 문장으로 번역해서 내려보낸다.
   * 원본 숫자는 브라우저로 넘어가지 않는다. (CLAUDE.md 규칙 5)
   */
  const chips = DIMENSIONS.map((dimension) => {
    const values = days
      .map((d) => d[dimension])
      .filter((v): v is number => typeof v === "number");
    if (values.length === 0) return null;

    const average = values.reduce((sum, v) => sum + v, 0) / values.length;
    const text = describeDimension(dimension, average);
    return text ? { label: DIMENSION_LABELS[dimension], text } : null;
  }).filter((chip): chip is { label: string; text: string } => chip !== null);

  return (
    <InsightsView
      chips={chips}
      todayNote={today?.note ?? null}
      interventionCount={countResult.count ?? 0}
    />
  );
}
