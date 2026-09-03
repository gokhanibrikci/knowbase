import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";

import { site, isPrivate } from "@/lib/site";

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
  /**
   * Snippet limits are the one documented lever over how deeply an AI answer engine may
   * quote a page: Microsoft's webmaster guidelines say NOSNIPPET and NOCACHE reduce
   * Copilot citation depth and answer quality. The inverse has to be stated on the
   * generic directive, not only for Googlebot — Bing and the rest read this one.
   */
  // A private deployment is not indexed by anything; robots.ts says the same to crawlers.
  robots: isPrivate()
    ? { index: false, follow: false, googleBot: { index: false, follow: false } }
    : {
        index: true,
        follow: true,
        "max-snippet": -1,
        "max-image-preview": "large",
        "max-video-preview": -1,
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
