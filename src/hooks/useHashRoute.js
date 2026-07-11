import { useEffect, useState } from "react";

// Minimal hash-based router: no dependency, and hash routes never hit the server, so it
// works on GitHub Pages with no 404.html SPA-fallback trick. Navigate with plain
// <a href="#/expenditure"> links anywhere in the tree.
export function useHashRoute(fallback = "home") {
  const read = () => window.location.hash.replace(/^#\/?/, "") || fallback;
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return route;
}
