import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";

import { site } from "@/lib/site";

import "./globals.css";

// A true terminal face: rectangular counters, visible slab terminals, wide sidebearings.
const terminal = IBM_Plex_Mono({
  variable: "--font-terminal",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.title, template: `%s — ${site.name}` },
  description: site.description,
  applicationName: site.name,
  generator: `${site.name} ${site.version}`,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: site.name,
    title: site.title,
    description: site.description,
    url: site.url,
    locale: site.locale,
  },
  twitter: {
    card: "summary",
    title: site.title,
    description: site.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-snippet": -1 },
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${terminal.variable} h-full`}>
      {/* Screen chrome lives in app/(site)/layout.tsx; the front door renders bare. */}
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
