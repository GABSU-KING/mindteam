import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { SetupNotice } from "@/components/SetupNotice";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/agents");

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-logo">마인드팀</h1>
        <p className="auth-tag">
          마음속 감정들이 서로 대화합니다. 당신은 그 대화를 지켜보다 끼어듭니다.
        </p>
        <LoginForm appleEnabled={process.env.NEXT_PUBLIC_ENABLE_APPLE_LOGIN === "true"} />
      </div>
    </div>
  );
}
