import type { RiskLevel } from "@/lib/types";

/**
 * 자해 신호 감지와 상담 연결.
 *
 * 이건 스크리닝 보조지 진단이 아니다. 놓치는 것보다 넉넉히 잡는 쪽으로 기울인다.
 * LLM 판단(risk)과 키워드 사전 필터를 OR 로 합친다 — LLM 호출이 실패해도 안전망이 남는다.
 */

const HIGH_RISK_PATTERNS: RegExp[] = [
  /자살/,
  /자해/,
  /죽고\s*싶/,
  /죽어\s*버리/,
  /사라지고\s*싶/,
  /없어지고\s*싶/,
  /살기\s*싫/,
  /살고\s*싶지\s*않/,
  /목숨을\s*끊/,
  /끝내고\s*싶/,
  /내가\s*없어지면/,
];

const LOW_RISK_PATTERNS: RegExp[] = [
  /다\s*포기/,
  /버틸\s*수\s*없/,
  /아무\s*의미\s*없/,
  /희망이\s*없/,
  /혼자만\s*남/,
  /견딜\s*수\s*없/,
];

export function screenText(text: string): RiskLevel {
  if (HIGH_RISK_PATTERNS.some((re) => re.test(text))) return "high";
  if (LOW_RISK_PATTERNS.some((re) => re.test(text))) return "low";
  return "none";
}

const ORDER: Record<RiskLevel, number> = { none: 0, low: 1, high: 2 };

/** 둘 중 더 높은 위험도를 택한다. */
export function mergeRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return ORDER[a] >= ORDER[b] ? a : b;
}

export function isRiskLevel(value: unknown): value is RiskLevel {
  return value === "none" || value === "low" || value === "high";
}

/**
 * 위험 신호가 잡히면 발화하는 모든 에이전트의 시스템 프롬프트 뒤에 붙는 지침.
 * 특정 감정을 지목하지 않는다 — 어떤 감정 구성이든 동작해야 한다.
 */
export function careGuidanceFor(risk: RiskLevel): string | null {
  if (risk === "none") return null;
  if (risk === "low") {
    return [
      "",
      "[지금 상황] 이 사람은 지쳐 있다.",
      "가볍게 넘기거나 억지로 기운 내라고 하지 마라. 힘을 빼고, 지금 상태를 있는 그대로 인정해 줘라.",
      "해결책을 서둘러 내놓지 말고 먼저 곁에 있어라.",
    ].join("\n");
  }
  return [
    "",
    "[지금 상황] 이 사람에게서 스스로를 해칠 수도 있는 신호가 보인다.",
    "놀라거나 캐묻지 마라. 겁주지도 마라. 목소리를 낮추고 곁에 있어라.",
    "'혼자 이겨내라'는 말은 절대 하지 마라. 지금 혼자가 아니라는 걸 짧게 전해라.",
    "한 명 정도는 자연스럽게 '누군가한테 털어놓자', '도와줄 사람이 있다'는 방향을 꺼내도 된다.",
    "전화번호나 기관 이름을 발화에 직접 넣지는 마라. 그건 화면이 따로 안내한다.",
  ].join("\n");
}

/** 화면에 띄울 상담 자원 (대한민국). */
export const CARE_RESOURCES = [
  { label: "자살예방 상담전화", number: "109", note: "24시간" },
  { label: "정신건강 상담전화", number: "1577-0199", note: "24시간" },
  { label: "생명의전화", number: "1588-9191", note: "24시간" },
  { label: "청소년 전화", number: "1388", note: "24시간" },
] as const;
