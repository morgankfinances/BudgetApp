// A small bridge between the app and the Settings panel for the household's
// import settings (duplicate handling, filling in suggested categories).
// The app owns and saves them; Settings (in householdGate.jsx) shows and
// changes them through here, since the two aren't otherwise connected.
import { useSyncExternalStore } from "react";

let current = null;
const listeners = new Set();

// The app publishes the current values and how to change them; null while
// the app isn't open (for example, in the middle of setting up a household).
export function publishImportPrefs(next) {
  current = next;
  listeners.forEach((listener) => listener());
}

export function useImportPrefs() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current
  );
}

// The current values, outside React (used by tests).
export function getImportPrefs() {
  return current;
}
