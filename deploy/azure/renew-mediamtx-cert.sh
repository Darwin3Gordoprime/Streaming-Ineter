#!/usr/bin/env sh
set -eu

PROJECT_DIR="${INETER_PROJECT_DIR:-/opt/ineter}"
AZURE_COMPOSE_FILE="$PROJECT_DIR/deploy/azure/docker-compose.azure.yml"

if [ ! -f "$PROJECT_DIR/docker-compose.yml" ] || [ ! -f "$AZURE_COMPOSE_FILE" ]; then
  echo "No se encuentra el proyecto En Vivo en $PROJECT_DIR" >&2
  exit 1
fi

docker compose \
  -f "$PROJECT_DIR/docker-compose.yml" \
  -f "$AZURE_COMPOSE_FILE" \
  up -d --force-recreate mediamtx
