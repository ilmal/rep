#!/usr/bin/env bash
# Proves the newest offsite backup is restorable: download, gunzip, integrity_check, row counts. Never touches the live DB.
# Usage: SSH_TARGET=user@backup-host REMOTE_DIR=/srv/backups/rep SSH_KEY=~/.ssh/id_ed25519 deploy/restore-drill.sh
set -euo pipefail
: "${SSH_TARGET:?set SSH_TARGET}"; : "${REMOTE_DIR:?set REMOTE_DIR}"
KEY=${SSH_KEY:-$HOME/.ssh/id_ed25519}
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
latest=$(ssh -i "$KEY" -o BatchMode=yes "$SSH_TARGET" "ls -1 '$REMOTE_DIR' | grep -E '^rep_[0-9]{8}_[0-9]{6}\.db\.gz$' | sort | tail -1")
echo "newest backup: $latest"
scp -q -i "$KEY" "$SSH_TARGET:$REMOTE_DIR/$latest" "$tmp/b.db.gz"
gunzip "$tmp/b.db.gz"
python3 - "$tmp/b.db" <<'PY'
import sqlite3, sys, time, re
d = sqlite3.connect(sys.argv[1])
assert d.execute('pragma integrity_check').fetchone()[0] == 'ok', 'integrity_check failed'
print('users:', d.execute('select count(*) from users').fetchone()[0])
for t, n in d.execute('select type, count(*) from entities where deleted=0 group by type'): print(f'  {t}: {n}')
PY
echo "restore drill OK"
