#!/usr/bin/env bash
# Refresh locked dependencies for a Cursor cloud agent Build.
# Safe to run again: npm ci reinstalls from the lockfiles.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
	echo "Node.js and npm must already be installed. This script does not install Node.js." >&2
	exit 1
fi

npm ci
npm ci --prefix site

export DEBIAN_FRONTEND=noninteractive
npx playwright install --with-deps chromium
