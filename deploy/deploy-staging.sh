#!/usr/bin/env bash
# Thin wrapper — the real logic is in deploy_staging.py (uses paramiko for
# SFTP since this environment has no sshpass/expect for password-based
# native ssh/sftp automation).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
python deploy/deploy_staging.py
