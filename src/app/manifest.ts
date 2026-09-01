import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Freelance Brief",
    short_name: "Freelance Brief",
    description: "A transparent rolling seven-day freelance job-ticket board.",
    start_url: "/",
    display: "standalone",
    background_color: "#3a332c",
    theme_color: "#b42318",
    icons: [{ src: "/brand-mark.png", sizes: "512x512", type: "image/png" }],
  };
}
