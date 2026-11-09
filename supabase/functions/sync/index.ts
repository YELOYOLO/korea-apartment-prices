// sync: one batch of the nationwide data syncs, called hourly by pg_cron.
//   {"job": "trades"}    국토교통부 아파트 매매 실거래가 -> kr_apt_trades
//   {"job": "auctions"}  온비드 공매 부동산 (주거용) -> kr_auction_items
// Service role only (verify_jwt = true). Keys: MOLIT_SERVICE_KEY (data.go.kr);
// ONBID_SERVICE_KEY falls back to it. Without a key a job reports configured: false.
import { handler, HttpError, json, readJsonObject } from "../_shared/http.ts";
import { fetchMolitAptTrades } from "../_shared/kr/molit.ts";
import { fetchOnbidSido } from "../_shared/kr/onbid.ts";
import { planAuctionSync, planTradeSync } from "../_shared/kr/sync.ts";
import { syncKrAuctions } from "../_shared/krAuctions.ts";
import { syncKrTrades, type KrTradesDb } from "../_shared/krTrades.ts";
import { env, requireServiceRole, serviceClient } from "../_shared/supabase.ts";

Deno.serve(
  handler(async (req) => {
    requireServiceRole(req);
    const { job } = await readJsonObject(req);
    const db = serviceClient() as unknown as KrTradesDb;
    try {
      if (job === "trades") {
        const molit = { fetchMolitAptTrades: (p: Parameters<typeof fetchMolitAptTrades>[0]) => fetchMolitAptTrades(p), planTradeSync };
        return json({ job, result: await syncKrTrades(db, molit, { serviceKey: env("MOLIT_SERVICE_KEY") }) });
      }
      if (job === "auctions") {
        const onbid = { fetchOnbidSido: (p: Parameters<typeof fetchOnbidSido>[0]) => fetchOnbidSido(p), planAuctionSync };
        return json({ job, result: await syncKrAuctions(db, onbid, { serviceKey: env("ONBID_SERVICE_KEY") ?? env("MOLIT_SERVICE_KEY") }) });
      }
    } catch (err) {
      console.error(`sync ${job} failed`, err);
      throw new HttpError(500, `sync ${job} failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500), "SYNC_FAILED");
    }
    throw new HttpError(400, 'job must be "trades" or "auctions"');
  }),
);
