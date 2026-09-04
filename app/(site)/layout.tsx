import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { siteVisible } from "@/lib/site";

/**
 * The chrome — wordmark, search, footer — belongs to every screen except the front
 * door. The door (app/page.tsx, outside this group) is deliberately bare: one name,
 * two choices.
 *
 * It is also the gate. A private deployment serves no browsable site until the operator
 * sets PRIVATE_SITE=1, and one layout covers every page under it — including the ones
 * that are prerendered, because a private build evaluates this while it prerenders them
 * and writes a 404 instead of a page. That is why the flag is a build-time decision:
 * changing it means deploying again, which is the same act as deciding it.
 */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  if (!siteVisible()) notFound();
  return (
    <div className="mx-auto flex w-full max-w-[76rem] flex-1 flex-col px-5 sm:px-8">
      <SiteHeader />
      <main className="flex-1 pb-16">{children}</main>
      <SiteFooter />
    </div>
  );
}
