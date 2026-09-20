"use client";

import { useState } from "react";
import Link from "next/link";
import { CARE_RESOURCES } from "@/lib/safety";

export function InsightsView({
  chips,
  todayNote,
  interventionCount,
}: {
  chips: { label: string; text: string }[];
  todayNote: string | null;
  interventionCount: number;
}) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSummary() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/summary", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "요약을 만들지 못했습니다.");
      setNarrative(payload.narrative);
    } catch (err) {
      setError(err instanceof Error ? err.message : "요약을 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>돌아보기</h1>
        <p>지난 일주일 동안 남기신 말들을 바탕으로 정리한 인상입니다.</p>
      </div>

      {interventionCount === 0 ? (
        <div className="empty">
          <p>아직 남겨 주신 말이 없어요.</p>
          <Link className="btn btn-primary" href="/room">
            감정들에게 말 걸러 가기
          </Link>
        </div>
      ) : (
        <>
          {todayNote && (
            <section className="panel">
              <h2>오늘</h2>
              <p className="panel-sub">가장 최근에 남긴 말에서 읽은 인상이에요.</p>
              <p className="narrative">{todayNote}</p>
            </section>
          )}

          {chips.length > 0 && (
            <section className="panel">
              <h2>이번 주 결</h2>
              <p className="panel-sub">좋고 나쁨을 재는 게 아니라, 어떤 결이었는지 살피는 거예요.</p>
              <div className="chips">
                {chips.map((chip) => (
                  <div key={chip.label} className="chip">
                    <b>{chip.label}</b>
                    {chip.text}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="panel">
            <h2>주간 편지</h2>
            <p className="panel-sub">일주일치 이야기를 한 편의 글로 받아 보세요.</p>

            {error && <div className="msg-error">{error}</div>}

            {narrative ? (
              <p className="narrative">{narrative}</p>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={loadSummary}
                disabled={busy}
              >
                {busy ? "쓰는 중..." : "편지 받기"}
              </button>
            )}

            {narrative && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 14 }}
                onClick={loadSummary}
                disabled={busy}
              >
                {busy ? "다시 쓰는 중..." : "다시 쓰기"}
              </button>
            )}
          </section>
        </>
      )}

      <section className="panel" style={{ marginTop: 14 }}>
        <h2>언제든 이야기할 수 있는 곳</h2>
        <p className="panel-sub">혼자 감당하기 버거울 때 편하게 연결해 보세요.</p>
        <div className="care-list">
          {CARE_RESOURCES.map((resource) => (
            <a
              key={resource.number}
              className="care-item"
              href={`tel:${resource.number.replace(/-/g, "")}`}
            >
              {resource.label} <b>{resource.number}</b> <small>{resource.note}</small>
            </a>
          ))}
        </div>
      </section>

      <p className="disclaimer">
        마인드팀은 마음을 들여다보는 걸 돕는 도구일 뿐, 진단을 하지 않습니다. 여기 적힌 어떤
        문장도 의학적 판단이 아니며, 힘든 상태가 이어진다면 전문가와 이야기해 보시길 권합니다.
      </p>
    </main>
  );
}
