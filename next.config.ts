import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /k/<slug>.json is the URL an agent guesses; /k/<slug>/json is what the router
  // can express. The rewrite keeps the guessable form as the one we publish.
  async rewrites() {
    return [
      { source: "/k/:slug.json", destination: "/k/:slug/json" },
      { source: "/k/:slug.md", destination: "/k/:slug/md" },
      { source: "/k/:slug.txt", destination: "/k/:slug/txt" },
    ];
  },
};

export default nextConfig;
