#!/usr/bin/env bash
# Interactive, local-only credential entry for JAKESJAM's R2 clip hosting.
# Run this yourself in your own terminal — never paste these values into
# chat/Claude Code messages. The secret is read with terminal echo off and
# is never printed back, logged, or transmitted anywhere by this script.
#
# Usage: ./scripts/setup-r2-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="server/.env.local"

if [ -f "$ENV_FILE" ]; then
  echo "warning: $ENV_FILE already exists."
  read -r -p "Overwrite it? [y/N] " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted — existing file left untouched."
    exit 1
  fi
fi

echo "JAKESJAM R2 credential setup — values are entered here only, never shown again, never sent anywhere."
echo

read -r -p "R2_ACCOUNT_ID (from the token success page): " account_id
read -r -p "R2_ACCESS_KEY_ID: " access_key_id

echo -n "R2_SECRET_ACCESS_KEY (input hidden): "
read -r -s secret_access_key
echo

read -r -p "R2_BUCKET (public clips bucket name): " bucket
read -r -p "R2_ARCHIVE_BUCKET [jakesjam-clips-archive]: " archive_bucket
archive_bucket="${archive_bucket:-jakesjam-clips-archive}"
read -r -p "R2_PUBLIC_CLIP_DOMAIN (e.g. clips.elyad.io, leave blank if not bound yet): " public_domain

{
  echo "R2_ACCOUNT_ID=$account_id"
  echo "R2_ACCESS_KEY_ID=$access_key_id"
  echo "R2_SECRET_ACCESS_KEY=$secret_access_key"
  echo "R2_BUCKET=$bucket"
  echo "R2_ARCHIVE_BUCKET=$archive_bucket"
  if [ -n "$public_domain" ]; then
    echo "R2_PUBLIC_CLIP_DOMAIN=$public_domain"
  fi
} > "$ENV_FILE"

chmod 600 "$ENV_FILE"

echo
echo "Saved 5-6 vars to $ENV_FILE (permissions 600, gitignored)."
echo "Values are not printed here or anywhere else — tell Claude Code you're done and it can verify the app loads them without ever seeing the actual secret."
