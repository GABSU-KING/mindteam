"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CareCard } from "@/components/CareCard";
import { StatusBar } from "@/components/StatusBar";
import { useToast } from "@/components/Toast";
import type { DialoguePhase } from "@/lib/phase";
import { createClient } from "@/lib/supabase/client";
import { readDialogueStream, type DialogueEvent } from "@/lib/stream";
import {
  MIN_ACTIVE_AGENTS,
  type Agent,
  type AgentActivity,
  type AgentMessage,
  type TimelineItem,
} from "@/lib/types";
import { addUsage, EMPTY_USAGE, normalizeUsage, type TokenUsage } from "@/lib/usage";

export function RoomView({
  userId,
  agents,
  initialTimeline,
  initialModel,
}: {
  userId: string;
  agents: Agent[];
  initialTimeline: TimelineItem[];
  /** 서버에서 읽은 ANTHROPIC_MODEL. 스트림이 실제 응답 모델로 덮어쓴다. */
  initialModel: string;
}) {
  const [timeline, setTimeline] = useState<TimelineItem[]>(initialTimeline);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const [phase, setPhase] = useState<DialoguePhase>("resting");
  const [activity, setActivity] = useState<Record<string, AgentActivity>>({});
  const [currentSpeakerId, setCurrentSpeakerId] = useState<string | null>(null);
  const [model, setModel] = useState(initialModel);
  const [roundUsage, setRoundUsage] = useState<TokenUsage>(EMPTY_USAGE);
  const [sessionUsage, setSessionUsage] = useState<TokenUsage>(EMPTY_USAGE);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const { show, node: toast } = useToast();
  const bottomRef = useRef<HTMLDivElement>(null);

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const activeAgents = useMemo(() => agents.filter((a) => a.archived_at === null), [agents]);
  const currentSpeaker = currentSpeakerId ? agentsById.get(currentSpeakerId) ?? null : null;

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
  }, [timeline.length, phase]);

  const handleEvent = useCallback(
    (event: DialogueEvent) => {
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
          setActivity((prev) => ({ ...prev, [event.agentId]: "thinking" }));
          break;
        }
        case "message": {
          setModel(event.model);
          countUsage(event.usage);
          setActivity((prev) => ({ ...prev, [event.message.agent_id]: "spoke" }));
          setCurrentSpeakerId(null);
          append({
            kind: "agent",
            id: event.message.id,
            createdAt: event.message.created_at,
            agentId: event.message.agent_id,
            content: event.message.content,
          });
          break;
        }
        case "skipped": {
          setActivity((prev) => ({ ...prev, [event.agentId]: "resting" }));
          setCurrentSpeakerId(null);
          break;
        }
        case "done": {
          setModel(event.model);
          setElapsedMs(event.elapsedMs);
          setCurrentSpeakerId(null);
          setPhase("resting");
          break;
        }
        case "error": {
          show(event.message);
          break;
        }
      }
    },
    [activeAgents, append, countUsage, show],
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
        throw new Error(payload?.error ?? "대화를 만들지 못했습니다.");
      }

      await readDialogueStream(response.body, handleEvent);
    },
    [handleEvent],
  );

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
      if (!response.ok) throw new Error(payload.error ?? "말을 전하지 못했습니다.");

      // 분석 호출도 토큰을 쓴다. 발화 생성분과 함께 이번 라운드로 센다.
      if (payload.model) setModel(payload.model);
      countUsage(payload.usage);

      append({
        kind: "user",
        id: payload.intervention.id,
        createdAt: payload.intervention.created_at,
        content,
        risk: payload.risk ?? "none",
      });

      await runDialogue(content);
    } catch (err) {
      show(err instanceof Error ? err.message : "문제가 생겼습니다.");
      setDraft(content);
      setPhase("resting");
    } finally {
      setBusy(false);
    }
  }

  async function nudge() {
    if (busy) return;
    setBusy(true);
    try {
      await runDialogue();
    } catch (err) {
      show(err instanceof Error ? err.message : "문제가 생겼습니다.");
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
      />

      <main className="page" style={{ display: "flex", flexDirection: "column" }}>
        <div className="stream">
          {timeline.length === 0 && (
            <div className="empty">
              <p>아직 조용합니다. 먼저 말을 걸어도 되고, 감정들끼리 떠들게 둬도 됩니다.</p>
              <button type="button" className="btn" onClick={nudge} disabled={busy}>
                감정들끼리 이야기하게 두기
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
                </div>
              </div>
            );
          })}

          {phase !== "resting" && (
            <div
              className="thinking"
              style={{ ["--agent-color" as string]: currentSpeaker?.color ?? "var(--text-faint)" }}
            >
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <span>
                {currentSpeaker
                  ? `${currentSpeaker.emoji} ${currentSpeaker.name}이 말을 고르고 있어요`
                  : phase === "listening"
                    ? "감정들이 듣고 있어요"
                    : "누가 말할지 정하고 있어요"}
              </span>
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
            placeholder="끼어들어 한 마디 해보세요"
            maxLength={2000}
            disabled={busy}
            rows={1}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={nudge}
            disabled={busy}
            title="감정들끼리 이야기하게 두기"
          >
            엿듣기
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={send}
            disabled={busy || !draft.trim()}
          >
            전하기
          </button>
        </div>
      </main>

      {toast}
    </>
  );
}
