import { useState } from "react";
import { uid } from "../lib/util.js";

// A generic append/edit/remove log of dated entries. Reused by the weight log and the
// intake log — each entry is whatever shape the caller stores (plus an id).
export function useLog(makeInitial = () => []) {
  const [items, setItems] = useState(makeInitial);
  return {
    items, setItems,
    add: (entry) => setItems((xs) => [...xs, { id: uid(), ...entry }]),
    edit: (id, patch) => setItems((xs) => xs.map((e) => (e.id === id ? { ...e, ...patch } : e))),
    remove: (id) => setItems((xs) => xs.filter((e) => e.id !== id)),
    reset: () => setItems(makeInitial()),
  };
}
