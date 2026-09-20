"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CareCard } from "@/components/CareCard";
import { useToast } from "@/components/Toast";
import { createClient } from "@/lib/supabase/client";
import {
  MIN_ACTIVE_AGENTS,
  type Agent,
  type AgentMessage,
  type TimelineItem,
} from "@/lib/types";

export function RoomView({
  userId,
  agents,
  initialTimeline,
}: {
  userId: string;
  agents: Agent[];
  initialTimeline: TimelineItem[];
}) {
  const [timeline, setTimeline] = useState<TimelineItem[]>(initialTimeline);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const { show, node: toast } = useToast();
  const bottomRef = useRef<HTMLDivElement>(null);

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const activeAgents = useMemo(() => agents.filter((a) => a.archived_at === null), [agents]);

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

  // 새 발화가 insert 되면 Realtime 이 밀어 준다.
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
  }, [timeline.length, stage]);

  /** 감정들끼리 말하게 한다. userLine 이 있으면 그 말에 반응한다. */
  const runDialogue = useCallback(
    async (userLine?: string) => {
      setStage("감정들이 생각하고 있어요");
      const response = await fetch("/api/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userLine }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "대화를 만들지 못했습니다.");

      // Realtime 이 못 받은 경우를 대비해 응답으로도 한 번 채운다.
      for (const message of (payload.messages ?? []) as AgentMessage[]) {
        append({
          kind: "agent",
          id: message.id,
          createdAt: message.created_at,
          agentId: message.agent_id,
          content: message.content,
        });
      }
    },
    [append],
  );

  async function send() {
    const content = draft.trim();
    if (!content || busy) return;

    setBusy(true);
    setDraft("");

    try {
      setStage("감정들이 듣고 있어요");
      const response = await fetch("/api/intervene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "말을 전하지 못했습니다.");

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
    } finally {
      setStage(null);
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
    } finally {
      setStage(null);
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
                    <span style={{ color: "var(--text-faint)", fontWeight: 400 }}> · 떠난 감정</span>
                  )}
                </div>
                <div className="bubble bubble-agent">{item.content}</div>
              </div>
            </div>
          );
        })}

        {stage && (
          <div className="thinking">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
            <span>{stage}</span>
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

      {toast}
    </main>
  );
}
