#!/bin/sh
# Start Trusic in a container.
set -e
cd /app/apps/api

if [ -n "$DATABASE_URL" ]; then
  # A database that lasts (Supabase, say), usually with file storage that lasts too (the S3_ settings). Bring the
  # database up to date. The first time only, when it's empty, copy in the demo data this image was built with, and
  # its files: in one go, so an interrupted start leaves it empty and the next one tries again.
  node --enable-source-maps dist/migrate.mjs
  if [ "$DEMO_SEED" = "true" ]; then
    node --enable-source-maps dist/load-demo.mjs
  fi
elif [ "$DEMO_SEED" = "true" ] && [ ! -d "$TRUSIC_DATA_DIR/pglite" ]; then
  # The image comes with its database already set up. If the data directory has been replaced with an empty one
  # (e.g. a new volume), load the demo data first.
  node --enable-source-maps dist/seed.mjs
fi

exec node --enable-source-maps dist/server.mjs
