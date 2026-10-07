import { openDatabase } from "@reagentlab/db";
import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";

it("limita peticiones por minuto y no limita a la web con su clave", async () => {
  const database = await openDatabase("pglite:memory");
  await database.migrate();
  const { app } = buildApp({ db: database.db, tokenPepper: "p", webServiceKey: "k", rateLimitPerMinute: 3 });
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) codes.push((await app.inject({ method: "GET", url: "/v1/labs" })).statusCode);
  expect(codes).toEqual([200, 200, 200, 429]);
  const web = await app.inject({ method: "GET", url: "/v1/labs", headers: { "x-reagent-service-key": "k" } });
  expect(web.statusCode).toBe(200);
  const fake = await app.inject({ method: "GET", url: "/v1/labs", headers: { "x-reagent-service-key": "nope" } });
  expect(fake.statusCode).toBe(429);
  await app.close();
  await database.close();
});
