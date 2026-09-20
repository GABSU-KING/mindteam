"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/** 브라우저용 Supabase 클라이언트. Realtime 구독과 본인 데이터 읽기/쓰기에만 쓴다. */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
