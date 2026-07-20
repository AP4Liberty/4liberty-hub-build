#!/usr/bin/env python3
"""
Deploy the fourliberty theme + 4liberty-hub plugin to the GoDaddy staging
site over SFTP. Files only — never touches the database (Golden Rule: deploy
files, never overwrite the production/staging content DB).

Reads deploy/.env.staging (git-ignored) for credentials. Uploads:
  wp-content/themes/fourliberty  -> {remote}/themes/fourliberty
  wp-content/plugins/4liberty-hub -> {remote}/plugins/4liberty-hub

Usage:  python deploy/deploy_staging.py
"""
import os
import sys
import time

import paramiko

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_env(path):
    env = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()
    return env


def ensure_remote_dir(sftp, remote_dir):
    parts = remote_dir.strip("/").split("/")
    path = ""
    for part in parts:
        path += "/" + part
        try:
            sftp.stat(path)
        except FileNotFoundError:
            sftp.mkdir(path)


def upload_dir(sftp, local_dir, remote_dir):
    ensure_remote_dir(sftp, remote_dir)
    count = 0
    for entry in sorted(os.listdir(local_dir)):
        local_path = os.path.join(local_dir, entry)
        remote_path = remote_dir.rstrip("/") + "/" + entry
        if os.path.isdir(local_path):
            count += upload_dir(sftp, local_path, remote_path)
        else:
            sftp.put(local_path, remote_path)
            print(f"  put {remote_path}")
            count += 1
    return count


def main():
    env_path = os.path.join(ROOT, "deploy", ".env.staging")
    if not os.path.exists(env_path):
        print(f"Missing {env_path} — see README.md for how to generate staging SFTP/SSH credentials.")
        sys.exit(1)

    env = load_env(env_path)
    host = env["STAGING_SFTP_HOST"]
    port = int(env["STAGING_SFTP_PORT"])
    user = env["STAGING_SFTP_USER"]
    pw = env["STAGING_SFTP_PASS"]
    remote_wp_content = env.get("STAGING_REMOTE_WP_CONTENT", "/html/wp-content")

    print(f"Connecting to {host}:{port} as {user} ...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=host, port=port, username=user, password=pw,
        look_for_keys=False, allow_agent=False,
        timeout=25, banner_timeout=25, auth_timeout=25,
    )
    sftp = client.open_sftp()
    print("Connected.")

    theme_local = os.path.join(ROOT, "wp-content", "themes", "fourliberty")
    plugin_local = os.path.join(ROOT, "wp-content", "plugins", "4liberty-hub")

    print("Uploading theme...")
    n1 = upload_dir(sftp, theme_local, remote_wp_content.rstrip("/") + "/themes/fourliberty")
    print("Uploading plugin...")
    n2 = upload_dir(sftp, plugin_local, remote_wp_content.rstrip("/") + "/plugins/4liberty-hub")

    sftp.close()
    client.close()
    print(f"Done. {n1} theme files + {n2} plugin files uploaded.")
    print("Next: in wp-admin, activate 'Support (donations)' template on /support, ")
    print("activate the '4Liberty Network' theme, and set the Site Logo.")


if __name__ == "__main__":
    main()
