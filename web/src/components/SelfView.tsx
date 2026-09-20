"use client";

import { useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import { normalizeBudget, remainingUsd, type BudgetStatus } from "@/lib/budget";
import { formatUsd } from "@/lib/pricing";
import type { DriftBand } from "@/lib/identity";

type ComparisonRow = {
  axis: string;
  label: string;
  hint: string;
  /** 서버에서 이미 문장으로 번역된 값. 숫자는 넘어오지 않는다. */
  text: string;
  band: DriftBand | null;
  direction: "up" | "down" | "flat" | null;
};

type SnapshotBrief = {
  summary: string;
  driftNote: string | null;
  createdAt: string;
  messageCount: number;
};

export function SelfView({
  portraitContent,
  hasBaselineAxes,
  latest,
  history,
  comparison,
  messageCount,
  untilNext,
  snapshotEvery,
  budget: initialBudget,
}: {
  portraitContent: string;
  hasBaselineAxes: boolean;
  latest: SnapshotBrief | null;
  history: { id: string; summary: string; createdAt: string; messageCount: number }[];
  comparison: ComparisonRow[];
  messageCount: number;
  untilNext: number;
  snapshotEvery: number;
  budget: BudgetStatus;
}) {
  const [draft, setDraft] = useState(portraitContent);
  const [saved, setSaved] = useState(portraitContent);
  const [editing, setEditing] = useState(portraitContent.length === 0);
  const [budget, setBudget] = useState(initialBudget);
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const { show, node: toast } = useToast();

  const exhausted = remainingUsd(budget) <= 0;
  const dirty = draft.trim() !== saved.trim();

  async function savePortrait() {
    const content = draft.trim();
    if (!content) {
      show("자기 소개글을 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/self-portrait", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "저장하지 못했습니다.");

      if (payload.budget) setBudget(normalizeBudget(payload.budget, budget.limitUsd));
      setSaved(content);
      setEditing(false);
      show("기준 자아를 저장했습니다. 다음 자아가 그려질 때 이 글과 대조됩니다.");
    } catch (err) {
      show(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function drawNow() {
    setDrawing(true);
    try {
      const response = await fetch("/api/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "자아를 그리지 못했습니다.");

      if (payload.budget) setBudget(normalizeBudget(payload.budget, budget.limitUsd));
      show("자아를 다시 그렸습니다.");
      // 서버 컴포넌트가 새로 읽어야 하므로 새로고침한다.
      window.location.reload();
    } catch (err) {
      show(err instanceof Error ? err.message : "자아를 그리지 못했습니다.");
      setDrawing(false);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>자아</h1>
        <p>
          감정들의 대화에서 자라난 자아와, 직접 쓰신 기준 자아를 나란히 놓고 봅니다. 어느 쪽이
          맞다는 판정이 아니라 어디서 갈라지는지를 보는 자리예요.
        </p>
      </div>

      {/* ── 기준 자아 ──────────────────────────── */}
      <section className="panel">
        <h2>내가 쓴 나</h2>
        <p className="panel-sub">
          비교의 기준이 되는 글입니다. 언제든 고칠 수 있고, 고치면 다음 대조에 바로 반영됩니다.
        </p>

        {editing ? (
          <>
            <textarea
              className="portrait-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={4000}
              rows={8}
              placeholder={
                "나는 어떤 사람인가요?\n\n중요하게 여기는 것, 잘 흔들리는 지점, 사람들과 지내는 방식,\n요즘 가고 싶은 방향… 떠오르는 대로 쓰셔도 됩니다."
              }
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={savePortrait}
                disabled={busy || exhausted || !draft.trim()}
              >
                {busy ? "읽고 있어요..." : "저장하기"}
              </button>
              {saved && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setDraft(saved);
                    setEditing(false);
                  }}
                  disabled={busy}
                >
                  그만두기
                </button>
              )}
              <span style={{ marginLeft: "auto", color: "var(--text-faint)", fontSize: 12 }}>
                {draft.length} / 4000
              </span>
            </div>
            {exhausted && (
              <p style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 10 }}>
                이번 달 예산을 다 써서 지금은 저장할 수 없습니다. 글을 읽어 축으로 옮기는 데도 호출이
                필요해요.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="narrative">{saved}</p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 12 }}
              onClick={() => setEditing(true)}
            >
              고치기
            </button>
            {!hasBaselineAxes && (
              <p style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 10 }}>
                이 글을 축으로 옮기지 못했습니다. 다시 저장하면 한 번 더 시도합니다.
              </p>
            )}
          </>
        )}
      </section>

      {/* ── 자라난 자아 ────────────────────────── */}
      {latest ? (
        <section className="panel">
          <h2>대화에서 자라난 나</h2>
          <p className="panel-sub">
            발화 {latest.messageCount.toLocaleString("ko-KR")}개까지 반영 ·{" "}
            {formatDate(latest.createdAt)}
          </p>
          <p className="narrative">{latest.summary}</p>
        </section>
      ) : (
        <section className="panel">
          <h2>대화에서 자라난 나</h2>
          <p className="panel-sub">아직 그려지지 않았어요.</p>
          {messageCount === 0 ? (
            <p style={{ fontSize: 14, color: "var(--text-dim)" }}>
              감정들이 먼저 이야기해야 합니다.{" "}
              <Link href="/room" style={{ color: "var(--accent)" }}>
                대화로 가기
              </Link>
            </p>
          ) : (
            <p style={{ fontSize: 14, color: "var(--text-dim)" }}>
              발화 {snapshotEvery}개가 쌓이면 자동으로 한 장 그려집니다. 지금까지{" "}
              {messageCount.toLocaleString("ko-KR")}개 쌓였어요.
            </p>
          )}
        </section>
      )}

      {/* ── 대조 ──────────────────────────────── */}
      {comparison.length > 0 && (
        <section className="panel">
          <h2>어디서 갈라지나</h2>
          <p className="panel-sub">
            {latest?.driftNote
              ? "축마다 기준으로 쓰신 글과 비교했습니다."
              : "기준 글이 없어서 지금 상태만 보여 드립니다. 위에 자기 소개글을 쓰면 대조가 시작됩니다."}
          </p>

          <div className="drift-list">
            {comparison.map((row) => (
              <div key={row.axis} className="drift-row" data-band={row.band ?? "none"}>
                <div className="drift-axis">
                  <b>{row.label}</b>
                  <small>{row.hint}</small>
                </div>
                <div className="drift-text">
                  {row.direction && row.direction !== "flat" && (
                    <span className="drift-arrow" aria-hidden="true">
                      {row.direction === "up" ? "▲" : "▼"}
                    </span>
                  )}
                  {row.text}
                </div>
              </div>
            ))}
          </div>

          {latest?.driftNote && (
            <p className="narrative" style={{ marginTop: 18, fontSize: 14.5 }}>
              {latest.driftNote}
            </p>
          )}
        </section>
      )}

      {/* ── 형성 과정 ──────────────────────────── */}
      {history.length > 0 && (
        <section className="panel">
          <h2>여기까지 오는 동안</h2>
          <p className="panel-sub">자아가 어떻게 움직였는지 거꾸로 되짚어 봅니다.</p>
          <ol className="snapshot-history">
            {history.map((item) => (
              <li key={item.id}>
                <div className="snapshot-when">
                  {formatDate(item.createdAt)}
                  <small> · 발화 {item.messageCount.toLocaleString("ko-KR")}개까지</small>
                </div>
                <p>{item.summary}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ── 다시 그리기 ────────────────────────── */}
      <section className="panel">
        <h2>지금 다시 그리기</h2>
        <p className="panel-sub">
          평소에는 발화 {snapshotEvery}개마다 자동으로 그려집니다.
          {untilNext > 0 && latest ? ` 다음 장까지 ${untilNext}개 남았어요.` : ""}
        </p>
        <button
          type="button"
          className="btn"
          onClick={drawNow}
          disabled={drawing || exhausted || messageCount === 0}
        >
          {drawing ? "그리는 중..." : "지금 그리기"}
        </button>
        <p style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 12 }}>
          이번 달 {formatUsd(budget.spentUsd)} / {formatUsd(budget.limitUsd)} 사용 · 자아를 한 장
          그리는 데 대략 {formatUsd(0.02)} 듭니다.
        </p>
      </section>

      <p className="disclaimer">
        여기 적힌 어떤 문장도 의학적 판단이나 성격 검사 결과가 아닙니다. 감정들의 말은 당신의
        내면을 비춘 것이지 사실 기록이 아니며, 기준으로 쓰신 글과 다르다는 것이 문제라는 뜻도
        아닙니다.
      </p>

      {toast}
    </main>
  );
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
