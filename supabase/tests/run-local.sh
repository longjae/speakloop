#!/usr/bin/env bash
set -euo pipefail

test_container="speakloop-rls-$$"
trap 'docker rm -f "$test_container" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$test_container" -e POSTGRES_PASSWORD=localtest postgres:17-alpine >/dev/null
for attempt in $(seq 1 30); do
  if docker exec "$test_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$test_container" pg_isready -U postgres >/dev/null
docker exec -i "$test_container" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
SQL
docker exec -i "$test_container" psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/202610240001_s1.sql
docker exec -i "$test_container" psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/rls.sql
