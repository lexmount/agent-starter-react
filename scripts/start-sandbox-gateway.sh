#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

for env_file in .env .env.sandbox-gateway; do
  if [[ -f "${env_file}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${env_file}"
    set +a
  fi
done

export LIVEAVATAR_USE_SANDBOX="${LIVEAVATAR_USE_SANDBOX:-1}"
exec node scripts/start-liveavatar.mjs
