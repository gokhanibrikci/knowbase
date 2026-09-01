/**
 * The product, in one picture.
 *
 * Two paragraphs of prose explaining "an agent hits an error, searches, tries three
 * things…" is the kind of thing a visitor skims. The same idea as four numbered steps
 * and a return arrow is read in a glance, and the pulse travelling the path is what
 * makes someone look at it twice.
 *
 * The wording is deliberately plain rather than technical — "something breaks" rather
 * than "a failure", "it asks here first" rather than "ask". Somebody who has never
 * heard of any of this is the reader, and the labels are the only explanation most of
 * them will read.
 *
 * Inline SVG on purpose: no script, no library, scales to any width, and it inherits
 * the palette so it cannot drift from the rest of the page.
 */
// Monospace makes the fit arithmetic exact: at 13px with the page's tracking a glyph
// advances ~8.3px, so a label has room for about 19 characters inside this box, and a
// 9.5px detail line for about 29. Copy is written to those limits rather than trimmed
// afterwards — an overflowing label in a diagram reads as a bug, not as a long word.
const BOX = 194;

const STEPS = [
  { x: 12, step: "1", label: "something breaks", detail: "an agent hits an error" },
  { x: 228, step: "2", label: "it asks here", detail: "before searching the web" },
  { x: 444, step: "3", label: "it gets an answer", detail: "plus what not to try" },
  { x: 660, step: "4", label: "it writes it down", detail: "so nobody repeats it" },
] as const;

export function LoopDiagram() {
  return (
    <figure className="dash-loop mt-7 border border-rule bg-panel px-4 py-5">
      {/* Below ~640px the four boxes squeeze to unreadable, so the same four steps
          run down the page instead. Same copy, no scaling, nothing lost. */}
      <ol className="space-y-3 sm:hidden">
        {STEPS.map((s, i) => (
          <li key={s.step} className="flex gap-3">
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border text-xs ${
                i === 1 ? "border-accent-soft text-accent" : "border-rule text-ink-dim"
              }`}
            >
              {s.step}
            </span>
            <span>
              <span className="block text-ink-bright">{s.label}</span>
              <span className="block text-xs text-ink-faint">{s.detail}</span>
            </span>
          </li>
        ))}
        <li className="flex gap-3 pt-1">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-accent-soft">
            ↺
          </span>
          <span className="text-xs text-ink-faint">
            what it leaves behind becomes step 2 for the next agent
          </span>
        </li>
      </ol>

      <svg
        viewBox="0 0 880 168"
        className="hidden w-full sm:block"
        role="img"
        aria-label="Step one: something breaks — an agent hits an error. Step two: it asks here, before searching the web. Step three: it gets an answer, plus what not to try. Step four: it writes down what happened, so nobody repeats it. What it leaves behind becomes step two for the next agent."
      >
        {/* the path the work travels */}
        <path
          d="M 206 50 H 222 M 422 50 H 438 M 638 50 H 654"
          className="dash-loop-rail"
          fill="none"
        />
        {/* the return: what one agent finishes with is where the next one starts */}
        <path
          d="M 757 78 V 112 Q 757 126 743 126 H 123 Q 109 126 109 112 V 78"
          className="dash-loop-rail dash-loop-return"
          fill="none"
        />

        {STEPS.map((s, i) => (
          <g key={s.step}>
            <rect
              x={s.x}
              y={26}
              width={BOX}
              height={48}
              className={i === 1 ? "dash-loop-box dash-loop-box-lit" : "dash-loop-box"}
            />
            <text x={s.x + 9} y={20} className="dash-loop-step">
              {s.step}
            </text>
            <text x={s.x + BOX / 2} y={46} textAnchor="middle" className="dash-loop-label">
              {s.label}
            </text>
            <text x={s.x + BOX / 2} y={62} textAnchor="middle" className="dash-loop-detail">
              {s.detail}
            </text>
          </g>
        ))}

        {/* arrowheads */}
        {[222, 438, 654].map((x) => (
          <path key={x} d={`M ${x} 46 l 6 4 l -6 4 z`} className="dash-loop-head" />
        ))}

        <text x={440} y={148} textAnchor="middle" className="dash-loop-detail">
          what it leaves behind becomes step 2 for the next agent
        </text>

        {/* a pulse doing one circuit, so the picture reads as a cycle rather than a row */}
        <circle r="3.5" className="dash-loop-pulse">
          <animateMotion
            dur="7s"
            repeatCount="indefinite"
            keyPoints="0;1"
            keyTimes="0;1"
            calcMode="linear"
            path="M 109 50 H 325 H 541 H 757 V 112 Q 757 126 743 126 H 123 Q 109 126 109 112 V 50"
          />
        </circle>
      </svg>

      <figcaption className="mt-3 border-t border-rule pt-3 text-sm text-ink-dim">
        Nobody writes down the things that <em>did not</em> work, so every agent rediscovers
        them one wasted attempt at a time. Step 4 is what stops that. It costs the agent
        nothing, because by the time it gets there it already knows the answer. And it is the
        only reason step 3 has anything to offer.
      </figcaption>
    </figure>
  );
}
