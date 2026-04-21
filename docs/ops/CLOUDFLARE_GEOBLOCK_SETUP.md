# Cloudflare geo-block — paste-ready ops runbook

_Ship Task #3 sub-item (a): Tier-3 WAF block for OFAC-sanctioned jurisdictions + Ukrainian occupied subdivisions. Independent of the Paddle adapter (Task #1); safe to apply today._

**Owner:** founder (Cloudflare dashboard access lives on your side, not in this sandbox)
**Authoritative policy source:** `docs/GEO_LAUNCH_POLICY.md` §2 Tier 3 + §3.1
**Last updated:** 2026-04-21

---

## 1. What this rule does

Rejects all requests from IP addresses geolocated to:

| ISO | Jurisdiction | Basis |
|---|---|---|
| IR | Iran | OFAC comprehensive sanctions |
| SY | Syria | OFAC comprehensive sanctions |
| KP | North Korea | OFAC comprehensive sanctions |
| CU | Cuba | OFAC comprehensive sanctions |
| UA-43 | Crimea (AR of Crimea) | OFAC Crimea region sanctions (EO 13685) |
| UA-40 | Sevastopol | OFAC Crimea region sanctions (EO 13685) — **added here; missing from GEO_LAUNCH_POLICY.md §3.1 draft** |
| UA-14 | Donetsk oblast | OFAC DPR sanctions (EO 14065, 2022) |
| UA-09 | Luhansk oblast | OFAC LPR sanctions (EO 14065, 2022) |
| UA-65 | Kherson oblast | OFAC Kherson sanctions (EO 14065, Sep 2022 expansion) — **added here; missing from draft** |
| UA-23 | Zaporizhzhia oblast | OFAC Zaporizhzhia sanctions (EO 14065, Sep 2022 expansion) — **added here; missing from draft** |

**Policy-doc drift flagged:** the original GEO_LAUNCH_POLICY.md §3.1 listed only UA-43 / UA-14 / UA-09. Sevastopol (UA-40) has always been paired with Crimea in US sanctions (2014); Kherson (UA-65) + Zaporizhzhia (UA-23) were added to the sanctioned-region list in September 2022 alongside Donetsk and Luhansk. The expression below uses the full OFAC-current six subdivisions. Suggest back-porting the correction into GEO_LAUNCH_POLICY.md §3.1 at next review cadence (see §7 below).

---

## 2. Paste-ready WAF expression

Single-line, Cloudflare Ruleset Engine syntax (no comments — Ruleset Engine does not accept inline comments inside the expression):

```
(ip.src.country in {"IR" "SY" "KP" "CU"}) or (ip.src.subdivision_1_iso_code in {"UA-43" "UA-40" "UA-14" "UA-09" "UA-65" "UA-23"})
```

**Field naming note:** `ip.src.country` / `ip.src.subdivision_1_iso_code` are the current canonical fields. The legacy `ip.geoip.*` aliases still work but are deprecated.

**Action:** `Block`

**Rule name:** `tier3-ofac-geoblock`

---

## 3. Dashboard walkthrough (Cloudflare Free plan — 6 clicks)

1. Log in to Cloudflare → select the `pdfcraftai.com` zone.
2. Left nav → **Security** → **WAF** → **Custom rules** tab.
3. Click **Create rule**.
4. Fill in:
   - **Rule name:** `tier3-ofac-geoblock`
   - **When incoming requests match:** toggle to **"Edit expression"** (top-right of the expression builder) and paste the expression from §2.
   - **Then take action:** `Block`
5. Click **Deploy**.
6. Verify the rule appears as enabled (green toggle) at position 1 of the Custom Rules list.

Expected propagation: < 30 seconds to the global edge.

---

## 4. API alternative (for reproducibility / version control)

If you prefer to version the rule in `scripts/cloudflare/` rather than click-ops it, here's the equivalent API call.

Prereqs: a Cloudflare API token scoped to `Zone.WAF:Edit` for the `pdfcraftai.com` zone, plus the zone ID.

```bash
# Fetch zone ID (one-time; paste into .claude/secrets.env if you want to keep)
curl -sX GET "https://api.cloudflare.com/client/v4/zones?name=pdfcraftai.com" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | jq -r '.result[0].id'

# List existing rulesets on the zone to find the zone_custom entry-point ruleset ID
curl -sX GET "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/rulesets" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | jq '.result[] | select(.phase=="http_request_firewall_custom")'

# Create the rule (append to the zone_custom ruleset)
curl -sX POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/rulesets/$CF_RULESET_ID/rules" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "action": "block",
    "expression": "(ip.src.country in {\"IR\" \"SY\" \"KP\" \"CU\"}) or (ip.src.subdivision_1_iso_code in {\"UA-43\" \"UA-40\" \"UA-14\" \"UA-09\" \"UA-65\" \"UA-23\"})",
    "description": "tier3-ofac-geoblock",
    "enabled": true
  }'
```

Response includes the new rule ID — keep it for future edits. Consider committing a redacted version of the final rule JSON (with the ID + zone ID scrubbed) to `scripts/cloudflare/tier3-ofac-geoblock.json` as the version-controlled source of truth.

---

## 5. Free-tier caveat: 451 response code

GEO_LAUNCH_POLICY.md §3.1 specifies HTTP 451 "Unavailable For Legal Reasons" as the response. **WAF Custom Rule with `action: block` on the Cloudflare Free plan returns the default Cloudflare 1020 "Access Denied" page with HTTP 403, not 451.** Custom block response bodies + custom status codes are a Pro-plan feature.

Two options to reach the 451 spec:

### 5.1 Accept 403 as a fair-enough surrogate (recommended for v1)

Pros: free, zero extra moving parts, still meets the regulatory intent (user is refused service).
Cons: response is 403, not the arguably-more-correct 451. Most compliance reviewers accept 403 as equivalent.
**Decision to confirm with CA during consult (Task #2) and/or legal review before public launch.**

### 5.2 Use a Cloudflare Worker for a true 451 (free up to 100k requests/day)

Add a Worker route scoped to `pdfcraftai.com/*`, then route the Tier-3 geo decision through the Worker instead of (or in addition to) the WAF rule.

Worker code (paste into `workers/geoblock.js` — a template for when you add Workers to the stack):

```javascript
// pdfcraftai.com — Tier-3 geoblock Worker
// Deploy: wrangler deploy (or paste into Workers dashboard)
// Route: pdfcraftai.com/*

const TIER_3_COUNTRIES = new Set(["IR", "SY", "KP", "CU"]);
const TIER_3_SUBDIVISIONS = new Set([
  "UA-43", "UA-40",   // Crimea, Sevastopol
  "UA-14", "UA-09",   // Donetsk, Luhansk
  "UA-65", "UA-23",   // Kherson, Zaporizhzhia
]);

export default {
  async fetch(request, env, ctx) {
    const country = request.cf?.country ?? "XX";
    const subdivision = request.cf?.regionCode
      ? `${country}-${request.cf.regionCode}`
      : null;

    const blocked =
      TIER_3_COUNTRIES.has(country) ||
      (subdivision && TIER_3_SUBDIVISIONS.has(subdivision));

    if (blocked) {
      // Structured audit log for Workers Logs → retain 2 years per GEO_LAUNCH_POLICY §5
      console.log(JSON.stringify({
        event: "tier3_block",
        ts: new Date().toISOString(),
        country,
        subdivision,
        ip: request.headers.get("cf-connecting-ip"),
        path: new URL(request.url).pathname,
      }));

      return new Response(
        "<!DOCTYPE html><html><head><title>Unavailable For Legal Reasons</title></head>" +
        "<body style=\"font-family:sans-serif;max-width:600px;margin:4rem auto;padding:2rem\">" +
        "<h1>451 — Unavailable For Legal Reasons</h1>" +
        "<p>pdfcraftai.com cannot be accessed from this jurisdiction due to sanctions compliance.</p>" +
        "<p>If you believe this is an error, contact support@pdfcraftai.com.</p>" +
        "</body></html>",
        { status: 451, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }

    return fetch(request);
  },
};
```

**Do NOT deploy the Worker route yet** — it intercepts all traffic, which means a bad Worker breaks prod. Ship the §3 WAF rule first, verify (see §6), then move to the Worker if/when the 451 surrogate becomes a legal-review requirement.

---

## 6. Verification plan

After applying the WAF rule (§3), verify from three angles.

### 6.1 Allowed-country smoke (must stay 200)

```bash
# Your normal machine (IN/US/etc.) — should still 200
curl -sI https://pdfcraftai.com/ | head -n 3
curl -sI https://pdfcraftai.com/api/health | head -n 3
curl -sI https://pdfcraftai.com/api/payments/probe | head -n 3
```

### 6.2 Sanctioned-country synthetic test

Cloudflare doesn't expose a test endpoint that simulates a sanctioned-country source IP, so use one of:

**(a) VPN:** if you have a VPN with an Iranian or Cuban exit node (ProtonVPN has Iran; Cuba is rarely offered). Connect, then:
```bash
curl -sI https://pdfcraftai.com/
# Expected: HTTP/2 403 (or Cloudflare 1020 block page)
```

**(b) Ruleset Engine "Preview" mode:** in the Cloudflare dashboard, the rule edit view has a "Preview" button that replays sample traffic against the rule. Use it to confirm the expression parses.

**(c) Simulated header via page rule (temporary):** create a temporary Transform Rule that overwrites `ip.src.country` for requests carrying a specific test header, then remove the Transform Rule after verification. Fiddly; only do this if you don't have VPN access and can't wait for the first real Tier-3 request to hit.

### 6.3 Logging verification

- Cloudflare dashboard → Security → Events → filter by Service = "WAF" and Action = "Block". Confirm the rule ID from §4 appears.
- If on the Worker path (§5.2), Cloudflare dashboard → Workers & Pages → your worker → **Logs** tab → confirm the `tier3_block` JSON entries are landing.

### 6.4 Paper-trail what you did

After the rule is live + verified, append to this doc (or to `docs/STATUS.md` Task #3 section) the following evidence:

- Timestamp of rule creation (UTC)
- Rule ID from §4 response
- Screenshot or text dump of the 403 response from a Tier-3 IP (or the Preview result)
- First 24 h Tier-3 block count from Security → Events (for the quarterly review metric)

---

## 7. Quarterly review checklist (per GEO_LAUNCH_POLICY §8)

Every quarter, re-run this checklist. First cadence entry: 2026-07-21.

- [ ] Re-scan OFAC SDN + sectoral sanctions list (https://sanctionssearch.ofac.treas.gov/) for any new comprehensive-country sanctions. If new country added, edit WAF rule expression.
- [ ] Re-scan UK HMT consolidated list (https://www.gov.uk/government/publications/the-uk-sanctions-list) for UK-only sanctions that may need mirroring.
- [ ] Re-scan EU consolidated sanctions list (https://webgate.ec.europa.eu/fsd/fsf) for EU-only sanctions.
- [ ] Audit Tier-3 block counts from Security → Events for the past quarter. Anomalous spike may indicate geo-data error or legitimate user hitting the block via VPN.
- [ ] Confirm WAF rule is still enabled + at position 1 in Custom Rules list (sometimes reorders after dashboard changes).
- [ ] If Sevastopol (UA-40) / Kherson (UA-65) / Zaporizhzhia (UA-23) status changes (e.g., Ukraine recaptures + OFAC delists), remove from expression.

---

## 8. Cross-references

- `docs/GEO_LAUNCH_POLICY.md` §3.1 — source policy (pending correction: add UA-40, UA-65, UA-23)
- `docs/STATUS.md` — Task #3 status entry
- `lib/payments/router.ts` — Tier-2 (deferred) + Tier-1 (allowed) checkout routing, deferred until Paddle keys land (Task #1)
- OFAC regulations cited: EO 13685 (Crimea, 2014), EO 14065 (DPR/LPR/Kherson/Zaporizhzhia, 2022)

---

## 9. Next steps after this rule lands

Once §3 is deployed and §6 verified, the remaining Task #3 sub-items are still blocked on the Paddle adapter (Task #1):

- `lib/payments/router.ts` — Tier-gate check, dispatch IN → Razorpay / Tier-1-rest → Paddle / Tier-2 → 403 "coming soon". Needs `paddle` provider registered (Task #1 keys + wire-up).
- Tier-2 deferred-region lead-capture form + email signup.
- Transform Rule to set a `x-tier` request header for server-side debugging (optional).

No code changes in this repo are required for §3 to go live — it's 100% edge-config.
