// src/storageAdapter.js
// Same drop-in replacement for window.storage as before, but now scoped to
// a household rather than an individual user — so everyone in a household
// reads and writes the same data. Which household a request belongs to is
// resolved once (via household_members) and cached for the session.

import { supabase } from "./supabaseClient.js";

let cachedHouseholdId = null;

export function resetHouseholdCache() {
  cachedHouseholdId = null;
}

async function getHouseholdId() {
  if (cachedHouseholdId) return cachedHouseholdId;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) throw new Error("Not in a household yet");
  cachedHouseholdId = data.household_id;
  return cachedHouseholdId;
}

export const supabaseStorage = {
  async get(key, shared = false) {
    const household_id = await getHouseholdId();
    const { data, error } = await supabase
      .from("app_storage")
      .select("value")
      .eq("household_id", household_id)
      .eq("key", key)
      .eq("shared", shared)
      .maybeSingle();
    if (error || !data) throw new Error("Key not found: " + key);
    return { key, value: data.value, shared };
  },

  async set(key, value, shared = false) {
    const household_id = await getHouseholdId();
    const { error } = await supabase
      .from("app_storage")
      .upsert(
        { household_id, key, shared, value },
        { onConflict: "household_id,key,shared" }
      );
    if (error) {
      console.error("storage.set failed:", error.message);
      return null;
    }
    return { key, value, shared };
  },

  async delete(key, shared = false) {
    const household_id = await getHouseholdId();
    const { error } = await supabase
      .from("app_storage")
      .delete()
      .eq("household_id", household_id)
      .eq("key", key)
      .eq("shared", shared);
    if (error) {
      console.error("storage.delete failed:", error.message);
      return null;
    }
    return { key, deleted: true, shared };
  },

  async list(prefix = "", shared = false) {
    const household_id = await getHouseholdId();
    const { data, error } = await supabase
      .from("app_storage")
      .select("key")
      .eq("household_id", household_id)
      .eq("shared", shared)
      .like("key", prefix + "%");
    if (error) {
      console.error("storage.list failed:", error.message);
      return null;
    }
    return { keys: (data || []).map((r) => r.key), prefix, shared };
  },
};

window.storage = supabaseStorage;