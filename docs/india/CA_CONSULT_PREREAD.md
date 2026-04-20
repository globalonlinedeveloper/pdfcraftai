# CA Consult — Pre-Read Memo

**Purpose:** This memo is an AI-researched pre-read to give your Chartered Accountant context before the consultation, so billable time is spent validating positions rather than on first-principles research. Each of the 15 questions below has an **indicative answer**, **legal basis** (statutory citations), **web research findings** with primary-source links, a **confidence level**, and **what to confirm with CA**.

**Scope:** 7 income-tax questions (from `docs/india/TAX_MODEL.md` §7) + 8 GST questions (from `docs/india/GST_SETUP.md` §14). All 15 are in numeric order: Q1–Q7 (income tax), then GST-A through GST-H (GST).

**How to use this with your CA:**
1. Send this memo + `TAX_MODEL.md` + `GST_SETUP.md` + `docs/payments/MOR_EVALUATION.md` to the CA 48 hours before the call.
2. During the call, walk through the "What to confirm with CA" subsection of each question. Get a written opinion (even a short email) on the questions marked **Confidence: Medium** — those are the ones where AI research alone cannot commit us to a position.
3. After the call, update this memo's "CA response" column (to be added at bottom) with the CA's written answer + any deviations from the indicative answer. Store the CA's written opinion in `docs/india/ca-opinions/` for audit defensibility.

---

## ⚠️ Disclaimer

**This memo is preliminary research material produced by an AI system, based on web-sourced practitioner commentary and statutory references. It is NOT legal advice, NOT tax advice, and NOT a substitute for a qualified Chartered Accountant's written opinion.** Web-search results may be outdated, misquoted, or misinterpreted; citations should be independently verified by the CA against current bare-act text, CBIC/CBDT circulars, and RBI/DGFT notifications. Do not act on any position in this memo without CA sign-off. All "indicative answers" are research hypotheses, not conclusions.

---

## Business profile (context for the CA)

- **Entity:** Individual sole-proprietor (as of 2026-04-20; incorporation TBD — see Q3)
- **Product:** `pdfcraftai.com` — self-serve subscription + credits SaaS for PDF processing with AI features
- **Revenue rails:** Razorpay (INR, Indian customers) + Paddle (USD/EUR, international customers as Merchant of Record)
- **Projected mix:** 40% INR / 60% international (modelled in `docs/ai/MARGIN_VERIFICATION.md`)
- **Projected ARR:** Y1 ₹40-80L / Y2 ₹1-2Cr / Y3 ₹2-5Cr
- **No employees** in Y1 (possibly contractors); no UK/US/EU presence
- **Supplier mix:** OpenAI, Anthropic, Stripe, Paddle, Cloudflare, Hetzner, Vercel, GitHub (all USD SaaS — RCM exposure); AWS Mumbai or Google Cloud India (forward-charge IN GST)

---

## Q1. Is productized SaaS revenue classified under Section 44ADA (professional) or Section 44AD (business)?

**Indicative answer:** Productized SaaS sold on a self-serve, subscription / credits basis is far more defensible as a "business" under Section 44AD than as "technical consultancy" under Section 44ADA, because there is no bespoke human advisory element and the output is a standardized off-the-shelf product. However, the classification is genuinely fact-sensitive and the ITR business/profession code you select effectively locks you in, so the choice should be made deliberately with the CA. If Section 44AD applies, presumed income is 6% of digital receipts (vs 50% under 44ADA) — a very material difference at 40-80L ARR.

**Legal basis:**
- Section 44AA(1), Income Tax Act 1961 — specified professions: legal, medical, engineering, architectural, accountancy, technical consultancy, interior decoration, plus those notified under Rule 6F (Notification No. SO 17(E) dated 12.01.1977; later notifications incl. authorised representative, film artist, company secretary, and information technology — this IT notification is frequently cited as the basis for treating software work as a profession).
- Section 44AD — 6% presumptive rate on digital receipts, 8% on cash; turnover cap ₹3 Cr digital / ₹2 Cr non-digital (post Finance Act 2023).
- Section 44ADA — 50% presumptive; ₹75L cap if >=95% digital receipts / ₹50L otherwise (Finance Act 2023 amendment effective AY 2024-25).
- Section 44AD(6) explicitly excludes "a person carrying on profession as referred to in sub-section (1) of section 44AA" — the critical exclusion.

**Web research findings:** Practitioner view (TaxGuru, ClearTax, TaxTMI forums) is converging on: "Repeated sale of self-contained software products via a website or platform is characterised as business and aligns with Section 44AD, whereas bespoke software development or technical consultancy is a profession under 44ADA." The ITR utility business codes reinforce this: code 14001 (software development — services) is treated as professional and forces 44ADA, whereas codes under "Wholesale and retail trade" — specifically 09027 (retail sale via mail orders / internet) or 14010 (other IT & computer service activities n.e.c.) — are used for product/SaaS businesses claiming 44AD. CA club forum threads flag that filing 44AD under code 14001 draws a defective-return notice. No direct CBDT circular or reported ITAT ruling squarely on "productized SaaS = business"; the Pramod Lele ITAT Mumbai ruling (cited in TaxGuru) narrowly held management consultancy is not technical consultancy, which is useful precedent for arguing SaaS is also outside "technical consultancy". There is NO Notification 88/2008 under 44AA that I could verify — that notification number appears to be a misattribution; the actual notifications under 44AA/Rule 6F are older (1977, 2007 for company secretaries, and the IT-services notification).

**Confidence:** Medium. The product-vs-service distinction is well-supported in practice but not by a single binding statutory definition or Supreme Court ruling. The 44AD pathway is defensible for pdfcraftai (credit-based, automated product) but an AO could challenge it.

**Sources:**
- [Section 44ADA — Presumptive Tax Scheme for Professionals (ClearTax)](https://cleartax.in/s/section-44ada)
- [Section 44AD — Presumptive Scheme for Businesses (ClearTax)](https://cleartax.in/s/section-44ad-presumptive-scheme)
- [Software Sales through website — Business or Profession (TaxTMI)](https://www.taxtmi.com/forum/issue?id=120296)
- [ITR3 business code 14001 software development — presumptive 44ADA (CAclubindia forum)](https://www.caclubindia.com/forum/itr3-business-code-14001-software-development-for-claiming-presumptive-income-from-profession-526309.asp)
- [List of codes NOT eligible for section 44AD (CA Indelhi India)](https://www.caindelhiindia.com/blog/list-of-codes-not-eligible-for-section-44ad/)
- [Management Consultancy is not Technical Consultancy — Pramod Lele ITAT Mumbai (TaxGuru)](https://taxguru.in/income-tax/pramod-lele-income-tax-officer-itat-mumbai.html)

**What to confirm with CA:**
1. Given pdfcraftai sells credits on a self-serve subscription (no human deliverable per customer), can we file under 44AD with a "trade / IT product" business code (e.g. 09027 or 14010) rather than 14001? What's the defensibility memo?
2. If we claim 44AD, can we still rely on Section 44AD's lock-in rule safely for 5 years given projected Y2-Y3 turnover crossing ₹3 Cr (forcing audit under 44AB and exit from 44AD)?
3. Are there any AAR rulings or departmental circulars treating SaaS/productized software specifically, beyond the Engineering Analysis SC decision?

---

## Q2. Does Paddle-intermediated revenue qualify as "export of services" under Section 2(6) IGST Act?

**Indicative answer:** Yes — Paddle-intermediated revenue should qualify as export of services, because from India's perspective you are supplying a digital product to Paddle.com Market Limited (UK), a separate legal person, and receiving USD into your Indian bank with FIRC evidence. All five conditions of Section 2(6) IGST are met as long as you structure the invoice to Paddle (not to the end customer) and retain Paddle's settlement report + FIRC as proof. LUT eligibility under Rule 96A is preserved. The risk area is if GST officers argue that the "real recipient" is an Indian end-user (when Paddle forwards from an Indian buyer) — but the MoR contract and CBIC's own position on distinct legal persons (Circular 161/17/2021-GST) favours you.

**Legal basis:**
- Section 2(6) IGST Act — five conditions: (i) supplier in India, (ii) recipient outside India, (iii) place of supply outside India, (iv) payment in convertible forex / RBI-permitted INR, (v) supplier and recipient not merely establishments of distinct person (Explanation 1 to Section 8, IGST Act).
- Section 13(2) IGST — default place of supply for services where location of recipient is outside India = location of recipient (i.e. UK).
- Section 16 IGST / Rule 96A CGST Rules — zero-rated exports, LUT pathway (no IGST) or refund route.
- CBIC Circular 161/17/2021-GST dated 20.09.2021 — clarifies condition (v): a company incorporated in India and a body corporate incorporated outside India are separate legal persons and NOT "merely establishments of distinct person"; accordingly the supply qualifies as export.
- Master Circular on Exports / IGST refund mechanics — Rule 89 CGST Rules for refunds.

**Web research findings:** CBIC Circular 161/17/2021-GST is the authoritative recent clarification and strongly supports treating Paddle (UK company) as a distinct foreign recipient. All practitioner sources (VJM Global, IndiaFilings, Razorpay Blog, TaxGuru) read the circular the same way. Paddle's own documentation confirms MoR status — "Paddle acts as Merchant of Record and is a reseller of your product", meaning your counterparty for GST purposes is Paddle Ltd in the UK, not the end user. Skydo and Winvesta blogs confirm LUT eligibility for SaaS export; Razorpay's blog confirms the FIRC/BRC requirement (RBI circular: proceeds within 1 year, now extended to 15 months per FEMA 23(R)/(7)/2025-RB). The one watchout noted by practitioners: if your contract with Paddle is structured as "commission / platform fee" rather than "sale of software to Paddle", GST officers could try to recharacterise as intermediary services under Section 13(8)(b) IGST — place of supply then becomes India, disqualifying export. Read Paddle's seller terms carefully: they explicitly position it as reseller/MoR which protects against this.

**Confidence:** High on the legal conclusion; Medium on execution (depends on invoice wording, FIRC collection discipline, and the evolving CBIC stance on intermediary characterisation).

**Sources:**
- [CBIC Circular No. 161/17/2021-GST (official PDF)](https://cbic-gst.gov.in/pdf/Circular-No-161-14-2021-GST.pdf)
- [Clarification relating to Export of Services — Condition (v) of Section 2(6) (VJM Global)](https://www.vjmglobal.com/blog/clarification-relating-export-services-condition-section-26)
- [Export of Services Under GST (Razorpay Blog)](https://razorpay.com/blog/export-services-gst-conditions-guide/)
- [LUT for Export of Tech Services (Skydo)](https://www.skydo.com/blog/all-you-need-to-know-about-lut-for-tech-service-export)
- [Paddle: Merchant of Record for Indian SaaS (Product Growth Intelligence)](https://productgrowth.in/tools/payments/paddle/)
- [Intermediary Services Under GST — Gray Area (TaxGuru)](https://taxguru.in/goods-and-service-tax/intermediary-services-gst-gray-area-export-tax.html)

**What to confirm with CA:**
1. Should the invoice to Paddle be worded as "sale of software subscription" / "licence fee" (safe — export) or will "commission / platform revenue share" (risky — intermediary) accurately reflect Paddle's MoR contract? Please draft the preferred wording.
2. For transactions where Paddle's end customer is verifiably Indian, does the MoR structure still preserve export status for the India leg, or should we carve those out and collect GST separately?
3. Confirm LUT (Form GST RFD-11) filing timing for FY 2026-27 and the FIRC aggregation method for monthly Paddle settlements (one FIRC per payout or aggregated BRC).

---

## Q3. When should I incorporate (LLP vs Pvt Ltd) given projected trajectory?

**Indicative answer:** For a SaaS founder on a ₹40-80L Y1 / ₹1-2 Cr Y2 / ₹2-5 Cr Y3 trajectory, the clean decision framework is: (a) stay sole-prop through Y1 if you're confidently under 44ADA/44AD presumptive thresholds and not raising external capital; (b) incorporate as Pvt Ltd the moment you (i) cross ₹1 Cr ARR, (ii) want to hire and offer ESOPs, or (iii) start serious investor conversations — whichever comes first. LLP is rarely the right answer for a funded SaaS because it cannot issue ESOPs, cannot receive FDI through the automatic route without conditions, and is taxed at a flat 30% + surcharge + cess vs Pvt Ltd's 22% under Section 115BAA.

**Legal basis:**
- Section 115BAA, Income Tax Act — 22% concessional rate for domestic companies (effective ~25.17% after 10% surcharge + 4% cess), no MAT, on giving up specified deductions; Section 115BAB (15% for new manufacturing) is NOT available to SaaS (software development is explicitly excluded).
- LLP taxation: Flat 30% + 12% surcharge above ₹1 Cr + 4% cess ~ effective 34.94%. Alternate minimum tax under Section 115JC at 18.5%.
- Section 47(xiv) — sole prop to Pvt Ltd conversion is tax-neutral (no capital gains) if: all assets/liabilities transferred, consideration only in equity, proprietor holds >=50% voting power for 5 years; breach triggers retrospective taxation on the company.
- Companies Act 2013 / SEBI ESOP regulations — ESOPs available only to Pvt Ltd / Public Cos.
- FDI Policy (Consolidated FDI Policy / FEMA Regulations) — 100% FDI under automatic route available to Pvt Ltd in most sectors; LLP requires "sectors where 100% FDI is permitted under automatic route and no FDI-linked performance conditions".
- DDT abolished w.e.f. 01.04.2020 (Finance Act 2020) — dividends now taxed in shareholder hands at slab rate + Section 194 TDS at 10% above ₹5,000.

**Web research findings:** Consensus across LegalWiz, Ebizfiling, ClearTax, RegisterKaro, MotilalOswal: Pvt Ltd is strictly better for venture-track SaaS despite higher total tax burden when fully distributing profits. The arithmetic favours LLP only if you extract 100% of profits every year (LLP pays 30% once; profit share to partners is tax-free in their hands) — this is almost never the case for a growing SaaS reinvesting into hiring and product. The Pvt Ltd 22% under 115BAA + dividend at shareholder slab rate still loses to LLP on cash-out math but wins on: (i) fundraising, (ii) ESOP, (iii) valuation for M&A, (iv) FDI simplicity. Common founder breakpoints reported in practitioner writeups: most Indian SaaS founders incorporate Pvt Ltd around ₹50L-1 Cr ARR or immediately pre-seed. Conversion tax: Section 47(xiv) keeps it tax-free on the sole-prop > Pvt Ltd leg. Converting LLP back to Pvt Ltd later is possible but more involved (Section 47(xiiib) for Pvt Ltd > LLP is well-trodden; reverse is clunkier). Compliance cost delta: LLP ~ ₹15-30K/yr, Pvt Ltd ~ ₹40-80K/yr in statutory filings + ~₹25-50K for statutory audit (mandatory irrespective of turnover for Pvt Ltd).

**Confidence:** High on the decision framework; Medium on exact ARR breakpoint (depends on fundraising timeline).

**Sources:**
- [LLP vs Private Limited Company — Tax Benefits Compared (LegalWiz)](https://www.legalwiz.in/blog/llp-vs-private-limited-company-tax-benefits)
- [Taxation in LLP vs Pvt Ltd: Which is More Beneficial (TaxTMI)](https://www.taxtmi.com/article/detailed?id=13397)
- [Private Limited Company Tax Rate in India 2026 (RegisterKaro)](https://www.registerkaro.in/post/private-limited-company-tax-rate)
- [Corporate Tax 2025-26: Rates & Regimes (Motilal Oswal)](https://www.motilaloswal.com/personal-finance/tax/corporate-tax-in-india-2025-26-rates-regimes-complete-guide)
- [Section 47(xiv) Sole Prop to Pvt Ltd Conversion (TaxGuru)](https://taxguru.in/corporate-law/analysis-takeover-proprietorship-firm-private-limited-company.html)
- [ESOPs in Private Limited Companies (RegisterKaro)](https://www.registerkaro.in/post/esop-private-limited-company)

**What to confirm with CA:**
1. Given projected Y2 ₹1-2 Cr and Y3 ₹2-5 Cr, at what exact milestone should we pull the Pvt Ltd trigger to stay inside Section 47(xiv) tax neutrality and still opt into 115BAA from Year 1 of the company?
2. What is the impact of DPIIT Startup India recognition (Section 80-IAC 3-year 100% tax holiday for eligible startups) on our corporate tax — does pdfcraftai qualify?
3. Draft the slump-sale / business transfer agreement and Section 47(xiv) compliance roadmap so we don't accidentally trigger clawback in year 4 or 5.

---

## Q4. DTAA (Double Taxation Avoidance) implications on Paddle's withholding?

**Indicative answer:** Paddle is very unlikely to withhold UK tax on payouts to Indian sellers, because your income from Paddle is characterised as business income under Article 7 of the India-UK DTAA (not royalty under Article 13(3) nor FTS under Article 13(4)) — and with no UK permanent establishment, the UK has no primary right to tax it. The Supreme Court's decision in Engineering Analysis (2021) plus the Delhi HC line on India-UK DTAA's strict "make available" test buttress this. You will still need to self-declare this income in India and pay tax in full; DTAA relief is only useful if UK actually withholds (rare in the MoR model).

**Legal basis:**
- Article 7, India-UK DTAA — business profits taxable only in the state of residence unless attributable to a PE in the source state.
- Article 13, India-UK DTAA — Royalties and Fees for Technical Services; FTS definition in Art 13(4)(c) requires "make available" of technical knowledge, experience, skill, know-how or processes. Treaty rate is capped at 10-15%.
- Sections 90 and 90A, Income Tax Act — DTAA override; Section 90(4) mandates TRC to claim relief; Section 90(5) + Rule 21AB require Form 10F.
- Engineering Analysis Centre of Excellence Pvt Ltd v CIT (Supreme Court, 2 March 2021) — payments for shrink-wrapped / off-the-shelf software are not "royalty" under Section 9(1)(vi) read with Article 12/13 of the DTAA.
- Delhi HC line (multiple cases cited via LiveLaw and BCAJ) — mere use of technical expertise does NOT satisfy "make available" unless the recipient absorbs the technology.
- India-UK Synthesised MLI text (effective FY 2020-21 onwards) — PPT (Principal Purpose Test) introduced in Art 27A; India adopted Simplified Limitation on Benefits plus PPT.

**Web research findings:** Paddle's seller agreement says it "will withhold any and all required taxes… if required by law" but in practice the UK does not impose withholding on payments that are characterised as Paddle's cost-of-revenue paid to an overseas software vendor (especially when the Indian seller has no UK presence). All practitioner sources converge that payouts from Paddle to an Indian seller are business income of the Indian seller (not UK-sourced income subject to UK WHT). The Engineering Analysis SC decision is the foundational authority: standard software licences are NOT royalty. Delhi HC clarified in recent India-UK DTAA rulings that "make available" is a high bar — recipient must absorb technology to use it independently — so your payout wouldn't be FTS either. MLI-ratified PPT (India's MLI instrument of ratification deposited 25 June 2019, in force from 01.10.2019, effective for treaty provisions FY 2020-21) means that if the tax department felt you were structuring through Paddle specifically to abuse the DTAA, they could deny benefits — but standard commercial use of an MoR is not abusive. For claiming DTAA relief if needed: TRC (Section 90(4)) + Form 10F (self-declaration on e-filing portal since 2022 update) are mandatory.

**Confidence:** High on the characterisation; Medium on the operational detail (depends on what Paddle reports and whether any UK reporting obligations apply).

**Sources:**
- [Engineering Analysis Centre of Excellence vs CIT — Supreme Court 2 March 2021 (Indian Kanoon)](https://indiankanoon.org/doc/170521216/)
- [Indian Supreme Court rules on taxability of software payments (EY)](https://taxnews.ey.com/news/2021-0523-indian-supreme-court-rules-on-taxability-of-software-payments)
- [India-UK DTAA — Article 13 Royalties and FTS (Croner-i)](https://library.croneri.co.uk/cch_uk/bit/india-art-13)
- [Delhi HC on India-UK DTAA — "make available" test (LiveLaw)](https://www.livelaw.in/high-court/delhi-high-court/india-uk-dtaa-consideration-for-availing-services-that-require-technical-expertise-not-fts-unless-recipient-absorbs-technology-delhi-hc-297678)
- [2020 UK-India Synthesised text of MLI and 1993 DTA (GOV.UK)](https://www.gov.uk/government/publications/india-tax-treaties/2020-uk-india-synthesised-text-of-the-multilateral-instrument-and-the-1993-double-taxation-convention-in-force)
- [Form 10F and TRC — Section 90(4) requirements (ClearTax)](https://cleartax.in/s/form-10f-income-tax)

**What to confirm with CA:**
1. Has Paddle (Paddle.com Market Limited, UK) historically withheld any UK tax or issued any withholding statements to Indian sellers that we need to collect? If yes, obtain a TRC and file Form 10F to claim Article 7 business-profits relief.
2. For Indian tax self-assessment: should Paddle receipts be reported as "export of software/services" in Schedule BP of ITR, and do we need to disclose anything under Schedule FA (Foreign Assets) given the Paddle receivable balance at year-end?
3. Confirm MLI PPT exposure is nil for our commercial (non-avoidance) use of a UK-based MoR and document the commercial rationale memo.

---

## Q5. What should my quarterly advance-tax installments look like?

**Indicative answer:** If you file under Section 44ADA (professional presumptive — 50% income presumption) OR Section 44AD (business presumptive — 6% / 8%), you skip the four-installment schedule entirely under the proviso to Section 211(1)(b) and pay 100% of estimated tax in a single shot by 15 March. If you do NOT claim presumptive (e.g. you cross the turnover cap or opt for regular profit computation), you're on the standard 15 / 45 / 75 / 100 schedule on 15 Jun / 15 Sep / 15 Dec / 15 Mar. On ₹25-40L taxable income (new regime, FY 2026-27), roughly ₹4.5-9L tax is due — plan accordingly and do not underpay 90% by year-end or Section 234B kicks in at 1% per month.

**Legal basis:**
- Section 208 — advance tax trigger: total tax liability >= ₹10,000 in the year.
- Section 209 — computation of advance tax (estimate current-year total income, deduct TDS/TCS credits, tax the balance).
- Section 210 — payment of advance tax by assessee.
- Section 211(1)(b) — instalments schedule; proviso specifically for assessees declaring under Section 44AD/44ADA: "pay the whole amount of such advance tax during each financial year on or before the 15th day of March".
- Section 234B — interest at 1% per month for default in payment of advance tax (triggered if advance tax paid is < 90% of assessed tax).
- Section 234C — interest at 1% per month for deferment of installments; for 44AD/44ADA assessees, 234C applies only if the whole tax is not paid by 15 March (1 month of interest on the shortfall).
- Section 194-O — e-commerce operator TDS: 0.1% w.e.f. 01.10.2024 (was 1% earlier); ₹5L threshold for individuals/HUFs with PAN furnished.
- Section 194H / 194J — possibly relevant for Razorpay if structured as commission/fees; Razorpay typically acts as payment aggregator, not e-commerce operator in the 194-O sense, so 194-O may not apply directly — but confirm.

**Web research findings:** Unambiguous across ClearTax, TaxGuru, Income Tax Department calendar, IndiaFilings, Tax2win: 44AD/44ADA assessees pay 100% by 15 March; no June/Sept/Dec installments. The Income Tax Department's own Payment of Advance Tax calendar page confirms this. For standard (non-presumptive) assessees: 15% by 15 Jun, 45% cum by 15 Sep, 75% cum by 15 Dec, 100% by 15 Mar; Section 234C charges 1% × 3 months on the shortfall at each of the first three deadlines and 1% × 1 month on the final shortfall. Section 234B is triggered separately if advance tax paid during the year is less than 90% of final assessed tax — interest runs from 1 April of the AY until the tax is paid. Razorpay deducts TDS under Section 194-O only if Razorpay is treated as an e-commerce operator for the transaction; the more common view (EY, RazorpayX blog, CBDT Circular 17/2020) is that pure payment gateways are outside 194-O unless they take on merchant-like functions. Paddle as a UK entity does not apply Indian TDS. Bank interest income gets TDS at 10% under Section 194A above ₹40K threshold. Common founder mistakes: (i) forgetting to pay even as a presumptive assessee by 15 March, (ii) miscalculating total income because of non-INR receipts (conversion timing), (iii) not grossing up TDS credits in ITR causing mismatch with 26AS/AIS.

**Confidence:** High.

**Sources:**
- [Section 211 Income Tax Act — Instalments of advance tax (aaptaxlaw)](https://www.aaptaxlaw.com/income-tax-act/section-211-income-tax-act-instalments-of-advance-tax-and-due-dates-sec-211-of-income-tax-act-1961.html)
- [Payment of Advance Tax — Tax Calendar (incometaxindia.gov.in)](https://incometaxindia.gov.in/Documents/Tax-Calendar/Payment-of-Advance-Tax.htm)
- [Interest Imposed by IT Department — Section 234C (ClearTax)](https://cleartax.in/s/interest-imposed-by-income-tax-department-under-section-234c)
- [Section 194-O TDS on Payments to E-commerce Participants (ClearTax)](https://cleartax.in/s/section-194o)
- [Section 194-O — RazorpayX Guide (Razorpay)](https://razorpay.com/learn/business-banking/section-194o-tds-for-e-commerce-businesses/)
- [Advance Tax Payment: Due Dates, Calculator (ClearTax)](https://cleartax.in/s/advance-tax)

**What to confirm with CA:**
1. Given our 40-60 India/international split and Paddle USD receipts, what exact rupee-conversion rule (RBI reference rate on receipt date? invoice date? month-end?) do we use for advance tax estimation so we don't mis-declare at 15 March?
2. Is Razorpay applying any TDS (194-O at 0.1% or otherwise) on my settlements? Pull 26AS / AIS for FY 2026-27 opening and reconcile, then confirm which section code is used.
3. If we cross the 44ADA/44AD threshold mid-year (e.g. because Paddle international revenue pushes us over), does that retroactively disqualify presumptive for the full year and force us back onto the 15 Jun/Sep/Dec/Mar schedule with 234C interest? Build the ₹30L taxable case in a worked example.

---

## Q6. Am I required to register for GST day-1, or can I wait for the ₹20L turnover threshold?

**Indicative answer:** You can wait until aggregate turnover crosses ₹20 lakh (all-India basis, FY). As an Indian-located supplier of SaaS to both Indian and foreign customers, you are NOT caught by mandatory registration under Section 24(i) because Notification 10/2017-Integrated Tax (13-Oct-2017) — issued under Section 23(2) CGST — explicitly exempts inter-State suppliers of services below ₹20L from compulsory registration, and this notification is still in force in 2026. OIDAR mandatory-registration rules apply only to suppliers located outside India, not to you. Caveat: the moment you want to (a) export under LUT without paying IGST, or (b) claim refund of input ITC on Paddle revenue, voluntary registration becomes a practical necessity — but it is not legally compelled until ₹20L.

> **Flag for CA:** This position departs from the conservative stance in `TAX_MODEL.md` Q6 and `GST_SETUP.md` §1 which state "GST registration required from day 1" (based on Section 24(i) read alone). Notification 10/2017-IT overrides that result for service-only exporters below threshold. CA should confirm whether to follow the letter of the notification (wait until ₹20L) or voluntarily register day-1 for LUT + FIRC workflow hygiene.

**Legal basis:**
- Section 22(1) CGST Act 2017 — general threshold (₹20L services, ₹10L special-category states Mizoram/Tripura/Manipur/Nagaland)
- Section 24(i) CGST Act 2017 — "persons making any inter-State taxable supply" must register regardless of threshold
- Section 23(2) CGST Act 2017 — Government power to exempt categories from registration
- **Notification No. 10/2017-Integrated Tax dated 13.10.2017** — exempts inter-State service suppliers below ₹20L aggregate turnover (₹10L special-category) from registration
- Section 2(6) IGST Act 2017 — export of services definition (5 conditions)
- Section 16(1) IGST Act — exports are "zero-rated" (not exempt); ITC still available
- Section 2(17) IGST Act — OIDAR definition (amended by Finance Act 2023 eff 01-Oct-2023, removed "minimal human intervention")
- Section 14 IGST Act — OIDAR registration trigger applies to supplier in non-taxable territory serving Indian recipients, not the reverse

**Web research findings:** All mainstream practitioner sources (ClearTax, TaxGuru, IndiaFilings, Taxwink, TaxAdda, Taxmann) agree that Notification 10/2017-IT is still operative in 2025-26 and overrides Section 24(i) for service suppliers. There is a minority "conservative" view (some caclubindia forum threads, Taxwink) arguing that pure exporters should register voluntarily regardless, because (a) without GSTIN you cannot file LUT/RFD-11 and will be forced to pay 18% IGST then claim refund, and (b) GSTIN is routinely demanded by AD banks for FIRC/eBRC issuance above certain thresholds. The Finance Act 2023 broadening of OIDAR (dropped "essentially automated, minimal human intervention") is irrelevant to you — Section 14 IGST places the compliance burden on foreign OIDAR suppliers serving Indian recipients, not Indian suppliers.

**Confidence:** High on the legal position (threshold rule); Medium on the practical recommendation (voluntary registration is commonly advised for export-heavy businesses).

**Sources:**
- [CBIC Notification 10/2017-Integrated Tax (PDF)](https://cbic-gst.gov.in/hindi/pdf/integrated-tax-rate/Notification10-IGST.pdf)
- [Tax2win — Section 24 CGST Compulsory Registration](https://tax2win.in/guide/compulsory-registration-gst-act-section-24)
- [TaxGuru — GST Not Payable on Inter-State Supplies by Exempt Persons](https://taxguru.in/goods-and-service-tax/gst-not-payable-on-inter-state-supplies-of-taxable-services-by-exempt-persons.html)
- [TaxGuru — Whether GST Registration Mandatory for Export of Services](https://taxguru.in/goods-and-service-tax/gst-registration-mandatory-persons-making-export-services.html)
- [IndiaFilings — GST for Freelancers 2025](https://www.indiafilings.com/learn/gst-on-freelancers)

**What to confirm with CA:**
1. Given Paddle payouts take 14–45 days (SWIFT) and I may cross ₹20L mid-FY, when exactly is the registration trigger — month of crossing, next month, or 30 days after? (Section 25(1) proviso)
2. Should I voluntarily register on day-1 anyway so LUT is in place before the first Paddle payout, to avoid 18% IGST lock-up and refund delay?
3. For aggregate turnover counting, does zero-rated export value count toward the ₹20L? (Per Section 2(6) CGST read with definition, yes — confirm.)

---

## Q7. Is professional tax (PT) applicable, and what's the enrollment process?

**Indicative answer:** Whether PT applies depends entirely on the state where you're registered as a sole-prop. Of the geographies commonly relevant to Indian SaaS founders: **Karnataka, Maharashtra, Tamil Nadu, Telangana, West Bengal, Gujarat** levy PT; **Delhi, Haryana, Uttar Pradesh, Punjab, Rajasthan** do NOT. As a sole-prop with no employees, you need only a **PTEC (Professional Tax Enrollment Certificate)** — NOT a PTRC (which is for employers deducting from employee salaries). Max PT is ₹2,500/year per person (Constitutional cap, Article 276(2)). Apply within 30 days of commencing business; non-enrollment attracts per-day penalty + interest.

**Legal basis:**
- Article 276, Constitution of India — empowers States to levy PT, capped at ₹2,500/year per person
- State-level statutes: Karnataka Tax on Professions, Trades, Callings and Employments Act 1976; Maharashtra State Tax on Professions Act 1975; Tamil Nadu Municipal Laws (Second Amendment) Act 1998 (levied by GCC/municipal corporations); Telangana Professions, Trades, Callings & Employments Act 1987; West Bengal State Tax on Professions Act 1979; Gujarat State Tax on Professions Act 1976
- **Karnataka Professional Tax Amendment Act 2025** (effective 01-Apr-2025): raised exemption threshold to ₹25,000/month

**Web research findings:** Comparison table (sole-prop / self-employed rates, 2025–26):

| State | PT applicable to self-employed? | Rate for sole-prop | Enrollment cert | Due date | Key source |
|---|---|---|---|---|---|
| Karnataka | Yes | ₹2,500/yr flat (above ₹25K/mo income) | PTEC | 30 Apr each yr | Simpliance, Saachi HRMS |
| Maharashtra | Yes | ₹2,500/yr (PTEC) | PTEC | 30 Jun each yr | TaxGuru MH guide |
| Tamil Nadu | Yes | Slab: ₹0–₹1,250 per half-year (levied by GCC / local body) | PT enrollment with municipality | 01 Apr, 01 Oct | TN DTP, Simpliance |
| Telangana | Yes | Slab up to ₹2,500/yr (₹200/mo above ₹20K) | PTEC | 30 Jun | Factohr, Paisabazaar |
| West Bengal | Yes | Slab up to ₹2,500/yr (₹200/mo above ₹40K) | Enrollment Cert | 31 Jul (annual) | ClearTax WB |
| Gujarat | Yes | Flat ₹2,400/yr (₹200/mo above ₹12K) | Enrollment Cert | 30 Sep | Factohr |
| Delhi / Haryana / UP / Punjab / Rajasthan / J&K / Uttarakhand | **NO** | — | — | — | Vidhikarya, Wikipedia |

Enrollment process (common pattern): register on state commercial-tax portal (e.g., Karnataka: ctax.kar.nic.in, Maharashtra: mahagst.gov.in), submit PAN, Aadhaar, address proof, commencement-of-business proof (bank statement / GST certificate / shop & establishment certificate), generate challan, pay ₹2,500, download PTEC. Typical timeline: 1–3 working days. Enrollment fee itself is generally nil. Late enrollment penalty: ₹5–₹20/day + interest 1.25% p.m. (state-specific).

**Confidence:** High on rates and applicability; Medium on Tamil Nadu sole-prop numbers (levied by municipality, varies by corporation — Chennai revised 2024-25 half-year slab).

**Sources:**
- [Vidhikarya — States Where PT Is Applicable vs Not](https://www.vidhikarya.com/legal-blog/the-states-in-which-the-professional-tax-is-applicable-and-the-states-in-which-it-is-not)
- [TaxGuru — State-wise Professional Tax Slab Rates 2024-25](https://taxguru.in/corporate-law/state-wise-professional-tax-slab-rates-2024-2025.html)
- [ClearTax — Professional Tax Karnataka](https://cleartax.in/s/professional-tax-karnataka)
- [TaxGuru — Maharashtra PT Guide (PTEC & PTRC)](https://taxguru.in/goods-and-service-tax/maharashtra-professional-tax-guide-ptec-ptrc-reference-with-latest-update.html)
- [Saral — State-wise PT Slab Rates 2025-26](https://saral.pro/blogs/professional-tax-slab-rates-in-different-states/)

**What to confirm with CA:**
1. Which state is my principal place of business (PAN address vs actual residence vs GST-future-registered-state) — PT is triggered by State of residence/business, not customer location.
2. If I later register for GST, does PTEC auto-apply or do I need to enroll separately (Maharashtra/Karnataka enforce this strictly — GST dept shares data with PT dept)?
3. As a sole-prop with no employees, do I need PTRC at all, even prospectively, or can I skip it until first hire?

---

## GST-A. SAC code: 998313 vs 998314 vs 998319 (plus 998315, 998434)

**Indicative answer:** Use **SAC 998314 — "Information technology (IT) design and development services"** as your primary code on every invoice (Razorpay and Paddle payouts both). SaaS with AI features = productized software accessed as a service = the canonical example practitioner sites (IndiaFilings, BUSY, PayGlocal, TaxBuddy) cite for 998314. Rate is 18% under Notification 11/2017-CT(R). Deviate only if: (a) pure consulting/advisory engagement with no software delivery → 998313; (b) revenue share that is predominantly cloud/server hosting resale (rare for SaaS) → 998315; (c) an offering that genuinely doesn't fit anywhere (very rare) → 998319 catch-all. 998434 ("on-line content services — software downloads") is a theoretical alternative but is more apt for digital goods (e-books, downloadable standalone software) than subscription SaaS.

**Legal basis:**
- Notification 11/2017-Central Tax (Rate) dated 28.06.2017 (Annexure: Scheme of Classification of Services), Heading 9983 "Other professional, technical and business services" → Group 99831 (IT services) → sub-codes 998311–998319
- 998313: IT consulting and support services
- 998314: IT design and development services
- 998315: Hosting and IT infrastructure provisioning services
- 998319: Other IT services n.e.c.
- Heading 9984 → Group 99843 (Online content services) → 998434: Software downloads
- Rate across all above: 18% (9% CGST + 9% SGST, or 18% IGST)
- Section 31 CGST + Rule 46 CGST Rules — SAC/HSN disclosure mandatory on invoice (4/6-digit requirement depends on turnover)

**Web research findings:** Practitioner consensus is strong and converges on 998314 for SaaS. IndiaFilings: "For developing software — building apps, SaaS platforms, or custom software — use SAC code 998314." BUSY and PayGlocal confirm the same. NASSCOM community thread notes genuine ambiguity between 998314 (if you built the software) and 998315 (if you primarily resell cloud hosting) — for a productized SaaS where the founder is both developer and hoster, 998314 prevails because the predominant supply is the software IP/functionality, not rented compute. No dispositive Karnataka or Maharashtra AAR ruling specifically on SaaS SAC classification surfaced in searches (most AARs on SaaS/software address "intermediary" vs "principal" questions or place-of-supply, not SAC choice). All three candidate codes (998313/14/15/19) are at 18% so the rate exposure is identical; the choice matters for reporting hygiene, audit defensibility, and export-benefit classification (IT-BPM incentive schemes reference specific SAC buckets).

**Confidence:** High on 998314 as primary; Medium on 998434 not being the right alternative (some software-download/one-time-license products do use it).

**Sources:**
- [CBIC — Notification 11/2017-CT(R) Annexure: Scheme of Classification of Services (PDF)](https://cbic-gst.gov.in/hindi/pdf/central-tax-rate/Notification11-CGST-Annexure.pdf)
- [IndiaFilings — SAC Code for Website & Software Development](https://www.indiafilings.com/learn/sac-code-for-website-software-development)
- [IndiaFilings — GST Rates & SAC Codes for IT Services](https://www.indiafilings.com/learn/sac-code-gst-rate-it-services)
- [NASSCOM Community — SAC/HSN for SaaS](https://community.nasscom.in/communities/digital-transformation/bfsi/gst/sac-hsn-for-saas.html)
- [India Briefing — GST Compliance for SaaS and Cloud Computing](https://www.india-briefing.com/news/gst-compliance-for-saas-and-cloud-computing-in-india-explained-39021.html/)

**What to confirm with CA:**
1. Should Paddle payouts (where Paddle is MoR and buyer is Paddle UK, not end user) carry 998314 — or does that change the SAC (e.g., to "intermediary" services, which would jeopardize export status)?
2. Is it safer to use 6-digit SAC on every invoice, or 4-digit (9983) given my turnover is below ₹5 crore (Rule 46 threshold)?
3. Should AI-feature line items be separately described in invoice (for audit clarity) even if they stay on 998314?

---

## GST-B. Paddle revenue as export-of-services — operational GST checklist

**Indicative answer:** Paddle's MoR flow satisfies Section 2(6) IGST (supplier in India, recipient outside India, place of supply outside India per Section 13(2) default rule, payment received in convertible foreign exchange via SWIFT, supplier-recipient are separate legal persons) — provided the contract identifies Paddle UK as the contracting counterparty or pass-through to overseas end users. To operationalize zero-rating during a GST audit, you need: (1) LUT on file (RFD-11, renewed annually before 31 March), (2) export invoices with IGST-nil + "Export under LUT" legend, (3) GSTR-1 Table 6A filed per tax period, (4) SWIFT credit advice + bank statement showing FCY credit, (5) **eBRC from AD bank** (eBRC has effectively replaced paper FIRC for export-benefit purposes; FIRA/IRM is acceptable for GST refund when eBRC is not applicable because there is no shipping bill for services). RBI extended export-proceeds realization window from 9 months to **15 months** via FEMA 23(R) 2nd Amendment Regulations 2025 — aligns well with Paddle's bi-weekly payout cycle.

**Legal basis:**
- Section 2(6) IGST Act 2017 — 5-condition test for export of services
- Section 13(2) IGST Act — default place-of-supply = location of recipient when recipient is outside India and address on record is available (Section 13(3)–(13) carve-outs don't apply to SaaS)
- Section 16 IGST Act — zero-rated supply; LUT option under Section 16(3)(a)
- Rule 96A CGST Rules 2017 — LUT (RFD-11) procedure; realization deadline 1 year (under GST) else IGST + 18% interest; CBIC extended operational realization to 15 months via FEMA alignment
- **CBIC Circular 37/11/2018-GST dated 15.03.2018** — clarifications on export refunds; non-insistence on IGST payment when LUT in place
- CBIC Circular 161/17/2021-GST — clarification on Section 2(6)(v) "distinct persons" condition
- CBIC Circular 202/14/2023-GST — clarification on INR receipt via Special Rupee Vostro accounts qualifying as Section 2(6)(iv)
- RBI Master Direction on Export of Goods and Services (updated 12-Jan-2026)
- RBI FEMA 23(R)/(7)/2025-RB — realization period 9 → 15 months

**Web research findings:** Razorpay, CAclubindia, VJM Global, and GSTHero are aligned that all 5 Section 2(6) conditions must be independently met, and that failing condition (v) (distinct-person test) is the most common trap — not relevant to Paddle (arm's-length). Sources diverge on FIRC vs eBRC: (a) RBI stopped mandating paper FIRC for trade remittances post-EDPMS (2016); banks now issue eFIRC/FIRA/IRM; (b) DGFT eBRC is the definitive proof for export incentives but is tied to shipping bills, which services exports lack — so for services, the bank's FIRA/IRM + SWIFT credit advice is the working substitute; (c) some GST officers still ask for FIRC during refund scrutiny — if bank won't issue, produce FIRA + bank certificate citing RBI 2016 EDPMS circular. No source suggests Paddle's MoR structure disqualifies the arrangement from Section 2(6); the recipient test is satisfied because Paddle UK (and by extension its foreign end-customers) is located outside India.

**Operational checklist per Paddle payout cycle:**
1. LUT (RFD-11) for current FY — file before 31 March each year
2. Export invoice with: GSTIN, "Export of services under LUT without payment of IGST", SAC 998314, recipient = Paddle.com Market Ltd (UK) or end-customer name, INR + USD equivalent, conversion rate per Rule 34
3. GSTR-1 Table 6A — file monthly/quarterly with invoice details
4. GSTR-3B — Table 3.1(b) zero-rated outward supplies
5. SWIFT credit advice (MT103) + bank statement showing FCY credit
6. FIRA / eFIRC / IRM from AD bank (or paper FIRC if bank still issues)
7. eBRC where applicable (services exporters may log via DGFT "Common Digital Platform" for SOFTEX-equivalent — check with bank)
8. SOFTEX form (if STPI-registered — optional for sole-prop SaaS, but improves audit trail for software exports)
9. Contract / Paddle Seller Agreement + invoicing terms (to evidence Paddle's role)
10. Reconciliation sheet: Paddle payout vs invoices vs FIRA — retain 6 years per Section 36 CGST

**Confidence:** High on the legal/operational framework; Medium on SOFTEX being strictly needed (STPI/RBI practice varies for non-STPI sole-props).

**Sources:**
- [CBIC Circular 37/11/2018-GST (PDF)](https://cbic-gst.gov.in/pdf/circularno-37-cgst.pdf)
- [CAclubindia — LUT for Export of Services, Rule 96A, RFD-11 Filing](https://www.caclubindia.com/articles/lut-under-gst-for-export-of-services-complete-guide-to-zerorated-supply-compliance-rule-96a-conditions-rfd11-filing-53653.asp)
- [Razorpay — Export of Services under GST Conditions Guide](https://razorpay.com/blog/export-services-gst-conditions-guide/)
- [HiWiPay — eBRC for Exporters 2025 Guide](https://hiwipay.com/blog/ebrc-for-exporters-in-2025-a-guide-to-compliance-gst-refunds-incentives/)
- [Taxmann — RBI Extends Export Realisation 9 to 15 Months (FEMA 23(R))](https://www.taxmann.com/post/blog/rbi-extends-the-time-period-for-realisation-of-full-export-from-9-to-15-months)
- [Skydo — EFIRC vs FIRC vs BRC](https://www.skydo.com/blog/efirc-firc-brc-essentials-differences)

**What to confirm with CA:**
1. With Paddle as MoR, whose name goes on the GSTR-1 Table 6A "recipient" column — Paddle UK, or end-customer country — and which creates the cleanest audit trail?
2. Do I need SOFTEX filing (via STPI or non-STPI route) for Paddle SaaS payouts, or is SWIFT credit advice + FIRA sufficient since I'm not claiming any STPI/SEIS-type incentive?
3. On the Paddle payout, Paddle deducts ~5% fees + foreign VAT at source before remitting — should my export invoice be the gross (end-customer price) or net (Paddle remittance), and how does that affect the Section 2(6)(iv) "payment received" test?

---

## GST-C. QRMP (Quarterly Return, Monthly Payment) — opt-in from day-1?

**Indicative answer:** Yes — opt in to QRMP from Day 1 of registration. At projected ARR of ₹40-80L you are squarely within the ≤ ₹5Cr eligibility threshold, and QRMP collapses the annual filing calendar from 24 returns (12 GSTR-1 + 12 GSTR-3B) to 8 (4 + 4) while monthly tax liability is still discharged via PMT-06. The IFF is optional; since your B2B-Indian slice will be small and most customers will either be B2C Indians or export recipients (zero-rated), you can safely skip IFF entirely in months 1 and 2 and simply upload everything in the quarterly GSTR-1. The refund-cycle concern is real but manageable: export refunds under LUT are filed on a tax-period basis, so a QRMP filer claims refunds on a quarterly cadence — slightly slower cash-flow than monthly but with far less compliance overhead, which is the right trade at this turnover.

**Legal basis:** Proviso to Section 39(1) CGST Act; Rule 61A CGST Rules; Notification 84/2020-CT dated 10-Nov-2020 (prescribes eligibility and procedure); Notification 85/2020-CT (fixed-sum / 35% challan method); Circular 143/13/2020-GST dated 10-Nov-2020 (operating guidance); Section 31(1) proviso + Rule 59(2) for IFF (Invoice Furnishing Facility).

**Web research findings:** ClearTax, Tax2Win, and the official GSTN FAQ converge: eligibility is aggregate turnover ≤ ₹5Cr in the preceding FY, with an exit trigger if turnover crosses ₹5Cr mid-year (ineligible from the next quarter). Opt-in window is generous — from the 1st of the 2nd month of the preceding quarter to the last day of the 1st month of the target quarter (e.g., for Jul-Sep quarter, window is 01-May to 31-Jul). PMT-06 offers two methods: "Fixed Sum" (35% challan auto-generated; only usable after one full quarter of history) and "Self-Assessment" (compute actual net liability — this is what you'll use because RCM on foreign supplier invoices needs to be paid monthly in cash and claimed as ITC same month). For exporters, practitioner sites (IntelligentGST, MYGSTRefund) flag a historical pain point: the IFF-uploaded invoices for M1/M2 weren't always recognized by the refund portal, so exporters must ensure the quarterly GSTR-3B reflects IFF invoices before filing RFD-01. This is a portal-level annoyance, not a legal disqualifier.

**Confidence:** High. The statutory framework and opt-in mechanics are settled; the only judgment call is IFF usage, and that is discretionary.

**Sources:**
- [ClearTax - QRMP Scheme under GST](https://cleartax.in/s/quarterly-return-monthly-payment-qrmp-scheme-gst)
- [GSTN Official FAQ on QRMP & IFF (PDF)](https://tutorial.gst.gov.in/downloads/news/faq_on_qrmp_iff.pdf)
- [Circular 143/13/2020-GST (dcmsme mirror)](https://www.dcmsme.gov.in/Quarterly-return-monthly-payment-scheme.pdf)
- [Tax2Win QRMP 2025 guide](https://tax2win.in/guide/qrmp-scheme-under-gst)
- [IntelligentGST - QRMP refund filing advisory](https://intelligentgst.com/gstn-advisory-for-qrmp-taxpayers-on-refund-filing)

**What to confirm with CA:**
1. Should we elect QRMP starting the very first quarter of registration, or wait one quarter to establish a GSTR-3B history before switching (to unlock the fixed-sum method if useful)?
2. Given our export-heavy mix, do you recommend monthly RFD-01 filing (allowed for exporters even under QRMP) or quarterly, balancing cash-flow vs compliance cost?
3. Can we skip IFF entirely for quarters with few or no Indian B2B buyers, or do you want IFF uploaded every M1/M2 for audit-trail hygiene?

---

## GST-D. RCM on foreign supplier invoices (OpenAI, Anthropic, Stripe, Paddle fees, Cloudflare, Hetzner, Vercel, GitHub)

**Indicative answer:** Every USD/EUR invoice from OpenAI, Anthropic, Stripe, Paddle, Cloudflare (US entity), Hetzner, Vercel, and GitHub is an "import of services" and attracts 18% IGST under RCM — you pay IGST in cash via PMT-06 and claim the identical amount as ITC in the same GSTR-3B, netting to zero cash impact but non-zero compliance impact. You must issue a self-invoice per Section 31(3)(f) read with Rule 47A within 30 days of receipt. For AWS Mumbai / Google Cloud India, if billed via their Indian GSTIN-registered entity with forward-charge IGST/CGST+SGST on the invoice, it is NOT an RCM transaction — it's a normal domestic purchase on which the Indian supplier collects GST and you just claim ITC.

**Legal basis:** Section 5(3) IGST Act + Notification 10/2017-IT(R) dated 28-Jun-2017 (services supplied by a person in a non-taxable territory to a recipient in taxable territory — import of services — are notified for RCM); Section 2(11) IGST Act (definition of import of services); Section 31(3)(f) CGST Act + Rule 47A CGST Rules (self-invoice within 30 days, effective 01-Nov-2024 via Finance (No. 2) Act 2024); Rule 36(1)(b) CGST Rules (ITC basis = self-invoice); Section 13(2) IGST Act (place of supply = recipient's location for most of these services); Section 16 CGST Act (ITC conditions); Section 14 IGST Act + Notification 2/2023-IT(R) (OIDAR B2B → RCM on recipient; OIDAR B2C → forward charge on non-resident supplier with its own GSTIN).

**Web research findings:** HNA&Co, TaxGuru, and ClearTax agree: all imports of services by a registered Indian recipient fall under RCM at 18% IGST. Reporting: output liability in GSTR-3B Table 3.1(d) "Inward supplies liable to reverse charge", matching ITC claimed in Table 4(A)(3). Cash payment of the RCM liability is mandatory — the electronic cash ledger, not the credit ledger, must fund it. CAClubIndia confirms the 01-Nov-2024 Rule 47A 30-day self-invoice window; ignoring self-invoices risks ITC denial. The 2023 OIDAR amendment (effective 01-Oct-2023) broadened the definition (dropped "essentially automated, minimal human intervention") and narrowed "non-taxable online recipient" to only unregistered persons — meaning for a registered Indian business receiving OpenAI/Anthropic access, the RCM path is unambiguous. AWS Tax Help page and Google Cloud India's February 2025 notice confirm: if you're billed by AWS India or Google Cloud India (Private Limited) with your GSTIN on file, they charge forward-charge GST — no RCM. If billed by AWS Inc. (US) or Google Asia Pacific, it's an import of services → RCM. Stripe, Paddle, OpenAI, Anthropic, Hetzner are all non-resident suppliers today → RCM.

**Monthly process checklist:**
1. Export all foreign-vendor invoices for the month; convert to INR at RBI reference rate on invoice date (or BoE rate if imported goods — here services, so RBI/GAAR rate).
2. Issue a self-invoice (consecutive serial series) for each foreign vendor within 30 days.
3. Maintain payment voucher under Rule 52 on the date of payment.
4. Pay 18% IGST (= invoice INR value × 18%) via PMT-06 in cash before the 25th of next month.
5. In GSTR-3B, report RCM output in Table 3.1(d) and claim identical ITC in Table 4(A)(3).
6. File annual reconciliation in GSTR-9 Table 4G (inward supplies on which tax is paid on reverse charge).

**Confidence:** High on mechanics; Medium on edge case of whether Paddle (as Merchant of Record, UK entity) reselling to Indian B2B creates an import-of-services relationship between you and Paddle or between you and the Indian end-customer — this needs CA view because your "supplier" relationship with Paddle is for platform-fee + payout services.

**Sources:**
- [ClearTax - All about RCM under GST](https://cleartax.in/s/reverse-charge-gst)
- [HNA&Co - RCM on Import of Services & IPR](https://hnallp.com/a/rcm-on-import-of-service-intellectual-property-right)
- [TaxGuru - Rule 47A 30-day self-invoice effective Nov 2024](https://taxguru.in/goods-and-service-tax/regulation-rcm-invoicing-effective-november-1-2024.html)
- [Fonoa - OIDAR 2023 amendment](https://www.fonoa.com/resources/blog/oidar-in-india-2023-and-beyond)
- [AWS Tax Help India](https://aws.amazon.com/tax-help/india/)
- [TaxGuru - OIDAR from 1 Oct 2023](https://taxguru.in/goods-and-service-tax/gst-oidar-services-foreign-firms-oct-1-2023.html)

**What to confirm with CA:**
1. Paddle is UK MoR that charges end-customers and pays us USD SWIFT — is the RCM-taxable "supply" here Paddle's merchant-of-record service fee (a percentage commission) or the full gross amount? This affects the IGST-under-RCM base.
2. For AWS/Google Cloud Mumbai with our GSTIN on file, confirm we claim full ITC (no blocked credit under Section 17(5)) for cloud compute used in exporting services.
3. Exchange-rate convention: RBI reference rate vs GAAR-approved rate vs invoice-date bank rate — which should we hard-code in our monthly RCM worksheet?

---

## GST-E. GSTIN capture at checkout for B2B Indian customers

**Indicative answer:** Add an OPTIONAL GSTIN field on the checkout flow — unchecked by default, revealed behind a "I'm buying for a business / GST invoice" toggle. If the buyer supplies a GSTIN, validate it via a public GSTIN verification API at checkout, capture the registered business name and state (place of supply), and emit a Rule-46-compliant B2B tax invoice that must be reported invoice-wise in GSTR-1 Table 4A. If the field is blank, it is a B2C supply, issue a simple tax invoice/bill of supply and report in aggregate in GSTR-1 Table 7. E-invoicing (IRP/IRN) is NOT applicable at your Y1 turnover (threshold is ₹5Cr), but architect the invoice numbering and data model so you can bolt it on later.

**Legal basis:** Section 31(1) CGST Act (tax invoice); Rule 46 CGST Rules (16 mandatory particulars — recipient's name, address, GSTIN/UIN (if registered), HSN/SAC, taxable value, rate, amount of tax, place of supply for inter-state); Rule 46(f) specifically mandates recipient GSTIN for registered buyers; Rule 54 (special invoice rules for reverse charge / ISD / banking — not relevant for your case); Rule 48(4) + Notification 10/2023-CT (e-invoicing mandatory only for aggregate turnover > ₹5Cr in any FY from 2017-18 onward — not you, yet); Section 37 + Rule 59 CGST (GSTR-1 reporting — Table 4A invoice-wise for B2B, Table 7 rate-wise aggregate for B2C intra-state, Table 5 for B2C inter-state > ₹2.5L); Section 16 (buyer's ITC entitlement depends on correctly reported B2B invoice in supplier's GSTR-1).

**Web research findings:** ClearTax, GSTN FAQ, and the CBIC flyer on tax invoices all confirm the invoice-particulars list in Rule 46 and the B2B-vs-B2C distinction in GSTR-1. Practical practitioner consensus (TaxGuru, WeAndGST): for SaaS/digital, a minimum-compliant B2B invoice must carry: supplier GSTIN+name+address, consecutive serial, date, recipient GSTIN+name+address, HSN (SAC 998314 "IT design and development" or 998439 "other online content" is typical for SaaS), taxable value, rate, IGST or CGST+SGST split, place of supply, signature (can be digital). If the buyer enters a wrong GSTIN, the mismatch surfaces in their GSTR-2B auto-population and they cannot claim ITC — but the supplier liability does not change (you've collected and paid tax to government correctly). Downstream scrutiny risk for the seller is low as long as the invoice was honestly prepared and GSTR-1 was filed correctly. GSTIN verification is available via: (a) the free public-facing GST portal search; (b) commercial GSPs (Mastersindia, Cashfree, Signzy, ClearTax) that expose REST APIs with sub-second latency for checkout integration — recommended because the public portal has rate-limits. GSTN clarified in a recent update (A2ZTaxCorp note) that Table 12 of GSTR-1 B2B section is system-validated as mandatory while B2C section is optional — adds a small compliance tailwind for keeping B2B data clean.

**Recommendation for your checkout flow:** optional GSTIN field; if populated, run one API call to a GSP (budget ~₹0.50-₹2 per call); if valid, auto-fill business name and state; store GSTIN, legal name, and registered state against the order; conditionally render the B2B invoice with IGST (if buyer state ≠ your registered state) or CGST+SGST (if same state); email the PDF invoice alongside the receipt.

**Confidence:** High. This is standard SaaS checkout practice in India (Razorpay's own docs + ClearTax playbook converge).

**Sources:**
- [TaxGuru - Tax Invoice Requirements under Section 31 + Rule 46](https://taxguru.in/goods-and-service-tax/tax-invoice-requirements-section-31-cgst-act-gst-rule-46.html)
- [ClearTax - Details in GSTR-1 Return](https://cleartax.in/s/details-mentioned-return-gstr-1)
- [WeAndGST - GST Invoice Mandatory Fields 2026](https://www.weandgst.in/gst-invoice-mandatory-fields-india/)
- [ClearTax - E-invoicing threshold Rs.5Cr](https://cleartax.in/s/e-invoicing-businesses-above-rs-5-crore-turnover)
- [IndiaFilings - E-invoicing for taxpayers > ₹5Cr](https://www.indiafilings.com/learn/mandatory-gst-e-invoicing-for-taxpayers-exceeds-threshold-limit-of-inr-5-crore/)

**What to confirm with CA:**
1. Which SAC code should we hard-code on invoices — 998314 (IT design/development) vs 998439 (other online content) vs 998316 (IT infra support) — for a credits-based PDF-processing SaaS? (Cross-ref GST-A.)
2. If a buyer enters a GSTIN but the API validation fails (downtime or invalid), should we block checkout, downgrade to B2C (with a warning), or accept and flag for manual review?
3. Do we need to print "Reverse charge: No" on every B2C invoice explicitly, or is omission acceptable?

---

## GST-F. Credit notes and refund workflows (same-FY B2C, same-FY export, cross-FY)

**Indicative answer:** For a domestic B2C INR refund within the same FY, issue a Section-34 credit note linked to the original invoice, reduce output IGST/CGST+SGST proportionally in the GSTR-1 of the month of the credit note, and refund the cash via Razorpay in the same transaction window; the GST paid on the cancelled portion flows back into your electronic cash/credit ledger via the net-liability reduction. For a Paddle-routed export refund (zero-rated, supplied under LUT without IGST payment), issue a credit note for documentation and bookkeeping, but there is NO output-tax adjustment because the original supply carried 0% effective tax — you just reverse any ITC attributable to that cancelled supply if material. For a cross-FY refund (e.g., Feb 2027 invoice refunded May 2027), Section 34(2) gives you until 30-Nov-2027 or the GSTR-9 filing date for FY26-27, whichever is earlier, to claim the output-tax adjustment; after that window, commercial refund is still fine but the GST portion is non-adjustable and becomes a real cost.

**Legal basis:** Section 34(1) CGST Act (circumstances for credit note — taxable value/tax charged in invoice > value/tax payable, or goods returned, or deficient supply); Section 34(2) CGST Act (time limit — declaration in GSTR-1 return for month of issue, not later than 30-Nov following end of FY in which supply was made, or date of annual return filing, whichever earlier); Section 34(2) proviso (no reduction in output-tax liability if incidence of tax has been passed on to any other person — critical for B2C); Rule 53 CGST Rules (particulars of credit note — reference to original invoice, value, tax); Rule 59 + GSTR-1 Table 9B (credit/debit notes issued to registered recipients — invoice-wise); Table 9 (B2C amendments — aggregate); Section 16 IGST Act + Section 54 CGST Act (zero-rated export refund mechanics — LUT route accumulates ITC to be refunded via RFD-01; IGST-paid route is automatic via shipping bill).

**Web research findings:** TaxGuru, TallySolutions, ClearTax and CBIC's own Chapter-8 handbook align on the time limit. The SagInfotech piece notes a critical practical point: after the 30-Nov cutoff, credit notes can still be issued for commercial/accounting purposes but the GST-output-tax reduction is forfeited. For zero-rated exports, TaxGuru flags a landmark position: if you exported on IGST-paid route and already claimed an IGST refund, you CANNOT then issue a Section-34 credit note to adjust output tax downward for the same supply (Taxguru - GST credit note not permitted for returned export goods after IGST refund). This is a strong argument for always exporting under LUT (no IGST paid, just ITC accumulated/refunded) — credit notes for refunds then cause zero portal friction. For proportional B2C reversal (Karnani FNB Specialities LLP AAAR-WB 2023), only the proportionate tax corresponding to the amount actually refunded is eligible for reduction — partial refunds need partial credit notes.

**Concrete step-by-step — B2C INR refund (same FY):**
1. User requests refund within 14 days; product issues Razorpay refund API call.
2. System auto-generates a Section-34 credit note numbered in a consecutive series (prefix e.g., `CN-FY2627-0001`), referencing the original tax invoice number, original invoice date, refunded taxable value, refunded CGST/SGST/IGST.
3. Credit note PDF emailed to customer.
4. In the next GSTR-1, the credit note is reported in Table 9B (if B2B) or via B2C amendment/Table 9 (if B2C aggregate).
5. GSTR-3B for the month: reduce gross outward tax in Table 3.1(a) by the credit-note tax (output liability net of credit notes).
6. Net cash effect: the IGST/CGST+SGST originally paid sits in your credit ledger and offsets next month's liability.

**Concrete step-by-step — Paddle-export refund (same or cross FY, LUT route):**
1. Paddle initiates refund to the end-customer from its MoR balance; they claw back from your next payout.
2. Issue a credit note referencing the original export invoice (Paddle payout reconciliation) with 0% tax and zero-rated under LUT noted.
3. Report credit note in GSTR-1 Table 9B (credit notes to registered recipients — here Paddle UK is the "registered recipient" of record per your export invoice treatment) or equivalent B2C export amendment depending on invoice classification.
4. No output-tax reversal (tax was zero). If you had already claimed an RFD-01 refund of accumulated ITC attributable to the cancelled export, technically that proportion should be reversed — flag for CA.

**Cross-FY (Feb 2027 → May 2027):** Refund in May 2027 is before 30-Nov-2027, so you retain the output-tax adjustment right. Issue the credit note dated May 2027, report in GSTR-1 of May 2027 (Table 9B — cross-FY credit notes against prior-FY invoices are explicitly permitted within the 34(2) window) referencing the original Feb-2027 invoice number.

**Confidence:** High on the mechanics; Medium on the Paddle-specific treatment because the GST characterization of Paddle-as-MoR vs Paddle-as-agent affects credit-note counterparty.

**Sources:**
- [TaxGuru - Section 34 Credit Notes under GST](https://taxguru.in/goods-and-service-tax/section-34-understanding-credit-notes-gst.html)
- [CBIC - CGST Section 34 (official text)](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter7/section34_v1.00.html)
- [TallySolutions - Credit Note under GST](https://tallysolutions.com/gst/credit-note-under-gst/)
- [SagInfotech - Credit note post-30-Nov](https://blog.saginfotech.com/possibilities-credit-note-declaration-gst-returns-30th-nov)
- [TaxGuru - Credit note not permitted for exported goods after IGST refund](https://taxguru.in/goods-and-service-tax/gst-credit-note-not-permitted-returned-export-goods-after-igst-refund.html)

**What to confirm with CA:**
1. For our Paddle export flow, is the credit-note counterparty Paddle (UK B2B) or the end-customer (place of supply determination)? This drives GSTR-1 Table 9B vs amendment table choice.
2. If a refund crosses the 30-Nov cutoff (e.g., Feb 2026 invoice refunded Dec 2027), should we refund net-of-GST to the customer or eat the GST as a cost-of-service?
3. For partial refunds (credits partially consumed), we'll issue proportional credit notes — is invoice-wise or consolidated-monthly credit-note issuance acceptable practice?

---

## GST-G. DSC vs EVC for monthly return filing

**Indicative answer:** As an individual sole-proprietor, EVC (OTP to your Aadhaar-linked mobile + email) is the simplest path and fully compliant — Rule 26 CGST Rules does NOT mandate DSC for you; it only mandates DSC for companies and LLPs. Stay with EVC unless you see a concrete UX pain point (mobile unavailable during filing windows, or OTP-delivery flakiness). Skipping the ₹1,000-₹2,000/2-years DSC cost and the USB-token workflow is rational for a low-volume single-filer setup; under QRMP you'll only file 4 GSTR-3B and 4 GSTR-1 per year, which is a trivial EVC burden.

**Legal basis:** Rule 26(1) CGST Rules (all applications, including return filing, shall be signed with DSC OR through e-signature / other mode notified, verified by OTP sent to mobile/email = EVC); Rule 26(1) proviso (mandatorily DSC for companies registered under Companies Act 2013 and LLPs — no EVC option for them); Section 25(6C) CGST (Aadhaar-authentication for registration, separate from return-filing authentication); CGST Rules Rule 26(3) (registration/amendment documents to be filed using DSC or EVC per entity class).

**Web research findings:** TallySolutions, TaxScan, Certificate.Digital, MarkItSolutions, and SagInfotech all confirm the split: companies/LLPs mandatorily DSC; individuals, sole-proprietorships, HUFs, partnerships, and AOPs may use DSC, e-sign, or EVC interchangeably. Practical DSC economics: a Class 3 individual DSC costs ~₹1,000-₹2,000 for 2 years (~₹996+GST for 2-year at budget vendors; ~₹1,419+GST for 3-year), plus one-time USB token (~₹500-₹1,000). Renewal cycle: 2 years most common, up to 3 years. The IndiaFilings / VibrantFinserv view: for sole-proprietor GST, DSC is explicitly NOT mandatory — Aadhaar-OTP-based EVC works end-to-end including registration, GSTR-1, GSTR-3B, LUT (RFD-11), and refund applications (RFD-01). Edge case: if you eventually incorporate to a Private Limited (say to raise funding or separate liability), DSC becomes mandatory — budget this for the transition but don't pre-pay it today.

**Recommendation:** Stick with EVC for Year 1-2. Revisit when (a) you incorporate, (b) OTP delivery becomes unreliable (rare but possible), or (c) you add an authorized signatory other than yourself.

**Confidence:** High. Rule 26 text is unambiguous and practitioner consensus is uniform.

**Sources:**
- [CBIC - Rule 26 CGST Rules (official)](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter3/rule26_v1.00.html)
- [TallySolutions - DSC vs E-Sign vs EVC](https://tallysolutions.com/gst/difference-between-dsc-e-sign-and-evc-in-gst-portal/)
- [TaxScan - EVC not allowed for companies (historic)](https://www.taxscan.in/gst-return-filing-by-companies-using-evc-instead-of-digital-signature-provision-mandatory-from-august/117049)
- [IndiaFilings - Is DSC required for GST](https://www.indiafilings.com/learn/is-digital-signature-required-for-gst)
- [ProDigiSign - Class 3 DSC validity](https://prodigisign.com/class-3-individual-digital-signature-validity-everything-you-need-to-know/)

**What to confirm with CA:**
1. For LUT filing (RFD-11) to enable zero-rated exports without IGST, is EVC fully sufficient or does any sub-form still require DSC for individuals?
2. If we add a CA or bookkeeper as an authorized signatory on the GST portal, do they authenticate with their own DSC/EVC or do OTPs still come to the proprietor's mobile?
3. Any risk of the government narrowing EVC-eligibility for proprietors above a certain turnover (any proposal in recent GST Council meetings)?

---

## GST-H. Composition scheme eligibility (should we formally exclude ourselves?)

**Indicative answer:** NOT eligible — and even if it were available, NOT economically desirable. The 6% service-provider composition scheme under Section 10(2A) read with Notification 2/2019-CT(R) disqualifies any taxpayer making inter-state supplies, and export of services is statutorily deemed inter-state per Section 7(5) IGST Act. Our revenue model (60% international = exports; some Indian customers likely outside our registered state = inter-state intra-India) triples the disqualification. Even hypothetically: 6% flat on all turnover is strictly worse than 0% effective on exports (zero-rated under Section 16 IGST) + 18% on Indian supplies with full ITC on input costs — composition blocks ITC AND blocks exports being zero-rated.

**Legal basis:** Section 10(2A) CGST Act (composition for service providers or mixed suppliers, tax rate not exceeding 3% — i.e., 6% combined); Section 10(2)(c) CGST Act (disqualification: person engaged in making any inter-state outward supplies of goods or services cannot opt for composition); Section 7(5)(a) IGST Act (supply where supplier is in India and place of supply is outside India is inter-state supply — covers all exports of services); Section 16(1) IGST Act (export of services is a zero-rated supply); Section 10(2)(d) (no supplies through an ECO that collects TCS); Section 10(4) (composition taxpayer cannot collect tax from recipients and cannot claim ITC); Notification 2/2019-CT(R) dated 07-Mar-2019 (prescribes 6% rate for service providers opting under 10(2A), with explicit condition of no inter-state outward supplies); Notification 5/2019-CT (procedural); turnover limit ≤ ₹50L in preceding FY (our projected ₹40-80L is already at/above this threshold even before the inter-state disqualifier).

**Web research findings:** ClearTax, TaxGuru, TaxMann, AUBSP, and TaxAdda uniformly confirm three killers for us: (a) no inter-state outward supplies — kills us via exports AND any customer outside our home state; (b) aggregate turnover ≤ ₹50L in the preceding FY — our Y1 projection of ₹40-80L risks the ceiling in the preceding-FY sense too (composition eligibility is checked against preceding FY turnover, so arguably available in Y1 only); (c) no supplies through e-commerce operators that collect TCS. Notification 2/2019-CT(R) codifies the 6% rate and the inter-state restriction. The practitioner consensus (e.g., TaxTMI forum, TaxGuru "Lifeline for Small Taxpayers") is explicit: exporters of services are categorically outside Section 10(2A). Even economically, composition forbids claiming ITC on the RCM you pay on foreign SaaS invoices — so you lose that refund-able credit entirely, and you cannot reclaim IGST on export refunds because composition suppliers cannot make zero-rated supplies. CIM on all three vectors.

**How to document the exclusion for the CA pre-read memo:**
1. State plainly: "pdfcraftai supplies services to customers outside India (export of services under Section 2(6) IGST) and to customers in Indian states other than the proprietor's home state (inter-state intra-India). Both constitute inter-state outward supply. Per Section 10(2)(c) CGST and Notification 2/2019-CT(R), this disqualifies the business from the composition scheme under Section 10(2A)."
2. Add: "Even if hypothetically eligible, composition at 6% flat on gross turnover is economically worse than the default 18% + zero-rating on exports + ITC path because (a) exports under LUT carry 0% effective GST, (b) ITC on RCM (foreign vendor invoices) is fully claimable under the default regime but forfeited under composition, (c) composition bars onward GST collection from Indian B2B customers which eliminates their ITC and hurts our pricing on that segment."
3. Instruct the CA at the registration step: select "Regular taxpayer" in Form GST REG-01, NOT composition. Do not file CMP-02 at any point.

**Confidence:** High. Statutory bar is explicit and economic argument is overdetermined.

**Sources:**
- [CBIC - Section 10 CGST Act (official)](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter3/section10_v1.00.html)
- [ClearTax - Lower GST Rate Composition Scheme for Service Providers](https://cleartax.in/s/gst-composition-scheme-service-providers)
- [TaxGuru - Composition Scheme for Service Providers w.e.f. 01-04-2019](https://taxguru.in/goods-and-service-tax/composition-scheme-service-providers-w-e-f01-04-2019.html)
- [TaxMann - GST Composition Scheme](https://www.taxmann.com/post/blog/gst-composition-scheme/)
- [AUBSP - Section 10 CGST Complete Guide](https://www.aubsp.com/cgst-act-section-10-explained/)

**What to confirm with CA:**
1. On registration (Form REG-01), confirm the selection defaults to "Regular" and composition is neither defaulted nor accidentally selectable by a junior assistant filing on our behalf.
2. Is there any intra-state-only sub-business (e.g., a local consulting SKU to Maharashtra customers only) we could ring-fence under composition via a separate GSTIN? (Answer almost certainly no because composition is GSTIN-level not SKU-level, and if any inter-state supply exists under that GSTIN we're out.)
3. For the CA pre-read memo, any risk that FY26-27 Budget tweaks the 10(2A) threshold (₹50L → higher) or the inter-state bar — if so, should we leave a placeholder to revisit?

---

## Research summary (for the CA's quick triage)

**Highest-impact / highest-uncertainty questions (lead with these on the call):**
- **Q1** (44AD vs 44ADA) — **Medium confidence**. Single biggest tax delta at ₹50L gross: 44AD's ~₹3L presumed income vs 44ADA's ₹25L. Get written opinion citing specific ITR business code + defensibility memo.
- **Q2** (Paddle as export of services) — **High conclusion / Medium execution**. Invoice wording matters: "sale of software subscription to Paddle UK" vs "commission / platform revenue share" is the difference between export and domestic intermediary.
- **Q6** (day-1 vs ₹20L threshold GST) — **High/Medium**. Notification 10/2017-IT letter-of-law says wait; practical answer is register day-1 for LUT/FIRC workflow. Ask CA for written recommendation on which path.

**Settled with High confidence (confirm, then execute):**
- Q3 (Pvt Ltd trigger), Q4 (DTAA no-withholding via Article 7), Q5 (advance tax single-shot under 44AD/44ADA), Q7 (PTEC per-state rules), GST-A (SAC 998314), GST-C (QRMP yes), GST-G (EVC sufficient), GST-H (composition ineligible + undesirable).

**Operational checklists already drafted (CA to sign off):**
- GST-B (10-item Paddle-export audit-trail)
- GST-D (6-step monthly RCM process)
- GST-E (checkout GSTIN integration design)
- GST-F (step-by-step refund workflows for 3 scenarios)

**Questions with cross-question dependencies:**
- Q1 (44AD/44ADA) → drives Q5 (advance tax schedule)
- Q2 (export classification) → drives GST-B (operational checklist), GST-F (credit-note counterparty)
- Q6 (day-1 registration) → gates GST-B, GST-C, GST-D, GST-E, GST-F execution
- Q3 (incorporation timing) → forces Q1 re-evaluation (companies can't use 44AD/44ADA) + GST-G (DSC becomes mandatory)

---

## Cross-references

- `docs/india/TAX_MODEL.md` §7 — source list for Q1–Q7
- `docs/india/GST_SETUP.md` §14 — source list for GST-A–GST-H
- `docs/payments/MOR_EVALUATION.md` — Paddle MoR rationale (context for Q2, GST-B, GST-D, GST-F)
- `docs/ai/MARGIN_VERIFICATION.md` §11–§12 — blended-margin math that consumes these tax assumptions
- `docs/GEO_LAUNCH_POLICY.md` — customer geography mix (40/60 IN/intl) that drives the GST-B export slice
- `docs/MASTER_PLAN.md` §4, §8 — decision log + paper trail

---

## Change log

| Date | Version | Change | Source |
|------|---------|--------|--------|
| 2026-04-21 | v1.0 | Initial research memo drafted from web sources by AI agents (3 parallel general-purpose agents, ~60 web searches total). All 15 questions covered with statutory citations, confidence levels, and CA follow-up questions. | commit TBD |

---

## Post-consult addendum template (fill in after CA call)

For each question, after the CA call, append a table row like:

```
| Q#  | CA position                | Citations CA added       | Deviates from indicative? | Action items            |
|-----|----------------------------|--------------------------|---------------------------|-------------------------|
| Q1  | 44AD under code 09027      | ITAT Pramod Lele, CBDT   | No                        | Update TAX_MODEL.md §3  |
| Q2  | Export under LUT, invoice to Paddle UK | Cir 161/17/2021    | No                        | Draft invoice template  |
| ... | ...                        | ...                      | ...                       | ...                     |
```

Once the CA signs off, update `TAX_MODEL.md` §7 and `GST_SETUP.md` §14 to replace the open-item checkboxes with confirmed positions + CA-opinion file references.
