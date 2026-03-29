#!/bin/bash
# Upload site configs from YAML to KV as JSON.
# Key format: config:{clientName} where clientName matches D1 clients.name
set -uo pipefail

SITES_DIR="/Users/rombot/roam-eco/roamcrawler/sites"
ACCOUNT="732e7b6d5dd17779e5b2368491e6a05f"
CACHE_NS="ec2c9c854b174240ad7ceb59bacf53cb"
TMPDIR=$(mktemp -d)

export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT"

uploaded=0
failed=0

upload() {
  local client_name="$1"
  local yaml_name="$2"
  local yaml_file="$SITES_DIR/${yaml_name}.yaml"

  if [ ! -f "$yaml_file" ]; then
    echo "SKIP  $client_name (no yaml: $yaml_name)"
    ((failed++))
    return
  fi

  local json_file="$TMPDIR/${client_name}.json"
  yq -o json "$yaml_file" > "$json_file"

  npx wrangler kv key put "config:${client_name}" \
    --namespace-id "$CACHE_NS" \
    --path "$json_file" 2>/dev/null

  echo "OK    config:${client_name} <- ${yaml_name}.yaml"
  ((uploaded++))
}

# D1 clientName -> YAML config filename
upload beg meetgeelong
upload bourkeshire visitbourke
upload coralcoast australiascoralcoast
upload geelongbellarine visitgeelongbellarine
upload gippsland destinationgippsland
upload goldenoutback australiasgoldenoutback
upload grampians1 grampianstourism
upload lovewestside lovewestside
upload melbournenow melbournenow
upload mrt visitthemurray
upload mudgee1 mudgeeregion
upload northofthemurray northofthemurray
upload phillipisland destinationphillipisland
upload portmacquarie portmacquariehastings
upload swanvalley swanvalley
upload tourismbowen tourismbowen
upload vicheartland victoriasheartland
upload whitsundays tourismwhitsundays
upload yarraranges yarrarangestourism

rm -rf "$TMPDIR"
echo ""
echo "Done: $uploaded uploaded, $failed failed"
