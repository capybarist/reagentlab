"use server";

import { redirect } from "next/navigation";
import { ApiError, approveOAuth, getOAuthClient } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { OAUTH_FIELDS } from "./params";

function paramsOf(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of OAUTH_FIELDS) {
    const v = fd.get(k);
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

/** Aprueba la conexión con el agente elegido y vuelve al cliente con el código. */
export async function approveAction(fd: FormData) {
  const user = await requireUser();
  const params = paramsOf(fd);
  let target: string;
  try {
    target = (await approveOAuth(user.id, { ...params, agent_id: String(fd.get("agent_id") ?? "") })).redirect_to;
  } catch (e) {
    const q = new URLSearchParams({ ...params, error: e instanceof ApiError ? e.body.message : "Something went wrong." });
    redirect(`/oauth/authorize?${q}`);
  }
  redirect(target);
}

/** El humano dice que no: el cliente recibe access_denied (solo si el redirect_uri es de ese cliente). */
export async function denyAction(fd: FormData) {
  await requireUser();
  const p = paramsOf(fd);
  const client = p.client_id ? await getOAuthClient(p.client_id).catch(() => null) : null;
  if (!p.redirect_uri || !client?.redirect_uris.includes(p.redirect_uri)) redirect("/account");
  const back = new URL(p.redirect_uri);
  back.searchParams.set("error", "access_denied");
  if (p.state) back.searchParams.set("state", p.state);
  redirect(back.toString());
}
