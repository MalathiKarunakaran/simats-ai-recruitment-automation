# Production image for the Vite/React frontend: build the static bundle in
# a Node stage, then serve it from a minimal nginx stage. VITE_API_BASE_URL
# is a build-time arg (Vite inlines import.meta.env.* at build time, not
# read at container start) -- pass it via docker-compose's build.args, e.g.
# https://api.malathi.io/api/v1 for the production deployment.
#
# Debian-slim, not alpine: Vite 8's Rolldown bundler and lightningcss both
# ship Rust-native (napi) binaries, and musl (alpine) support for those is
# far less battle-tested than glibc -- `npm ci` failed outright on
# node:22-alpine in this project's first deploy attempt.
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
# npm install, not npm ci: package-lock.json here was generated on Windows,
# and npm ci's strict lockfile-fidelity check can miscompute which native
# optional binaries (Rolldown/lightningcss both ship per-platform napi
# binaries) apply when installing on a different OS -- a well-known npm bug
# (npm/cli#4828) that failed npm ci outright in this project's first two
# production deploy attempts, before any real network install even ran.
# npm install recomputes the dependency tree fresh instead of trusting the
# lock strictly, picking the correct linux-x64-gnu binaries at install time.
RUN npm install

COPY . .

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
