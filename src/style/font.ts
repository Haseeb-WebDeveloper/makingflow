import { Inter } from "next/font/google";
import localFont from "next/font/local";

/**
 * Platform fonts.
 *
 * - `inter` — the body/UI sans. Exposed as `--font-sans` (Tailwind `font-sans`).
 * - `sebenta` — a local display/heading font. Exposed as `--font-sebenta`
 *   (Tailwind `font-sebenta`). Files live in public/font/sebenta/.
 *
 * Both variables are attached to <html> in src/app/layout.tsx and wired into
 * the Tailwind theme in src/app/globals.css.
 */
export const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  display: "swap",
  variable: "--font-sans",
});

export const sebenta = localFont({
  // Paths are resolved relative to this file (src/style/).
  src: [
    { path: "../../public/font/sebenta/sebenta-light.otf", weight: "300", style: "normal" },
    { path: "../../public/font/sebenta/sebenta-light-italic.otf", weight: "300", style: "italic" },
    { path: "../../public/font/sebenta/sebenta-regular.otf", weight: "400", style: "normal" },
    { path: "../../public/font/sebenta/sebenta-regular-italic.otf", weight: "400", style: "italic" },
    { path: "../../public/font/sebenta/sebenta-medium.otf", weight: "500", style: "normal" },
    { path: "../../public/font/sebenta/sebenta-medium-italic.otf", weight: "500", style: "italic" },
    { path: "../../public/font/sebenta/sebenta-semibold.otf", weight: "600", style: "normal" },
    { path: "../../public/font/sebenta/sebenta-semibold-italic.otf", weight: "600", style: "italic" },
    { path: "../../public/font/sebenta/sebenta-bold.otf", weight: "700", style: "normal" },
    { path: "../../public/font/sebenta/sebenta-bold-italic.otf", weight: "700", style: "italic" },
    { path: "../../public/font/sebenta/sebenta-heavy.otf", weight: "800", style: "normal" },
    { path: "../../public/font/sebenta/sebenta-heavy-italic.otf", weight: "800", style: "italic" },
  ],
  display: "swap",
  variable: "--font-sebenta",
});
