import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * 서버(Server Component / Route Handler)용 Supabase 클라이언트.
 * service_role 키는 쓰지 않는다 — 사용자 세션으로 붙어서 RLS 가 그대로 적용되게 한다.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component 에서 호출된 경우 쿠키를 못 쓴다. 미들웨어가 갱신을 담당한다.
        }
      },
    },
  });
}

/** 로그인한 사용자를 요구한다. 없으면 null. */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}
