"use client";

import { useCallback, useEffect, useState } from "react";
import { AddAgentDialog } from "@/components/AddAgentDialog";
import { useToast } from "@/components/Toast";
import { createClient } from "@/lib/supabase/client";
import {
  MAX_ACTIVE_AGENTS,
  MIN_ACTIVE_AGENTS,
  normalizePersonality,
  type Agent,
} from "@/lib/types";

export function AgentsView({
  initialAgents,
  userId,
}: {
  initialAgents: Agent[];
  userId: string;
}) {
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const { show, node: toast } = useToast();

  const reload = useCallback(async () => {
    const { data } = await createClient()
      .from("agents")
      .select("*")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("sort_order", { ascending: true });

    setAgents(
      ((data ?? []) as Agent[]).map((row) => ({
        ...row,
        personality: normalizePersonality(row.personality),
      })),
    );
  }, [userId]);

  // agents 테이블 구독 → 목록 자동 갱신
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("agents-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agents", filter: `user_id=eq.${userId}` },
        () => void reload(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, reload]);

  async function archive(agent: Agent) {
    // UI 쪽 하한 확인. DB 트리거가 한 번 더 막아 준다.
    if (agents.length <= MIN_ACTIVE_AGENTS) {
      show(`감정은 최소 ${MIN_ACTIVE_AGENTS}명이 필요합니다.`);
      return;
    }
    if (!confirm(`'${agent.name}'을(를) 보낼까요?\n지금까지 나눈 대화는 그대로 남습니다.`)) {
      return;
    }

    const { error } = await createClient()
      .from("agents")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", agent.id);

    if (error) {
      show(error.message);
      return;
    }
    show(`${agent.name}을(를) 보냈습니다.`);
    void reload();
  }

  async function seedDefaults() {
    setSeeding(true);
    try {
      const response = await fetch("/api/agents/seed", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      void reload();
    } catch (err) {
      show(err instanceof Error ? err.message : "기본 감정을 들이지 못했습니다.");
    } finally {
      setSeeding(false);
    }
  }

  const atCapacity = agents.length >= MAX_ACTIVE_AGENTS;

  return (
    <main className="page">
      <div className="page-head">
        <h1>지금 함께 있는 감정들</h1>
        <p>
          {agents.length > 0
            ? `${agents.length}명이 당신 안에서 이야기하고 있어요. 최대 ${MAX_ACTIVE_AGENTS}명까지 함께할 수 있습니다.`
            : "아직 아무도 없네요."}
        </p>
      </div>

      {agents.length === 0 ? (
        <div className="empty">
          <p>감정이 한 명도 없습니다.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={seedDefaults}
            disabled={seeding}
          >
            {seeding ? "불러오는 중..." : "기본 감정 다섯 들이기"}
          </button>
        </div>
      ) : (
        <div className="agent-grid">
          {agents.map((agent) => (
            <article
              key={agent.id}
              className="agent-card"
              style={{ ["--agent-color" as string]: agent.color }}
            >
              <div className="agent-card-top">
                <div className="avatar">{agent.emoji}</div>
                <div className="agent-name">{agent.name}</div>
              </div>
              <p className="agent-role">{agent.role_line ?? ""}</p>
              <div className="agent-card-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => archive(agent)}
                  disabled={agents.length <= MIN_ACTIVE_AGENTS}
                  title={
                    agents.length <= MIN_ACTIVE_AGENTS
                      ? `감정은 최소 ${MIN_ACTIVE_AGENTS}명이 필요합니다.`
                      : "보내기"
                  }
                >
                  보내기
                </button>
              </div>
            </article>
          ))}

          <button
            type="button"
            className="card-add"
            onClick={() => setDialogOpen(true)}
            disabled={atCapacity}
            title={
              atCapacity ? `감정은 최대 ${MAX_ACTIVE_AGENTS}명까지 함께할 수 있습니다.` : undefined
            }
          >
            <span style={{ fontSize: 22 }}>+</span>
            <span>{atCapacity ? "자리가 꽉 찼어요" : "감정 들이기"}</span>
          </button>
        </div>
      )}

      {dialogOpen && (
        <AddAgentDialog
          onClose={() => setDialogOpen(false)}
          onCreated={(name) => {
            setDialogOpen(false);
            show(`${name}이(가) 합류했습니다.`);
            void reload();
          }}
        />
      )}

      {toast}
    </main>
  );
}
