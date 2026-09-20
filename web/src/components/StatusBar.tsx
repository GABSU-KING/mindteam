"use client";

import { remainingUsd, usedRatio, type BudgetStatus } from "@/lib/budget";
import { DIALOGUE_PHASE_LABEL, type DialoguePhase } from "@/lib/phase";
import { PURPOSE_LABEL } from "@/lib/models";
import { formatUsd } from "@/lib/pricing";
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
  budget,
  watching,
  nextRoundInMs,
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
  budget: BudgetStatus;
  watching: boolean;
  /** 다음 라운드까지 남은 시간. 계속 지켜보는 중일 때만 의미가 있다. */
  nextRoundInMs: number | null;
}) {
  const busy = phase !== "resting";
  const ratio = usedRatio(budget);
  const left = remainingUsd(budget);
  const exhausted = left <= 0;

  const headline =
    phase === "thinking" && currentSpeaker
      ? `${currentSpeaker.name}이 생각하고 있어요`
      : DIALOGUE_PHASE_LABEL[phase];

  const topSpender = budget.byPurpose[0];

  return (
    <div className="statusbar" data-busy={busy}>
      <div className="statusbar-row">
        <div className="statusbar-state">
          <span className="state-dot" data-busy={busy} aria-hidden="true" />
          <span>{headline}</span>
          {!busy && watching && !exhausted && nextRoundInMs !== null && (
            <span className="state-meta">다음 대화까지 {formatCountdown(nextRoundInMs)}</span>
          )}
          {!busy && !watching && elapsedMs !== null && (
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
            <b>{formatTokens(totalTokens(roundUsage))}</b>
            <small>
              ↑
              {formatTokens(
                roundUsage.inputTokens +
                  roundUsage.cacheReadTokens +
                  roundUsage.cacheCreationTokens,
              )}{" "}
              ↓{formatTokens(roundUsage.outputTokens)}
            </small>
          </span>

          <span className="meter" title={`이 세션 LLM 호출 ${sessionUsage.calls}회`}>
            <span className="meter-label">누적</span>
            <b>{formatTokens(totalTokens(sessionUsage))}</b>
          </span>
        </div>
      </div>

      {/* 예산 — 서버가 호출 직전에 실제로 막는 값이다. 표시만이 아니다. */}
      <div className="statusbar-row">
        <div
          className="budget"
          data-level={ratio >= 1 ? "out" : ratio > 0.85 ? "low" : ratio > 0.6 ? "half" : "ok"}
          title={
            budget.byPurpose.length > 0
              ? budget.byPurpose
                  .map((p) => `${PURPOSE_LABEL[p.purpose]} ${formatUsd(p.costUsd)} (${p.calls}회)`)
                  .join(" · ")
              : "이번 달 지출 내역이 아직 없습니다"
          }
        >
          <span className="budget-label">이번 달</span>
          <span className="budget-track" aria-hidden="true">
            <span className="budget-fill" style={{ width: `${ratio * 100}%` }} />
          </span>
          <span className="budget-text">
            <b>{formatUsd(budget.spentUsd)}</b>
            <small> / {formatUsd(budget.limitUsd)}</small>
          </span>
          {exhausted ? (
            <span className="budget-note">다 썼어요 · 다음 달에 이어집니다</span>
          ) : (
            topSpender && (
              <span className="budget-note">
                주로 {PURPOSE_LABEL[topSpender.purpose]}에 쓰였어요
              </span>
            )
          )}
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

function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}분` : `${minutes}분 ${rest}초`;
}
