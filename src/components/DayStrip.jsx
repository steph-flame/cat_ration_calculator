import { C, CHART } from "../theme.js";
import { extent, linScale } from "../lib/scale.js";
import { r0, r1 } from "../lib/util.js";
import { toDisplayWeight, weightLabel } from "../lib/units.js";
import { formatDayLabel } from "../lib/dayPager.js";

// A compact, presentational strip above the day pager: one column per day (last ~30 days
// ending today, fewer if there's less history — see lib/dayPager.js's dayStripWindow, which
// the caller uses to build `days`). Intake kcal draws as a small vertical bar (hollow for a
// day flagged incomplete — the same "don't trust this one" convention TimelineChart uses for
// imputed points); daily median weight overlays as a thin dot-line on its own implicit scale
// (no shared axis with the bars — this is a glance-strip, not a second full chart, so there
// are deliberately no axes/legend/ticks). The viewed day gets a soft highlight pill. Purely
// dumb: every value arrives via `data` (a { [date]: { kcal, imputed, weightKg } } map from the
// caller); this component owns no log-reading logic and no state beyond hover-title text,
// which comes for free from the native <title> element.
//
// Real per-day <button>s (in a flex row) sit on top of a purely decorative, aria-hidden SVG —
// clicking/tapping/keyboard-activating any column calls onSelect(date). That split is what
// gets both a continuous cross-column weight line (needs one shared SVG) AND per-column
// keyboard focus + aria-labels (needs real focusable elements), rather than picking one at the
// expense of the other.
export default function DayStrip({ days, data = {}, selected, onSelect, unit = "kg", height = 64 }) {
  const n = Math.max(days.length, 1);
  const W = 640; // arbitrary viewBox unit; scales to 100% width like TimelineChart's own SVGs
  const padTop = 6, padBottom = 4;
  const barAreaH = height - padTop - padBottom;
  const colW = W / n;
  const barW = Math.max(2, colW * 0.42);
  const xAt = (i) => i * colW + colW / 2;

  const kcalVals = days.map((d) => data[d]?.kcal).filter((v) => v != null && v > 0);
  const kcalHi = kcalVals.length ? Math.max(...kcalVals) : 0;
  const barH = (kcal) => (kcalHi > 0 ? (kcal / kcalHi) * barAreaH : 0);

  const wVals = days.map((d) => data[d]?.weightKg).filter((v) => v != null);
  const [wLoRaw, wHiRaw] = wVals.length ? extent(wVals) : [0, 1];
  const wPad = (wHiRaw - wLoRaw) * 0.25 || 0.1;
  const wY = linScale([wLoRaw - wPad, wHiRaw + wPad], [height - padBottom - 1, padTop + 1]);

  const linePts = days
    .map((d, i) => (data[d]?.weightKg != null ? `${xAt(i).toFixed(1)},${wY(data[d].weightKg).toFixed(1)}` : null))
    .filter(Boolean)
    .join(" ");

  const label = (d) => {
    const kcal = data[d]?.kcal;
    const w = data[d]?.weightKg;
    const bits = [formatDayLabel(d, days[days.length - 1])];
    bits.push(kcal != null ? `${r0(kcal)} kcal${data[d]?.imputed ? " (incomplete)" : ""}` : "no intake logged");
    if (w != null) bits.push(`${r1(toDisplayWeight(w, unit))} ${weightLabel(unit)}`);
    return bits.join(", ");
  };

  return (
    <div className="relative mb-4" style={{ height }} role="group" aria-label="Day timeline — click a day to view it">
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} style={{ display: "block" }} aria-hidden="true">
        {days.map((d, i) => d === selected && (
          <rect key={`sel-${d}`} x={i * colW + 1} y={0} width={Math.max(colW - 2, 0)} height={height} rx={5} fill={C.spruceSoft} />
        ))}
        {days.map((d, i) => {
          const kcal = data[d]?.kcal;
          if (kcal == null || kcal <= 0) return null;
          const h = Math.max(barH(kcal), 1.5);
          const y = height - padBottom - h;
          const imputed = !!data[d]?.imputed;
          return imputed
            ? <rect key={d} x={xAt(i) - barW / 2} y={y} width={barW} height={h} fill="none" stroke={CHART.intake} strokeWidth="1" rx="1" />
            : <rect key={d} x={xAt(i) - barW / 2} y={y} width={barW} height={h} fill={CHART.intake} rx="1" />;
        })}
        {wVals.length > 1 && <polyline points={linePts} fill="none" stroke={CHART.weight} strokeWidth="1" strokeDasharray="1.5 2" opacity="0.75" />}
        {wVals.length > 0 && days.map((d, i) => data[d]?.weightKg != null && (
          <circle key={`w-${d}`} cx={xAt(i)} cy={wY(data[d].weightKg)} r="1.6" fill={CHART.weight} />
        ))}
      </svg>
      <div className="absolute inset-0 flex">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onSelect(d)}
            aria-label={label(d)}
            aria-pressed={d === selected}
            title={label(d)}
            style={{ flex: "1 1 0" }}
            className="h-full outline-none rounded focus-visible:ring-2"
          />
        ))}
      </div>
    </div>
  );
}
