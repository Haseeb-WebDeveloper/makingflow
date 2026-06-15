import "./globals.css";
import type { Metadata, Viewport } from "next";
import { cn } from "@/lib/utils";
import { inter, sebenta } from "@/style/font";
import { ThemeProvider } from "@/components/theme-provider";
import { AnchoredToastProvider, ToastProvider } from "@/components/ui/toast";
import { Suspense } from "react";

// Absolute base for OG/canonical URLs — without this, og:image paths can't
// resolve and social previews break. Set NEXT_PUBLIC_SITE_URL to the real origin
// in production (it's localhost in dev).
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://makingflow.com";

const TITLE = "MakingFlow: AI form builder";
const DESCRIPTION =
  "Describe a form in plain language. MakingFlow builds it, adapts it to every respondent, and hands you clean, summarized answers.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "MakingFlow",
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "MakingFlow",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      { url: "/og.png", width: 1080, height: 607, alt: "MakingFlow: build forms that think." },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "scrollbar-thin h-full antialiased font-sans",
        inter.variable,
        sebenta.variable,
      )}
      suppressHydrationWarning
    >
      <body className="antialiased " suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          // enableSystem
          disableTransitionOnChange
        >
          <ToastProvider>
            <AnchoredToastProvider>
              {/* Boundary for async layouts (auth) under Cache Components — see blocking-route */}
              <Suspense fallback={null}>
                <main>{children}</main>
              </Suspense>
            </AnchoredToastProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
