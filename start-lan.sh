#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 22 LTS or newer, then run this script again."
  exit 1
fi

node scripts/start-lan.mjs "$@"
