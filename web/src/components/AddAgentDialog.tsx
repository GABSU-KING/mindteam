"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeUsage, type TokenUsage } from "@/lib/usage";

const EMOJI_CHOICES = ["✨", "🌙", "🍃", "🔮", "🎈", "🕯️", "🌱", "⚡"];

export function AddAgentDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string, meta: { model: string; usage: TokenUsage }) => void;
}) {
  const [name, setName] = useState("");
  const [roleLine, setRoleLine] = useState("");
  const [emoji, setEmoji] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), roleLine: roleLine.trim(), emoji }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "감정을 들이지 못했습니다.");
      onCreated(name.trim(), {
        model: typeof payload.model === "string" ? payload.model : "알 수 없음",
        usage: normalizeUsage(payload.usage),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "감정을 들이지 못했습니다.");
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="감정 들이기">
        <h2>감정 들이기</h2>
        <p>이름과 한 줄만 적어 주세요. 말투와 성격은 알아서 지어집니다.</p>

        {error && <div className="msg-error">{error}</div>}

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="agent-name">이름</label>
            <input
              id="agent-name"
              ref={firstFieldRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={10}
              required
              placeholder="호기심"
            />
          </div>

          <div className="field">
            <label htmlFor="agent-role">한 줄 역할</label>
            <input
              id="agent-role"
              value={roleLine}
              onChange={(e) => setRoleLine(e.target.value)}
              maxLength={60}
              required
              placeholder="모르는 걸 그냥 지나치지 못합니다"
            />
          </div>

          <div className="field">
            <label>이모지 (고르지 않으면 알아서 붙습니다)</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {EMOJI_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setEmoji(emoji === choice ? "" : choice)}
                  style={{
                    borderColor: emoji === choice ? "var(--accent)" : undefined,
                    padding: "6px 10px",
                  }}
                >
                  {choice}
                </button>
              ))}
            </div>
          </div>

          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              그만두기
            </button>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "성격을 짓는 중..." : "들이기"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
