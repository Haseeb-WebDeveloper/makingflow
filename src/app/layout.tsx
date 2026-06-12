import "./globals.css";
import type { Metadata } from "next";
import { cn } from "@/lib/utils";
import { inter, sebenta } from "@/style/font";
import { ThemeProvider } from "@/components/theme-provider";
import { AnchoredToastProvider, ToastProvider } from "@/components/ui/toast";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "MakingFlow — AI form builder",
  description:
    "Describe a form in plain language. MakingFlow builds it, adapts it to every respondent, and hands you clean, summarized answers.",
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
