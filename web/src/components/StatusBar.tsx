"use client";

import { DIALOGUE_PHASE_LABEL, type DialoguePhase } from "@/lib/phase";
import type { Agent, AgentActivity } from "@/lib/types";
import { formatTokens, totalTokens, type TokenUsage } from "@/lib/usage";

const ACTIVITY_LABEL: Record<AgentActivity, string> = {
  resting: "쉬는 중",
  queued: "차례 기다림",
  thinking: "생각 중",
  spoke: "말했어요",
};

export function StatusBar({
  phase,
  currentSpeaker,
  agents,
  activity,
  model,
  roundUsage,
  sessionUsage,
  elapsedMs,
}: {
  phase: DialoguePhase;
  currentSpeaker: Agent | null;
  agents: Agent[];
  activity: Record<string, AgentActivity>;
  model: string;
  /** 지금 라운드까지 쌓인 사용량. 발화가 하나씩 완성될 때마다 올라간다. */
  roundUsage: TokenUsage;
  /** 이 브라우저 세션 전체 누적. */
  sessionUsage: TokenUsage;
  elapsedMs: number | null;
}) {
  const busy = phase !== "resting";

  const headline =
    phase === "thinking" && currentSpeaker
      ? `${currentSpeaker.name}이 말을 고르고 있어요`
      : DIALOGUE_PHASE_LABEL[phase];

  const roundTotal = totalTokens(roundUsage);
  const sessionTotal = totalTokens(sessionUsage);

  return (
    <div className="statusbar" data-busy={busy}>
      <div className="statusbar-row">
        <div className="statusbar-state">
          <span className="state-dot" data-busy={busy} aria-hidden="true" />
          <span>{headline}</span>
          {phase === "resting" && elapsedMs !== null && (
            <span className="state-meta">지난 라운드 {(elapsedMs / 1000).toFixed(1)}초</span>
          )}
        </div>

        <div className="statusbar-meters">
          <span className="meter" title="이 발화를 만드는 모델">
            <span className="meter-label">모델</span>
            <code>{model}</code>
          </span>

          <span
            className="meter"
            title={`이번 라운드 — 입력 ${roundUsage.inputTokens.toLocaleString("ko-KR")} · 캐시 읽기 ${roundUsage.cacheReadTokens.toLocaleString("ko-KR")} · 출력 ${roundUsage.outputTokens.toLocaleString("ko-KR")} (호출 ${roundUsage.calls}회)`}
          >
            <span className="meter-label">이번</span>
            <b>{formatTokens(roundTotal)}</b>
            <small>
              ↑{formatTokens(roundUsage.inputTokens + roundUsage.cacheReadTokens + roundUsage.cacheCreationTokens)} ↓
              {formatTokens(roundUsage.outputTokens)}
            </small>
          </span>

          <span className="meter" title={`이 세션 LLM 호출 ${sessionUsage.calls}회`}>
            <span className="meter-label">누적</span>
            <b>{formatTokens(sessionTotal)}</b>
          </span>
        </div>
      </div>

      {agents.length > 0 && (
        <div className="statusbar-row statusbar-agents">
          {agents.map((agent) => {
            const state = activity[agent.id] ?? "resting";
            return (
              <span
                key={agent.id}
                className="agent-pill"
                data-state={state}
                style={{ ["--agent-color" as string]: agent.color }}
                title={`${agent.name} — ${ACTIVITY_LABEL[state]}`}
              >
                <span aria-hidden="true">{agent.emoji}</span>
                <span className="agent-pill-name">{agent.name}</span>
                <span className="agent-pill-state">{ACTIVITY_LABEL[state]}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
