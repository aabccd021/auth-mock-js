export NETERO_DIR="./var/lib/netero"
mkdir -p "$NETERO_DIR"

mkfifo "./ready0.fifo"
mkfifo "./ready1.fifo"

server 2>&1 | while IFS= read -r line; do
  printf '\033[32m[server]\033[0m %s\n' "$line"
done &

auth-mock-server \
  --db "./db.sqlite" \
  --on-ready-pipe "./ready1.fifo" \
  --port 3001 2>&1 | while IFS= read -r line; do
  printf '\033[34m[accounts.google.com]\033[0m %s\n' "$line"
done &

timeout 5 cat ./ready0.fifo >/dev/null
timeout 5 cat ./ready1.fifo >/dev/null

bash -euo pipefail "$TEST_FILE" 2>&1 | while IFS= read -r line; do
  printf '\033[33m[client]\033[0m %s\n' "$line"
done

mkdir $out
