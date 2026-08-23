# Bakes the Caddyfile into the image at build time instead of bind-mounting
# it from the host. The production deploy tool only syncs docker-compose.yml
# itself into the running project's directory, not every other repo file --
# a bind-mounted ./Caddyfile there resolved to a path that didn't exist, and
# Docker's default behavior for a missing bind-mount source is to silently
# create an empty directory, which then collided with Caddy's own
# /etc/caddy/Caddyfile (a file in the base image): "not a directory" mount
# error. `build:` contexts don't have this problem -- the build step
# operates against the full cloned repo (proven by the frontend/backend
# services' builds, which need their own full source trees).
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
