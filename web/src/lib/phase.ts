/**
 * 대화 라운드의 전체 상태.
 * 서버와 클라이언트가 같은 문구를 쓰도록 여기 모아 둔다 (`server-only` 아님).
 */

export type DialoguePhase =
  /** 아무 호출도 돌지 않는다. 감정들이 쉬고 있다. */
  | "resting"
  /** 사용자 발화를 분석하는 중 (/api/intervene). */
  | "listening"
  /** 발화를 생성하는 중 (/api/dialogue). */
  | "thinking";

export const DIALOGUE_PHASE_LABEL: Record<DialoguePhase, string> = {
  resting: "감정들이 쉬고 있어요",
  listening: "감정들이 듣고 있어요",
  thinking: "감정들이 생각하고 있어요",
};
