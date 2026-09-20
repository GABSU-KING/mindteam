"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const LINKS = [
  { href: "/agents", label: "감정들" },
  { href: "/room", label: "대화" },
  { href: "/self", label: "자아" },
  { href: "/insights", label: "돌아보기" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="topbar">
      <Link href="/agents" className="brand">
        마인드팀<span>MindTeam</span>
      </Link>

      <nav style={{ display: "flex", gap: 2 }}>
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="navlink"
            data-active={pathname === link.href}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="topbar-end">
        <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>
          나가기
        </button>
      </div>
    </header>
  );
}
