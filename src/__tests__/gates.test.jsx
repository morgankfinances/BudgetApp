import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, within, act, waitFor } from "@testing-library/react";
import { makeFakeSupabase } from "./fakeSupabase.js";

const sb = vi.hoisted(() => ({ current: null }));
vi.mock("../supabaseClient.js", () => ({ get supabase() { return sb.current.client; } }));
vi.mock("../storageAdapter.js", () => ({ resetHouseholdCache: () => {} }));
const reloads = vi.hoisted(() => ({ count: 0 }));
vi.mock("../lib/browser.js", () => ({ reloadPage: () => { reloads.count += 1; } }));
sb.current = makeFakeSupabase();
const fake = sb.current;
const { default: AuthGate } = await import("../authGate.jsx");
const { default: DisclosureGate } = await import("../disclosureGate.jsx");
const { default: HouseholdGate } = await import("../householdGate.jsx");
const { AppErrorBoundary } = await import("../monitoring.jsx");

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
// Stand-in for <App>. It's a component (not a bare <div>) because the
// household screen passes the household's name to whatever it wraps.
function TheApp() { return <div>the app</div>; }
const future = new Date(Date.UTC(2026, 9, 1)).toISOString();
const household = { id: "h1", name: "Alchemist Household", invite_code: "B9FD74DD", invite_code_expires_at: future };
const owner = { user_id: "u1", email: "morgan@example.com", role: "owner" };
const partner = { user_id: "u2", email: "partner@example.com", role: "member" };
beforeEach(() => { fake.reset(); reloads.count = 0; window.history.replaceState({}, "", "/"); document.documentElement.removeAttribute("data-theme"); });

describe("sign-in", () => {
  // Signed-out visitors land on the home page; "Sign in" opens the form.
  const signedOut = async () => {
    render(<AuthGate><div>the app</div></AuthGate>);
    await screen.findByRole("heading", { name: "Your money. Organized by you." });
    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[0]);
    await screen.findByText("Welcome back");
  };

  it("signed-in people go straight to the app", async () => {
    fake.state.session = { user: { id: "u1" } };
    render(<AuthGate><div>the app</div></AuthGate>);
    expect(await screen.findByText("the app")).toBeTruthy();
  });
  it("password sign-in; a wrong password gets a message that doesn't reveal whether the account exists", async () => {
    fake.state.auth.signInWithPassword = { error: { message: "Invalid login credentials" } };
    await signedOut();
    await waitFor(() => expect(document.title).toBe("Sign In | Coinrose"));
    fireEvent.change(document.getElementById("auth-email"), { target: { value: "me@example.com" } });
    fireEvent.change(document.getElementById("auth-password"), { target: { value: "wrong password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/Email or password is incorrect/)).toBeTruthy();
    expect(fake.called("auth:signInWithPassword")[0].args).toMatchObject({ email: "me@example.com", password: "wrong password" });
  });
  it("other sign-in errors are shown as-is", async () => {
    fake.state.auth.signInWithPassword = { error: { message: "Email rate limit exceeded" } };
    await signedOut();
    fireEvent.change(document.getElementById("auth-email"), { target: { value: "a@b.co" } });
    fireEvent.change(document.getElementById("auth-password"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Email rate limit exceeded")).toBeTruthy();
  });
  it("an email link is sent back to this site", async () => {
    await signedOut();
    fireEvent.click(screen.getByRole("tab", { name: "Email link" }));
    fireEvent.change(document.getElementById("auth-email"), { target: { value: "me@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByText(/for a sign-in link/)).toBeTruthy();
    expect(fake.called("auth:signInWithOtp")[0].args.options.emailRedirectTo).toBe(window.location.origin);
  });
  it("a failed email link shows why", async () => {
    fake.state.auth.signInWithOtp = { error: { message: "Too many requests" } };
    await signedOut();
    fireEvent.click(screen.getByRole("tab", { name: "Email link" }));
    fireEvent.change(document.getElementById("auth-email"), { target: { value: "me@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByText("Too many requests")).toBeTruthy();
  });
  it("'forgot password' gives the same answer whether or not the account exists, but shows rate limits", async () => {
    await signedOut();
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    await waitFor(() => expect(document.title).toBe("Reset Password | Coinrose"));
    fireEvent.change(document.getElementById("auth-email"), { target: { value: "nobody@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText(/If an account with a password exists/)).toBeTruthy();
    expect(fake.called("auth:resetPasswordForEmail")[0].args.redirectTo).toBe(`${window.location.origin}/?reset=1`);
    fireEvent.click(screen.getByRole("button", { name: /Back to sign in/ }));
    fake.state.auth.resetPasswordForEmail = { error: { message: "Email rate limit exceeded" } };
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    fireEvent.change(document.getElementById("auth-email"), { target: { value: "me@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText("Email rate limit exceeded")).toBeTruthy();
  });
  it("arriving from a reset email: choose a new password (checked), then other devices are signed out", async () => {
    window.history.replaceState({}, "", "/?reset=1");
    fake.state.session = { user: { id: "u1" } };
    render(<AuthGate><div>the app</div></AuthGate>);
    await screen.findByText("Choose a new password");
    await waitFor(() => expect(document.title).toBe("Choose a New Password | Coinrose"));
    const save = () => fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    fireEvent.change(document.getElementById("auth-new-password"), { target: { value: "short" } });
    fireEvent.change(document.getElementById("auth-confirm-password"), { target: { value: "short" } });
    save();
    await waitFor(() => expect(document.querySelector(".auth-message.error").textContent).toMatch(/Use at least 12 characters/));
    fireEvent.change(document.getElementById("auth-new-password"), { target: { value: "correct horse battery" } });
    save();
    expect(await screen.findByText(/don't match/)).toBeTruthy();
    fireEvent.change(document.getElementById("auth-confirm-password"), { target: { value: "correct horse battery" } });
    save();
    expect(await screen.findByText("the app")).toBeTruthy();
    expect(fake.called("auth:updateUser")[0].args).toEqual({ password: "correct horse battery" });
    expect(fake.called("auth:signOut")[0].args).toEqual({ scope: "others" });
    expect(window.location.search).toBe("");
  });
  it("a failed password update is shown", async () => {
    window.history.replaceState({}, "", "/?reset=1");
    fake.state.session = { user: { id: "u1" } };
    fake.state.auth.updateUser = { error: { message: "New password should be different" } };
    render(<AuthGate><div>the app</div></AuthGate>);
    await screen.findByText("Choose a new password");
    fireEvent.change(document.getElementById("auth-new-password"), { target: { value: "correct horse battery" } });
    fireEvent.change(document.getElementById("auth-confirm-password"), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText("New password should be different")).toBeTruthy();
  });
  it("Supabase's password-recovery signal also opens the new-password form", async () => {
    await signedOut();
    act(() => fake.authListener("PASSWORD_RECOVERY", { user: { id: "u1" } }));
    expect(await screen.findByText("Choose a new password")).toBeTruthy();
  });
});

describe("disclosure notice", () => {
  it("shows once, then the app; it can be reopened from Settings and closed again", async () => {
    render(<DisclosureGate><div>the app</div></DisclosureGate>);
    expect(screen.getByText("Before you get started")).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("Before You Get Started | Coinrose"));
    fireEvent.click(screen.getByRole("button", { name: "I understand, continue" }));
    expect(screen.getByText("the app")).toBeTruthy();
    document.title = "Budget | Coinrose";
    act(() => window.dispatchEvent(new Event("coinrose:show-disclosure")));
    expect(screen.getByText("About this app")).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("About This App | Coinrose"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("About this app")).toBeNull();
    await waitFor(() => expect(document.title).toBe("Budget | Coinrose"));
    act(() => window.dispatchEvent(new Event("coinrose:show-disclosure")));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("About this app")).toBeNull();
  });
  it("isn't shown again once accepted", () => {
    localStorage.setItem("ledger-disclosure-ack-v1", "true");
    render(<DisclosureGate><div>the app</div></DisclosureGate>);
    expect(screen.getByText("the app")).toBeTruthy();
  });
});

describe("household setup", () => {
  it("someone new creates a household and gets its invite code", async () => {
    render(<HouseholdGate><TheApp /></HouseholdGate>);
    await screen.findByText("Set up your household");
    await waitFor(() => expect(document.title).toBe("Set Up Your Household | Coinrose"));
    fireEvent.change(screen.getByPlaceholderText("Household name (optional)"), { target: { value: "The Keller House" } });
    fireEvent.click(screen.getByRole("button", { name: "Create a new household" }));
    expect(await screen.findByText("NEWCODE1")).toBeTruthy();
    expect(fake.called("rpc:create_household")[0].args).toEqual({ p_name: "The Keller House" });
    fake.state.membership = { household_id: "h1", role: "owner", households: household };
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("the app")).toBeTruthy();
  });
  it("joining with a code waits for approval; a declined request can try another code", async () => {
    render(<HouseholdGate><TheApp /></HouseholdGate>);
    await screen.findByText("Set up your household");
    fake.state.myRequest = { id: "r1", status: "pending" };
    fireEvent.change(screen.getByPlaceholderText("Enter invite code"), { target: { value: " b9fd74dd " } });
    fireEvent.click(screen.getByRole("button", { name: "Request to join" }));
    expect(await screen.findByText("Waiting for approval")).toBeTruthy();
    expect(fake.called("rpc:request_join_household")[0].args).toEqual({ p_invite_code: "b9fd74dd" });
  });
  it("a declined request can start over", async () => {
    fake.state.myRequest = { id: "r1", status: "denied" };
    render(<HouseholdGate><TheApp /></HouseholdGate>);
    await screen.findByText("Request not approved");
    fireEvent.click(screen.getByRole("button", { name: "Try a different code" }));
    expect(screen.getByText("Set up your household")).toBeTruthy();
  });
  it("a bad invite code shows why", async () => {
    fake.state.rpc.request_join_household = { error: { message: "Invalid invite code" } };
    render(<HouseholdGate><TheApp /></HouseholdGate>);
    await screen.findByText("Set up your household");
    fireEvent.change(screen.getByPlaceholderText("Enter invite code"), { target: { value: "NOPE" } });
    fireEvent.click(screen.getByRole("button", { name: "Request to join" }));
    expect(await screen.findByText("Invalid invite code")).toBeTruthy();
  });
});

describe("Settings", () => {
  async function openSettings(members = [owner, partner], extra = {}) {
    fake.reset({ membership: { household_id: "h1", role: members.find((m) => m.user_id === "u1").role, households: household },
                 members, requests: [{ id: "r9", requester_email: "new@example.com", created_at: future }], ...extra });
    render(<HouseholdGate><TheApp /></HouseholdGate>);
    await screen.findByText("the app");
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    await screen.findByText("Members");
    const row = (email) => screen.getByText(new RegExp(email)).closest("div[style]");
    return { row };
  }
  it("owners see the request badge, and can rename, copy, and renew the invite code", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
    await openSettings();
    expect(screen.getByRole("button", { name: /^Settings\s*1$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByDisplayValue("Alchemist Household"), { target: { value: "Keller Home" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await flush();
    expect(fake.called("rpc:rename_household")[0].args).toEqual({ p_household_id: "h1", p_name: "Keller Home" });
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("B9FD74DD");
    fireEvent.click(screen.getByRole("button", { name: "Generate a new code" }));
    await flush();
    expect(fake.called("rpc:regenerate_invite_code")).toHaveLength(1);
  });
  it("owners approve (choosing a role) and deny join requests", async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText("Role for this person"), { target: { value: "owner" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await flush();
    expect(fake.called("rpc:approve_join_request")[0].args).toEqual({ p_request_id: "r9", p_role: "owner" });
  });
  it("denying a request", async () => {
    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await flush();
    expect(fake.called("rpc:deny_join_request")[0].args).toEqual({ p_request_id: "r9" });
  });
  it("owners remove someone with or without a copy, and change roles", async () => {
    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Make owner" }));
    await flush();
    expect(fake.called("rpc:set_member_role")[0].args).toEqual({ p_household_id: "h1", p_user_id: "u2", p_role: "owner" });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove without a copy" }));
    await flush();
    expect(fake.called("rpc:remove_household_member")[0].args).toEqual({ p_household_id: "h1", p_target_user_id: "u2", p_keep_copy: false });
  });
  it("an owner can step down while another owner remains", async () => {
    await openSettings([owner, { ...partner, role: "owner" }]);
    fireEvent.click(screen.getByRole("button", { name: "Step down to member" }));
    await flush();
    expect(fake.called("rpc:set_member_role")[0].args).toMatchObject({ p_user_id: "u1", p_role: "member" });
  });
  it("server refusals are shown (e.g. the last owner can't step down)", async () => {
    await openSettings([owner, { ...partner, role: "owner" }], { rpc: { set_member_role: { error: { message: "A household needs at least one owner." } } } });
    fireEvent.click(screen.getByRole("button", { name: "Step down to member" }));
    expect(await screen.findByText("A household needs at least one owner.")).toBeTruthy();
  });
  it("members see the list and roles, but no owner controls, invite code, or requests", async () => {
    await openSettings([{ ...owner, role: "member" }, { ...partner, role: "owner" }]);
    expect(screen.getByText(/Owners invite new people/)).toBeTruthy();
    for (const name of ["Rename", "Approve", "Make owner", "Remove", "Copy code"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByText("B9FD74DD")).toBeNull();
    expect(screen.getByRole("button", { name: /^Settings$/ })).toBeTruthy(); // no badge
  });
  it("leaving reloads into your own copy of the household", async () => {
    await openSettings([owner, { ...partner, role: "owner" }]);
    fireEvent.click(screen.getByRole("button", { name: "Leave this household" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm leave" }));
    await flush();
    expect(fake.called("rpc:leave_household")).toHaveLength(1);
    expect(reloads.count).toBe(1);
  });
  it("leaving asks first; a refusal is shown", async () => {
    await openSettings([owner, partner], { rpc: { leave_household: { error: { message: "You're the only owner." } } } });
    fireEvent.click(screen.getByRole("button", { name: "Leave this household" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm leave" }));
    expect(await screen.findByText("You're the only owner.")).toBeTruthy();
  });
  it("switching households warns what will happen, then sends the request", async () => {
    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Join a different household" }));
    fireEvent.change(screen.getAllByPlaceholderText("Enter invite code").at(-1), { target: { value: "ZZZ99999" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(document.body.textContent).toMatch(/will be merged into/);
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText(/Request sent/)).toBeTruthy();
    expect(fake.called("rpc:request_join_household")[0].args).toEqual({ p_invite_code: "ZZZ99999" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
  });
  it("setting a password: checked, and asks for an emailed code when Supabase requires it", async () => {
    let asked = false;
    await openSettings([owner], { auth: { updateUser: () => (asked ? { error: null } : ((asked = true), { error: { code: "reauthentication_needed", message: "reauthentication needed" } })) } });
    fireEvent.click(screen.getByRole("button", { name: "Set or change password" }));
    const pw = screen.getByPlaceholderText(/New password/), confirm = screen.getByPlaceholderText("Confirm new password");
    fireEvent.change(pw, { target: { value: "too short" } }); fireEvent.change(confirm, { target: { value: "too short" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText(/at least 12 characters/)).toBeTruthy();
    fireEvent.change(pw, { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText(/don't match/)).toBeTruthy();
    fireEvent.change(confirm, { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    const code = await screen.findByPlaceholderText("Code from your email");
    expect(fake.called("auth:reauthenticate")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText("Enter the code from your email.")).toBeTruthy();
    fireEvent.change(code, { target: { value: " 482913 " } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(await screen.findByText(/Password saved/)).toBeTruthy();
    expect(fake.called("auth:updateUser").at(-1).args).toEqual({ password: "correct horse battery", nonce: "482913" });
    expect(fake.called("auth:signOut")[0].args).toEqual({ scope: "others" });
  });
  it("Data History lists save points and restores the chosen one after confirming", async () => {
    await openSettings(undefined, { changeSets: [{ id: 41, started_at: new Date(Date.now() - 3 * 60000).toISOString(), change_count: 12 }] });
    fireEvent.click(screen.getByRole("button", { name: "View history" }));
    expect(await screen.findByText(/3 minutes ago/)).toBeTruthy();
    expect(document.body.textContent).toMatch(/12 changes/);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await flush();
    expect(fake.called("rpc:restore_ledger_to")[0].args).toEqual({ p_change_set_id: 41 });
    expect(reloads.count).toBe(1); // the page reloads to show the restored data
  });
  it("choosing a theme applies it and remembers it on this device", async () => {
    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: /Dark — Midnight/ }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark-midnight");
    expect(localStorage.getItem("ledger-theme-v1")).toBe("dark-midnight");
  });
  it("About opens the tutorial or the disclosure notice", async () => {
    const heard = [];
    for (const e of ["coinrose:start-tutorial", "coinrose:show-disclosure"]) window.addEventListener(e, () => heard.push(e));
    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "View tutorial" }));
    expect(heard).toEqual(["coinrose:start-tutorial"]);
  });
  it("deleting your account in a shared household explains that the data stays, then signs out", async () => {
    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(document.body.textContent).toMatch(/data stays with its other members/);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete my account" }));
    await flush();
    expect(fake.called("rpc:delete_my_account")).toHaveLength(1);
    expect(fake.called("auth:signOut")).toHaveLength(1);
  });
  it("a sole member can delete the household's data; the warning says nothing is kept", async () => {
    await openSettings([owner]);
    expect(screen.queryByText(/isn't only yours to delete/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete all my data" }));
    expect(document.body.textContent).toMatch(/Nothing is kept anywhere|nothing is kept anywhere/i);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete everything" }));
    await flush();
    expect(fake.called("rpc:delete_my_household_data")).toHaveLength(1);
  });
  it("sign out", async () => {
    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await flush();
    expect(fake.called("auth:signOut")).toHaveLength(1);
  });
});

describe("crash screen", () => {
  it("a crash shows a friendly screen with a reload button instead of a blank page", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Broken() { throw new Error("boom"); }
    render(<AppErrorBoundary><Broken /></AppErrorBoundary>);
    expect(screen.getByRole("alert").textContent).toMatch(/Something went wrong.*saved data is safe/);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reloads.count).toBe(1);
    spy.mockRestore();
  });
});

describe("legal links", () => {
  it("the sign-in page, the notice, and Settings all link to the Privacy Policy and Terms of Use", async () => {
    const hrefs = () => [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    window.history.replaceState({}, "", "/#signin"); // straight to the sign-in form
    render(<AuthGate><div>app</div></AuthGate>);
    await screen.findByText("Welcome back");
    expect(hrefs()).toEqual(expect.arrayContaining(["/terms.html", "/privacy.html"]));
    expect(document.body.textContent).toMatch(/By continuing, you agree to the Terms of Use/);
  });
  it("the disclosure notice links to both", () => {
    render(<DisclosureGate><div>app</div></DisclosureGate>);
    const links = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(expect.arrayContaining(["/terms.html", "/privacy.html"]));
  });
});

describe("appearance and the Settings dialog", () => {
  it("new visitors get the Slate theme, which leads the list", async () => {
    localStorage.removeItem("ledger-theme-v1");
    fake.reset({ membership: { household_id: "h1", role: "owner", households: household }, members: [owner] });
    render(<HouseholdGate><TheApp /></HouseholdGate>);
    await screen.findByText("the app");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light-slate");
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    await screen.findByText("Members");
    const themeButtons = screen.getAllByRole("button").filter((b) => /Slate|Natural|Midnight/.test(b.textContent)).map((b) => b.textContent.trim());
    expect(themeButtons[0]).toMatch(/Default — Slate/);
  });
  it("Settings is a labeled dialog that takes focus, and Escape closes it and returns focus", async () => {
    fake.reset({ membership: { household_id: "h1", role: "owner", households: household }, members: [owner] });
    render(<HouseholdGate><TheApp /></HouseholdGate>);
    await screen.findByText("the app");
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await screen.findByText("Members");
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement.textContent).toMatch(/^Settings/));
  });
});

describe("keyboard focus stays inside Settings", () => {
  it("Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last", async () => {
    fake.reset({ membership: { household_id: "h1", role: "owner", households: household }, members: [owner] });
    render(<HouseholdGate><TheApp /></HouseholdGate>);
    await screen.findByText("the app");
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await screen.findByText("Members");
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]')];
    const first = focusable[0], last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    focusable[1].focus();
    fireEvent.keyDown(focusable[1], { key: "Tab" });        // in the middle: the browser moves focus normally
    expect(document.activeElement).toBe(focusable[1]);
    fireEvent.keyDown(focusable[1], { key: "a" });          // other keys are ignored
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});


describe("home page", () => {
  it("signed-out visitors see the home page, with its sections, screenshots, and legal links", async () => {
    render(<AuthGate><div>the app</div></AuthGate>);
    expect(await screen.findByRole("heading", { level: 1, name: "Your money. Organized by you." })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("Coinrose: Household Budgeting"));
    for (const name of ["How it works", "What it does", "A look inside", "Built to know as little as possible", "About Coinrose"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    }
    const images = [...document.querySelectorAll("img")].filter((i) => i.getAttribute("src").startsWith("/home/"));
    expect(images).toHaveLength(4);
    expect(images.every((i) => i.alt.length > 20)).toBe(true); // every screenshot is described
    const hrefs = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/privacy.html", "/terms.html", "mailto:morgankfinances@gmail.com"]));
  });
  it("'Get started' opens the sign-in form on the email-link tab, which creates accounts", async () => {
    render(<AuthGate><div>the app</div></AuthGate>);
    fireEvent.click((await screen.findAllByRole("button", { name: /Get started/ }))[0]);
    expect(await screen.findByText("Welcome back")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Email link" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(document.title).toBe("Sign In | Coinrose"));
  });
  it("'Sign in' opens the password tab, and 'Back to home' returns", async () => {
    render(<AuthGate><div>the app</div></AuthGate>);
    fireEvent.click((await screen.findAllByRole("button", { name: "Sign in" }))[0]);
    expect(screen.getByRole("tab", { name: "Password" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Back to home/ }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Organized by you/);
  });
  it("coinrose.io/#signin goes straight to the sign-in form", async () => {
    window.history.replaceState({}, "", "/#signin");
    render(<AuthGate><div>the app</div></AuthGate>);
    expect(await screen.findByText("Welcome back")).toBeTruthy();
  });
  it("signed-in visitors never see the home page", async () => {
    fake.state.session = { user: { id: "u1" } };
    render(<AuthGate><div>the app</div></AuthGate>);
    expect(await screen.findByText("the app")).toBeTruthy();
    expect(screen.queryByText(/Organized by you/)).toBeNull();
  });
});

describe("demo mode", () => {
  it("'Try the demo' opens the app with sample data, and 'Exit demo' returns home", async () => {
    render(<AuthGate><div>the app</div></AuthGate>);
    fireEvent.click((await screen.findAllByRole("button", { name: "Try the demo" }))[0]);
    expect(await screen.findByText(/You're exploring a demo/, {}, { timeout: 4000 })).toBeTruthy();
    expect(await screen.findByText("Sample Household Ledger", {}, { timeout: 4000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Exit demo" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Organized by you/);
    const { isDemo } = await import("../ledgerStore.js");
    expect(isDemo()).toBe(false);
  });
  it("coinrose.io/#demo opens it directly, and 'Create your account' goes to sign-up", async () => {
    window.history.replaceState({}, "", "/#demo");
    render(<AuthGate><div>the app</div></AuthGate>);
    fireEvent.click(await screen.findByRole("button", { name: "Create your account" }, { timeout: 4000 }));
    expect(await screen.findByText("Welcome back")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Email link" }).getAttribute("aria-selected")).toBe("true");
    expect(window.location.hash).toBe("");
  });
  it("signing in switches the data layer back to the real database", async () => {
    const { startDemo, isDemo } = await import("../ledgerStore.js");
    startDemo({ accounts: [] });
    fake.state.session = { user: { id: "u1" } };
    render(<AuthGate><div>the app</div></AuthGate>);
    await screen.findByText("the app");
    expect(isDemo()).toBe(false);
  });
});

import { publishImportPrefs } from "../lib/importPrefs.js";
describe("Settings → Importing", () => {
  it("shows the household's import settings once the app has published them, and changes them", async () => {
    const onSetDuplicateHandling = vi.fn(), onToggleAutoApply = vi.fn();
    fake.reset({ membership: { household_id: "h1", role: "owner", households: household }, members: [owner] });
    render(<HouseholdGate><TheApp /></HouseholdGate>);
    await screen.findByText("the app");
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    await screen.findByText("Members");
    expect(screen.queryByText("Importing")).toBeNull(); // nothing to show until the app is open
    act(() => publishImportPrefs({ duplicateHandling: "skip", autoApplySuggestions: true, skippedCount: 0, onSetDuplicateHandling, onToggleAutoApply }));
    expect(screen.getByText("Importing")).toBeTruthy();
    expect(screen.getByLabelText(/Skip them automatically/).checked).toBe(true);
    fireEvent.click(screen.getByLabelText(/Import everything, with no duplicate checks/));
    expect(onSetDuplicateHandling).toHaveBeenCalledWith("off");
    fireEvent.click(screen.getByLabelText(/Fill in suggested categories automatically/));
    expect(onToggleAutoApply).toHaveBeenCalledWith(false);
    act(() => publishImportPrefs(null));
  });
});

describe("demo mode and signing in", () => {
  it("the app never loads the demo's data for a signed-in person: demo mode is off before the app appears", async () => {
    const { startDemo, isDemo } = await import("../ledgerStore.js");
    startDemo({ accounts: [] });
    let demoWhenAppAppeared = null;
    function RecordingApp() {
      if (demoWhenAppAppeared === null) demoWhenAppAppeared = isDemo();
      return <div>the app</div>;
    }
    fake.state.session = { user: { id: "u1" } };
    render(<AuthGate><RecordingApp /></AuthGate>);
    await screen.findByText("the app");
    expect(demoWhenAppAppeared).toBe(false);
  });
});

describe("the household screen tells the app who's who", () => {
  it("passes the signed-in person's ID and the member list, for comment authors", async () => {
    let received = null;
    function PropsApp(props) { received = props; return <div>the app</div>; }
    fake.reset({ membership: { household_id: "h1", role: "owner", households: household }, members: [owner, partner] });
    render(<HouseholdGate><PropsApp /></HouseholdGate>);
    await screen.findByText("the app");
    await waitFor(() => expect(received.householdMembers).toHaveLength(2));
    expect(received.currentUserId).toBe(owner.user_id);
    expect(received.householdName).toBe(household.name);
  });
});

describe("two-step sign-in", () => {
  const signedInNeedingCode = () => {
    fake.state.session = { user: { id: "u1" } };
    fake.state.mfaFactors = [{ id: "f1", status: "verified" }];
    fake.state.mfaLevel = { currentLevel: "aal1", nextLevel: "aal2" };
  };
  it("after the password, someone with two-step on enters their code before Coinrose opens", async () => {
    signedInNeedingCode();
    render(<AuthGate><div>the app</div></AuthGate>);
    expect(await screen.findByRole("heading", { name: "Enter your code" })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("Two-Step Sign-In | Coinrose"));
    expect(screen.queryByText("the app")).toBeNull();
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "12 34" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Enter the 6-digit code/);
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("the app")).toBeTruthy();
    expect(fake.called("mfa:challengeAndVerify")[0].args).toEqual({ factorId: "f1", code: "123456" });
  });
  it("a wrong code says so, and signing out is always available", async () => {
    signedInNeedingCode();
    fake.state.mfaVerifyFails = true;
    render(<AuthGate><div>the app</div></AuthGate>);
    fireEvent.change(await screen.findByLabelText("6-digit code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/That code didn't work/);
    expect(screen.queryByText("the app")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(fake.called("auth:signOut")).toHaveLength(1);
  });
  it("people without two-step go straight in", async () => {
    fake.state.session = { user: { id: "u1" } };
    render(<AuthGate><div>the app</div></AuthGate>);
    expect(await screen.findByText("the app")).toBeTruthy();
  });

  const openSettings = async () => {
    fake.reset({ membership: { household_id: "h1", role: "owner", households: household }, members: [owner] });
    render(<HouseholdGate><TheApp /></HouseholdGate>);
    await screen.findByText("the app");
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    await screen.findByText("Members");
  };
  it("Settings: turning it on shows the QR code and setup key, and only switches on after a code checks out", async () => {
    await openSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on two-step sign-in" }));
    const qr = await screen.findByAltText("QR code for setting up two-step sign-in");
    expect(qr.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Enter the 6-digit code it shows/), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn it on" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Enter the 6-digit code/);
    fake.state.rpc.create_two_step_recovery_codes = { data: CODES, error: null };
    fake.state.rpc.two_step_recovery_codes_left = { data: 10, error: null };
    fireEvent.change(screen.getByLabelText(/Enter the 6-digit code it shows/), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn it on" }));
    // The backup codes come next, shown once, and must be confirmed as saved.
    const codes = await screen.findByRole("group", { name: "Your backup codes" });
    expect([...codes.querySelectorAll("li")].map((li) => li.textContent)).toEqual(CODES);
    expect(codes.textContent).toMatch(/This is the only time they'll be shown/);
    const done = within(codes).getByRole("button", { name: "Done" });
    expect(done.disabled).toBe(true);
    fireEvent.click(within(codes).getByLabelText("I've saved these codes somewhere safe"));
    fireEvent.click(done);
    expect(await screen.findByText(/Two-step sign-in is now on\./)).toBeTruthy();
    expect(await screen.findByText("Backup codes: 10 of 10 left.")).toBeTruthy();
  });
  it("Settings: an abandoned setup is cleaned up, and turning it off asks first", async () => {
    await openSettings();
    fake.state.mfaFactors = [{ id: "stale", status: "unverified" }];
    fireEvent.click(await screen.findByRole("button", { name: "Turn on two-step sign-in" }));
    await screen.findByAltText("QR code for setting up two-step sign-in");
    expect(fake.called("mfa:unenroll")[0].args).toEqual({ factorId: "stale" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("button", { name: "Turn on two-step sign-in" })).toBeTruthy();
    fake.state.mfaFactors = [{ id: "f1", status: "verified" }];
    cleanupAndReopen: {
      fireEvent.keyDown(window, { key: "Escape" });
    }
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Turn off two-step sign-in" }));
    fake.state.mfaUnenrollFails = true;
    fireEvent.click(screen.getByRole("button", { name: "Yes, turn it off" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/sign out and sign back in with your code first/);
    fake.state.mfaUnenrollFails = false;
    fireEvent.click(screen.getByRole("button", { name: "Turn off two-step sign-in" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, turn it off" }));
    expect(await screen.findByRole("button", { name: "Turn on two-step sign-in" })).toBeTruthy();
  });
});


const CODES = ["UZ3JK-3SBYG", "RRDMB-7565X", "QWERT-23456", "ASDFG-34567", "ZXCVB-45678", "POIUY-56789", "LKJHG-67892", "MNBVC-78923", "TREWQ-89234", "YTREW-92345"];
describe("two-step backup codes", () => {
  const signedInNeedingCode = () => {
    fake.state.session = { user: { id: "u1" } };
    fake.state.mfaFactors = [{ id: "f1", status: "verified" }];
    fake.state.mfaLevel = { currentLevel: "aal1", nextLevel: "aal2" };
  };
  it("lost phone: a backup code gets you in, and explains that two-step is now off until it's set up again", async () => {
    signedInNeedingCode();
    fake.state.rpc.redeem_two_step_recovery_code = { data: true, error: null };
    render(<AuthGate><div>the app</div></AuthGate>);
    fireEvent.click(await screen.findByRole("button", { name: "Lost your phone? Use a backup code" }));
    expect(screen.getByRole("heading", { name: "Use a backup code" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Backup code"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Use backup code" }));
    expect(screen.getByRole("alert").textContent).toMatch(/10 letters and numbers/);
    fireEvent.change(screen.getByLabelText("Backup code"), { target: { value: "uz3jk 3sbyg" } });
    fireEvent.click(screen.getByRole("button", { name: "Use backup code" }));
    expect(await screen.findByRole("heading", { name: "You're in" })).toBeTruthy();
    expect(fake.called("rpc:redeem_two_step_recovery_code")[0].args).toEqual({ p_code: "uz3jk 3sbyg" });
    expect(fake.called("auth:refreshSession")).toHaveLength(1);
    expect(document.body.textContent).toMatch(/set it up again with your new device in Settings/);
    fake.state.mfaLevel = { currentLevel: "aal1", nextLevel: "aal1" }; // two-step is off now
    fireEvent.click(screen.getByRole("button", { name: "Continue to Coinrose" }));
    expect(await screen.findByText("the app")).toBeTruthy();
  });
  it("a wrong backup code, or too many tries, says so; you can go back to the authenticator code", async () => {
    signedInNeedingCode();
    fake.state.rpc.redeem_two_step_recovery_code = { data: false, error: null };
    render(<AuthGate><div>the app</div></AuthGate>);
    fireEvent.click(await screen.findByRole("button", { name: "Lost your phone? Use a backup code" }));
    fireEvent.change(screen.getByLabelText("Backup code"), { target: { value: "AAAAA-AAAAA" } });
    fireEvent.click(screen.getByRole("button", { name: "Use backup code" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/didn't work\. Each code works only once/);
    fake.state.rpc.redeem_two_step_recovery_code = { data: null, error: new Error("Too many tries. Wait an hour, then try again.") };
    fireEvent.click(screen.getByRole("button", { name: "Use backup code" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Too many tries/));
    expect(screen.queryByText("the app")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to the authenticator code" }));
    expect(screen.getByRole("heading", { name: "Enter your code" })).toBeTruthy();
  });
  it("Settings shows how many backup codes are left, warns when low, and makes a new set", async () => {
    fake.reset({ membership: { household_id: "h1", role: "owner", households: household }, members: [owner] });
    fake.state.mfaFactors = [{ id: "f1", status: "verified" }];
    fake.state.rpc.two_step_recovery_codes_left = { data: 2, error: null };
    render(<HouseholdGate><TheApp /></HouseholdGate>);
    await screen.findByText("the app");
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    expect(await screen.findByText(/Backup codes: 2 of 10 left\. Running low/)).toBeTruthy();
    fake.state.rpc.create_two_step_recovery_codes = { data: CODES, error: null };
    fireEvent.click(screen.getByRole("button", { name: "Make new backup codes (replaces the old ones)" }));
    const codes = await screen.findByRole("group", { name: "Your backup codes" });
    expect(codes.querySelectorAll("li")).toHaveLength(10);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue() } });
    fireEvent.click(within(codes).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CODES.join("\n")));
    expect(within(codes).getByRole("button", { name: "Copied" })).toBeTruthy();
  });
  it("with no codes left, it says so plainly", async () => {
    fake.reset({ membership: { household_id: "h1", role: "owner", households: household }, members: [owner] });
    fake.state.mfaFactors = [{ id: "f1", status: "verified" }];
    fake.state.rpc.two_step_recovery_codes_left = { data: 0, error: null };
    render(<HouseholdGate><TheApp /></HouseholdGate>);
    await screen.findByText("the app");
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    expect(await screen.findByText(/You have no backup codes left/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make backup codes" })).toBeTruthy();
  });
});

describe("the demo's banner and Settings", () => {
  const openDemo = async () => {
    // A returning visitor who has seen the tour, so it doesn't open by itself
    // and take focus while these tests check Settings.
    localStorage.setItem("coinrose-tutorial-seen-v1", "true");
    window.history.replaceState({}, "", "/#demo");
    render(<AuthGate><div>the app</div></AuthGate>);
    await screen.findByText("Sample Household Ledger", {}, { timeout: 4000 });
  };
  it("the banner tells pinned buttons its height (so it can't cover 'Show sidebar'), and stops when the demo closes", async () => {
    await openDemo();
    expect(document.documentElement.style.getPropertyValue("--top-banner-height")).toMatch(/^\d+px$/);
    fireEvent.click(screen.getByRole("button", { name: "Exit demo" }));
    expect(document.documentElement.style.getPropertyValue("--top-banner-height")).toBe("");
  });
  it("Settings: themes really change, the tour replays, and the invite code is a sample that can't be real", async () => {
    await openDemo();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: /Settings/ });
    // Focus moves in just after the panel appears (React 19 may do this a
    // moment later than React 18, so wait for it).
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(within(dialog).getByText("DEMO-CODE")).toBeTruthy();
    expect(/^[0-9A-F]{8}$/.test("DEMO-CODE")).toBe(false); // real codes are 8 characters of 0-9 and A-F
    expect(dialog.textContent).toMatch(/you@example\.com \(you\) · Owner/);
    expect(dialog.textContent).toMatch(/They're not part of the demo\./);
    fireEvent.click(within(dialog).getByRole("button", { name: /Dark — Midnight/ }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark-midnight");
    expect(localStorage.getItem("ledger-theme-v1")).toBe("dark-midnight");
    const tour = vi.fn();
    window.addEventListener("coinrose:start-tutorial", tour);
    fireEvent.click(within(dialog).getByRole("button", { name: "View tutorial" }));
    expect(tour).toHaveBeenCalledTimes(1);
    window.removeEventListener("coinrose:start-tutorial", tour);
    expect(screen.queryByRole("dialog", { name: /Settings/ })).toBeNull(); // Settings closed...
    expect(await screen.findByText("Welcome to Coinrose")).toBeTruthy(); // ...and the tour opened
  });
  it("Settings closes with Escape, returning focus to its button, and 'Create your account' leaves the demo", async () => {
    await openDemo();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement.textContent).toBe("Settings"));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create your account" }));
    expect(await screen.findByText("Welcome back")).toBeTruthy();
  });
});

describe("links to Help & FAQ", () => {
  it("Settings links to the help page", async () => {
    fake.reset({ membership: { household_id: "h1", role: "owner", households: household }, members: [owner] });
    render(<HouseholdGate><TheApp /></HouseholdGate>);
    await screen.findByText("the app");
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    expect((await screen.findByRole("link", { name: "Help & FAQ" })).getAttribute("href")).toBe("/help.html");
  });
  it("the demo's Settings links to it too", async () => {
    localStorage.setItem("coinrose-tutorial-seen-v1", "true");
    window.history.replaceState({}, "", "/#demo");
    render(<AuthGate><div>the app</div></AuthGate>);
    await screen.findByText("Sample Household Ledger", {}, { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Help & FAQ" }).getAttribute("href")).toBe("/help.html");
  });
});
