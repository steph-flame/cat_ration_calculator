import { useState } from "react";
import { Info, X, Cat, Settings as SettingsIcon, ChevronsUpDown } from "lucide-react";
import { C } from "./theme.js";
import { AppProvider, useApp } from "./state/AppState.jsx";
import { useHashRoute } from "./hooks/useHashRoute.js";
import { isIOSSafari, isStandalone, isBannerDismissed, dismissBanner } from "./lib/pwa.js";
import Home from "./pages/Home.jsx";
import RationPlanner from "./pages/RationPlanner.jsx";
import Expenditure from "./pages/Expenditure.jsx";
import Log from "./pages/Log.jsx";
import Settings from "./pages/Settings.jsx";

const PAGES = { home: Home, ration: RationPlanner, expenditure: Expenditure, log: Log, settings: Settings };

// Compact app-shell header: a settings link always, plus (once there's more than one cat) a
// tap-to-cycle active-cat switcher — dense to match the rest of the chrome (banners, nav rows).
function Header({ catsSummary, activeCatId, switchCat }) {
  const active = catsSummary.find((c) => c.id === activeCatId);
  const cycle = () => {
    const idx = catsSummary.findIndex((c) => c.id === activeCatId);
    switchCat(catsSummary[(idx + 1) % catsSummary.length].id);
  };
  return (
    <div style={{ borderColor: C.line, background: C.paper }} className="w-full border-b">
      <div className="max-w-xl mx-auto px-4 py-1.5 flex items-center justify-between text-xs font-mono">
        {catsSummary.length > 1 ? (
          <button onClick={cycle} title="Switch cat" style={{ color: C.spruce }} className="inline-flex items-center gap-1.5 hover:underline">
            <Cat size={13} /> {active?.name || "unnamed cat"} <ChevronsUpDown size={11} style={{ color: C.faint }} />
          </button>
        ) : <span />}
        <a href="#/settings" style={{ color: C.sub }} className="inline-flex items-center gap-1 hover:underline"><SettingsIcon size={12} /> settings</a>
      </div>
    </div>
  );
}

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

// iOS Safari only (not installed) and not already dismissed — computed once per mount,
// same as storageOk above, since none of these change during a session.
const showInstallNudge = () =>
  typeof navigator !== "undefined" &&
  isIOSSafari(navigator.userAgent, navigator.maxTouchPoints) &&
  !isStandalone() &&
  !isBannerDismissed();

function Router() {
  const { loaded, firstRun, storageOk, catsSummary, activeCatId, switchCat } = useApp();
  const route = useHashRoute("home");
  const [introClosed, setIntroClosed] = useState(false);
  const [installNudgeClosed, setInstallNudgeClosed] = useState(false);
  if (!loaded) return <div style={{ background: C.paper, minHeight: "100%" }} className="w-full" />;
  const Page = PAGES[route] || Home;
  return (
    <>
      <Header catsSummary={catsSummary} activeCatId={activeCatId} switchCat={switchCat} />
      {!storageOk && (
        <Banner tone="warn">This browser isn't letting the app save (private mode?). Changes won't persist — use Export in Settings to keep your data.</Banner>
      )}
      {firstRun && !introClosed && (
        <Banner onClose={() => setIntroClosed(true)}>Showing example data (a sample cat). Set the cat's name, date of birth, and a weigh-in on the ration planner to make it yours — or head to Settings to start fresh or add another cat.</Banner>
      )}
      {!installNudgeClosed && showInstallNudge() && (
        <Banner onClose={() => { dismissBanner(); setInstallNudgeClosed(true); }}>
          Add to Home Screen to keep your data safe — iOS clears browser data for sites unused 7 days.
        </Banner>
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
