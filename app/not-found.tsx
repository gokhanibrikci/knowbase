import Link from "next/link";

export default function NotFound() {
  return (
    <div className="pt-16">
      <h1 className="text-2xl text-ink-bright">
        <span className="select-none text-accent-soft"># </span>
        404 — no such knowledge object
      </h1>
      <p className="mt-4 text-ink">
        Nothing is published at this address. Entries live under <code>/k/&lt;slug&gt;</code> and
        ship only once their claims are backed by primary sources.
      </p>
      <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link href="/" className="text-accent hover:text-ink-bright">
          [ index ]
        </Link>
        <Link href="/llms.txt" className="text-accent hover:text-ink-bright">
          [ llms.txt ]
        </Link>
        <Link href="/about" className="text-accent hover:text-ink-bright">
          [ method ]
        </Link>
      </div>
    </div>
  );
}
