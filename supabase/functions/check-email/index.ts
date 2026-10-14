import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handle } from "./handler.js";

// App origins allowed to call this function, comma separated. Set it at deploy time:
//   supabase secrets set ALLOWED_ORIGINS=https://app.example.com --project-ref <ref>
// (localhost dev origins are always accepted by the handler).
const origins = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean);

serve((req) => handle(req, { origins, resolveMx: (domain: string) => Deno.resolveDns(domain, "MX") }));
