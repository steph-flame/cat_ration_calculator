import { ChevronLeft, Settings as SettingsIcon, Plus, Download, Upload, AlertTriangle, Trash2, RotateCcw } from "lucide-react";
import { C } from "../theme.js";
import { useApp } from "../state/AppState.jsx";
import { validateImport } from "../lib/validate.js";

const catLabel = (c) => c.name || "unnamed cat";

export default function Settings() {
  const { p, catsSummary, activeCatId, switchCat, addCat, deleteCat, clearCatHistory, eraseAll, fridgeDays, exportData, importData } = useApp();

  const doExport = () => {
    const blob = new Blob([exportData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cat-data-${(p.name || "cats").replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click(); URL.revokeObjectURL(url);
  };
  const doImport = (ev) => {
    const file = ev.target.files?.[0]; ev.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!validateImport(parsed)) throw new Error("malformed export shape");
        importData(parsed);
      } catch { window.alert("Couldn't read that file — it doesn't look like a Cat Feeding export."); }
    };
    reader.readAsText(file);
  };

  const clearHistory = (c) => {
    if (window.confirm(`Erase ${catLabel(c)}'s weigh-in and intake history? Profile, ration, and saved foods stay. This can't be undone.`)) clearCatHistory(c.id);
  };
  const removeCat = (c) => {
    const tail = catsSummary.length === 1 ? " Since every cat needs a home, this one is replaced with a fresh blank cat." : "";
    if (window.confirm(`Delete ${catLabel(c)} — profile, ration, and all weigh-in/intake history? This can't be undone.${tail}`)) deleteCat(c.id);
  };
  const doEraseAll = () => {
    if (window.confirm("Erase everything — every cat's profile, all saved foods, and all weigh-in and intake history? This can't be undone.")) eraseAll();
  };

  return (
    <div style={{ background: C.paper, color: C.ink, minHeight: "100%" }} className="w-full">
      <div className="max-w-xl mx-auto px-4 py-6 sm:py-8">
        <nav className="mb-4 text-xs font-mono">
          <a href="#/" style={{ color: C.sub }} className="inline-flex items-center gap-1 hover:underline"><ChevronLeft size={13} /> home</a>
        </nav>

        <div className="mb-6">
          <div style={{ color: C.spruce }} className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest mb-1"><SettingsIcon size={13} /> settings</div>
          <h1 className="text-2xl font-semibold leading-tight" style={{ letterSpacing: "-0.01em" }}>Settings</h1>
        </div>

        {/* cats */}
        <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
          <h2 className="font-medium mb-1">Cats</h2>
          <p style={{ color: C.faint }} className="text-xs mb-3">Every cat gets its own profile, ration, and history. They share one food library and fridge setting ({fridgeDays} day{fridgeDays === 1 ? "" : "s"}).</p>
          <div className="space-y-1.5">
            {catsSummary.map((c) => (
              <label key={c.id} style={{ borderColor: c.id === activeCatId ? C.spruce : C.line, background: c.id === activeCatId ? C.spruceSoft : "transparent" }}
                className="flex items-center gap-3 border rounded-xl px-3 py-2 cursor-pointer">
                <input type="radio" name="activeCat" checked={c.id === activeCatId} onChange={() => switchCat(c.id)} style={{ accentColor: C.spruce }} aria-label={`Make ${catLabel(c)} the active cat`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: c.id === activeCatId ? C.spruce : C.ink }}>{catLabel(c)}</div>
                  <div style={{ color: C.faint }} className="text-xs font-mono mt-0.5">{c.ageDisplay || "age unknown"} · {c.weighIns} weigh-in{c.weighIns === 1 ? "" : "s"}</div>
                </div>
              </label>
            ))}
          </div>
          <button onClick={addCat} style={{ borderColor: C.line, color: C.spruce }} className="mt-3 w-full border border-dashed rounded-xl py-2.5 text-sm inline-flex items-center justify-center gap-1.5 hover:bg-white"><Plus size={15} /> add a cat</button>
        </section>

        {/* data */}
        <section style={{ background: C.card, borderColor: C.line }} className="border rounded-2xl p-4 sm:p-5 mb-4">
          <h2 className="font-medium mb-1">Data</h2>
          <p style={{ color: C.faint }} className="text-xs mb-3">Everything above — every cat, the food library, all history — in one file. Saved on this device only; export to back up or move to another browser.</p>
          <div className="flex items-center gap-2">
            <button onClick={doExport} style={{ borderColor: C.line, color: C.sub }} className="inline-flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 hover:bg-white"><Download size={13} /> Export data</button>
            <label style={{ borderColor: C.line, color: C.sub }} className="inline-flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 hover:bg-white cursor-pointer">
              <Upload size={13} /> Import
              <input type="file" accept="application/json,.json" onChange={doImport} className="sr-only" />
            </label>
          </div>
        </section>

        {/* danger zone */}
        <section style={{ background: C.warnSoft, borderColor: C.warn }} className="border-2 rounded-2xl p-4 sm:p-5 mb-4">
          <h2 style={{ color: C.warn }} className="font-medium mb-1 flex items-center gap-1.5"><AlertTriangle size={16} /> Danger zone</h2>
          <p style={{ color: C.warn }} className="text-xs mb-3 opacity-90">Every action here is permanent — there's no undo, and each button says exactly what it erases.</p>

          <div className="space-y-1.5">
            {catsSummary.map((c) => (
              <div key={c.id} style={{ borderColor: C.warn }} className="flex items-center justify-between gap-2 border rounded-xl px-3 py-2 bg-white/40">
                <span className="text-sm truncate" style={{ color: C.ink }}>{catLabel(c)}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => clearHistory(c)} style={{ borderColor: C.warn, color: C.warn }} className="inline-flex items-center gap-1 text-xs border rounded-lg px-2 py-1 hover:bg-white"><RotateCcw size={11} /> clear history…</button>
                  <button onClick={() => removeCat(c)} style={{ borderColor: C.warn, color: C.warn }} className="inline-flex items-center gap-1 text-xs border rounded-lg px-2 py-1 hover:bg-white"><Trash2 size={11} /> delete cat…</button>
                </span>
              </div>
            ))}
          </div>

          <div style={{ borderColor: C.warn }} className="mt-4 border-t pt-3">
            <button onClick={doEraseAll} style={{ background: C.warn }} className="w-full rounded-xl py-2.5 text-sm text-white inline-flex items-center justify-center gap-1.5"><Trash2 size={14} /> erase all — every cat, every food, all history…</button>
          </div>
        </section>
      </div>
    </div>
  );
}
