"use client";

import { useCallback, useEffect, useState } from "react";

export function useToast() {
  const [message, setMessage] = useState<string | null>(null);

  const show = useCallback((text: string) => setMessage(text), []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3200);
    return () => clearTimeout(timer);
  }, [message]);

  const node = message ? (
    <div className="toast" role="status">
      {message}
    </div>
  ) : null;

  return { show, node };
}
