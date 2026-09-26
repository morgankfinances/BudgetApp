// Privacy rules for crash reports (used by src/monitoring.jsx).
//
// Coinrose handles financial data, so crash reports are kept minimal:
// no console output, no record of clicks (which can include on-screen
// text like transaction descriptions), no query strings in addresses
// (which can include ids), and no email addresses or long digit runs
// (account or card numbers) in any message.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LONG_DIGITS = /\d{6,}/g;

export function redactText(text) {
  if (typeof text !== "string") return text;
  return text.replace(EMAIL, "[redacted]").replace(LONG_DIGITS, "[redacted]");
}

// Keep an address's path; drop everything after ? or #.
export function stripQuery(url) {
  if (typeof url !== "string") return url;
  return url.split(/[?#]/)[0];
}

// Runs on every crash report just before it's sent.
export function scrubEvent(event) {
  if (!event) return event;
  delete event.user;
  if (event.request) {
    event.request.url = stripQuery(event.request.url);
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      event.request.headers = { "User-Agent": event.request.headers["User-Agent"] };
    }
  }
  if (event.message) event.message = redactText(event.message);
  for (const ex of event.exception?.values || []) {
    ex.value = redactText(ex.value);
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter(Boolean);
  }
  return event;
}

// Runs on every step Sentry records before a crash. Returning null drops it.
export function scrubBreadcrumb(crumb) {
  if (!crumb) return null;
  const category = crumb.category || "";
  if (category === "console" || category.startsWith("ui.")) return null;
  const next = { ...crumb };
  if (next.message) next.message = redactText(next.message);
  if (next.data) {
    next.data = { ...next.data };
    for (const key of ["url", "from", "to"]) {
      if (typeof next.data[key] === "string") next.data[key] = stripQuery(next.data[key]);
    }
  }
  return next;
}
