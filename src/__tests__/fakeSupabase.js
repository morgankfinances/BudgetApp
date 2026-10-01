// A stand-in for the Supabase client used by the sign-in, disclosure, and
// household screens. Tests set `sb.state` to describe the world, and read
// `sb.calls` to see what the screens asked for.
export function makeFakeSupabase() {
  const sb = {
    state: {},
    calls: [],
    authListener: null,
    reset(state = {}) {
      this.calls = [];
      this.state = {
        session: null, user: { id: "u1" }, membership: null, myRequest: null, requests: [], members: [], changeSets: [],
        newHouseholdCode: "NEWCODE1", rpc: {}, auth: {}, ...state,
      };
    },
  };
  const record = (name, args) => sb.calls.push({ name, args });
  const result = (name, fallback) => {
    const r = sb.state.rpc[name] ?? sb.state.auth[name];
    return typeof r === "function" ? r() : (r ?? fallback);
  };
  function from(table) {
    const b = {
      select: () => b, eq: () => b, order: () => b, limit: () => b,
      maybeSingle: async () => {
        record(`from:${table}:single`);
        if (table === "household_members") return { data: sb.state.membership, error: null };
        if (table === "household_join_requests") return { data: sb.state.myRequest, error: null };
        if (table === "households") return { data: { invite_code: sb.state.newHouseholdCode }, error: null };
        return { data: null, error: null };
      },
      then: (res, rej) => {
        record(`from:${table}`);
        const data = table === "household_join_requests" ? sb.state.requests : table === "ledger_change_sets" ? sb.state.changeSets : [];
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return b;
  }
  sb.client = {
    from,
    rpc: async (name, args) => {
      record(`rpc:${name}`, args);
      return result(name, { data: name === "get_household_members" ? sb.state.members : null, error: null });
    },
    auth: {
      getSession: async () => ({ data: { session: sb.state.session } }),
      getUser: async () => ({ data: { user: sb.state.user } }),
      onAuthStateChange: (cb) => { sb.authListener = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async (args) => { record("auth:signInWithPassword", args); return result("signInWithPassword", { error: null }); },
      signInWithOtp: async (args) => { record("auth:signInWithOtp", args); return result("signInWithOtp", { error: null }); },
      resetPasswordForEmail: async (email, opts) => { record("auth:resetPasswordForEmail", { email, ...opts }); return result("resetPasswordForEmail", { error: null }); },
      updateUser: async (args) => { record("auth:updateUser", args); return result("updateUser", { error: null }); },
      reauthenticate: async () => { record("auth:reauthenticate"); return result("reauthenticate", { error: null }); },
      signOut: async (args) => { record("auth:signOut", args); return { error: null }; },
      refreshSession: async () => { record("auth:refreshSession"); return { data: {}, error: null }; },
      // Two-step sign-in (authenticator app codes), like Supabase's.
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: sb.state.mfaLevel || { currentLevel: "aal1", nextLevel: "aal1" }, error: null }),
        listFactors: async () => {
          const all = sb.state.mfaFactors || [];
          return { data: { totp: all.filter((f) => f.status === "verified"), all }, error: null };
        },
        enroll: async (args) => {
          record("mfa:enroll", args);
          sb.state.mfaFactors = [...(sb.state.mfaFactors || []), { id: "f-new", status: "unverified" }];
          return { data: { id: "f-new", totp: { qr_code: "<svg xmlns='http://www.w3.org/2000/svg'/>", secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Coinrose" } }, error: null };
        },
        challengeAndVerify: async (args) => {
          record("mfa:challengeAndVerify", args);
          if (sb.state.mfaVerifyFails) return { data: null, error: new Error("Invalid TOTP code entered") };
          sb.state.mfaFactors = (sb.state.mfaFactors || []).map((f) => (f.id === args.factorId ? { ...f, status: "verified" } : f));
          sb.state.mfaLevel = { currentLevel: "aal2", nextLevel: "aal2" };
          return { data: {}, error: null };
        },
        unenroll: async (args) => {
          record("mfa:unenroll", args);
          if (sb.state.mfaUnenrollFails) return { data: null, error: new Error("AAL2 required") };
          sb.state.mfaFactors = (sb.state.mfaFactors || []).filter((f) => f.id !== args.factorId);
          return { data: {}, error: null };
        },
      },
    },
  };
  sb.reset();
  sb.called = (name) => sb.calls.filter((c) => c.name === name);
  return sb;
}
