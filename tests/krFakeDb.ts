// Minimal in-memory stand-in for the Supabase client calls the Korea sync jobs make.
export function fakeDb(settings: Record<string, unknown>, state: Array<{ job: string; key: string; fetched_at: string | null }> = []) {
  const upserts: Array<{ table: string; rows: Array<Record<string, unknown>>; onConflict?: string }> = [];
  const db = {
    from(table: string) {
      return {
        select: () => ({
          eq: (_col: string, value: string) => {
            const rows = table === "kr_sync_state" ? state.filter((s) => s.job === value) : [];
            const p = Promise.resolve({ data: rows, error: null });
            return Object.assign(p, {
              maybeSingle: async () => ({ data: table === "app_settings" && settings[value] !== undefined ? { value: settings[value] } : null, error: null }),
            });
          },
        }),
        upsert: async (rows: Array<Record<string, unknown>>, o?: { onConflict?: string }) => {
          upserts.push({ table, rows, onConflict: o?.onConflict });
          return { error: null };
        },
      };
    },
  };
  return { db: db as never, upserts, of: (table: string) => upserts.filter((u) => u.table === table).flatMap((u) => u.rows) };
}
