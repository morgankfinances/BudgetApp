import { describe, it, expect } from "vitest";
import { redactText, stripQuery, scrubEvent, scrubBreadcrumb } from "../monitoring.js";

describe("crash report privacy", () => {
  it("redacts email addresses and account-number-like digit runs", () => {
    expect(redactText("failed for morgan@example.com on acct 000123456789")).toBe("failed for [redacted] on acct [redacted]");
    expect(redactText("row 42 of 12345")).toBe("row 42 of 12345"); // short numbers are fine
    expect(redactText(undefined)).toBeUndefined();
  });
  it("drops everything after ? or # in addresses", () => {
    expect(stripQuery("https://x.supabase.co/rest/v1/transactions?household_id=eq.abc")).toBe("https://x.supabase.co/rest/v1/transactions");
    expect(stripQuery("https://coinrose.io/#access_token=secret")).toBe("https://coinrose.io/");
    expect(stripQuery(null)).toBeNull();
  });
  it("strips personal and request details from a crash report", () => {
    const event = scrubEvent({
      user: { email: "morgan@example.com", ip_address: "1.2.3.4" },
      message: "Save failed for morgan@example.com",
      request: { url: "https://coinrose.io/?reset=1", query_string: "reset=1", cookies: "c", data: "d",
                 headers: { "User-Agent": "Firefox", Referer: "https://coinrose.io/?x=1" } },
      exception: { values: [{ value: "Card 4111111111111111 declined" }] },
      breadcrumbs: [
        { category: "console", message: "Thrifty Sprout $24.23" },
        { category: "ui.click", message: "button.save" },
        { category: "fetch", data: { url: "https://x.supabase.co/rest/v1/accounts?select=*" } },
      ],
    });
    expect(event.user).toBeUndefined();
    expect(event.message).toBe("Save failed for [redacted]");
    expect(event.request).toEqual({ url: "https://coinrose.io/", headers: { "User-Agent": "Firefox" } });
    expect(event.exception.values[0].value).toBe("Card [redacted] declined");
    expect(event.breadcrumbs).toEqual([{ category: "fetch", data: { url: "https://x.supabase.co/rest/v1/accounts" } }]);
  });
  it("handles reports without optional parts", () => {
    expect(scrubEvent(null)).toBeNull();
    expect(scrubEvent({ message: "plain" })).toEqual({ message: "plain" });
    expect(scrubEvent({ request: { url: "https://a/b" } }).request).toEqual({ url: "https://a/b" });
  });
  it("drops console and click steps, and scrubs the rest", () => {
    expect(scrubBreadcrumb({ category: "console", message: "x" })).toBeNull();
    expect(scrubBreadcrumb({ category: "ui.input" })).toBeNull();
    expect(scrubBreadcrumb(null)).toBeNull();
    expect(scrubBreadcrumb({ category: "navigation", data: { from: "/a?x=1", to: "/b#t" } }).data).toEqual({ from: "/a", to: "/b" });
    expect(scrubBreadcrumb({ message: "user 000123456789" })).toEqual({ message: "user [redacted]" });
    const untouched = { category: "xhr", data: { status_code: 500 } };
    expect(scrubBreadcrumb(untouched)).toEqual(untouched);
  });
});
