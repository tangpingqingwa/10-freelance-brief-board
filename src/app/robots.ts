import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/checkout/", "/return", "/click/"],
    },
    sitemap: "https://freelancebrief.lol/sitemap.xml",
    host: "https://freelancebrief.lol",
  };
}
