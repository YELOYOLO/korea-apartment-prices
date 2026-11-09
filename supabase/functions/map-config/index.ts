// map-config: public settings for the 지도 page. Only the NCP Maps Client ID, which the
// browser sends to Naver anyway (it is restricted to the registered Web 서비스 URLs).
// Public (verify_jwt = false), GET.
import { errorResponse, handler, json } from "../_shared/http.ts";

Deno.serve(
  handler(
    async () => {
      const id = Deno.env.get("NAVER_MAP_CLIENT_ID")?.trim();
      if (!id) return errorResponse(503, "map is not configured");
      return json({ naverMapClientId: id }, 200, { "Cache-Control": "public, max-age=3600" });
    },
    { methods: ["GET"] },
  ),
);
