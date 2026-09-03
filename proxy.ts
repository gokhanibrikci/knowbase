import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { allowRequest } from "@/lib/gate";

/**
 * The gate in front of a private deployment's human pages.
 *
 * Next 16 renamed this file convention from `middleware` to `proxy`; the shape is
 * otherwise the same. It is here rather than in each page because a prerendered page
 * never re-runs its own code at request time, and "the whole site, including the static
 * parts" is exactly the guarantee that has to hold.
 *
 * Both flags are read from the build environment: `npm run cf:deploy:private` builds with
 * PRIVATE=1 in the shell precisely because the pages are prerendered, so a private build
 * carries this decision in the bundle rather than depending on a runtime lookup that the
 * edge context may not offer.
 */
export function proxy(request: NextRequest) {
  const priv = process.env.PRIVATE === "1";
  const siteOpen = process.env.PRIVATE_SITE === "1";
  if (allowRequest(request.nextUrl.pathname, priv, siteOpen)) return NextResponse.next();
  // 404 rather than 401: a private deployment does not confirm that it is a knowbase to
  // somebody who cannot already read it.
  return new NextResponse("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
