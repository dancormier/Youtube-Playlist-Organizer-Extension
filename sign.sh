#!/bin/bash
set -e

# Sign the Firefox extension with Mozilla's API.
# Set these environment variables before running:
#   export AMO_JWT_ISSUER="your-jwt-issuer"
#   export AMO_JWT_SECRET="your-jwt-secret"
#
# Get credentials at: https://addons.mozilla.org/developers/addon/api/key/

if [ -z "$AMO_JWT_ISSUER" ] || [ -z "$AMO_JWT_SECRET" ]; then
  echo "Error: AMO_JWT_ISSUER and AMO_JWT_SECRET must be set."
  echo ""
  echo "  export AMO_JWT_ISSUER=\"your-jwt-issuer\""
  echo "  export AMO_JWT_SECRET=\"your-jwt-secret\""
  exit 1
fi

# Build first
./build.sh

# Sign
web-ext sign \
  --source-dir dist/firefox \
  --artifacts-dir dist \
  --api-key="$AMO_JWT_ISSUER" \
  --api-secret="$AMO_JWT_SECRET" \
  --channel=unlisted
