# Production image for the Vite/React frontend: build the static bundle in
# a Node stage, then serve it from a minimal nginx stage. VITE_API_BASE_URL
# is a build-time arg (Vite inlines import.meta.env.* at build time, not
# read at container start) -- pass it via docker-compose's build.args, e.g.
# https://api.malathi.io/api/v1 for the production deployment.
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
