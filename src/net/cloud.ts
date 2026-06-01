/** Supabase cloud persistence for levels + a global high-score board.
 * The publishable (anon) key is safe to ship client-side; access is governed by
 * the table RLS policies (see the SQL in README/below). */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ufpiweuhvnefmrjfopso.supabase.co";
const SUPABASE_KEY = "sb_publishable_pHBuzNrxkC2Yn6d31OAmrg_LeD2oMAv";

const LEVELS_SLOT = "main"; // shared published level set

let client: SupabaseClient | null = null;
export function cloud(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}
export const cloudEnabled = () => cloud() !== null;

export interface CloudScore { name: string; score: number; }

/** Load the published level set (the per-maze edits map), or null. */
export async function cloudLoadLevels(): Promise<Record<string, unknown> | null> {
  const c = cloud(); if (!c) return null;
  try {
    const { data, error } = await c.from("levels").select("data").eq("slot", LEVELS_SLOT).maybeSingle();
    if (error) { console.warn("[cloud] load levels:", error.message); return null; }
    return (data?.data as Record<string, unknown>) ?? null;
  } catch (e) { console.warn("[cloud] load levels:", e); return null; }
}

/** Publish the level set (upsert by slot). Returns true on success. */
export async function cloudSaveLevels(data: Record<string, unknown>): Promise<boolean> {
  const c = cloud(); if (!c) return false;
  try {
    const { error } = await c.from("levels")
      .upsert({ slot: LEVELS_SLOT, data, updated_at: new Date().toISOString() }, { onConflict: "slot" });
    if (error) { console.warn("[cloud] save levels:", error.message); return false; }
    return true;
  } catch (e) { console.warn("[cloud] save levels:", e); return false; }
}

/** Top scores, descending. */
export async function cloudTopScores(limit = 10): Promise<CloudScore[]> {
  const c = cloud(); if (!c) return [];
  try {
    const { data, error } = await c.from("scores").select("name,score")
      .order("score", { ascending: false }).limit(limit);
    if (error) { console.warn("[cloud] scores:", error.message); return []; }
    return (data as CloudScore[]) ?? [];
  } catch (e) { console.warn("[cloud] scores:", e); return []; }
}

export async function cloudAddScore(name: string, score: number): Promise<void> {
  const c = cloud(); if (!c || score <= 0) return;
  try { await c.from("scores").insert({ name: name.slice(0, 8), score }); }
  catch (e) { console.warn("[cloud] add score:", e); }
}
