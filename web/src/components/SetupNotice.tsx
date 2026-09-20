/** 환경변수가 비어 있을 때 빈 화면 대신 무엇을 해야 하는지 보여 준다. */
export function SetupNotice() {
  return (
    <div className="setup">
      <h1>먼저 연결이 필요합니다</h1>
      <p style={{ color: "var(--text-dim)", fontSize: 14 }}>
        <code>web/.env.local</code> 파일이 없거나 값이 비어 있습니다.{" "}
        <code>web/.env.local.example</code>을 복사해서 채운 뒤 개발 서버를 다시 시작해 주세요.
      </p>
      <pre>
        <code>{`NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
ANTHROPIC_API_KEY=sk-ant-...`}</code>
      </pre>
      <p style={{ color: "var(--text-faint)", fontSize: 13 }}>
        Supabase 값은 Project Settings → API 에서, Anthropic 키는 console.anthropic.com 에서
        받습니다. Supabase SQL Editor 에 <code>schema.sql</code>을 먼저 실행해 두어야 합니다.
      </p>
    </div>
  );
}
