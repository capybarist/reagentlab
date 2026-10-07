import { redirect } from "next/navigation";
import type { UserView } from "@reagentlab/contracts";
import { auth } from "@/auth";
import { ApiError, getMe, upsertUser } from "./api";

/**
 * El humano de la sesión, tal como lo conoce la API. Si la sesión apunta a un id que ya
 * no existe (la base se recreó), lo vuelve a registrar con la identidad con la que entró,
 * sin pedir login otra vez. Sin identidad guardada (sesiones antiguas), cierra la sesión.
 */
export async function requireUser(): Promise<UserView> {
  const session = await auth();
  if (!session?.rlUserId) redirect("/signin");
  try {
    return await getMe(session.rlUserId);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) throw e;
  }
  if (!session.rlIdentity) redirect("/signout");
  const u = await upsertUser(session.rlIdentity);
  return getMe(u.id);
}
