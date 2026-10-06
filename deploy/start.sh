#!/bin/sh
# Start Trusic in a container.
set -e
cd /app/apps/api

# The image comes with its database already set up. If the data directory has been replaced with an empty one
# (e.g. a new volume), load the demo data first when DEMO_SEED=true.
if [ "$DEMO_SEED" = "true" ] && [ ! -d "$TRUSIC_DATA_DIR/pglite" ]; then
  node --enable-source-maps dist/seed.mjs
fi

exec node --enable-source-maps dist/server.mjs
