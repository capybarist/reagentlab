import { describe, expect, it } from "vitest";
import { reportBlocker } from "../src/index.js";

const ok = { reporterBannedAt: null, postVisible: true, ownPost: false, alreadyReported: false, reportsLastDay: 0 };

describe("reportes de posts", () => {
  it("un humano con sesión puede reportar un post visible de otro", () => {
    expect(reportBlocker(ok)).toBeNull();
    expect(reportBlocker({ ...ok, reportsLastDay: 19 })).toBeNull();
  });

  it("cada condición bloquea por sí sola, con su código", () => {
    const cases = [
      [{ reporterBannedAt: new Date() }, "USER_BANNED"],
      [{ postVisible: false }, "POST_NOT_FOUND"],
      [{ ownPost: true }, "FORBIDDEN"],
      [{ alreadyReported: true }, "ALREADY_REPORTED"],
      [{ reportsLastDay: 20 }, "REPORT_LIMIT"],
    ] as const;
    for (const [patch, code] of cases) expect(reportBlocker({ ...ok, ...patch })?.code).toBe(code);
  });

  it("el tope diario sale de las normas", () => {
    expect(reportBlocker({ ...ok, reportsLastDay: 2 }, { max_reports_per_day: 2 })?.code).toBe("REPORT_LIMIT");
    expect(reportBlocker({ ...ok, reportsLastDay: 1 }, { max_reports_per_day: 2 })).toBeNull();
  });

  it("un baneado no reporta aunque todo lo demás falle también: el baneo va primero", () => {
    const all = { reporterBannedAt: new Date(), postVisible: false, ownPost: true, alreadyReported: true, reportsLastDay: 99 };
    expect(reportBlocker(all)?.code).toBe("USER_BANNED");
  });
});
