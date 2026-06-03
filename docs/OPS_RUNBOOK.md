# Operations Runbook

_One-page incident reference. When the site is broken, start here._
_Sources: `CLAUDE.md` §5, `docs/STATUS.md` cascade history, post-plan auto-mode arc experience (2026-04-22 → 2026-05-03)._

## At-a-glance health check

```bash
curl -sS https://pdfcraftai.com/api/health
```

| Response | Meaning | Next step |
|---|---|---|
| `{"ok":true,"commit":"<sha>"}` 200 | Healthy. `commit` is the live SHA. | Done — verify SHA matches your last push if you just deployed. |
| 503 (HTML body, LiteSpeed default page) | Either zombie cascade or build-in-progress. | See "Site returning 503" below. |
| 502 / 504 | Network issue between Cloudflare and Hostinger. | Wait 60s. If persistent, check Cloudflare status page. |
| Connection refused / DNS fail | Cloudflare or DNS issue. | Check Cloudflare dashboard. |

## Site returning 503

Decision tree — work top to bottom, stop at the first match:

### Step 1 — Has the site been 503 for >15 min?
If yes → escalate. The recovery paths below are designed for the <15 min window. Past 15 min, open a Hostinger Support ticket.

### Step 2 — Check what build is on disk vs. what's serving

```bash
ssh -i .claude/id_ed25519_cowork -p 65002 u692382124@212.85.28.206 \
  'cd ~/domains/pdfcraftai.com/public_html/.builds/last-source && git log --oneline -1; \
   cat ~/domains/pdfcraftai.com/nodejs/.next/BUILD_ID 2>/dev/null'
```

**If `last-source` SHA matches your latest push AND BUILD_ID exists** → the build itself succeeded. The runtime is broken. Skip to **Cascade recovery** below.

**If `last-source` SHA does NOT match your latest push (after 5+ min wait)** → auto-pull jam. Skip to **Auto-pull jam recovery** below.

**If BUILD_ID is missing** → the build itself failed. Check stderr for build errors. Compile errors won't be in `nodejs/console.log`; they're in Hostinger's build pipeline output (visible in hPanel → Deploy History).

### Step 3 — Cascade recovery

Look for the documented signal:

```bash
ssh -i .claude/id_ed25519_cowork -p 65002 u692382124@212.85.28.206 \
  'ps -fu u692382124 | grep -c next-server'
```

**>4 next-server processes** → zombie cascade confirmed. Recovery options, in order of preference:

1. **hPanel "Stop running process"** (SAFEST). Login to hPanel → Resource Usage → Stop running process. App auto-restarts within 60s, drains via the platform's restart machinery. Use this when reachable.

2. **SSH mass-kill** (ONE attempt MAX):
   ```bash
   ssh ... 'ps -fu u692382124 | grep next-server | awk "{print \$2}" | xargs -r kill -KILL && \
            mkdir -p ~/domains/pdfcraftai.com/nodejs/tmp && \
            touch ~/domains/pdfcraftai.com/nodejs/tmp/restart.txt'
   ```
   App typically recovers within 30s. **DO NOT pkick a second time.** Verified twice in this arc that the second kick saturates the cgroup thread cap and triggers the "fork: retry: Resource temporarily unavailable" cascade-of-cascade pattern.

3. **Wait** (LAST RESORT). If both above fail, or if you see `bash: fork: retry: Resource temporarily unavailable` on the SSH attempt, **STOP TRYING**. Every reconnect creates more pending forks. Wait 5–10 min for the kernel to drain pending threads. Verified twice this session: 8-9 minutes recovered without further intervention.

### Step 4 — Auto-pull jam recovery

If `last-source` SHA hasn't updated 5+ min after push:

```bash
git commit --allow-empty -m "chore: nudge Hostinger auto-pull (<sha> stuck in queue)" && \
git push origin main
```

Wait 4 min, recheck. **DO NOT** nudge more than twice per session — repeated nudges queue up and overlap with whatever is jammed already. If the second nudge doesn't unjam, escalate to Hostinger Support.

## Verifying a deploy is live

```bash
# 1. Did the source pull?
ssh ... 'cd ~/domains/pdfcraftai.com/public_html/.builds/last-source && git log --oneline -1'

# 2. Did the build succeed?
ssh ... 'cat ~/domains/pdfcraftai.com/nodejs/.next/BUILD_ID 2>/dev/null && echo "BUILD_ID present"'

# 3. Is the runtime serving the new code?
curl -sS https://pdfcraftai.com/api/health | grep -oP '"commit":"\K[^"]+'
```

Healthy timeline from `git push origin main`:
- T+0s push completes
- T+30–90s Hostinger auto-pull triggers (`last-source` updates)
- T+2–4 min build completes (BUILD_ID written)
- T+4–6 min runtime cycles to new build (health endpoint returns new SHA)
- Total: typically under 7 minutes

If any phase exceeds the timing by 2x, see the relevant recovery section above.

## Rolling back a bad deploy

```bash
# Identify the last-known-good SHA. STATUS.md typically captures this.
git log --oneline -10

# Revert the offending commit. Don't force-push — Hostinger's GitHub
# integration treats force-push as a normal push and will redeploy
# mid-revert state.
git revert <bad-sha>
git push origin main

# If auto-pull doesn't fire within 5 min:
git commit --allow-empty -m "chore: nudge auto-pull after revert"
git push origin main
```

For env-var changes only (not code): hPanel → Environment Variables → modify → Save and redeploy. This restarts the runtime but doesn't pull new code from GitHub.

## Common false alarms

- **HTML body in `/api/health` response** = LiteSpeed default 503 page. The endpoint is JSON-only; if you see HTML, the runtime is down.
- **uptimeSec=0** = server JUST restarted. Wait 30s and recheck — it'll either stabilize at uptimeSec>0 (deploy success) or 503 (deploy failure mid-startup).
- **`commit` field shows OLD SHA after deploy** = stale-worker hold. The build pipeline succeeded but the runtime didn't cycle. Use SSH mass-kick (Step 3 path 2 above) to force respawn.

## Cascade pattern hypothesis (open investigation)

Working theory documented in STATUS.md + NEXT_SESSION.md: zombie cascades correlate with **rapid code-bearing deploys**, not deploy frequency alone. Doc-only and test-only commits deploy clean; code-bearing commits trigger cascades at a high rate (4 of last 4 in this arc, though `4f3a4c7` was rescued by an empty-commit nudge).

**Mitigation while investigating:**
- Batch code commits with 5+ min spacing.
- Prefer "single big commit" over "several small commits" for code changes — reduces the deploy-cascade exposure to one event instead of multiple.
- Doc-only and test-only commits (e.g. STATUS sync, CI guard additions) can ride between code-bearing commits as natural spacers without triggering rebuilds.

## Critical: do NOT try these

- **`git push --force` to main** — Hostinger's GitHub integration treats it as a normal push and may redeploy mid-state.
- **Multiple SSH mass-kicks in quick succession** — saturates the cgroup thread cap, makes the cascade worse, can lock SSH itself.
- **`ssh ... && curl ... && ssh ... && curl ...` polling loops during a cascade** — every attempt creates pending forks the cgroup is rejecting, prolongs the hang.
- **Skipping git hooks (`--no-verify`)** — bypasses pre-commit + pre-push validation that catches type errors before they ship.
- **Editing files via Hostinger File Manager** — bypasses the GitHub auto-pull pipeline; the next push will overwrite your edit.

## Health endpoints + SSH endpoint reference

| Resource | URL / Command |
|---|---|
| Public health | `https://pdfcraftai.com/api/health` |
| SSH | `ssh -i .claude/id_ed25519_cowork -p 65002 u692382124@212.85.28.206` |
| Build directory | `~/domains/pdfcraftai.com/nodejs/` |
| Source clone | `~/domains/pdfcraftai.com/public_html/.builds/last-source` |
| Runtime stdout | `~/domains/pdfcraftai.com/nodejs/console.log` |
| Restart trigger | `touch ~/domains/pdfcraftai.com/nodejs/tmp/restart.txt` |
| GitHub repo | `https://github.com/globalonlinedeveloper/pdfcraftai` |
| hPanel | `https://hpanel.hostinger.com/websites/pdfcraftai.com` |

See `CLAUDE.md` §1–§5 for the canonical credential + deployment-flow reference.
