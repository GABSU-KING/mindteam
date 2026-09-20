"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "magic";

export function LoginForm({ appleEnabled }: { appleEnabled: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);

    const supabase = createClient();

    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${location.origin}/auth/callback` },
        });
        if (error) throw error;
        setNotice("메일로 로그인 링크를 보냈습니다. 받은 편지함을 확인해 주세요.");
        return;
      }

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/auth/callback` },
        });
        if (error) throw error;
        if (!data.session) {
          setNotice("확인 메일을 보냈습니다. 메일의 링크를 눌러 가입을 마쳐 주세요.");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }

      router.replace("/agents");
      router.refresh();
    } catch (err) {
      setError(translate(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleApple() {
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) {
      setError(translate(error));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="tabs">
        <button type="button" data-active={mode === "signin"} onClick={() => setMode("signin")}>
          로그인
        </button>
        <button type="button" data-active={mode === "signup"} onClick={() => setMode("signup")}>
          처음이에요
        </button>
        <button type="button" data-active={mode === "magic"} onClick={() => setMode("magic")}>
          메일 링크
        </button>
      </div>

      {error && <div className="msg-error">{error}</div>}
      {notice && <div className="msg-ok">{notice}</div>}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="email">이메일</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        {mode !== "magic" && (
          <div className="field">
            <label htmlFor="password">비밀번호</label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="6자 이상"
            />
          </div>
        )}

        <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>
          {busy
            ? "잠시만요..."
            : mode === "signup"
              ? "가입하고 감정 만나기"
              : mode === "magic"
                ? "로그인 링크 받기"
                : "들어가기"}
        </button>
      </form>

      {appleEnabled && (
        <button
          type="button"
          className="btn"
          style={{ width: "100%", marginTop: 10 }}
          onClick={handleApple}
          disabled={busy}
        >
           Apple로 계속하기
        </button>
      )}

      <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 20, lineHeight: 1.7 }}>
        처음 가입하면 기본 감정 다섯이 먼저 자리를 잡습니다. 나중에 언제든 들이거나 보낼 수
        있어요.
      </p>
    </>
  );
}

/** Supabase 가 돌려주는 영어 메시지를 사람 말로 바꾼다. */
function translate(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (/Invalid login credentials/i.test(message)) {
    return "이메일이나 비밀번호가 맞지 않습니다.";
  }
  if (/User already registered/i.test(message)) {
    return "이미 가입된 이메일입니다. '로그인'으로 들어와 주세요.";
  }
  if (/Email not confirmed/i.test(message)) {
    return "메일 확인이 아직 안 됐습니다. 받은 편지함의 링크를 눌러 주세요.";
  }
  if (/Password should be at least/i.test(message)) {
    return "비밀번호는 6자 이상이어야 합니다.";
  }
  if (/rate limit|too many/i.test(message)) {
    return "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (/provider is not enabled/i.test(message)) {
    return "이 로그인 방식이 아직 켜져 있지 않습니다. Supabase에서 활성화해 주세요.";
  }
  return message;
}
