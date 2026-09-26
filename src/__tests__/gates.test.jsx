import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, within, act, waitFor } from "@testing-library/react";
import { makeFakeSupabase } from "./fakeSupabase.js";

const sb = vi.hoisted(() => ({ current: null }));
vi.mock("../supabaseClient.js", () => ({ get supabase() { return sb.current.client; } }));
vi.mock("../storageAdapter.js", () => ({ resetHouseholdCache: () => {} }));
sb.current = makeFakeSupabase();
const fake = sb.current;
const { default: AuthGate } = await import("../authGate.jsx");
const { default: DisclosureGate } = await import("../disclosureGate.jsx");
const { default: HouseholdGate } = await import("../householdGate.jsx");
const { AppErrorBoundary } = await import("../monitoring.jsx");

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const future = new Date(Date.UTC(2026, 9, 1)).toISOString();
const household = { id: "h1", name: "Alchemist Household", invite_code: "B9FD74DD", invite_code_expires_at: future };
const owner = { user_id: "u1", email: "morgan@example.com", role: "owner" };
const partner = { user_id: "u2", email: "partner@example.com", role: "member" };
beforeEach(() => { fake.reset(); window.history.replaceState({}, "", "/"); document.documentElement.removeAttribute("data-theme"); });

describe("sign-in", () => {
  const signedOut = async () => { render(<AuthGate><div>the app</div></AuthGate>); await screen.findByText("Welcome back"); };

  it("signed-in people go straight to the app", async () => {
    fake.state.session = { user: { id: "u1" } };
    render(<AuthGate><div>the app</div></AuthGate>);
    expect(await screen.findByText("the app")).toBeTruthy();
  });
  it("password sign-in; a wrong password gets a message that doesn't reveal whether the account exists", async () => {
    fake.state.auth.signInWithPassword = { error: { message: "Invalid login credentials" } };
    await signedOut();
    expect(document.title).toBe("Sign In | Coinrose");
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
    expect(document.title).toBe("Reset Password | Coinrose");
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
    expect(document.title).toBe("Choose a New Password | Coinrose");
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
    expect(document.title).toBe("Before You Get Started | Coinrose");
    fireEvent.click(screen.getByRole("button", { name: "I understand, continue" }));
    expect(screen.getByText("the app")).toBeTruthy();
    document.title = "Budget | Coinrose";
    act(() => window.dispatchEvent(new Event("coinrose:show-disclosure")));
    expect(screen.getByText("About this app")).toBeTruthy();
    expect(document.title).toBe("About This App | Coinrose");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("About this app")).toBeNull();
    expect(document.title).toBe("Budget | Coinrose");
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
    render(<HouseholdGate><div>the app</div></HouseholdGate>);
    await screen.findByText("Set up your household");
    expect(document.title).toBe("Set Up Your Household | Coinrose");
    fireEvent.change(screen.getByPlaceholderText("Household name (optional)"), { target: { value: "The Keller House" } });
    fireEvent.click(screen.getByRole("button", { name: "Create a new household" }));
    expect(await screen.findByText("NEWCODE1")).toBeTruthy();
    expect(fake.called("rpc:create_household")[0].args).toEqual({ p_name: "The Keller House" });
    fake.state.membership = { household_id: "h1", role: "owner", households: household };
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("the app")).toBeTruthy();
  });
  it("joining with a code waits for approval; a declined request can try another code", async () => {
    render(<HouseholdGate><div>the app</div></HouseholdGate>);
    await screen.findByText("Set up your household");
    fake.state.myRequest = { id: "r1", status: "pending" };
    fireEvent.change(screen.getByPlaceholderText("Enter invite code"), { target: { value: " b9fd74dd " } });
    fireEvent.click(screen.getByRole("button", { name: "Request to join" }));
    expect(await screen.findByText("Waiting for approval")).toBeTruthy();
    expect(fake.called("rpc:request_join_household")[0].args).toEqual({ p_invite_code: "b9fd74dd" });
  });
  it("a declined request can start over", async () => {
    fake.state.myRequest = { id: "r1", status: "denied" };
    render(<HouseholdGate><div>the app</div></HouseholdGate>);
    await screen.findByText("Request not approved");
    fireEvent.click(screen.getByRole("button", { name: "Try a different code" }));
    expect(screen.getByText("Set up your household")).toBeTruthy();
  });
  it("a bad invite code shows why", async () => {
    fake.state.rpc.request_join_household = { error: { message: "Invalid invite code" } };
    render(<HouseholdGate><div>the app</div></HouseholdGate>);
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
    render(<HouseholdGate><div>the app</div></HouseholdGate>);
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
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    spy.mockRestore();
  });
});
