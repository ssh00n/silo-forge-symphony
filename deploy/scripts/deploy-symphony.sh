#!/usr/bin/env zsh
# deploy-symphony.sh - Reference runtime manual apply script for Symphony on Otter EC2
# Usage: ./scripts/deploy-symphony.sh [--install]
#   --install  First-time setup (install deps, create dirs, enable service)
#
# Current deployment notes:
# - Symphony worker runner uses `claude` with `codex` CLI fallback
# - Secret source of truth is Vault
# - /home/ubuntu/symphony/.env is a generated runtime artifact

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="otter"
REMOTE_DIR="/home/ubuntu/symphony"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Symphony Deployer → Otter EC2     ║"
echo "╚══════════════════════════════════════╝"
echo ""

# --- Sync source files ---
echo "📦 Syncing Symphony source..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude 'logs' \
  "$REPO_DIR/symphony/" "$TARGET:$REMOTE_DIR/"
echo "  [ok] Source synced"
echo ""

# --- First-time install ---
if [ "$1" = "--install" ]; then
  echo "🔧 First-time setup..."

  # Install dependencies
  echo "  Installing npm dependencies..."
  ssh "$TARGET" "cd $REMOTE_DIR && npm install --production"
  echo "  [ok] Dependencies installed"

  # Create required directories
  ssh "$TARGET" "mkdir -p /home/ubuntu/symphony_workspaces $REMOTE_DIR/logs"
  echo "  [ok] Directories created"

  # Create placeholder .env only if not exists
  ssh "$TARGET" "[ -f $REMOTE_DIR/.env ] || cat > $REMOTE_DIR/.env << 'ENVEOF'
# Generated runtime env is normally provided by vault-env.sh
LINEAR_API_KEY=
ENVEOF"
  echo "  [ok] .env placeholder created (Vault-managed env preferred)"

  # Install systemd service
  ssh "$TARGET" "mkdir -p ~/.config/systemd/user"
  scp -q "$REPO_DIR/config/symphony.service" "$TARGET:~/.config/systemd/user/symphony.service"
  ssh "$TARGET" "systemctl --user daemon-reload && systemctl --user enable symphony.service"
  echo "  [ok] systemd service installed and enabled"

  echo ""
  echo "⚠️  Before starting Symphony, you must:"
  echo "   1. Provision Vault/AppRole creds on Otter"
  echo "   2. Generate runtime env: vault-env.sh otter $REMOTE_DIR/.env"
  echo "   3. Update project_slug in $REMOTE_DIR/WORKFLOW.md if needed"
  echo "   4. Install Claude CLI and Codex CLI on Otter"
  echo "   5. Authenticate Codex on Otter if fallback should be available"
  echo ""
  echo "   Then start with: ssh otter 'systemctl --user start symphony'"
  echo ""
else
  # Just sync and restart
  echo "🔄 Restarting Symphony service..."
  ssh "$TARGET" "systemctl --user restart symphony.service 2>/dev/null || echo '  (service not yet installed, run with --install first)'"
  echo "  [ok] Symphony restarted"
fi

echo ""
echo "━━━ Deploy complete ━━━"
echo ""
