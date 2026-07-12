import { Scale, Activity, NotebookPen, ChevronRight, Download, Upload } from "lucide-react";
import { C } from "../theme.js";
import { useApp } from "../state/AppState.jsx";
import { r0, r1 } from "../lib/util.js";
import { toDisplayWeight, weightLabel } from "../lib/units.js";
import { resolveTarget } from "../lib/targeting.js";

// Landing page: pick a tool. Shows a one-line status from each so the home screen is useful,
// not just a menu.
export default function Home() {
  const { p, t, expenditure, weightLog, intakeLog, expSettings, exportData, importData } = useApp();
  const doExport = () => {
    const blob = new Blob([exportData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cat-data-${(p.name || "cat").replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click(); URL.revokeObjectURL(url);
  };
  const doImport = (ev) => {
    const file = ev.target.files?.[0]; ev.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { importData(JSON.parse(reader.result)); }
      catch { window.alert("Couldn't read that file — it doesn't look like a Cat Feeding export."); }
    };
    reader.readAsText(file);
  };
  const unit = expSettings.unit || "kg";
  const expStatus = expenditure.enoughData
    ? `measured ${r0(expenditure.kcal)} kcal · ${r1(toDisplayWeight(expenditure.trendWeightKg, unit))} ${weightLabel(unit)}`
    : "log weight + intake to estimate";
  const logStatus = `${weightLog.items.length} weigh-in${weightLog.items.length === 1 ? "" : "s"} · ${intakeLog.items.length} meal${intakeLog.items.length === 1 ? "" : "s"} logged`;

  const tools = [
    { href: "#/ration", icon: Scale, title: "Ration planner",
      desc: "Daily energy target, food split into gram portions, and a food-transition schedule.",
      status: `${r0(resolveTarget({ t, expenditure, expSettings }).target)} kcal/day target` },
    { href: "#/expenditure", icon: Activity, title: "Energy expenditure",
      desc: "Measure the real maintenance requirement from weight trend + intake, and plan a safe deficit.",
      status: expStatus },
    { href: "#/log", icon: NotebookPen, title: "Log",
      desc: "Record weigh-ins and what you dispensed. These feed the expenditure estimate.",
      status: logStatus },
  ];

  return (
    <div style={{ background: C.paper, color: C.ink, minHeight: "100%" }} className="w-full">
      <div className="max-w-xl mx-auto px-4 py-8 sm:py-12">
        <div style={{ color: C.spruce }} className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest mb-1"><Scale size={13} /> cat feeding</div>
        <h1 className="text-2xl font-semibold leading-tight" style={{ letterSpacing: "-0.01em" }}>{p.name}'s kitchen</h1>
        <p style={{ color: C.sub }} className="text-sm mt-1 mb-6">Tools that share one profile, food library, and history.</p>

        <div className="space-y-3">
          {tools.map((tool) => (
            <a key={tool.href} href={tool.href}
              style={{ background: C.card, borderColor: C.line }}
              className="block border rounded-2xl p-4 sm:p-5 hover:shadow-sm transition-shadow">
              <div className="flex items-center gap-3">
                <div style={{ background: C.spruceSoft, color: C.spruce }} className="rounded-xl p-2.5 shrink-0"><tool.icon size={20} /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-medium">{tool.title}</h2>
                    <ChevronRight size={16} style={{ color: C.faint }} />
                  </div>
                  <p style={{ color: C.sub }} className="text-sm mt-0.5 leading-snug">{tool.desc}</p>
                  <div style={{ color: C.spruce }} className="text-xs font-mono mt-1.5">{tool.status}</div>
                </div>
              </div>
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-6">
          <button onClick={doExport} style={{ borderColor: C.line, color: C.sub }} className="inline-flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 hover:bg-white"><Download size={13} /> Export data</button>
          <label style={{ borderColor: C.line, color: C.sub }} className="inline-flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 hover:bg-white cursor-pointer">
            <Upload size={13} /> Import
            <input type="file" accept="application/json,.json" onChange={doImport} className="sr-only" />
          </label>
        </div>
        <p style={{ color: C.faint }} className="text-xs leading-relaxed mt-3 px-1">
          A planning aid, not veterinary advice. Saved on this device only — Export to back up or move to another browser.
        </p>
      </div>
    </div>
  );
}
