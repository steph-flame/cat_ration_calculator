import { useState, useEffect } from "react";
import { ChevronLeft, ChevronDown, ChevronRight, Plus, Trash2, RotateCcw, Settings as SettingsIcon, Cat as CatIcon } from "lucide-react";
import { C } from "../theme.js";
import { useApp } from "../state/AppState.jsx";
import { Field, Toggle } from "../components/primitives.jsx";
import CatMark from "../components/CatMark.jsx";

const catLabel = (c) => c.name || "unnamed cat";

// Every real cat's profile, plus per-cat danger actions — split out of Settings onto its own
// page (Settings kept only a "Cats →" link) since it's the thing people actually visit day to
// day (switching cats, fixing a birthday, checking counts), not a one-time setup screen.
// Biscuit (the demo cat) is always listed last, labeled "demo", with no controls at all: she
// can't be renamed, edited, cleared, or deleted — every mutation seam for her is a no-op at
// the state layer (see AppState.jsx's updateActiveCat), so there'd be nothing for these
// controls to do anyway.
export default function Cats() {
  const { today, fridgeDays, catsSummary, activeCatId, switchCat, addCat, updateCatProfile, deleteCat, clearCatHistory } = useApp();
  const [expandedId, setExpandedId] = useState(null);
  const realCats = catsSummary.filter((c) => !c.demo);
  const demoRow = catsSummary.find((c) => c.demo);

  const clearHistory = (c) => {
    if (window.confirm(`Erase ${catLabel(c)}'s weigh-in and intake history? Profile, ration, and saved foods stay. This can't be undone.`)) clearCatHistory(c.id);
  };
  const removeCat = (c) => {
    const tail = realCats.length === 1 ? " Since every cat needs a home, Biscuit (the demo cat) becomes active." : "";
    if (window.confirm(`Delete ${catLabel(c)} — profile, ration, and all weigh-in/intake history? This can't be undone.${tail}`)) deleteCat(c.id);
  };

  return (
    <div style={{ background: C.paper, color: C.ink, minHeight: "100%" }} className="w-full">
      <div className="max-w-xl mx-auto px-4 py-6 sm:py-8">
        <nav className="flex items-center justify-between mb-4 text-xs font-mono">
          <a href="#/" style={{ color: C.sub }} className="inline-flex items-center gap-1 hover:underline"><ChevronLeft size={13} /> home</a>
          <a href="#/settings" style={{ color: C.spruce }} className="inline-flex items-center gap-1 hover:underline"><SettingsIcon size={12} /> settings</a>
        </nav>

        <div className="flex items-end gap-4 mb-6">
          <CatMark size={60} />
          <div className="min-w-0">
            <div style={{ color: C.amber }} className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest mb-1"><CatIcon size={13} /> cats</div>
            <h1 className="text-[26px] font-extrabold leading-tight" style={{ letterSpacing: "-0.02em" }}>Cats</h1>
            <p style={{ color: C.sub }} className="text-sm mt-1">Every cat gets its own profile, ration, and history. They share one food library and fridge setting ({fridgeDays} day{fridgeDays === 1 ? "" : "s"}).</p>
          </div>
        </div>

        <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
          <div className="space-y-1.5">
            {realCats.map((c) => {
              const expanded = c.id === expandedId;
              return (
                <div key={c.id} style={{ borderColor: c.id === activeCatId ? C.spruce : C.line, background: c.id === activeCatId ? C.spruceSoft : "transparent" }}
                  className="border rounded-xl overflow-hidden">
                  <div className="flex items-center gap-3 px-3 py-2">
                    <input type="radio" name="activeCat" checked={c.id === activeCatId} onChange={() => switchCat(c.id)} style={{ accentColor: C.spruce }} aria-label={`Make ${catLabel(c)} the active cat`} />
                    <div className="flex-1 min-w-0">
                      <CatNameField cat={c} onChange={(name) => updateCatProfile(c.id, { name })} active={c.id === activeCatId} />
                      <div style={{ color: C.faint }} className="text-xs font-mono mt-0.5">
                        {c.ageDisplay || "age unknown"} · {c.weighIns} weigh-in{c.weighIns === 1 ? "" : "s"} · {c.meals} meal{c.meals === 1 ? "" : "s"}
                      </div>
                    </div>
                    <button onClick={() => setExpandedId(expanded ? null : c.id)} aria-expanded={expanded} style={{ color: C.sub }} className="shrink-0 inline-flex items-center gap-0.5 text-xs hover:underline">
                      profile {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  </div>
                  {expanded && (
                    <div style={{ borderColor: C.line }} className="border-t px-3 py-3 space-y-3">
                      <Field label="Date of birth">
                        <input type="date" value={c.dob} max={today} onChange={(e) => updateCatProfile(c.id, { dob: e.target.value })} className="w-full bg-transparent outline-none font-mono text-sm tabular-nums" style={{ color: C.ink }} aria-label={`${catLabel(c)}'s date of birth`} />
                      </Field>
                      <div className="flex items-center gap-2">
                        <span style={{ color: C.sub }} className="text-xs w-28">Spayed / neutered</span>
                        <Toggle value={c.neutered} onChange={(v) => updateCatProfile(c.id, { neutered: v })} />
                      </div>
                      <div style={{ borderColor: C.line }} className="border-t pt-3 flex items-center gap-1.5">
                        <button onClick={() => clearHistory(c)} style={{ borderColor: C.warn, color: C.warn }} className="inline-flex items-center gap-1 text-xs border rounded-lg px-2 py-1 hover:bg-white"><RotateCcw size={11} /> clear history…</button>
                        <button onClick={() => removeCat(c)} style={{ borderColor: C.warn, color: C.warn }} className="inline-flex items-center gap-1 text-xs border rounded-lg px-2 py-1 hover:bg-white"><Trash2 size={11} /> delete cat…</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button onClick={addCat} style={{ borderColor: C.line, color: C.spruce }} className="mt-3 w-full border border-dashed rounded-xl py-2.5 text-sm inline-flex items-center justify-center gap-1.5 hover:bg-white"><Plus size={15} /> add a cat</button>

          {demoRow && (
            <div style={{ borderColor: C.line }} className="mt-3 border rounded-xl px-3 py-2.5 opacity-70">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate" style={{ color: C.ink }}>{demoRow.name}</span>
                <span style={{ background: C.line, color: C.sub }} className="text-[10px] font-mono uppercase tracking-wide rounded-full px-1.5 py-0.5">demo</span>
              </div>
              <div style={{ color: C.faint }} className="text-xs font-mono mt-0.5">
                {demoRow.ageDisplay || "age unknown"} · {demoRow.weighIns} weigh-in{demoRow.weighIns === 1 ? "" : "s"} · {demoRow.meals} meal{demoRow.meals === 1 ? "" : "s"} · sample data, no controls
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// Inline-editable cat name, scoped to whichever row it's rendered in (not just the active
// cat). Local `value` state — rather than the row's own (trimmed, for display) catsSummary
// name — is the controlled source, so a trailing space mid-word doesn't get stripped out
// from under the cursor on every keystroke; it only resyncs when the row's cat id changes.
function CatNameField({ cat, onChange, active }) {
  const [value, setValue] = useState(cat.name);
  useEffect(() => { setValue(cat.name); }, [cat.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="text" value={value} placeholder="unnamed cat"
      onChange={(e) => { setValue(e.target.value); onChange(e.target.value); }}
      autoComplete="off" data-lpignore="true" data-1p-ignore data-form-type="other"
      aria-label={`${catLabel(cat)}'s name`}
      style={{ color: active ? C.spruce : C.ink }}
      className="w-full bg-transparent outline-none text-sm font-medium border-b border-transparent focus:border-current"
    />
  );
}
