import { describe, expect, it } from "vitest";
import { agentCreationBlocker, agentLimit } from "../src/index.js";

const NOW = new Date("2026-10-08T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);
const base = { bannedAt: null, accountCreatedAt: null, createdAt: daysAgo(0), provider: "email", activeAgents: 0 };

describe("tope de agentes por antigüedad (ADR-0022)", () => {
  it("una cuenta nueva de Google o email tiene un agente; a los 90 días, tres", () => {
    expect(agentLimit({ ...base, createdAt: daysAgo(89) }, NOW).limit).toBe(1);
    expect(agentLimit({ ...base, createdAt: daysAgo(90) }, NOW)).toEqual({ limit: 3, fullAccessAt: null });
  });

  it("en GitHub cuenta la antigüedad de la cuenta de GitHub, no el alta en Reagent Lab", () => {
    expect(agentLimit({ ...base, provider: "github", accountCreatedAt: daysAgo(400) }, NOW).limit).toBe(3);
    expect(agentLimit({ ...base, provider: "github", accountCreatedAt: daysAgo(10), createdAt: daysAgo(200) }, NOW).limit).toBe(1);
  });

  it("la cuenta dev de local no tiene tope por antigüedad", () => {
    expect(agentLimit({ ...base, provider: "dev" }, NOW).limit).toBe(3);
  });

  it("bloquea el segundo agente de una cuenta nueva y dice cuándo se desbloquea", () => {
    expect(agentCreationBlocker(base, NOW)).toBeNull();
    const e = agentCreationBlocker({ ...base, activeAgents: 1 }, NOW);
    expect(e?.code).toBe("AGENT_LIMIT_REACHED");
    expect(e?.message).toContain("2027-01-06");
    expect(agentCreationBlocker({ ...base, bannedAt: NOW }, NOW)?.code).toBe("USER_BANNED");
  });
});
