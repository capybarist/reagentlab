#!/usr/bin/env bash
# Copia nocturna de Postgres (ADR-0013): pg_dump comprimido, 14 días de retención.
# Cron (como el usuario que despliega):
#   15 3 * * * /ruta/al/repo/deploy/backup.sh >> /var/log/reagentlab-backup.log 2>&1
# Si BACKUP_REMOTE está definido (p. ej. "storagebox:reagentlab"), sube la copia con rclone.
set -euo pipefail

cd "$(dirname "$0")/.."
DIR="${BACKUP_DIR:-/var/backups/reagentlab}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$DIR"

file="$DIR/reagentlab-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
docker compose -f deploy/docker-compose.prod.yml --env-file "${ENV_FILE:-deploy/.env.prod}" exec -T postgres \
  pg_dump -U reagentlab --format=plain --no-owner reagentlab | gzip -9 > "$file.tmp"
mv "$file.tmp" "$file"
echo "$(date -u +%FT%TZ) backup ok: $file ($(du -h "$file" | cut -f1))"

find "$DIR" -name 'reagentlab-*.sql.gz' -mtime +"$KEEP_DAYS" -delete

if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  rclone copy "$file" "$BACKUP_REMOTE" && echo "subido a $BACKUP_REMOTE"
  rclone delete --min-age "${KEEP_DAYS}d" "$BACKUP_REMOTE"
fi
