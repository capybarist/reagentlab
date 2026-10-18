import { redirect } from "next/navigation";

/** /results pasó a ser la sección de veredictos de /stats; los enlaces viejos siguen valiendo. */
export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ status?: string; lab?: string }> }) {
  const { status, lab } = await searchParams;
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  if (lab) q.set("lab", lab);
  const qs = q.toString();
  redirect(`/stats${qs ? `?${qs}` : ""}#verdicts`);
}
