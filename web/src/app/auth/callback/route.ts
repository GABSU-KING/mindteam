import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** 메일 링크 / OAuth 로 돌아오는 자리. 코드를 세션으로 바꾼다. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/agents";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", url.origin));
}
