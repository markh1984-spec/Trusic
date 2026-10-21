# Trusic in one container: the API serves the web app from the same origin.
FROM node:22-slim
# ffmpeg converts uploads for streaming (AAC at an even volume) and resizes artwork.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable

COPY . .
# Only what the server needs: not the phone or desktop apps.
RUN pnpm install --frozen-lockfile --filter "@trusic/api..." --filter "@trusic/web..." \
  && pnpm --filter @trusic/web build \
  && pnpm --filter @trusic/api build

ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000 TRUSIC_DATA_DIR=/data

# Create the database now rather than every time the container starts: setting it up takes more memory and time
# than free hosting allows. With DEMO_SEED=true (the default) it's filled with the demo data, using the default
# demo password; the server switches to DEMO_PASSWORD when it starts. The demo audio and artwork are converted here
# too, at full speed. (Nothing the seed keeps is signed, so it gets a throwaway signing secret.) With DATABASE_URL
# set when the site runs, this copy is loaded into that database the first time instead: see deploy/start.sh.
ARG DEMO_SEED=true
RUN cd apps/api && export STREAM_SIGNING_SECRET=build-only \
  && if [ "$DEMO_SEED" = "true" ]; then node dist/seed.mjs; else node dist/migrate.mjs; fi

EXPOSE 10000
CMD ["sh", "deploy/start.sh"]
