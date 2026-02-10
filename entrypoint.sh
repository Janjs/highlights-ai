#!/bin/sh
set -e

/app/.venv/bin/gunicorn \
  --bind 0.0.0.0:${FLASK_PORT:-5001} \
  --timeout 600 \
  --workers 2 \
  --chdir /app/backend \
  wsgi:app &

HOSTNAME="0.0.0.0" PORT=3000 node server.js
