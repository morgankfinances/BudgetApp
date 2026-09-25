
/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}


export function guessHeader(headers, candidates) {
  const lower = headers.map((h) => String(h).toLowerCase());
  for (const cand of candidates) {
    const idx = lower.findIndex((h) => h.includes(cand));
    if (idx !== -1) return headers[idx];
  }
  return "";
}


export function parseDateISO(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  if (!str) return null;

  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, mo, da, yr] = m;
    if (yr.length === 2) yr = (+yr > 50 ? "19" : "20") + yr;
    const d = new Date(Date.UTC(+yr, +mo - 1, +da));
    if (!isNaN(d.getTime()) && d.getUTCMonth() === +mo - 1) {
      return d.toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}


export function parseMoney(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return isFinite(value) ? value : null;
  let str = String(value).trim();
  if (!str) return null;
  let negative = false;
  if (/^\(.*\)$/.test(str)) {
    negative = true;
    str = str.slice(1, -1);
  }
  str = str.replace(/[$,\s]/g, "");
  if (str.startsWith("-")) {
    negative = true;
    str = str.slice(1);
  } else if (str.startsWith("+")) {
    str = str.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(str)) return null;
  const num = parseFloat(str);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}


export function formatMoney(n) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}


export function formatDateDisplay(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
