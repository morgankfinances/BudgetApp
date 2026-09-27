// Reloads the page. Kept in its own tiny module so tests can confirm a
// reload happens (the simulated browser used in tests can't reload).
export function reloadPage() {
  window.location.reload();
}
