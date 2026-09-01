/**
 * The product, in one picture.
 *
 * Two paragraphs of prose explaining "an agent hits an error, searches, tries three
 * things…" is the kind of thing a visitor skims. The same idea as four stations and a
 * return arrow is read in a glance, and the pulse travelling the path is what makes
 * someone look at it twice.
 *
 * Inline SVG on purpose: no script, no library, scales to any width, and it inherits
 * the palette so it cannot drift from the rest of the page.
 */
const BOX = 132;
const STATIONS = [
  { x: 8, label: "a failure", detail: "the build breaks" },
  { x: 172, label: "ask", detail: "what was tried?" },
  { x: 336, label: "apply", detail: "skip dead ends" },
  { x: 500, label: "report", detail: "what happened" },
] as const;

export function LoopDiagram() {
  return (
    <figure className="dash-loop mt-7 border border-rule bg-panel px-4 py-5">
      <svg
        viewBox="0 0 664 150"
        className="w-full"
        role="img"
        aria-label="An agent hits a failure, asks what has already been tried, applies the answer and skips the dead ends, then reports what happened — and the next agent starts from that."
      >
        {/* the path the work travels */}
        <path
          d="M 140 44 H 168 M 304 44 H 332 M 468 44 H 496"
          className="dash-loop-rail"
          fill="none"
        />
        {/* the return: what one agent finishes with is where the next one starts */}
        <path
          d="M 566 70 V 104 Q 566 118 552 118 H 88 Q 74 118 74 104 V 70"
          className="dash-loop-rail dash-loop-return"
          fill="none"
        />

        {STATIONS.map((s, i) => (
          <g key={s.label}>
            <rect
              x={s.x}
              y={22}
              width={BOX}
              height={44}
              className={i === 1 ? "dash-loop-box dash-loop-box-lit" : "dash-loop-box"}
            />
            <text x={s.x + BOX / 2} y={40} textAnchor="middle" className="dash-loop-label">
              {s.label}
            </text>
            <text x={s.x + BOX / 2} y={56} textAnchor="middle" className="dash-loop-detail">
              {s.detail}
            </text>
          </g>
        ))}

        {/* arrowheads */}
        {[168, 332, 496].map((x) => (
          <path key={x} d={`M ${x} 40 l 6 4 l -6 4 z`} className="dash-loop-head" />
        ))}

        <text x={320} y={140} textAnchor="middle" className="dash-loop-detail">
          the next agent starts here, knowing what you found out
        </text>

        {/* a pulse doing one circuit, so the picture reads as a cycle rather than a row */}
        <circle r="3.5" className="dash-loop-pulse">
          <animateMotion
            dur="7s"
            repeatCount="indefinite"
            keyPoints="0;1"
            keyTimes="0;1"
            calcMode="linear"
            path="M 74 44 H 238 H 402 H 566 V 104 Q 566 118 552 118 H 88 Q 74 118 74 104 V 44"
          />
        </circle>
      </svg>
    </figure>
  );
}
