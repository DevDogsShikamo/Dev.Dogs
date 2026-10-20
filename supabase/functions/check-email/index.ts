import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { email } = await req.json();
    const domain = email?.split("@")[1]?.toLowerCase();
    if (!domain) return Response.json({ valid: false, reason: "no_domain" }, { headers: CORS });

    const records = await Deno.resolveDns(domain, "MX").catch(() => []);
    const valid = records.length > 0;

    return Response.json({ valid, reason: valid ? "ok" : "no_mx" }, { headers: CORS });
  } catch {
    return Response.json({ valid: false, reason: "error" }, { headers: CORS, status: 400 });
  }
});
