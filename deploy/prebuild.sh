#!/usr/bin/env bash
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
echo "SCRIPT_DIR: ${SCRIPT_DIR}"

echo "=> Create production bundle..."
cd ${SCRIPT_DIR}/../label_studio/frontend
npm ci && npm run build:production
cd ${SCRIPT_DIR}

MANAGE=${SCRIPT_DIR}/../label_studio/manage.py

echo "=> Compile Django messages..."
python3 $MANAGE compilemessages -l en_US -l zh_Hans

echo "=> Collect static..."
python3 $MANAGE collectstatic --no-input

echo "=> Create version file..."
python3 ${SCRIPT_DIR}/../label_studio/core/version.py
