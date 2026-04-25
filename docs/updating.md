# Updating Kanjiscribe

Follow these steps to update to a newer version of the codebase.

## Standard Update

### 1. Stop the Production Service

```bash
sudo systemctl stop kanjiscribe
```

### 2. Backup the Database

```bash
cp /media/default/ssd/prod/kanjiscribe/data/kanjiscribe.db \
   /media/default/ssd/prod/kanjiscribe/data/kanjiscribe.db.bak
```

### 3. Pull Latest Code in Dev

```bash
cd /media/default/ssd/dev/kanjiscribe
git pull
```

### 4. Rebuild

```bash
./scripts/build-prod.sh
```

### 5. Redeploy

```bash
./scripts/deploy.sh /media/default/ssd/prod/kanjiscribe
```

This copies the newly built bundle and frontend, then installs `better-sqlite3` in the target via `npm`. Your existing `data/` directory in production is preserved.

### 6. Start the Service

```bash
sudo systemctl start kanjiscribe
```

### 7. Verify

```bash
# Check service came up clean
sudo systemctl status kanjiscribe

# Confirm health endpoint responds
curl http://localhost:52654/health

# Check logs for any errors
sudo journalctl -u kanjiscribe --since "1 minute ago"
```

## Rollback

If the update causes issues:

### 1. Stop the Service

```bash
sudo systemctl stop kanjiscribe
```

### 2. Restore the Database Backup

```bash
cp /media/default/ssd/prod/kanjiscribe/data/kanjiscribe.db.bak \
   /media/default/ssd/prod/kanjiscribe/data/kanjiscribe.db
```

### 3. Revert Code in Dev

```bash
cd /media/default/ssd/dev/kanjiscribe
git checkout <previous-commit-hash>
```

### 4. Rebuild and Redeploy

```bash
./scripts/build-prod.sh
./scripts/deploy.sh /media/default/ssd/prod/kanjiscribe
```

### 5. Start

```bash
sudo systemctl start kanjiscribe
```

## Notes

- **Migrations**: The API server runs migrations automatically on every boot (`CREATE TABLE IF NOT EXISTS` style). You do not need to run `pnpm --filter @kanjiscribe/api db:migrate` manually — the server handles it.
- **Import data updates**: If upstream datasets (JMdict, KANJIDIC2, KanjiVG) have been updated and you want to refresh, re-run the importer commands. This is safe because imports use `INSERT OR REPLACE` / upsert semantics — existing study data and assignments are preserved.
- **WAL checkpointing**: On shutdown the server runs `PRAGMA wal_checkpoint(TRUNCATE)` to flush the write-ahead log and remove the `-wal` and `-shm` files from the data directory. This keeps the database clean.
- **Logs**: Systemd captures all output. View live logs with `sudo journalctl -u kanjiscribe -f`.
- **Restart policy**: The service uses `Restart=always` with a 5-second delay. If the process crashes, systemd will restart it automatically.
- **Data directory**: `scripts/deploy.sh` does NOT overwrite your `data/` directory. It only copies the built application files.
