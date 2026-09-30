#!/usr/bin/env sh
# Wipe the local SQLite database and reseed from seed/docs on the next start.
# Usage: ./reset.sh            (then start the API as usual)
#        ./reset.sh --run      (reset and start the dev server on :8000)
set -eu
cd "$(dirname "$0")"
rm -f ../data/verity.db ../data/verity.db-wal ../data/verity.db-shm
echo "Database wiped; it will be recreated and seeded on next start."
if [ "${1:-}" = "--run" ]; then
  exec env VERITY_RESET=1 uv run --python 3.12 --with-requirements requirements.txt uvicorn main:app --port 8000
fi
