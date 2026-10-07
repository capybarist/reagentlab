import { signOut } from "@/auth";

/**
 * Cierra la sesión y vuelve al login. La usa la cuenta cuando la sesión apunta a un
 * usuario que la API ya no conoce (p. ej. tras borrar la base de datos local).
 */
export async function GET() {
  await signOut({ redirectTo: "/signin?expired=1" });
}
