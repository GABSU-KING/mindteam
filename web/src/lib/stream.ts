/**
 * `/api/dialogue` 가 흘려보내는 이벤트.
 *
 * 발화는 순차 생성이라 한 라운드가 수 초 걸린다. 그동안 누가 생각 중이고 누가 쉬는지,
 * 어떤 모델이 얼마나 토큰을 쓰는지 화면에 보여 주려면 진행 상황이 실시간으로 넘어와야 한다.
 * 그래서 JSON 한 덩어리가 아니라 NDJSON(줄 단위 JSON) 스트림으로 내려보낸다.
 *
 * 서버와 클라이언트가 같은 타입을 쓰므로 `server-only` 를 붙이지 않는다.
 */

import type { AgentMessage } from "@/lib/types";
import type { TokenUsage } from "@/lib/usage";

export type DialogueEvent =
  /** 발화자 추첨이 끝났다. 여기 없는 감정은 이번 라운드에 쉰다. */
  | { type: "start"; model: string; speakerIds: string[] }
  /** 이 감정이 지금 말을 고르는 중이다. */
  | { type: "thinking"; agentId: string }
  /** 발화가 완성돼 저장됐다. */
  | { type: "message"; message: AgentMessage; usage: TokenUsage; model: string }
  /** 이 감정은 이번에 입을 열지 못했다 (생성 실패 등). 라운드는 계속된다. */
  | { type: "skipped"; agentId: string; reason: string }
  /** 라운드 종료. usage 는 이 라운드 전체 합계. */
  | { type: "done"; usage: TokenUsage; model: string; elapsedMs: number }
  /** 라운드 전체가 실패했다. */
  | { type: "error"; message: string };

export const NDJSON_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

/**
 * NDJSON 스트림을 읽어 이벤트를 하나씩 넘긴다.
 * 줄이 청크 경계에 걸쳐 잘리는 경우를 버퍼로 처리한다.
 */
export async function readDialogueStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: DialogueEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    // 마지막 조각은 아직 줄이 안 끝났을 수 있으니 버퍼에 남긴다.
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        onEvent(JSON.parse(trimmed) as DialogueEvent);
      } catch {
        // 깨진 줄 하나 때문에 라운드 전체를 버리지는 않는다.
        console.warn("대화 스트림에서 읽을 수 없는 줄을 건너뜁니다", trimmed);
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    flush(decoder.decode(value, { stream: true }));
  }
  flush(decoder.decode());

  const tail = buffer.trim();
  if (tail) {
    try {
      onEvent(JSON.parse(tail) as DialogueEvent);
    } catch {
      console.warn("대화 스트림의 마지막 줄이 잘렸습니다", tail);
    }
  }
}
