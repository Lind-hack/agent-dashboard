#!/usr/bin/env bash
# Supabase DB health for the dashboard's Website page. Runs as root (it needs `docker exec`) from
# agent-dashboard-db-stats.timer every 5 minutes and writes one JSON file the agent user can read:
#   /var/lib/agent-dashboard-db/db.json   (root-owned folder, world-readable file)
# Read-only: SELECTs on pg_stat views, and `ls` of the encrypted backups folder. Nothing is changed.
set -euo pipefail

OUT_DIR=/var/lib/agent-dashboard-db
BACKUPS=/opt/383-supabase/encrypted-backups
# Root owns the folder, so the agent user can't plant a symlink for root to write through.
install -d -o root -g root -m 755 "$OUT_DIR"
tmp=$(mktemp "$OUT_DIR/.db.json.XXXXXX")
trap 'rm -f "$tmp"' EXIT

sql=$(cat <<'SQL'
select json_build_object(
  'size_bytes', pg_database_size(current_database()),
  'connections', (select count(*) from pg_stat_activity),
  'active', (select count(*) from pg_stat_activity where state = 'active'),
  'idle_in_tx', (select count(*) from pg_stat_activity where state like 'idle in transaction%'),
  'max_connections', current_setting('max_connections')::int,
  'long_queries', (select coalesce(json_agg(q), '[]'::json) from (
      select left(regexp_replace(query, '\s+', ' ', 'g'), 160) as query, extract(epoch from now() - query_start)::int as seconds, usename as "user"
      from pg_stat_activity where state = 'active' and query_start < now() - interval '30 seconds' and pid <> pg_backend_pid()
      order by query_start limit 5) q),
  'cache_hit', (select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2) from pg_stat_database),
  'tables', (select coalesce(json_agg(t), '[]'::json) from (
      select schemaname || '.' || relname as name, pg_total_relation_size(relid) as bytes, n_live_tup as rows, n_dead_tup as dead
      from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 8) t),
  'slow', __SLOW__
)
SQL
)
psql() { docker exec -i supabase-db psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 "$@"; }
# The slow-query list needs pg_stat_statements; without it the field is an empty list.
if [ "$(psql -c "select count(*) from pg_extension where extname = 'pg_stat_statements'" 2>/dev/null || echo 0)" = "1" ]; then
  slow="(select coalesce(json_agg(s), '[]'::json) from (select left(regexp_replace(query, '\s+', ' ', 'g'), 160) as query, calls, round(mean_exec_time::numeric, 1) as mean_ms, round(total_exec_time::numeric / 1000, 1) as total_s from pg_stat_statements where query not ilike '%pg_stat%' order by mean_exec_time desc limit 5) s)"
else
  slow="'[]'::json"
fi
json=$(psql <<<"${sql/__SLOW__/$slow}" 2>/dev/null) || json='{"error":"psql failed"}'

latest=$(ls -1t "$BACKUPS"/*.age 2>/dev/null | head -1 || true)
if [ -n "$latest" ]; then
  backup=$(printf '{"file":"%s","bytes":%s,"at":"%s"}' "$(basename "$latest")" "$(stat -c %s "$latest")" "$(date -u -d "@$(stat -c %Y "$latest")" +%Y-%m-%dT%H:%M:%SZ)")
else
  backup=null
fi
unit=$(systemctl show 383-supabase-backup.service -p Result --value 2>/dev/null || echo unknown)

printf '{"at":"%s","db":%s,"backup":%s,"backup_unit":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$json" "$backup" "$unit" > "$tmp"
chmod 644 "$tmp"
mv -f "$tmp" "$OUT_DIR/db.json"
