// src/storageAdapter.js
// Drop-in replacement for the artifact's window.storage API, backed by
// Supabase instead of localStorage. Same method shapes (get/set/delete/list,
// each taking a "shared" flag), so App.jsx's existing loadData/saveData
// calls work completely unchanged.
//
// Import this once, before your app renders (e.g. at the top of main.jsx),
// AFTER the user is signed in — every method here requires an active
// Supabase session, since rows are scoped to the signed-in user via RLS.

import { supabase } from "./supabaseClient.js";

async function getUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

export const supabaseStorage = {
  async get(key, shared = false) {
    const user_id = await getUserId();
    const { data, error } = await supabase
      .from("app_storage")
      .select("value")
      .eq("user_id", user_id)
      .eq("key", key)
      .eq("shared", shared)
      .maybeSingle();
    if (error || !data) throw new Error("Key not found: " + key);
    return { key, value: data.value, shared };
  },

  async set(key, value, shared = false) {
    const user_id = await getUserId();
    const { error } = await supabase
      .from("app_storage")
      .upsert(
        { user_id, key, shared, value },
        { onConflict: "user_id,key,shared" }
      );
    if (error) {
      console.error("storage.set failed:", error.message);
      return null;
    }
    return { key, value, shared };
  },

  async delete(key, shared = false) {
    const user_id = await getUserId();
    const { error } = await supabase
      .from("app_storage")
      .delete()
      .eq("user_id", user_id)
      .eq("key", key)
      .eq("shared", shared);
    if (error) {
      console.error("storage.delete failed:", error.message);
      return null;
    }
    return { key, deleted: true, shared };
  },

  async list(prefix = "", shared = false) {
    const user_id = await getUserId();
    const { data, error } = await supabase
      .from("app_storage")
      .select("key")
      .eq("user_id", user_id)
      .eq("shared", shared)
      .like("key", prefix + "%");
    if (error) {
      console.error("storage.list failed:", error.message);
      return null;
    }
    return { keys: (data || []).map((r) => r.key), prefix, shared };
  },
};

// The rest of the app (App.jsx) already calls window.storage.*, so wiring
// it here means nothing else in that ~2,300-line file has to change.
window.storage = supabaseStorage;