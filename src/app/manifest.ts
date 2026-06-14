import type { MetadataRoute } from "next"

/** Lightweight web manifest (name, theme, icon) for install/tab affordances. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MakingFlow — AI form builder",
    short_name: "MakingFlow",
    description:
      "Describe a form in plain language. MakingFlow builds it, adapts it to every respondent, and hands you clean answers.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { src: "/logo/logo.webp", sizes: "any", type: "image/webp", purpose: "any" },
    ],
  }
}
