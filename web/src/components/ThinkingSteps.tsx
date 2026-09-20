"use client";

import type { ThinkingStep } from "@/lib/types";

/**
 * 감정이 말에 도달하기까지 밟은 단계.
 *
 * 내용은 모델이 실제로 만든 것이고, 한 단계씩 나타나 보이는 건 CSS 지연일 뿐이다
 * (없는 과정을 꾸며 내지 않는다).
 */
export function ThinkingSteps({
  steps,
  live = false,
}: {
  steps: ThinkingStep[];
  /** 지금 생각하는 중이면 펼친 채로, 지나간 발화면 접어서 보여 준다. */
  live?: boolean;
}) {
  if (steps.length === 0) return null;

  const list = (
    <ol className="steps">
      {steps.map((step, index) => (
        <li key={`${step.label}-${index}`} style={{ ["--i" as string]: index }}>
          <span className="step-label">{step.label}</span>
          <span className="step-detail">{step.detail}</span>
        </li>
      ))}
    </ol>
  );

  if (live) return <div className="steps-live">{list}</div>;

  return (
    <details className="steps-fold">
      <summary>생각 과정 {steps.length}단계</summary>
      {list}
    </details>
  );
}
