#!/bin/sh
# Run inside a fresh offline container with installed locked dependencies.
set -eu
umask 077

phase=${1:?Expected prepare, rollback or restore}
case "$phase" in prepare|rollback|restore) ;; *) exit 2 ;; esac
if [ "${I18N_SYNTHETIC_ROLLBACK_REHEARSAL:-}" != 1 ] \
  || [ "${DJANGO_DB:-}" != sqlite ] || [ "${BASE_DATA_DIR:-}" != /data ] \
  || [ "${I18N_ROLLBACK_HELPER:-}" != /check.py ]; then
  echo 'An explicit disposable synthetic SQLite container is required.' >&2
  exit 2
fi
if [ "$phase" = prepare ] && { [ -e /data/label_studio.sqlite3 ] || [ -e /data/fixture.json ]; }; then
  echo 'Prepare requires a fresh data volume; an existing database/fixture is refused.' >&2
  exit 2
fi
export PYTHONPATH=
python=/deps/.venv/bin/python
"$python" -m pip install --quiet --no-deps --force-reinstall /artifact/label_studio-1.23.0-py3-none-any.whl

# Add only the installed package root; never load backend source from /src.
manage() {
  "$python" -c 'import sys; from pathlib import Path; import label_studio; sys.path.insert(0, str(Path(label_studio.__file__).parent)); from django.core.management import execute_from_command_line; execute_from_command_line(["manage.py", *sys.argv[1:]])' "$@"
}
if [ "$phase" = prepare ]; then
  manage migrate --noinput
  manage seed_enterprise_e2e --output /data/fixture.json
  "$python" /check.py prepare
elif [ "$phase" = rollback ]; then
  "$python" /check.py artifact
else
  "$python" /check.py restore
fi
manage collectstatic --noinput
manage runserver 127.0.0.1:8080 --noreload > /results/django.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; cp -R /src/web/dist/cypress/apps/labelstudio-e2e/. /results/ 2>/dev/null || true' EXIT
for attempt in $(seq 1 60); do
  if curl --fail --silent http://localhost:8080/health/ >/dev/null \
    && curl --fail --silent http://localhost:8080/react-app/main.js >/dev/null; then
    break
  fi
  sleep 1
done
curl --fail --silent http://localhost:8080/health/ >/dev/null
cd /src/web
yarn cypress run --browser chrome --headless \
  --project apps/labelstudio-e2e \
  --config-file cypress.rollback.config.ts \
  --config baseUrl=http://localhost:8080,video=true \
  --env "rollbackPhase=$phase" \
  --spec apps/labelstudio-e2e/src/rehearsals/english-rollback.cy.ts
