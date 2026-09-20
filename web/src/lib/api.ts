import "server-only";

import { NextResponse } from "next/server";
import { AnthropicNotConfiguredError } from "@/lib/anthropic";

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export const UNAUTHORIZED = () => fail("로그인이 필요합니다.", 401);

/** 라우트에서 새어 나온 예외를 사용자에게 보여줄 한국어 문장으로 바꾼다. */
export function handleRouteError(error: unknown) {
  if (error instanceof AnthropicNotConfiguredError) {
    return fail(error.message, 503);
  }
  console.error(error);
  const message =
    error instanceof Error ? error.message : "알 수 없는 문제가 생겼습니다.";
  return fail(message, 500);
}

/** mental_scores 의 date 컬럼용. 서버 시간대와 무관하게 한국 날짜를 쓴다. */
export function todaySeoul(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}
