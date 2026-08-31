import { Inter } from "next/font/google";

/**
 * Platform font.
 *
 * Inter, and only Inter — exposed as `--font-sans` (Tailwind `font-sans`),
 * which `<html>` carries, so everything inherits it unless it says otherwise.
 * The variable is attached in src/app/layout.tsx and wired into the Tailwind
 * theme in src/app/globals.css.
 */
export const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  display: "swap",
  variable: "--font-sans",
});
