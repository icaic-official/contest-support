#!/usr/bin/env bash
# Refresh locked dependencies for a Cursor cloud agent Build.
# Safe to run again: npm ci reinstalls from the lockfiles, and Deno is copied only when missing.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
	echo "Node.js and npm must already be installed. This script does not install Node.js." >&2
	exit 1
fi

npm ci
npm ci --prefix site

if ! command -v deno >/dev/null 2>&1; then
	deno_bin="$(find node_modules/@deno -type f -name deno -executable -print -quit)"
	if [[ -z "${deno_bin}" ]]; then
		echo "The locked Deno package did not install a binary." >&2
		exit 1
	fi
	sudo install -m 755 "${deno_bin}" /usr/local/bin/deno
fi

export DEBIAN_FRONTEND=noninteractive
npx playwright install --with-deps chromium
