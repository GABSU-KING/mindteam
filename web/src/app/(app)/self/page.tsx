import { SelfView } from "@/components/SelfView";
import { readBudget } from "@/lib/budget-server";
import { describeAxisLevel, describeDrift, driftBand, SNAPSHOT_EVERY } from "@/lib/identity";
import { createClient } from "@/lib/supabase/server";
import {
  IDENTITY_AXES,
  IDENTITY_AXIS_HINT,
  IDENTITY_AXIS_LABEL,
  normalizeIdentityAxes,
  type IdentitySnapshot,
  type SelfPortrait,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const TIMELINE_LIMIT = 12;

export default async function SelfPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const [portraitResult, snapshotsResult, countResult, budget] = await Promise.all([
    supabase.from("self_portraits").select("*").eq("user_id", userId).maybeSingle(),
    supabase
      .from("identity_snapshots")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(TIMELINE_LIMIT),
    supabase.from("agent_messages").select("id", { count: "exact", head: true }).eq("user_id", userId),
    readBudget(supabase),
  ]);

  const portrait = portraitResult.data as SelfPortrait | null;
  const snapshots = (snapshotsResult.data ?? []) as IdentitySnapshot[];
  const latest = snapshots[0] ?? null;

  const messageCount = countResult.count ?? 0;
  const untilNext = Math.max(0, SNAPSHOT_EVERY - (messageCount - (latest?.message_count ?? 0)));

  /**
   * 축 비교를 서버에서 전부 문장으로 바꿔 내려보낸다.
   * 원본 숫자는 브라우저로 넘어가지 않는다 (CLAUDE.md 규칙 5의 정신).
   */
  const comparison = latest
    ? IDENTITY_AXES.map((axis) => {
        const grownAxes = normalizeIdentityAxes(latest.axes);
        const delta = latest.drift?.[axis];
        const hasBaseline = typeof delta === "number";

        return {
          axis,
          label: IDENTITY_AXIS_LABEL[axis],
          hint: IDENTITY_AXIS_HINT[axis],
          /** 기준 자아가 있으면 차이를, 없으면 지금 상태만 문장으로 */
          text: hasBaseline
            ? describeDrift(axis, delta)
            : describeAxisLevel(axis, grownAxes[axis]),
          band: hasBaseline ? driftBand(delta) : null,
          direction: hasBaseline
            ? delta > 0
              ? ("up" as const)
              : delta < 0
                ? ("down" as const)
                : ("flat" as const)
            : null,
        };
      })
    : [];

  return (
    <SelfView
      portraitContent={portrait?.content ?? ""}
      hasBaselineAxes={Boolean(portrait?.axes)}
      latest={
        latest
          ? {
              summary: latest.summary,
              driftNote: latest.drift_note,
              createdAt: latest.created_at,
              messageCount: latest.message_count,
            }
          : null
      }
      history={snapshots.slice(1).map((s) => ({
        id: s.id,
        summary: s.summary,
        createdAt: s.created_at,
        messageCount: s.message_count,
      }))}
      comparison={comparison}
      messageCount={messageCount}
      untilNext={untilNext}
      snapshotEvery={SNAPSHOT_EVERY}
      budget={budget}
    />
  );
}
