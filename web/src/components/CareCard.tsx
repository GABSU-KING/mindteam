"use client";

import { CARE_RESOURCES } from "@/lib/safety";
import type { RiskLevel } from "@/lib/types";

/**
 * 자해 신호가 잡히면 대화 흐름 안에 자연스럽게 놓이는 카드.
 * 시스템 메시지이므로 존댓말이고, 진단하거나 겁주지 않는다.
 */
export function CareCard({ risk }: { risk: RiskLevel }) {
  if (risk === "none") return null;

  return (
    <div className="care">
      <h3>{risk === "high" ? "잠깐만요, 혼자 두고 싶지 않아요" : "요즘 많이 버거우신가요"}</h3>
      <p>
        {risk === "high"
          ? "지금 마음이 많이 무거운 것 같습니다. 여기 감정들 말고, 곁에서 같이 들어줄 사람이 늘 기다리고 있어요. 전화 한 통이면 됩니다."
          : "지치는 날이 이어지고 있는 것 같아요. 버겁다고 느껴질 때 언제든 편하게 이야기 나눌 수 있는 곳이 있습니다."}
      </p>
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
    </div>
  );
}
