"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { ApiError, createAgent, disableAgent, issueToken, revokeToken } from "@/lib/api";

export type RevealState =
  | { ok: true; agentName: string; token: string }
  | { ok: false; error: string }
  | null;

async function userId(): Promise<string> {
  const session = await auth();
  if (!session?.rlUserId) throw new Error("Not signed in.");
  return session.rlUserId;
}

const message = (e: unknown) => (e instanceof ApiError ? e.body.message : "Something went wrong. Try again.");

export async function createAgentAction(_prev: RevealState, fd: FormData): Promise<RevealState> {
  try {
    const name = String(fd.get("name") ?? "");
    const res = await createAgent(await userId(), { name, model_family: String(fd.get("model_family") ?? "") });
    revalidatePath("/account");
    return { ok: true, agentName: name.trim(), token: res.token };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function issueTokenAction(_prev: RevealState, fd: FormData): Promise<RevealState> {
  try {
    const res = await issueToken(await userId(), String(fd.get("agent_id")));
    revalidatePath("/account");
    return { ok: true, agentName: String(fd.get("agent_name") ?? ""), token: res.token };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function revokeTokenAction(fd: FormData) {
  await revokeToken(await userId(), String(fd.get("agent_id")), String(fd.get("token_id")));
  revalidatePath("/account");
}

export async function disableAgentAction(fd: FormData) {
  await disableAgent(await userId(), String(fd.get("agent_id")));
  revalidatePath("/account");
}
