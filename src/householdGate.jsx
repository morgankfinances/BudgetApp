// src/HouseholdGate.jsx
// Sits between AuthGate and App. Handles the full household lifecycle:
//   - "none": no household and no pending request -> create or request to join
//   - "pending": a join request is out, waiting on an existing member
//   - "denied": the last request was turned down
//   - "ready": an actual member -> renders the app, plus a floating
//     "Household" button (badged with pending-request count) that opens a
//     panel to view members, remove someone, view/regenerate the invite
//     code, and approve/deny anyone waiting to join.

import React, { useState, useEffect } from "react";
import { supabase } from "./supabaseClient.js";
import { resetHouseholdCache } from "./storageAdapter.js";

const boxStyle = {
  display: "flex",
  minHeight: "100vh",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "sans-serif",
};

const inputStyle = {
  width: "100%",
  padding: 10,
  marginBottom: 8,
  boxSizing: "border-box",
  fontSize: 14,
};

const buttonStyle = { width: "100%", padding: 10, fontSize: 14 };

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
  fontFamily: "sans-serif",
};

const cardStyle = {
  width: 380,
  maxHeight: "85vh",
  overflowY: "auto",
  background: "#fff",
  borderRadius: 8,
  padding: 24,
  boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
};

const sectionLabelStyle = {
  fontSize: 11.5,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#888",
  margin: "18px 0 8px",
  fontWeight: 600,
};

const rowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 0",
  borderBottom: "1px solid #eee",
  fontSize: 13.5,
  gap: 8,
};

const smallBtnStyle = {
  padding: "5px 10px",
  fontSize: 12,
  cursor: "pointer",
  border: "1px solid #ccc",
  borderRadius: 5,
  background: "#fff",
};

function formatExpiry(expiresAt) {
  if (!expiresAt) return null;
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return { text: "Expired", expired: true };
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return { text: `Expires in ${days} day${days === 1 ? "" : "s"}`, expired: false };
}

// Has to match the STORAGE_KEY constant in App.jsx — that's the one blob
// this whole app reads and writes, and the one history tracks.
const LEDGER_STORAGE_KEY = "ledger-data-v1";

function formatRelativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function HistorySection() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState(null);

  async function loadHistory() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc("list_storage_history", {
      p_key: LEDGER_STORAGE_KEY,
      p_shared: false,
    });
    if (error) setError(error.message);
    setEntries(data || []);
    setLoading(false);
  }

  function handleOpen() {
    setOpen(true);
    loadHistory();
  }

  async function handleRestore(id) {
    setRestoring(true);
    setError(null);
    const { error } = await supabase.rpc("restore_storage_history", { p_history_id: id });
    if (error) {
      setRestoring(false);
      setError(error.message);
      return;
    }
    // The live data changed out from under the already-loaded app, so
    // reload to pick up the restored version cleanly.
    window.location.reload();
  }

  return (
    <>
      <div style={sectionLabelStyle}>Data history</div>
      {!open ? (
        <button style={{ ...buttonStyle, marginBottom: 8 }} onClick={handleOpen}>
          View history
        </button>
      ) : (
        <>
          <p style={{ fontSize: 12.5, color: "#888", marginBottom: 8 }}>
            Every past version of your data, kept for 7 days. Restoring replaces everything currently in the
            app with that older version — it's not a way to bring back just one item.
          </p>
          {loading ? (
            <p style={{ fontSize: 13, color: "#666" }}>Loading…</p>
          ) : entries.length === 0 ? (
            <p style={{ fontSize: 13, color: "#666" }}>No earlier versions yet.</p>
          ) : (
            entries.map((entry) => (
              <div style={rowStyle} key={entry.id}>
                <span>{formatRelativeTime(entry.archived_at)}</span>
                {confirmingId === entry.id ? (
                  <span style={{ display: "flex", gap: 6 }}>
                    <button
                      style={{ ...smallBtnStyle, borderColor: "#b3261e", color: "#b3261e" }}
                      onClick={() => handleRestore(entry.id)}
                      disabled={restoring}
                    >
                      {restoring ? "Restoring…" : "Confirm"}
                    </button>
                    <button style={smallBtnStyle} onClick={() => setConfirmingId(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button style={smallBtnStyle} onClick={() => setConfirmingId(entry.id)}>
                    Restore
                  </button>
                )}
              </div>
            ))
          )}
          {error && <p style={{ color: "#b3261e", fontSize: 13 }}>{error}</p>}
        </>
      )}
    </>
  );
}

function MemberRow({ member, currentUserId, onRemove }) {
  const [confirming, setConfirming] = useState(false);
  const isSelf = member.user_id === currentUserId;

  return (
    <div style={rowStyle}>
      <span>
        {member.email}
        {isSelf ? " (you)" : ""}
      </span>
      {!isSelf &&
        (confirming ? (
          <span style={{ display: "flex", gap: 6 }}>
            <button
              style={{ ...smallBtnStyle, borderColor: "#b3261e", color: "#b3261e" }}
              onClick={() => onRemove(member.user_id)}
            >
              Confirm
            </button>
            <button style={smallBtnStyle} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button style={smallBtnStyle} onClick={() => setConfirming(true)}>
            Remove
          </button>
        ))}
    </div>
  );
}

function RequestRow({ request, onApprove, onDeny }) {
  return (
    <div style={rowStyle}>
      <span>{request.requester_email || "Unknown"}</span>
      <span style={{ display: "flex", gap: 6 }}>
        <button
          style={{ ...smallBtnStyle, borderColor: "#3f7d5c", color: "#3f7d5c" }}
          onClick={() => onApprove(request.id)}
        >
          Approve
        </button>
        <button
          style={{ ...smallBtnStyle, borderColor: "#b3261e", color: "#b3261e" }}
          onClick={() => onDeny(request.id)}
        >
          Deny
        </button>
      </span>
    </div>
  );
}

function HouseholdPanel({ onClose, onDataChanged }) {
  const [household, setHousehold] = useState(null);
  const [members, setMembers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [leaveConfirming, setLeaveConfirming] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    setCurrentUserId(user.id);

    const { data: membership, error: membershipError } = await supabase
      .from("household_members")
      .select("household_id, households(id, name, invite_code, invite_code_expires_at)")
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError || !membership) {
      setError("Couldn't load household info.");
      setLoading(false);
      return;
    }

    setHousehold(membership.households);

    const [{ data: memberData }, { data: requestData }] = await Promise.all([
      supabase.rpc("get_household_members", { p_household_id: membership.household_id }),
      supabase
        .from("household_join_requests")
        .select("id, requester_email, created_at")
        .eq("household_id", membership.household_id)
        .eq("status", "pending")
        .order("created_at"),
    ]);

    setMembers(memberData || []);
    setRequests(requestData || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRegenerate() {
    if (!household) return;
    setRegenerating(true);
    setError(null);
    const { error } = await supabase.rpc("regenerate_invite_code", {
      p_household_id: household.id,
    });
    setRegenerating(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  function handleCopy() {
    if (!household) return;
    navigator.clipboard?.writeText(household.invite_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleApprove(requestId) {
    setError(null);
    const { error } = await supabase.rpc("approve_join_request", { p_request_id: requestId });
    if (error) {
      setError(error.message);
      return;
    }
    load();
    onDataChanged?.();
  }

  async function handleDeny(requestId) {
    setError(null);
    const { error } = await supabase.rpc("deny_join_request", { p_request_id: requestId });
    if (error) {
      setError(error.message);
      return;
    }
    load();
    onDataChanged?.();
  }

  async function handleRemove(targetUserId) {
    if (!household) return;
    setError(null);
    const { error } = await supabase.rpc("remove_household_member", {
      p_household_id: household.id,
      p_target_user_id: targetUserId,
    });
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  async function handleLeave() {
    setError(null);
    const { error } = await supabase.rpc("leave_household");
    if (error) {
      setError(error.message);
      return;
    }
    window.location.reload();
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  const expiry = household ? formatExpiry(household.invite_code_expires_at) : null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, marginBottom: 4, fontSize: 18 }}>Settings</h2>

        {loading ? (
          <p style={{ fontSize: 14, color: "#666" }}>Loading…</p>
        ) : household ? (
          <>
            <p style={{ fontSize: 14, color: "#555", marginBottom: 4 }}>{household.name}</p>

            <div style={sectionLabelStyle}>Members</div>
            {members.map((m) => (
              <MemberRow key={m.user_id} member={m} currentUserId={currentUserId} onRemove={handleRemove} />
            ))}

            {requests.length > 0 && (
              <>
                <div style={sectionLabelStyle}>Waiting to join ({requests.length})</div>
                {requests.map((r) => (
                  <RequestRow key={r.id} request={r} onApprove={handleApprove} onDeny={handleDeny} />
                ))}
              </>
            )}

            <div style={sectionLabelStyle}>Invite code</div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: 3,
                padding: 12,
                textAlign: "center",
                border: "1px solid #ccc",
                borderRadius: 6,
                marginBottom: 8,
                fontFamily: "monospace",
              }}
            >
              {household.invite_code}
            </div>
            {expiry && (
              <p style={{ fontSize: 12.5, color: expiry.expired ? "#b3261e" : "#888", marginBottom: 14 }}>
                {expiry.text}
              </p>
            )}
            <p style={{ fontSize: 12.5, color: "#888", marginBottom: 14 }}>
              Anyone who enters this code will show up above under "Waiting to join" until you approve them —
              they won't see any data until then.
            </p>
            <button style={{ ...buttonStyle, marginBottom: 8 }} onClick={handleCopy}>
              {copied ? "Copied!" : "Copy code"}
            </button>
            <button
              style={{ ...buttonStyle, marginBottom: 8 }}
              onClick={handleRegenerate}
              disabled={regenerating}
            >
              {regenerating ? "Generating…" : "Generate a new code"}
            </button>
            {error && <p style={{ color: "#b3261e", fontSize: 13 }}>{error}</p>}

            <HistorySection />
          </>
        ) : (
          <p style={{ color: "#b3261e", fontSize: 13 }}>{error}</p>
        )}

        <div style={sectionLabelStyle}>Account</div>
        {leaveConfirming ? (
          <div style={{ marginBottom: 8 }}>
            <p style={{ fontSize: 12.5, color: "#b3261e", marginBottom: 8 }}>
              You'll get a personal copy of the current data, and lose access to this household going forward.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={{ ...buttonStyle, borderColor: "#b3261e", color: "#b3261e", border: "1px solid #b3261e" }}
                onClick={handleLeave}
              >
                Confirm leave
              </button>
              <button style={buttonStyle} onClick={() => setLeaveConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button style={{ ...buttonStyle, marginBottom: 8 }} onClick={() => setLeaveConfirming(true)}>
            Leave this household
          </button>
        )}
        <button style={{ ...buttonStyle, marginBottom: 8 }} onClick={handleSignOut}>
          Sign out
        </button>

        <button
          style={{ ...buttonStyle, marginTop: 8, background: "none", border: "1px solid #ddd" }}
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}

export default function HouseholdGate({ children }) {
  const [status, setStatus] = useState("checking"); // checking | none | pending | denied | ready
  const [householdName, setHouseholdName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [createdCode, setCreatedCode] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  async function refreshPendingCount(householdId) {
    if (!householdId) {
      setPendingCount(0);
      return;
    }
    const { data } = await supabase
      .from("household_join_requests")
      .select("id")
      .eq("household_id", householdId)
      .eq("status", "pending");
    setPendingCount((data || []).length);
  }

  async function checkMembership() {
    setStatus("checking");
    resetHouseholdCache();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: membership } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (membership) {
      setStatus("ready");
      refreshPendingCount(membership.household_id);
      return;
    }

    const { data: request } = await supabase
      .from("household_join_requests")
      .select("id, status")
      .eq("requester_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (request && request.status === "pending") {
      setStatus("pending");
    } else if (request && request.status === "denied") {
      setStatus("denied");
    } else {
      setStatus("none");
    }
  }

  useEffect(() => {
    checkMembership();
  }, []);

  // Poll for a decision while waiting on approval.
  useEffect(() => {
    if (status !== "pending") return;
    const interval = setInterval(checkMembership, 8000);
    return () => clearInterval(interval);
  }, [status]);

  // Periodically refresh the pending-request badge while inside the app.
  useEffect(() => {
    if (status !== "ready") return;
    const interval = setInterval(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: membership } = await supabase
        .from("household_members")
        .select("household_id")
        .eq("user_id", user.id)
        .maybeSingle();
      refreshPendingCount(membership?.household_id);
    }, 30000);
    return () => clearInterval(interval);
  }, [status]);

  async function handleCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data: householdId, error } = await supabase.rpc("create_household", {
      p_name: householdName.trim() || "My Household",
    });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const { data: hh } = await supabase
      .from("households")
      .select("invite_code")
      .eq("id", householdId)
      .maybeSingle();
    setBusy(false);
    resetHouseholdCache();
    setCreatedCode(hh?.invite_code || null);
  }

  async function handleRequestJoin(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("request_join_household", {
      p_invite_code: joinCode.trim(),
    });
    setBusy(false);
    if (error) {
      setError(error.message || "Couldn't request to join with that code.");
      return;
    }
    checkMembership();
  }

  if (status === "checking") {
    return <div style={{ ...boxStyle, color: "#666" }}>Loading…</div>;
  }

  if (status === "pending") {
    return (
      <div style={boxStyle}>
        <div style={{ width: 360, textAlign: "center" }}>
          <h2 style={{ marginBottom: 4 }}>Waiting for approval</h2>
          <p style={{ fontSize: 14, color: "#555" }}>
            Your request to join has been sent. Someone already in the household needs to approve you before
            you can see anything — this page will update automatically once they do.
          </p>
          <button
            style={{ ...buttonStyle, marginTop: 12, background: "none", border: "1px solid #ddd" }}
            onClick={() => supabase.auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div style={boxStyle}>
        <div style={{ width: 360, textAlign: "center" }}>
          <h2 style={{ marginBottom: 4 }}>Request not approved</h2>
          <p style={{ fontSize: 14, color: "#555", marginBottom: 16 }}>
            Your request to join wasn't approved. Double check the code with whoever sent it, or try again.
          </p>
          <button style={buttonStyle} onClick={() => setStatus("none")}>
            Try a different code
          </button>
          <button
            style={{ ...buttonStyle, marginTop: 8, background: "none", border: "1px solid #ddd" }}
            onClick={() => supabase.auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (status === "none") {
    if (createdCode) {
      return (
        <div style={boxStyle}>
          <div style={{ width: 360 }}>
            <h2 style={{ marginBottom: 4 }}>Household created</h2>
            <p style={{ fontSize: 14, color: "#444" }}>
              Share this code with whoever you want to join. When they enter it, you'll see a request waiting
              for your approval in the Household panel — nothing is shared until you approve it.
            </p>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 3,
                padding: 14,
                textAlign: "center",
                border: "1px solid #ccc",
                borderRadius: 6,
                margin: "14px 0",
                fontFamily: "monospace",
              }}
            >
              {createdCode}
            </div>
            <button style={buttonStyle} onClick={checkMembership}>
              Continue
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={boxStyle}>
        <div style={{ width: 360 }}>
          <h2 style={{ marginBottom: 4 }}>Set up your household</h2>
          <p style={{ fontSize: 14, color: "#555" }}>
            Create a new household, or request to join one with an invite code someone shared with you.
          </p>

          <form onSubmit={handleCreate} style={{ marginTop: 20 }}>
            <input
              type="text"
              placeholder="Household name (optional)"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
              style={inputStyle}
            />
            <button type="submit" disabled={busy} style={buttonStyle}>
              Create a new household
            </button>
          </form>

          <div style={{ textAlign: "center", margin: "16px 0", color: "#999", fontSize: 12 }}>— or —</div>

          <form onSubmit={handleRequestJoin}>
            <input
              type="text"
              required
              placeholder="Enter invite code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              style={inputStyle}
            />
            <button type="submit" disabled={busy} style={buttonStyle}>
              Request to join
            </button>
          </form>

          {error && <p style={{ color: "#b3261e", fontSize: 13 }}>{error}</p>}

          <button
            style={{ ...buttonStyle, marginTop: 8, background: "none", border: "1px solid #ddd" }}
            onClick={() => supabase.auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      <button
        onClick={() => setPanelOpen(true)}
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          padding: "8px 14px",
          fontSize: 12.5,
          fontFamily: "sans-serif",
          background: "#fff",
          border: "1px solid #ccc",
          borderRadius: 6,
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          zIndex: 50,
        }}
      >
        Settings
        {pendingCount > 0 && (
          <span
            style={{
              marginLeft: 6,
              background: "#b3261e",
              color: "#fff",
              borderRadius: 999,
              padding: "1px 6px",
              fontSize: 11,
            }}
          >
            {pendingCount}
          </span>
        )}
      </button>
      {panelOpen && (
        <HouseholdPanel onClose={() => setPanelOpen(false)} onDataChanged={checkMembership} />
      )}
    </>
  );
}