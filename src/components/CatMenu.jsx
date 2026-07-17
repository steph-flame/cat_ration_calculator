import { useEffect, useRef, useState } from "react";
import { Cat, ChevronsUpDown, Plus, Check } from "lucide-react";
import { C } from "../theme.js";

// Shared cat-switcher popover: a trigger (name + ▾) that opens an anchored card listing every
// cat (active one marked) plus "+ add a cat". Used both by the Home masthead headline name
// ("headline" variant) and the app-shell header chip ("chip" variant) — same interaction,
// different trigger styling. Always rendered, even with a single cat — that's the point:
// "+ add a cat" needs to be reachable from here regardless of how many cats exist.
export default function CatMenu({ catsSummary, activeCatId, switchCat, addCat, variant = "chip", defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const wrapRef = useRef(null);
  const active = catsSummary.find((c) => c.id === activeCatId);
  const label = active?.name || "unnamed cat";

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const pick = (id) => { switchCat(id); setOpen(false); };
  const addAndEdit = () => { addCat(); setOpen(false); window.location.hash = "#/ration"; };

  return (
    <span ref={wrapRef} className="relative inline-block">
      {variant === "headline" ? (
        <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
          aria-label={`Switch cat (current: ${label})`}
          style={{ color: C.spruce, font: "inherit", letterSpacing: "inherit" }} className="align-baseline">
          {label}<span style={{ color: C.faint }} className="text-[0.7em] align-middle"> ▾</span>
        </button>
      ) : (
        <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
          aria-label={`Switch cat (current: ${label})`}
          style={{ color: C.spruce }} className="inline-flex items-center gap-1.5 hover:underline">
          <Cat size={13} /> {label} <ChevronsUpDown size={11} style={{ color: C.faint }} />
        </button>
      )}
      {open && (
        <div role="menu" style={{ background: C.card, borderColor: C.line }}
          className="absolute z-20 left-0 mt-1.5 min-w-[190px] max-h-72 overflow-auto border rounded-xl shadow-md py-1">
          {catsSummary.map((c) => (
            <button key={c.id} role="menuitem" onClick={() => pick(c.id)}
              style={{ color: c.id === activeCatId ? C.spruce : C.ink }}
              className="w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-2 hover:bg-black/[0.03]">
              <span className="truncate">{c.name || "unnamed cat"}</span>
              {c.id === activeCatId && <Check size={13} className="shrink-0" />}
            </button>
          ))}
          <div style={{ borderColor: C.line }} className="border-t my-1" />
          <button role="menuitem" onClick={addAndEdit} style={{ color: C.spruce }}
            className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-black/[0.03]">
            <Plus size={13} /> add a cat
          </button>
        </div>
      )}
    </span>
  );
}
