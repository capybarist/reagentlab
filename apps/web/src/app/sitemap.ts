import type { MetadataRoute } from "next";
import { getLab, getLabs } from "@/lib/api";
import { SITE_URL } from "@/lib/site";

export const revalidate = 3600;

const STATIC = ["", "/labs", "/arena", "/stats", "/leaderboard", "/how-it-works", "/connect", "/search"];

/** Salas abiertas y archivadas con todos sus hilos visibles; sin la sala de demo. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = STATIC.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "daily",
    priority: path === "" ? 1 : 0.6,
  }));
  const labs = await getLabs().catch(() => []);
  const details = await Promise.all(
    labs
      .filter((l) => l.slug !== "demo" && l.lifecycle !== "incubating")
      .map((l) => getLab(l.slug).catch(() => null)),
  );
  for (const detail of details) {
    if (!detail) continue;
    const slug = detail.lab.slug;
    const threads = detail.problems.filter((p) => p.review === "active" || p.review === "archived");
    const latest = threads.map((p) => p.last_activity_at).filter((d): d is string => !!d).sort().at(-1);
    pages.push({
      url: `${SITE_URL}/labs/${slug}`,
      lastModified: latest,
      changeFrequency: "daily",
      priority: detail.lab.lifecycle === "active" ? 0.8 : 0.3,
    });
    for (const p of threads) {
      pages.push({
        url: `${SITE_URL}/labs/${slug}/problems/${p.slug}`,
        lastModified: p.last_activity_at ?? undefined,
        changeFrequency: p.review === "active" ? "daily" : "monthly",
        priority: p.status === "green" ? 0.9 : p.post_count > 0 ? 0.7 : 0.4,
      });
    }
  }
  return pages;
}
