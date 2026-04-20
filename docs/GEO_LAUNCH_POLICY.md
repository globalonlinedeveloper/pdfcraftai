# pdfcraftai.com — Geographic Launch Policy

_Which countries we serve at launch, which we defer, and which we block. Drives the customer-geography mix used in `TAX_MODEL.md`, `GST_SETUP.md`, and `docs/payments/MOR_EVALUATION.md`._

**Last updated:** 2026-04-20
**Status:** Draft v1 — pending founder sign-off on D10 (EU launch posture) and D11 (US launch posture).

---

## 1. Why a geo-launch policy at all

pdfcraftai is a globally-accessible web SaaS. Every country the app is reachable from is, by default, a country where its laws may apply — VAT, GST, sales tax, data-protection (GDPR / CCPA / LGPD / PDPA), consumer-protection, accessibility (EU EAA 2025), content-moderation (DSA).

For a one-founder Indian sole prop at Phase 0, the compliance surface area of "open to everyone, everywhere" is infeasible. This doc partitions the world into three tiers:

- **Allow:** we actively target, invoice, and support these countries from day 1.
- **Defer:** reachable but not targeted; revisit as ARR + compliance budget grow.
- **Block:** geo-blocked at the Cloudflare edge; explicit checkout-refusal path.

The driver is **compliance cost per incremental dollar of revenue**, not TAM. A country that adds $500/month revenue but demands $2,000/month in tax+legal compliance is a net loss.

---

## 2. Tier definitions

### Tier 1 — **Allow** (target, invoice, support at launch)

| Country | Rail | Why | Compliance implication |
|---|---|---|---|
| **India** | Razorpay | Home market. GSTIN + LUT already required. | 18% GST on B2C; zero-rated on B2B export via Paddle. See `GST_SETUP.md`. |
| **United States** | Paddle | Largest SaaS market. Paddle handles 50-state sales tax via nexus rules. | Watch: each state has own economic-nexus threshold (~$100k revenue OR 200 transactions). Paddle handles registration + remittance; we monitor. |
| **United Kingdom** | Paddle | Mature digital-economy market, English-speaking. Paddle UK-domiciled, clean invoicing. | 20% VAT collected by Paddle. No direct compliance on us. |
| **Canada** | Paddle | Strong AI/productivity adoption. | GST/HST/QST (varies by province) handled by Paddle. No direct compliance. |
| **Australia** | Paddle | High-value market, English-speaking. | 10% GST on digital imports handled by Paddle. Registration threshold $75k AUD — irrelevant to us (Paddle registers). |
| **New Zealand** | Paddle | Small market but zero-friction. | 15% GST handled by Paddle. |
| **Singapore** | Paddle | Tech hub, English. | 9% GST-on-digital handled by Paddle. |
| **UAE** | Paddle | No personal income tax; business-heavy. | VAT 5% handled by Paddle. |
| **Rest of South/Southeast Asia** (PH, MY, TH, VN, ID) | Paddle | Strong organic growth potential; English websites common. | Local VAT/digital-service-tax handled by Paddle in each. |
| **Rest of Middle East / Africa** (SA, EG, NG, KE, ZA) | Paddle | Small volume but growing. Paddle handles. | Paddle-level compliance. |
| **Latin America** (BR, MX, CO, AR, CL, PE) | Paddle | Growing; Paddle registered in key countries. | Brazil has complex digital-service tax — Paddle handles but watch for BR-specific edge cases. |
| **Rest of Asia-Pacific** (JP, KR, TW, HK) | Paddle | Paddle handles consumption tax. Some language-localization challenges but not blocking. | Paddle-level compliance. |

### Tier 2 — **Defer** (reachable but not targeted; revisit as scale grows)

| Country / Region | Why deferred | Revisit trigger |
|---|---|---|
| **European Union (27 countries)** | GDPR + DSA + EU EAA 2025 + DMA obligations. Paddle handles VAT (OSS registered), but **content-moderation duties under DSA apply to the platform, not the MoR**. A one-founder platform responding to GDPR data-subject requests within 30 days is feasible but costly. EU users expect working EU-specific privacy language + DPO contact. Not a day-1 priority. | ARR crosses $5k MRR OR first dedicated compliance budget line. |
| **Switzerland** | Similar to EU — strong data-protection law (nFADP). Not large enough to justify dedicated work. | Paired with EU launch. |
| **Norway, Iceland, Liechtenstein** | EEA-equivalent GDPR obligations. | Paired with EU launch. |
| **China (mainland)** | Great Firewall, ICP licensing, data-localization — require local entity or partnership. Infeasible from India. | Long-term. |
| **Russia** | Sanctions overlay + data-localization (personal data must be stored in RU for RU users). | Indefinitely deferred. |
| **Belarus** | Sanctions overlay. | Indefinitely deferred. |

### Tier 3 — **Block** (geo-block at Cloudflare edge; refuse checkout)

| Country / Region | Why blocked |
|---|---|
| **OFAC-sanctioned countries** (Iran, Syria, North Korea, Cuba) | US-affiliated MoR (Paddle operates US entity) cannot legally transact. Must geo-block at edge. |
| **Crimea, Donetsk, Luhansk (Ukraine occupied territories)** | Sanctions overlay. |
| **Any future sanctioned state** | Monitor OFAC + UK HMT + EU sanctions lists quarterly. |

---

## 3. Implementation plan

### 3.1 Cloudflare geo-block (Tier 3)

Use Cloudflare WAF custom rule:

```
(ip.geoip.country in {"IR" "SY" "KP" "CU"}) or
(ip.geoip.subdivision_1_iso_code in {"UA-43"}) or  # Crimea
(ip.geoip.subdivision_1_iso_code in {"UA-14" "UA-09"})  # Donetsk, Luhansk oblasts
→ Action: Block
```

- Response: 451 "Unavailable For Legal Reasons"
- Logged, not silently dropped
- Updated quarterly from OFAC list

### 3.2 Checkout geo-gate (Tier 2)

For Tier 2 visitors (EU, Switzerland, etc. until launch), the **app still loads** but **checkout refuses**:

- `lib/payments/router.ts` checks `CF-IPCountry` header on every checkout request
- If country is in Tier 2, return 403 with a friendly "Not available in your region yet" page
- If country is in Tier 1, route to Razorpay (IN) or Paddle (rest)

Example router:

```typescript
const TIER_1_COUNTRIES = new Set([
  'IN', 'US', 'GB', 'CA', 'AU', 'NZ', 'SG', 'AE',
  'PH', 'MY', 'TH', 'VN', 'ID',
  'SA', 'EG', 'NG', 'KE', 'ZA',
  'BR', 'MX', 'CO', 'AR', 'CL', 'PE',
  'JP', 'KR', 'TW', 'HK'
]);

const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE',
  'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV',
  'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE'
]);

const TIER_3_COUNTRIES = new Set(['IR', 'SY', 'KP', 'CU']);

function routeCheckout(country: string) {
  if (TIER_3_COUNTRIES.has(country)) {
    return { action: 'block', status: 451, reason: 'Sanctioned jurisdiction' };
  }
  if (EU_COUNTRIES.has(country) || ['CH', 'NO', 'IS', 'LI'].includes(country)) {
    return { action: 'defer', status: 403, reason: 'Not yet available in the EU' };
  }
  if (country === 'IN') {
    return { action: 'checkout', rail: 'razorpay' };
  }
  if (TIER_1_COUNTRIES.has(country)) {
    return { action: 'checkout', rail: 'paddle' };
  }
  return { action: 'checkout', rail: 'paddle' };  // catchall — Paddle handles
}
```

### 3.3 UX for deferred users

Page copy for Tier 2 visitors hitting checkout:

> **We're not yet open for checkout in [country].**
>
> pdfcraftai is currently rolling out to India, the US, UK, Canada, Australia, and Asia-Pacific. We'll be expanding to the EU later this year once we have full GDPR/DSA compliance in place.
>
> Want to be notified when we launch in [country]? [email signup form]

No dead-end errors. Capture intent → use as demand signal for Tier 2 launch timing.

---

## 4. What this means for revenue modeling

| Scenario | Tier 1 % | Tier 2 % (deferred, not captured) | Tier 3 % |
|---|---|---|---|
| Launch mix (Q1 post-launch) | ~90% (US/IN/UK/CA dominate) | ~10% TAM leakage | <0.5% |
| Year 2 mix (Q1 2027) | ~95% | 5% TAM leakage | <0.5% |
| Year 3 with EU added | ~98% | 0% | <0.5% |

**Revenue math** (used in `TAX_MODEL.md` §4 scenarios):

- Tier 1 share → Razorpay (IN, 15%) + Paddle (rest, 85%)
- Tier 2 share → zero (blocked at checkout); counted as TAM leakage, not revenue
- Tier 3 share → zero (blocked at edge)

---

## 5. Legal / compliance artefacts per tier

### Tier 1 compliance checklist

- [x] India GST + LUT (see `GST_SETUP.md`)
- [ ] US: Paddle handles 50-state sales tax — ours is to monitor nexus trigger at $100k revenue OR 200 txn, then Paddle auto-registers in that state
- [ ] UK / EU-OSS: Paddle handles
- [ ] Canada / Australia / NZ / SG / UAE / rest of APAC + LatAm + Africa: Paddle handles
- [ ] Privacy policy covers **ALL** Tier 1 countries in a single global statement (CCPA + GDPR-light language, PIPEDA reference for Canada, LGPD for Brazil)
- [ ] Cookie consent banner on every page (Cloudflare Cookie Consent tool is free; must be active before first Tier 1 launch-day traffic)
- [ ] Accessibility (US ADA Section 508 + EU EAA) — audit at ARR $5k

### Tier 2 (deferred) compliance prep queue

When revisiting EU launch:
- [ ] GDPR Article 27 EU representative (required if no EU establishment)
- [ ] DPO (not required below certain thresholds but advisable)
- [ ] Updated privacy policy with EU-specific language
- [ ] DSR / DPA templates ready
- [ ] DSA compliance: illegal-content notification mechanism, transparency report readiness
- [ ] EU EAA (European Accessibility Act, June 2025) — WCAG 2.1 AA audit
- [ ] DMA — only applies if designated "gatekeeper" (we won't qualify for years)

### Tier 3 compliance

- [ ] Cloudflare rule configured + monitored
- [ ] Quarterly scan of OFAC / UK HMT / EU sanctions lists; update list as needed
- [ ] Log of all 451 responses for 2 years (in case a regulator asks)

---

## 6. Known edge cases

### 6.1 Traveller scenario

A US customer using a VPN in Iran triggers the edge block. **Acceptable false-positive** — we don't carve out for VPN-detection. If they complain, manual allowlist via IP.

### 6.2 Indian customer with foreign card

Card country ≠ IP country. Router uses `CF-IPCountry` for geo-gating, Razorpay uses card BIN for currency. We capture payment in INR regardless. No conflict.

### 6.3 EU citizen resident in Tier 1 country (e.g., German passport, lives in Singapore)

Geo-gate routes to Paddle (SG). GDPR does NOT follow the person — it follows the processing location. Since our processing is India + Paddle, and the user is in SG, GDPR doesn't directly apply to that transaction (they'd have to argue extra-territorial scope). Paddle handles SG GST.

### 6.4 Business customer in Tier 2 (EU)

Same as above — deferred until EU launch. Capture lead via "Notify me" form. Consider **enterprise sales manual-invoice channel** for urgent EU B2B needs ($5k+ deals only), processed via direct SWIFT + explicit ToS carveout. Not day-1.

---

## 7. Cloudflare free-tier fit

All geo-block + CF-IPCountry routing + bot rules required for this policy **fit in Cloudflare's free tier** for a site our size. No Cloudflare Enterprise needed.

The Cloudflare Zero Trust / Access layer (for admin dashboards) is also free up to 50 seats. We're one seat today.

---

## 8. Review cadence

- **Monthly** (first 6 months post-launch): traffic by Tier, conversion by Tier, Tier 2 "Notify me" signup rate
- **Quarterly:** OFAC / UK HMT / EU sanctions list update; revise Tier 3 if needed
- **Semi-annually:** Tier 2 → Tier 1 promotion decision (EU launch?)
- **Annually:** full policy refresh at FY boundary

---

## 9. Decisions (links to MASTER_PLAN §4)

- **D10** — Serve EU customers at launch? → **No. Defer until MRR > $5k.** (this doc)
- **D11** — Serve US customers at launch? → **Yes. Geo-allow US, monitor nexus thresholds.** (this doc)

Both decisions are now closed in this doc. Update MASTER_PLAN §4 accordingly.

---

## 10. Cross-references

- `TAX_MODEL.md` §2 Inputs — IN vs export revenue mix driven by this policy
- `GST_SETUP.md` §6 — invoice template depends on IN (Razorpay) vs export (Paddle) rail
- `docs/payments/MOR_EVALUATION.md` — Paddle chosen because it covers Tier 1 global mix
- `docs/MASTER_PLAN.md` §4 D10, D11
- `docs/PLAN_GAP_ANALYSIS.md` T2-G2 (EU VAT — defer closes the gap)

---

## 11. Disclaimer

Compliance laws change continuously. This policy is planning-grade as of 2026-04-20. Quarterly review is not optional.
