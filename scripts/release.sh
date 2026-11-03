#!/bin/sh
# Check, deploy to every domain in DEPLOY_DOMAIN, then smoke-test each one.
# DEPLOY_DOMAIN holds one domain, or several separated by spaces or commas. Name all of them on every deploy: the domains
# are not in wrangler.jsonc (the repo is public), so one left out here can stop being served.
domains=$(printf '%s' "${DEPLOY_DOMAIN:-}" | tr ',' ' ')
if [ -z "$(printf '%s' "$domains" | tr -d ' ')" ]; then echo 'Set DEPLOY_DOMAIN (the site domain, or several separated by spaces)'; exit 1; fi

flags=''
for d in $domains; do flags="$flags --domain $d"; done

npm run check || exit 1
# shellcheck disable=SC2086 # the flags are meant to split into words
npx wrangler deploy --env="" $flags || exit 1

for d in $domains; do
  # A domain deployed for the first time needs a moment for its DNS record and certificate.
  tries=0
  until curl -s -o /dev/null --max-time 5 "https://$d/robots.txt"; do
    tries=$((tries + 1))
    if [ "$tries" -ge 24 ]; then echo "$d did not answer within 2 minutes"; exit 1; fi
    sleep 5
  done
  node scripts/smoke.mjs "https://$d" || exit 1
done
