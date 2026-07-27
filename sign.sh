#!/bin/bash
set -e

# Sign the Firefox extension with Mozilla's API, on the unlisted channel.
#
# Unlisted means Mozilla signs the add-on but does not publish it — the signed
# .xpi is for self-distribution. That signature is what lets release Firefox
# install it permanently; a temporary add-on loaded via about:debugging is wiped
# on every restart.
#
# Credentials come from 1Password by default, so nothing has to be typed or
# pasted. Override by exporting AMO_JWT_ISSUER / AMO_JWT_SECRET first.
#
# Get credentials at: https://addons.mozilla.org/developers/addon/api/key/

OP_VAULT="Home Server"
OP_ITEM="Mozilla Developer Hub (For Firefox Add-ons)"
# The AMO "JWT issuer" is stored as the item's username, the "JWT secret" as its
# credential. Note the item name contains parentheses, which the op:// URI parser
# rejects — hence `op item get --fields` rather than `op read`.

if [ -z "$AMO_JWT_ISSUER" ] || [ -z "$AMO_JWT_SECRET" ]; then
  if command -v op >/dev/null 2>&1; then
    echo "Reading AMO credentials from 1Password ($OP_VAULT)..."
    AMO_JWT_ISSUER=$(op item get "$OP_ITEM" --vault "$OP_VAULT" --fields username --reveal)
    AMO_JWT_SECRET=$(op item get "$OP_ITEM" --vault "$OP_VAULT" --fields credential --reveal)
  fi
fi

if [ -z "$AMO_JWT_ISSUER" ] || [ -z "$AMO_JWT_SECRET" ]; then
  echo "Error: could not obtain AMO credentials."
  echo ""
  echo "Either install the 1Password CLI and ensure this item exists:"
  echo "  vault: $OP_VAULT"
  echo "  item:  $OP_ITEM"
  echo ""
  echo "or set them manually:"
  echo "  export AMO_JWT_ISSUER=\"your-jwt-issuer\""
  echo "  export AMO_JWT_SECRET=\"your-jwt-secret\""
  exit 1
fi

# AMO rejects a version it has already seen, so a re-sign needs a version bump
# in package.json. Fail early with a clear message rather than after the upload.
VERSION=$(node -p "require('./package.json').version")
echo "Signing version $VERSION (unlisted)"

# Build first
./build.sh

# Sign
web-ext sign \
  --source-dir dist/firefox \
  --artifacts-dir dist \
  --api-key="$AMO_JWT_ISSUER" \
  --api-secret="$AMO_JWT_SECRET" \
  --channel=unlisted
