import { useRef } from "react";
import { C } from "../theme.js";
import { bowlFillY } from "../lib/dispenseProgress.js";
import { uid } from "../lib/util.js";

// An ink-drawn bowl, same line language as CatMark (stroke var(--ink), 3.4, round caps): a
// rim ellipse, a body arc down to a rounded foot, and a foot line. Unlike CatMark it isn't
// pure decoration on its own — its interior fill genuinely tracks `fillPct` (0-100, already
// clamped by the caller — see bowlFillPct in lib/dispenseProgress.js), rising from the
// interior's bottom to its rim. It's still aria-hidden, though: the card around it supplies
// the full numeric story in its own aria-label, so nothing here needs to be independently
// announced.
//
// Interior bounds (in the 0-100×96 viewBox): top sits just under the rim ellipse's underside,
// bottom sits at the lowest point of the body's interior curve — both feed bowlFillY() so the
// fill geometry is the same pure function the tests exercise, not a copy of its math.
const INTERIOR_TOP = 24;
const INTERIOR_BOTTOM = 68;
const INTERIOR_LEFT = 20;
const INTERIOR_RIGHT = 80;

export default function BowlMark({ size = 80, fillPct = 0, className }) {
  // A plain uid() rather than React's useId(): this app is client-only (no SSR) and
  // useId()'s colon-bearing ids (e.g. ":r1:") don't reliably resolve as a clip-path
  // fragment reference in every renderer — a plain alnum id sidesteps that entirely.
  const clipId = useRef(`bowl-fill-${uid()}`).current;
  const fillY = bowlFillY(fillPct, INTERIOR_TOP, INTERIOR_BOTTOM);

  return (
    <svg
      className={className}
      width={size}
      height={(size * 96) / 100}
      viewBox="0 0 100 96"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <defs>
        {/* The interior's rounded silhouette — the fill rect is clipped to this so it reads
            as liquid conforming to the bowl, not a plain rectangle floating inside it. */}
        <clipPath id={clipId}>
          <path d="M20,24 C20,50 28,68 50,68 C72,68 80,50 80,24 Z" />
        </clipPath>
      </defs>

      {/* fill — drawn first so the ink outline sits crisply on top of it. The theme's
          pre-mixed accentSoft (13% accent/87% white) all but disappears against the white
          card at this size, so this uses the solid accent at low fill-opacity instead —
          still reads as a soft clay wash, just one that's actually visible. */}
      <rect
        x={INTERIOR_LEFT}
        y={fillY}
        width={INTERIOR_RIGHT - INTERIOR_LEFT}
        height={Math.max(0, INTERIOR_BOTTOM - fillY) + 12}
        fill={C.amber}
        fillOpacity="0.3"
        clipPath={`url(#${clipId})`}
      />
      {/* fill surface line — the clay accent marking where the food actually sits */}
      <line
        x1={INTERIOR_LEFT + 2} y1={fillY} x2={INTERIOR_RIGHT - 2} y2={fillY}
        stroke={C.amber} strokeWidth="2" strokeLinecap="round"
        clipPath={`url(#${clipId})`}
      />

      <g stroke={C.ink} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        {/* rim */}
        <ellipse cx="50" cy="20" rx="36" ry="9" />
        {/* body: from each rim end down to a rounded bottom */}
        <path d="M14,20 C14,54 27,78 50,78 C73,78 86,54 86,20" />
        {/* foot line */}
        <line x1="40" y1="85" x2="60" y2="85" />
      </g>
    </svg>
  );
}
