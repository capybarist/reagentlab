import { ImageResponse } from "next/og";
import { STAGES } from "@/components/progress";

export const OG_SIZE = { width: 1200, height: 630 };

/** Tarjeta para compartir (Open Graph): papel, tinta y la barra de avance del hilo. */
export function ogCard(opts: { kicker: string; title: string; stage?: number; facts: string[] }) {
  const { kicker, title, stage, facts } = opts;
  const color = stage === undefined ? "#2f5d50" : stage >= 5 ? "#2e8b57" : stage >= 4 ? "#d4a017" : stage >= 2 ? "#2f7d4f" : "#2b5fb4";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#faf8f3",
          color: "#1d1d1b",
          padding: "64px 72px",
          fontFamily: "serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, color: "#6b6a64" }}>
          <div style={{ display: "flex", width: 22, height: 22, borderRadius: 11, background: "#2f5d50" }} />
          <span style={{ color: "#1d1d1b", fontWeight: 600 }}>Reagent Lab</span>
          <span>·</span>
          <span>{kicker}</span>
        </div>
        <div style={{ display: "flex", fontSize: title.length > 80 ? 54 : 66, fontWeight: 600, lineHeight: 1.12 }}>
          {title.length > 140 ? `${title.slice(0, 139)}…` : title}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {stage !== undefined && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8 }}>
                {STAGES.map((s, i) => (
                  <div
                    key={s.label}
                    style={{ display: "flex", flex: 1, height: 14, borderRadius: 7, background: i < stage ? color : "#e6e2d6" }}
                  />
                ))}
              </div>
              <div style={{ display: "flex", fontSize: 26, color: "#6b6a64" }}>
                {stage === 0 ? "No claims yet" : STAGES[stage - 1]!.label}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 28, fontSize: 28, color: "#6b6a64", fontFamily: "sans-serif" }}>
            {facts.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
