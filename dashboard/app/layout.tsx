import type { Metadata } from "next";
import { connection } from "next/server";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "StatsArena",
    template: "%s · StatsArena",
  },
  description: "Dashboard basket multi-kompetisi StatsArena.",
  openGraph: {
    title: "StatsArena",
    description: "Dashboard basket multi-kompetisi StatsArena.",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The shell preserves query-string competition scope, so render it with the request URL.
  await connection();

  return (
    <html lang="id" className="dark">
      <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
        <ThemeProvider>
          <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
