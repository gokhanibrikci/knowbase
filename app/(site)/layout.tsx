import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

/**
 * The chrome — wordmark, search, footer — belongs to every screen except the front
 * door. The door (app/page.tsx, outside this group) is deliberately bare: one name,
 * two choices.
 */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="mx-auto flex w-full max-w-[76rem] flex-1 flex-col px-5 sm:px-8">
      <SiteHeader />
      <main className="flex-1 pb-16">{children}</main>
      <SiteFooter />
    </div>
  );
}
