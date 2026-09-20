"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CareCard } from "@/components/CareCard";
import { StatusBar } from "@/components/StatusBar";
import { ThinkingSteps } from "@/components/ThinkingSteps";
import { useToast } from "@/components/Toast";
import {
  MIN_INTERVAL_MS,
  normalizeBudget,
  pacingIntervalMs,
  remainingUsd,
  type BudgetStatus,
} from "@/lib/budget";
import type { DialoguePhase } from "@/lib/phase";
import { createClient } from "@/lib/supabase/client";
import { readDialogueStream, type DialogueEvent } from "@/lib/stream";
import {
  MIN_ACTIVE_AGENTS,
  type Agent,
  type AgentActivity,
  type AgentMessage,
  type ThinkingStep,
  type TimelineItem,
} from "@/lib/types";
import { addUsage, EMPTY_USAGE, normalizeUsage, type TokenUsage } from "@/lib/usage";

/** 한 단계를 읽을 시간. 내용은 이미 다 와 있고, 펼치는 속도만 여기서 정한다. */
const STEP_REVEAL_MS = 420;
const MAX_STEP_PAUSE_MS = 1800;

/** 대화 간격 계산에 쓰는 라운드당 평균 발화자 수 */
const AVERAGE_SPEAKERS = 3;

export function RoomView({
  userId,
  agents,
  initialTimeline,
  initialModel,
  ambientModel,
  initialBudget,
  initialMessagesUntilSnapshot,
}: {
  userId: string;
  agents: Agent[];
  initialTimeline: TimelineItem[];
  /** 서버에서 읽은 기본 모델. 스트림이 실제 응답 모델로 덮어쓴다. */
  initialModel: string;
  /** 평소 대화에 쓰는 저렴한 모델. 대화 간격 계산에 필요하다. */
  ambientModel: string;
  initialBudget: BudgetStatus;
  /** 다음 자아 스냅샷까지 남은 발화 수 */
  initialMessagesUntilSnapshot: number;
}) {
  const [timeline, setTimeline] = useState<TimelineItem[]>(initialTimeline);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const [phase, setPhase] = useState<DialoguePhase>("resting");
  const [activity, setActivity] = useState<Record<string, AgentActivity>>({});
  const [currentSpeakerId, setCurrentSpeakerId] = useState<string | null>(null);
  const [liveSteps, setLiveSteps] = useState<ThinkingStep[]>([]);
  const [model, setModel] = useState(initialModel);
  const [roundUsage, setRoundUsage] = useState<TokenUsage>(EMPTY_USAGE);
  const [sessionUsage, setSessionUsage] = useState<TokenUsage>(EMPTY_USAGE);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [budget, setBudget] = useState<BudgetStatus>(initialBudget);

  // 끊임없이 지켜보기
  const [watching, setWatching] = useState(false);
  const [nextRoundAt, setNextRoundAt] = useState<number | null>(null);
  const [nextRoundInMs, setNextRoundInMs] = useState<number | null>(null);

  const untilSnapshotRef = useRef(initialMessagesUntilSnapshot);
  const { show, node: toast } = useToast();
  const bottomRef = useRef<HTMLDivElement>(null);

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const activeAgents = useMemo(() => agents.filter((a) => a.archived_at === null), [agents]);
  const currentSpeaker = currentSpeakerId ? (agentsById.get(currentSpeakerId) ?? null) : null;
  const exhausted = remainingUsd(budget) <= 0;

  /** 상담 카드는 가장 최근 개입 아래에만 한 번 붙인다. */
  const latestUserId = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i].kind === "user") return timeline[i].id;
    }
    return null;
  }, [timeline]);

  const append = useCallback((item: TimelineItem) => {
    setTimeline((prev) => {
      if (prev.some((existing) => existing.id === item.id)) return prev;
      return [...prev, item].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  /** 라운드와 세션 누적을 한 번에 올린다. */
  const countUsage = useCallback((usage: TokenUsage) => {
    const safe = normalizeUsage(usage);
    setRoundUsage((prev) => addUsage(prev, safe));
    setSessionUsage((prev) => addUsage(prev, safe));
  }, []);

  // 새 발화가 insert 되면 Realtime 이 밀어 준다.
  // (다른 탭에서 만든 발화도 여기로 들어온다 — 스트림만으로는 놓친다.)
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("room-stream")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_messages",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as AgentMessage;
          append({
            kind: "agent",
            id: row.id,
            createdAt: row.created_at,
            agentId: row.agent_id,
            content: row.content,
            steps: row.thinking_steps ?? null,
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, append]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [timeline.length, phase, liveSteps.length]);

  /* ── 자아 스냅샷 ────────────────────────────────
     발화가 충분히 쌓였을 때만 부른다. 아니면 서버가 예산을 쓰지 않고 돌아온다. */
  const maybeSnapshot = useCallback(
    async (newMessages: number) => {
      untilSnapshotRef.current -= newMessages;
      if (untilSnapshotRef.current > 0) return;

      try {
        const response = await fetch("/api/identity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const payload = await response.json();
        if (!response.ok) {
          untilSnapshotRef.current = 8; // 잠시 뒤 다시 시도
          return;
        }
        untilSnapshotRef.current = payload.messagesUntilNext ?? 24;
        if (payload.created) {
          if (payload.budget) setBudget(normalizeBudget(payload.budget, budget.limitUsd));
          if (payload.usage) countUsage(payload.usage);
          show("자아가 한 장 더 그려졌습니다. '자아'에서 볼 수 있어요.");
        }
      } catch {
        untilSnapshotRef.current = 8;
      }
    },
    [budget.limitUsd, countUsage, show],
  );

  const handleEvent = useCallback(
    async (event: DialogueEvent) => {
      switch (event.type) {
        case "start": {
          setModel(event.model);
          // 뽑히지 않은 감정은 이번 라운드 내내 '쉬는 중' 이다.
          const next: Record<string, AgentActivity> = {};
          for (const agent of activeAgents) next[agent.id] = "resting";
          for (const id of event.speakerIds) next[id] = "queued";
          setActivity(next);
          break;
        }
        case "thinking": {
          setCurrentSpeakerId(event.agentId);
          setLiveSteps([]);
          setActivity((prev) => ({ ...prev, [event.agentId]: "thinking" }));
          break;
        }
        case "steps": {
          setLiveSteps(event.steps);
          // 한 단계씩 읽을 틈을 준다. 그동안 스트림은 계속 버퍼에 쌓인다.
          await sleep(Math.min(event.steps.length * STEP_REVEAL_MS, MAX_STEP_PAUSE_MS));
          break;
        }
        case "message": {
          setModel(event.model);
          countUsage(event.usage);
          setActivity((prev) => ({ ...prev, [event.message.agent_id]: "spoke" }));
          setCurrentSpeakerId(null);
          setLiveSteps([]);
          append({
            kind: "agent",
            id: event.message.id,
            createdAt: event.message.created_at,
            agentId: event.message.agent_id,
            content: event.message.content,
            steps: event.message.thinking_steps ?? null,
          });
          break;
        }
        case "skipped": {
          setActivity((prev) => ({ ...prev, [event.agentId]: "resting" }));
          setCurrentSpeakerId(null);
          setLiveSteps([]);
          break;
        }
        case "budget": {
          setBudget(normalizeBudget(event.budget, budget.limitUsd));
          break;
        }
        case "budget_exhausted": {
          setBudget(normalizeBudget(event.budget, budget.limitUsd));
          setWatching(false);
          show(event.message);
          break;
        }
        case "done": {
          setModel(event.model);
          setElapsedMs(event.elapsedMs);
          setCurrentSpeakerId(null);
          setLiveSteps([]);
          setPhase("resting");
          break;
        }
        case "error": {
          show(event.message);
          break;
        }
      }
    },
    [activeAgents, append, budget.limitUsd, countUsage, show],
  );

  /** 감정들이 말하게 한다. userLine 이 있으면 그 말에 반응한다. */
  const runDialogue = useCallback(
    async (userLine?: string) => {
      setPhase("thinking");
      setRoundUsage(EMPTY_USAGE);
      setElapsedMs(null);

      const response = await fetch("/api/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userLine }),
      });

      // 스트림을 열기 전에 실패하면 평범한 JSON 에러가 온다.
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        if (payload?.budgetExhausted) {
          setBudget(normalizeBudget(payload.budget, budget.limitUsd));
          setWatching(false);
        }
        throw new Error(payload?.error ?? "대화를 만들지 못했습니다.");
      }

      let produced = 0;
      await readDialogueStream(response.body, async (event) => {
        if (event.type === "message") produced++;
        await handleEvent(event);
      });

      if (produced > 0) void maybeSnapshot(produced);
    },
    [budget.limitUsd, handleEvent, maybeSnapshot],
  );

  const runRef = useRef(runDialogue);
  runRef.current = runDialogue;

  const startRound = useCallback(
    async (userLine?: string) => {
      setBusy(true);
      try {
        await runRef.current(userLine);
      } catch (err) {
        show(err instanceof Error ? err.message : "문제가 생겼습니다.");
        setPhase("resting");
      } finally {
        setBusy(false);
      }
    },
    [show],
  );

  /* ── 끊임없는 대화 ──────────────────────────────
     남은 예산을 이번 달 남은 시간에 펴 발라서 간격을 정한다.
     예산이 넉넉하면 촘촘하게, 빠듯하면 느긋하게. 다 쓰면 스스로 멈춘다.
     탭이 가려져 있으면 돌지 않는다 — 안 보는 화면에 돈을 쓰지 않는다. */
  useEffect(() => {
    if (!watching || busy || exhausted) {
      setNextRoundAt(null);
      return;
    }

    const delay = pacingIntervalMs({
      budget,
      speakersPerRound: AVERAGE_SPEAKERS,
      ambientModel,
    });

    if (!Number.isFinite(delay)) {
      setWatching(false);
      return;
    }

    const at = Date.now() + delay;
    setNextRoundAt(at);

    const timer = setTimeout(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        // 다시 보일 때까지 기다린다. 아래 visibilitychange 가 다시 예약한다.
        setNextRoundAt(null);
        return;
      }
      void startRound();
    }, delay);

    return () => clearTimeout(timer);
  }, [watching, busy, exhausted, budget, ambientModel, startRound]);

  // 탭이 다시 보이면 예약을 되살린다.
  useEffect(() => {
    if (!watching) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") setBudget((prev) => ({ ...prev }));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [watching]);

  // 남은 시간 표시
  useEffect(() => {
    if (nextRoundAt === null) {
      setNextRoundInMs(null);
      return;
    }
    const tick = () => setNextRoundInMs(Math.max(0, nextRoundAt - Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [nextRoundAt]);

  async function send() {
    const content = draft.trim();
    if (!content || busy) return;

    setBusy(true);
    setDraft("");

    try {
      setPhase("listening");
      setRoundUsage(EMPTY_USAGE);

      const response = await fetch("/api/intervene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (payload?.budgetExhausted) {
          setBudget(normalizeBudget(payload.budget, budget.limitUsd));
          setWatching(false);
        }
        throw new Error(payload.error ?? "말을 전하지 못했습니다.");
      }

      // 분석 호출도 토큰을 쓴다. 발화 생성분과 함께 이번 라운드로 센다.
      if (payload.model) setModel(payload.model);
      countUsage(payload.usage);
      if (payload.budget) setBudget(normalizeBudget(payload.budget, budget.limitUsd));

      append({
        kind: "user",
        id: payload.intervention.id,
        createdAt: payload.intervention.created_at,
        content,
        risk: payload.risk ?? "none",
      });

      await runRef.current(content);
    } catch (err) {
      show(err instanceof Error ? err.message : "문제가 생겼습니다.");
      setDraft(content);
      setPhase("resting");
    } finally {
      setBusy(false);
    }
  }

  if (activeAgents.length < MIN_ACTIVE_AGENTS) {
    return (
      <main className="page">
        <div className="empty">
          <p>대화를 하려면 감정이 최소 {MIN_ACTIVE_AGENTS}명 필요합니다.</p>
          <Link className="btn btn-primary" href="/agents">
            감정들 보러 가기
          </Link>
        </div>
      </main>
    );
  }

  return (
    <>
      <StatusBar
        phase={phase}
        currentSpeaker={currentSpeaker}
        agents={activeAgents}
        activity={activity}
        model={model}
        roundUsage={roundUsage}
        sessionUsage={sessionUsage}
        elapsedMs={elapsedMs}
        budget={budget}
        watching={watching}
        nextRoundInMs={nextRoundInMs}
      />

      <main className="page" style={{ display: "flex", flexDirection: "column" }}>
        <div className="stream">
          {timeline.length === 0 && (
            <div className="empty">
              <p>아직 조용합니다. 감정들이 알아서 이야기하게 두거나, 먼저 말을 걸어도 됩니다.</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setWatching(true)}
                disabled={busy || exhausted}
              >
                계속 지켜보기
              </button>
            </div>
          )}

          {timeline.map((item) => {
            if (item.kind === "user") {
              // Fragment 로 둔다 — div 로 감싸면 .row 의 align-self 가 먹지 않아 오른쪽 정렬이 깨진다.
              return (
                <Fragment key={item.id}>
                  <div className="row" data-side="right">
                    <div className="bubble bubble-user">{item.content}</div>
                  </div>
                  {item.risk !== "none" && item.id === latestUserId && (
                    <CareCard risk={item.risk} />
                  )}
                </Fragment>
              );
            }

            const agent = agentsById.get(item.agentId);
            const side = (agent?.sort_order ?? 0) % 2 === 0 ? "left" : "left-offset";

            return (
              <div
                key={item.id}
                className="row"
                data-side={side}
                style={{ ["--agent-color" as string]: agent?.color ?? "#9B7FE8" }}
              >
                <div className="avatar" style={{ width: 32, height: 32, fontSize: 16 }}>
                  {agent?.emoji ?? "✨"}
                </div>
                <div>
                  <div className="speaker">
                    {agent?.name ?? "알 수 없는 감정"}
                    {agent?.archived_at && (
                      <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>
                        {" "}
                        · 떠난 감정
                      </span>
                    )}
                  </div>
                  <div className="bubble bubble-agent">{item.content}</div>
                  {item.steps && item.steps.length > 0 && <ThinkingSteps steps={item.steps} />}
                </div>
              </div>
            );
          })}

          {phase !== "resting" && (
            <div
              className="thinking-block"
              style={{ ["--agent-color" as string]: currentSpeaker?.color ?? "var(--text-faint)" }}
            >
              <div className="thinking">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
                <span>
                  {currentSpeaker
                    ? `${currentSpeaker.emoji} ${currentSpeaker.name}이 생각하고 있어요`
                    : phase === "listening"
                      ? "감정들이 듣고 있어요"
                      : "누가 말할지 정하고 있어요"}
                </span>
              </div>
              {liveSteps.length > 0 && <ThinkingSteps steps={liveSteps} live />}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="composer">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={exhausted ? "이번 달 예산을 다 썼습니다" : "끼어들어 한 마디 해보세요"}
            maxLength={2000}
            disabled={busy || exhausted}
            rows={1}
          />
          <button
            type="button"
            className="btn"
            data-on={watching}
            onClick={() => setWatching((prev) => !prev)}
            disabled={exhausted}
            title={
              exhausted
                ? "이번 달 예산을 다 썼습니다"
                : `감정들이 알아서 계속 이야기합니다 (최소 ${MIN_INTERVAL_MS / 1000}초 간격, 남은 예산에 따라 조절)`
            }
          >
            {watching ? "지켜보는 중" : "계속 지켜보기"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={send}
            disabled={busy || exhausted || !draft.trim()}
          >
            전하기
          </button>
        </div>
      </main>

      {toast}
    </>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
