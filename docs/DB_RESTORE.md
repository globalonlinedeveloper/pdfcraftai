# Database restore runbook

How to restore a pdfcraftai.com MariaDB snapshot produced by the free
`db-backup` GitHub Action (`.github/workflows/db-backup.yml`). Pair this with
`CLAUDE.md` (credentials + infra) and `docs/STATUS.md`.

> ⚠️ **Restoring overwrites live data.** A restore replaces the current
> contents of the affected tables with the snapshot. Treat it as a
> break-glass action: confirm you truly want to roll back, and — whenever
> possible — restore into a scratch database FIRST and inspect, rather than
> straight over production.

---

## 1. Get a backup file

Backups live as GitHub Actions artifacts (90-day retention).

1. GitHub → repo → **Actions** → **db-backup** → pick a run.
2. Download the **`db-backup-<timestamp>`** artifact (a zip).
3. Unzip → you get `pdfcraftai-<timestamp>.sql.gz` and `.sql.gz.sha256`.

Verify integrity before trusting it:

```bash
# checksum (the .sha256 was written next to the dump at backup time)
sha256sum -c pdfcraftai-<timestamp>.sql.gz.sha256
# gzip is intact + the dump finished cleanly
gzip -t pdfcraftai-<timestamp>.sql.gz && echo "gzip OK"
zcat pdfcraftai-<timestamp>.sql.gz | tail -3 | grep -q "Dump completed" && echo "complete dump"
```

Peek inside without restoring:

```bash
zcat pdfcraftai-<timestamp>.sql.gz | grep -c 'CREATE TABLE'   # ~37 tables
zcat pdfcraftai-<timestamp>.sql.gz | less
```

---

## 2. Restore (safe path — staging copy first)

The DB only listens on `127.0.0.1`, so the restore runs **on the Hostinger
box**. Copy the dump up, restore into a throwaway database, inspect, then
decide.

```bash
# from a machine that has the SSH key (.claude/id_ed25519_cowork):
scp -i .claude/id_ed25519_cowork -P 65002 \
  pdfcraftai-<timestamp>.sql.gz \
  u692382124@212.85.28.206:/tmp/restore.sql.gz

ssh -i .claude/id_ed25519_cowork -p 65002 u692382124@212.85.28.206
```

On the server, pull DB creds from the running app (same source the backup
uses — no password typed or stored):

```bash
PID=$(ps -fu u692382124 | grep next-server | grep -v grep | head -1 | awk '{print $2}')
ENVF=/proc/$PID/environ
U=$(tr '\0' '\n' < "$ENVF" | grep '^MYSQL_USER='     | head -1 | cut -d= -f2-)
P=$(tr '\0' '\n' < "$ENVF" | grep '^MYSQL_PASSWORD=' | head -1 | cut -d= -f2-)
D=$(tr '\0' '\n' < "$ENVF" | grep '^MYSQL_DATABASE=' | head -1 | cut -d= -f2-)

# Restore into a scratch DB and eyeball it (NON-destructive to prod):
mysql -h 127.0.0.1 -u "$U" -p"$P" -e "CREATE DATABASE IF NOT EXISTS restore_check;"
zcat /tmp/restore.sql.gz | mysql -h 127.0.0.1 -u "$U" -p"$P" restore_check
mysql -h 127.0.0.1 -u "$U" -p"$P" restore_check -e "SHOW TABLES; SELECT COUNT(*) FROM users;"
```

If it looks right, drop the scratch DB when done:

```bash
mysql -h 127.0.0.1 -u "$U" -p"$P" -e "DROP DATABASE restore_check;"
```

---

## 3. Restore over production (destructive — only when you mean it)

```bash
# Take a fresh safety dump of CURRENT prod first, in case you need to undo:
mysqldump --single-transaction --quick --no-tablespaces --routines --events \
  -h 127.0.0.1 -u "$U" -p"$P" "$D" | gzip -c > /tmp/pre-restore-$(date -u +%Y%m%d-%H%M%S).sql.gz

# Then restore the chosen snapshot over prod:
zcat /tmp/restore.sql.gz | mysql -h 127.0.0.1 -u "$U" -p"$P" "$D"
```

The dump uses `CREATE TABLE` / `INSERT` with mysqldump defaults (it includes
`DROP TABLE IF EXISTS` per table), so restoring rebuilds each table from the
snapshot. After a full restore, recycle the app so it reconnects cleanly:

```bash
# gentlest first — hPanel → Resource Usage → Stop running process.
# (CLI fallback, per CLAUDE.md §5 — use ONE pkick max:)
touch ~/domains/pdfcraftai.com/nodejs/tmp/restart.txt
```

Then verify: `curl -s https://pdfcraftai.com/api/health` → expect
`{"ok":true,...,"db":{"ok":true,...}}`.

---

## 4. Partial / single-table restore

To recover just one table, extract it from the dump and apply it alone:

```bash
# Pull one table's section out of the gzipped dump:
zcat pdfcraftai-<timestamp>.sql.gz \
  | sed -n '/-- Table structure for table `error_events`/,/-- Table structure for table `/p' \
  > error_events.sql
mysql -h 127.0.0.1 -u "$U" -p"$P" "$D" < error_events.sql
```

---

## Notes

- **Cadence:** automatic daily at 02:30 UTC (~08:00 IST) + manual via Actions →
  db-backup → Run workflow. Retention 90 days.
- **Cost:** zero — GitHub Actions minutes + artifact storage on the free tier.
- **Why server-side:** MariaDB binds to `127.0.0.1` only; there is no public DB
  port, so both backup and restore must run on the Hostinger host over SSH.
- **Failure alerts:** if `SLACK_WEBHOOK_URL` is configured, a failed backup
  posts to Slack; success is silent.
