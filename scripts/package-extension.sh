#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/manifest.json').version")"
OUTPUT_DIR="${ROOT_DIR}/dist"
OUTPUT_FILE="${OUTPUT_DIR}/tabdoze-${VERSION}-extension.zip"

cd "${ROOT_DIR}"
mkdir -p "${OUTPUT_DIR}"
rm -f "${OUTPUT_FILE}"

zip -q "${OUTPUT_FILE}" \
  manifest.json \
  background.js \
  popup.html popup.js popup.css \
  settings.html settings.js settings.css \
  stats-dashboard.html stats-dashboard.js \
  onboarding.html onboarding.js onboarding.css \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png

unzip -tq "${OUTPUT_FILE}"
printf '%s\n' "${OUTPUT_FILE}"
