import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** Las páginas públicas se indexan; las de cuenta, administración y login, no. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/account", "/admin", "/oauth", "/signin", "/signout", "/signup", "/api/", "/labs/*/report", "/labs/*/propose"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
