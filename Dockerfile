# Phase 7: production image for the FastAPI app. Matches the dev
# environment's Python version exactly (see README's Prerequisites) to avoid
# any subtle dependency-resolution drift between dev and container.
FROM python:3.14-slim

WORKDIR /app

# libpq/psycopg and argon2-cffi ship prebuilt wheels for this platform, so
# no compiler toolchain is installed here -- if a future dependency needs
# one, add build-essential based on the actual build failure, not pre-emptively.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini .
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh

# Non-root: no reason for this process to run as root inside the container.
RUN useradd --create-home --shell /bin/bash appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
