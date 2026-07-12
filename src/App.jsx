import { useState } from "react";
import { Info, X } from "lucide-react";
import { C } from "./theme.js";
import { AppProvider, useApp } from "./state/AppState.jsx";
import { useHashRoute } from "./hooks/useHashRoute.js";
import Home from "./pages/Home.jsx";
import RationPlanner from "./pages/RationPlanner.jsx";
import Expenditure from "./pages/Expenditure.jsx";
import Log from "./pages/Log.jsx";

const PAGES = { home: Home, ration: RationPlanner, expenditure: Expenditure, log: Log };

function Banner({ children, tone, onClose }) {
  const bg = tone === "warn" ? C.amberSoft : C.spruceSoft;
  const fg = tone === "warn" ? C.warn : C.spruce;
  return (
    <div style={{ background: bg, color: fg }} className="w-full text-xs">
      <div className="max-w-xl mx-auto px-4 py-2 flex items-start gap-2">
        <Info size={14} className="shrink-0 mt-0.5" />
        <span className="flex-1 leading-snug">{children}</span>
        {onClose && <button onClick={onClose} aria-label="Dismiss" style={{ color: fg }} className="shrink-0"><X size={14} /></button>}
      </div>
    </div>
  );
}

function Router() {
  const { loaded, firstRun, storageOk } = useApp();
  const route = useHashRoute("home");
  const [introClosed, setIntroClosed] = useState(false);
  if (!loaded) return <div style={{ background: C.paper, minHeight: "100%" }} className="w-full" />;
  const Page = PAGES[route] || Home;
  return (
    <>
      {!storageOk && (
        <Banner tone="warn">This browser isn't letting the app save (private mode?). Changes won't persist — use Export on the home screen to keep your data.</Banner>
      )}
      {firstRun && !introClosed && (
        <Banner onClose={() => setIntroClosed(true)}>Showing example data (a sample cat). Edit the cat's weight and name on the ration planner to make it yours — or use "erase all" to start fresh.</Banner>
      )}
      <Page />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}
