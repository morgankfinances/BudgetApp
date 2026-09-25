import { describe, it, expect, beforeEach } from "vitest";
import { TUTORIAL_SEEN_KEY, TUTORIAL_EVENT, tutorialAlreadySeen, markTutorialSeen, TUTORIAL_STEPS } from "../tutorial.js";

const VIEWS = ["overview", "transactions", "reports", "accounts", "categories", "upload", "planning", "budgetGroups", "budget", "backup"];

describe("tutorial", () => {
  beforeEach(() => localStorage.clear());
  it("starts unseen, and is remembered once seen", () => {
    expect(tutorialAlreadySeen()).toBe(false);
    markTutorialSeen();
    expect(localStorage.getItem(TUTORIAL_SEEN_KEY)).toBe("true");
    expect(tutorialAlreadySeen()).toBe(true);
  });
  it("if storage is unavailable, it won't pop up on every visit or crash", () => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = () => { throw new Error("blocked"); };
    Storage.prototype.setItem = () => { throw new Error("blocked"); };
    expect(tutorialAlreadySeen()).toBe(true);
    expect(() => markTutorialSeen()).not.toThrow();
    Storage.prototype.getItem = get; Storage.prototype.setItem = set;
  });
  it("every step points to a real page and has a title and text", () => {
    for (const s of TUTORIAL_STEPS) {
      expect(VIEWS).toContain(s.view);
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(20);
    }
  });
  it("starts and ends on the Overview", () => {
    expect(TUTORIAL_STEPS[0].view).toBe("overview");
    expect(TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1].view).toBe("overview");
  });
  it("Settings uses this exact signal name to replay it", () => expect(TUTORIAL_EVENT).toBe("coinrose:start-tutorial"));
});
