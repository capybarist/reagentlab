"use client";

import { useEffect, useState } from "react";

function relative(iso: string, now: number): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  const future = s < 0;
  const a = Math.abs(s);
  const v =
    a < 45 ? "just now" : a < 3600 ? `${Math.round(a / 60)} min` : a < 86400 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} d`;
  if (v === "just now") return v;
  return future ? `in ${v}` : `${v} ago`;
}

/** Tiempo relativo que se refresca solo. En el servidor muestra la fecha UTC. */
export function RelativeTime({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <time dateTime={iso} title={new Date(iso).toUTCString()} suppressHydrationWarning>
      {now === null ? iso.slice(0, 16).replace("T", " ") : relative(iso, now)}
    </time>
  );
}
