# syntax=docker/dockerfile:1

# multi-stage build: nx (api + web) -> nginx + node under supervisor.
# node pinned to 24 lts (satisfies nestjs 11 and angular 21; matches local npm 11 lockfile).

# ---- stage: builder ----
# compiles the api (webpack) and the web spa (angular). the native toolchain
# is present so the first better-sqlite3 import compiles without a dockerfile change.
FROM node:24-alpine AS builder
RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /workspace

# install against the committed lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# webpack already emits dist/apps/api/{package.json,package-lock.json} via
# generatePackageJson, so the broken `nx prune` target is intentionally skipped.
RUN npx nx build api && npx nx build web
# guard: workspace_modules only exists once a @opspilot/* lib is imported in main.ts.
# create it unconditionally so the COPY below never fails.
RUN mkdir -p dist/apps/api/workspace_modules

# ---- stage: api-deps ----
# isolates the production node_modules (and native-module compilation later).
FROM node:24-alpine AS api-deps
RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /app
COPY --from=builder /workspace/dist/apps/api/package.json ./
COPY --from=builder /workspace/dist/apps/api/workspace_modules ./workspace_modules
# nx generatePackageJson emits a pruned package-lock.json that misplaces deeply
# nested duplicate versions (content-type 1.x top-level vs 2.x under
# platform-express -> type-is), so npm ci rejects it as out of sync. resolve the
# small production tree fresh from the generated package.json instead.
RUN npm install --omit=dev --no-audit --no-fund

# ---- stage: runtime ----
# nginx serves the spa + proxies /api; node runs nestjs; supervisor keeps both up.
FROM nginx:1.27-alpine AS runtime

# bring the node binary from the matching musl image (same abi as nginx:alpine).
COPY --from=node:24-alpine /usr/local/bin/node /usr/local/bin/node
# --upgrade forces the pre-installed expat up to the version pyexpat (pulled by
# python3 -> supervisor) links against, otherwise supervisord fails to import.
RUN apk add --no-cache --upgrade expat supervisor tini libstdc++ libgcc libc6-compat

# api bundle + production node_modules.
WORKDIR /app
COPY --from=builder /workspace/dist/apps/api/main.js ./main.js
# migrations land next to main.js so the boot-time migrate() resolves them via __dirname.
COPY --from=builder /workspace/dist/apps/api/migrations ./migrations
COPY --from=api-deps /app/node_modules ./node_modules

# spa static files.
COPY --from=builder /workspace/dist/apps/web/browser /usr/share/nginx/html

# nginx + supervisor configs.
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisord.conf

# bind-mount target for the future sqlite file (local btrfs on the host).
RUN mkdir -p /data

# nginx on 8080 (no clash with dsm 80/443/5000/5001); node on 127.0.0.1:3000.
EXPOSE 8080
ENV PORT=3000

# pid 1 = tini for correct signal forwarding -> supervisor -> api/nginx.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["supervisord", "-c", "/etc/supervisord.conf", "-n"]
