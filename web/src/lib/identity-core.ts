/**
 * 자아 대조의 순수 로직.
 *
 * LLM 도 DB 도 건드리지 않는다. 따로 있는 이유는 `dialogue-core.ts` 와 같다 —
 * CLAUDE.md 규칙 5(심리 값을 숫자로 보여주지 말 것)를 지키는 지점이 여기라서,
 * 외부 의존 없이 검증할 수 있어야 한다.
 */

import { clamp01, type IdentityAxes } from "@/lib/types";

/** 축이 기준보다 짙어졌을 때 / 옅어졌을 때의 표현. 숫자를 담지 않는다. */
export const DRIFT_WORDS: Record<keyof IdentityAxes, { more: string; less: string }> = {
  agency: {
    more: "내가 고른다는 감각이 또렷해요",
    less: "떠밀린다는 느낌이 늘었어요",
  },
  connection: {
    more: "사람 쪽으로 기울어 있어요",
    less: "혼자 있는 쪽으로 물러나 있어요",
  },
  stability: {
    more: "중심이 더 단단해요",
    less: "더 자주 흔들려요",
  },
  openness: {
    more: "새로운 쪽으로 더 열려 있어요",
    less: "익숙한 쪽으로 닫혀 있어요",
  },
  selfKindness: {
    more: "스스로에게 더 너그러워요",
    less: "스스로에게 더 엄해요",
  },
  direction: {
    more: "가고 싶은 쪽이 더 분명해요",
    less: "방향이 더 흐릿해요",
  },
};

export type DriftBand = "same" | "slight" | "clear";

/** 이 아래면 사실상 같다고 본다. LLM 판단의 흔들림 범위. */
export const SAME_THRESHOLD = 0.08;
export const CLEAR_THRESHOLD = 0.2;

export function driftBand(delta: number): DriftBand {
  if (!Number.isFinite(delta)) return "same";
  const magnitude = Math.abs(delta);
  if (magnitude < SAME_THRESHOLD) return "same";
  if (magnitude < CLEAR_THRESHOLD) return "slight";
  return "clear";
}

/**
 * 기준 자아와 자라난 자아의 축 하나를 문장으로 옮긴다.
 * 숫자를 절대 반환하지 않는다.
 */
export function describeDrift(axis: keyof IdentityAxes, delta: number): string {
  const band = driftBand(delta);
  if (band === "same") return "기준으로 쓴 글과 거의 같아요";

  const words = DRIFT_WORDS[axis];
  const phrase = delta > 0 ? words.more : words.less;
  const prefix = band === "clear" ? "글에 쓴 모습보다 뚜렷하게" : "글에 쓴 모습보다 조금";
  return `${prefix} ${phrase}`;
}

/** 축 하나의 절대적인 세기를 문장으로. 기준 자아가 없을 때 쓴다. */
export function describeAxisLevel(axis: keyof IdentityAxes, value: number): string {
  const level = clamp01(value);
  const words = DRIFT_WORDS[axis];
  if (level < 0.34) return words.less;
  if (level > 0.66) return words.more;
  return "한쪽으로 치우치지 않았어요";
}
