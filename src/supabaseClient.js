// src/supabaseClient.js
// Reads the project URL and publishable key from Vite env vars.
// Create a file named `.env.local` in your project root (same folder as
// package.json) with:
//
//   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
//   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
//
// Both values come from Supabase → Project Settings → API (the "API URL"
// and the "Publishable key"). The publishable key is safe to expose in
// client code — it's designed to be public; RLS is what actually protects
// the data. Never put a "secret" key (sb_secret_...) in the frontend.
//
// Add .env.local to your .gitignore so it doesn't get committed.
 
import { createClient } from "@supabase/supabase-js";
 
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
);