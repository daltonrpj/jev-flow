# Hostinger Ubuntu deployment

This runbook deploys the standalone Jev Flow application as a single-tenant service. Nginx protects **every application path**, including `/`, `/jev`, `/api`, docs, examples and media, with HTTP Basic Auth over HTTPS. Node remains bound to `127.0.0.1:8723`. User data, auth hashes and provider keys stay outside the release checkout.

Replace `flow.example.org` with the exact DNS name selected for Jev Flow. Use a canonical origin such as `https://flow.example.org`, without a trailing slash, path, query, fragment or credentials. The initial service is for one trusted operator: provider connections and flows are shared by the whole process.

## 1. Inspect the target before changing it

On the selected VPS, verify the hostname, Ubuntu release, current listeners, existing services, Nginx sites, and paths before installing or replacing anything:

```sh
hostnamectl
lsb_release -a
sudo ss -ltnp
sudo systemctl list-units --type=service --state=running
sudo ls -la /etc/nginx/sites-enabled
sudo systemctl status jev-flow --no-pager
sudo ls -la /opt/jev-flow /var/lib/jev-flow /etc/jev-flow 2>/dev/null
```

If a Jev Flow service, release, data directory, Nginx site, or listener already exists, identify its owner and active release before proceeding. Preserve it; do not overwrite an unknown service or site. Keep unrelated Nginx virtual hosts enabled. Add a domain-specific server block only. Do not add `default_server` directives to this site's configuration.

Point the chosen subdomain's **A** record to the selected VPS IPv4 address. Add an AAAA record only after confirming that this VPS has working IPv6 and its firewall permits the service. Open inbound TCP 80 and 443 for Nginx. Do **not** open port 8723 to the network in Hostinger Firewall, UFW, Docker, or another proxy. If another non-Nginx process owns ports 80 or 443, stop and resolve that conflict without displacing an existing product.

## 2. Install the standalone source as a tested, immutable release

Install Node.js 20 or newer from a trusted package source first. Then install the web server and authentication/certificate tools. This section is safe to repeat during updates:

```sh
set -euo pipefail
sudo apt update
sudo apt install -y nginx apache2-utils certbot
if ! id jevflow >/dev/null 2>&1; then
  sudo useradd --system --user-group --home /nonexistent --shell /usr/sbin/nologin jevflow
fi
sudo install -d -o root -g root -m 0755 /opt/jev-flow /opt/jev-flow/releases
```

As a normal deployment account, build from the reviewed standalone GitHub repository. Reuse the clean source checkout on updates; only clone it on the first deployment. The update path verifies the remote and refuses to discard local changes. A Git archive contains only tracked project files, so it excludes `.env`, local user data, logs and `.git` history:

```sh
set -euo pipefail
if [ ! -d ~/jev-flow-source/.git ]; then
  git clone --depth 1 --branch main https://github.com/daltonrpj/jev-flow.git ~/jev-flow-source
else
  source_remote="$(git -C ~/jev-flow-source remote get-url origin)"
  [ "$source_remote" = "https://github.com/daltonrpj/jev-flow.git" ] || {
    printf 'Unexpected source remote; inspect it before continuing.\n' >&2
    exit 1
  }
  [ -z "$(git -C ~/jev-flow-source status --porcelain)" ] || {
    printf 'Source checkout has local changes; preserve and inspect them before updating.\n' >&2
    exit 1
  }
  git -C ~/jev-flow-source fetch --depth 1 origin main
  git -C ~/jev-flow-source checkout --detach FETCH_HEAD
fi
cd ~/jev-flow-source
npm ci --omit=dev --ignore-scripts
npm test
git status --short
if [ -n "$(git ls-files '.env*' 'data/**' 'runtime-data/**')" ]; then
  printf 'Tracked env or runtime data found; do not deploy this checkout.\n' >&2
  exit 1
fi
```

`npm test` must pass and the last command must print no tracked environment files, credentials, or runtime user data. Confirm the exact `git rev-parse HEAD` is the intended published standalone commit. The published CI checks the 388,080-entry catalogue certificate against the source fingerprint; do not regenerate catalogue manifests during deployment because their certification timestamp changes.

Create a versioned release from that exact commit, install runtime dependencies in the staging copy, and keep the code readable but not writable by the service:

```sh
set -euo pipefail
release="$(git rev-parse --short=12 HEAD)"
stage="$(mktemp -d "/tmp/jev-flow-release-$release.XXXXXX")"
git archive HEAD | tar -x -C "$stage"
cp -a node_modules "$stage/node_modules"
release_path="/opt/jev-flow/releases/$release"
release_stage="/opt/jev-flow/releases/.staging-$release-$$"
if sudo test -e "$release_path" || sudo test -e "$release_stage"; then
  printf 'Release path already exists; inspect and reuse it without overwriting.\n' >&2
  exit 1
fi
sudo install -d -o root -g root -m 0755 "$release_stage"
sudo cp -a "$stage/." "$release_stage/"
sudo chown -R root:root "$release_stage"
sudo find "$release_stage" -type d -exec chmod 0755 {} +
sudo find "$release_stage" -type f -exec chmod 0644 {} +
sudo mv -T "$release_stage" "$release_path"
```

The release is assembled under a hidden staging name and atomically renamed only after it is complete. Versioned release paths are immutable: if the exact SHA already exists, verify and reuse it rather than copying over it. Nginx proxies to Node and does not read release files directly. No release file contains provider keys or user data. Leave `/var/lib/jev-flow` separate.

The source checkout and tested release are prepared for both first install and updates. Sections 3 and 4 create persistent credentials and the domain's TLS/Nginx setup; run them only on the first install. For an update, leave `/etc/jev-flow`, its Basic Auth database, certificate and enabled Nginx site in place, then continue at section 5.

## 3. First install only: keep provider settings and Basic Auth outside the release

Create a root-owned environment file. The origin setting is required; provider keys remain optional and should be added only by the operator directly on the server:

```sh
set -euo pipefail
sudo install -d -o root -g www-data -m 0750 /etc/jev-flow
if [ ! -e /etc/jev-flow/jev-flow.env ]; then
  sudoedit /etc/jev-flow/jev-flow.env
else
  printf 'Environment file already exists; preserve it and edit only if configuration changes.\n'
fi
sudo chown root:root /etc/jev-flow/jev-flow.env
sudo chmod 0600 /etc/jev-flow/jev-flow.env
```

The file must include this exact, non-secret setting:

```text
JEVFLOW_PUBLIC_ORIGIN=https://flow.example.org
```

Add provider credentials only if needed, using the variable names in the main README. Do not put keys into Git, Nginx files, shell command arguments, logs or this runbook.

Create the Basic Auth database with an interactive password prompt. The password is not included in shell history. The Nginx worker must be able to traverse `/etc/jev-flow` and read the hash, while the environment file remains unreadable to it:

```sh
set -euo pipefail
if [ ! -e /etc/jev-flow/htpasswd ]; then
  sudo htpasswd -cB /etc/jev-flow/htpasswd operator
else
  printf 'Basic Auth database already exists; preserving current credentials.\n'
fi
sudo chown root:www-data /etc/jev-flow/htpasswd
sudo chmod 0640 /etc/jev-flow/htpasswd
sudo -u www-data test -r /etc/jev-flow/htpasswd
sudo -u www-data test ! -r /etc/jev-flow/jev-flow.env
```

Use `-c` only for the first account; it replaces an existing file. Check the configured Nginx worker group if it is not `www-data`. A failed permission test must be fixed before enabling the site.

## 4. First install only: issue TLS without disrupting existing sites

Use the ACME webroot method, so certificate renewal can keep working while Nginx is running. First create the challenge directory and a temporary HTTP-only vhost for the exact Jev Flow hostname:

```sh
set -euo pipefail
sudo install -d -o root -g www-data -m 0755 /var/www/letsencrypt
sudo sed 's/__DOMAIN__/flow.example.org/g' deploy/nginx-jev-flow-acme.conf | sudo tee /etc/nginx/sites-available/jev-flow-acme >/dev/null
sudo ln -s /etc/nginx/sites-available/jev-flow-acme /etc/nginx/sites-enabled/jev-flow-acme
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot --webroot-path /var/www/letsencrypt -d flow.example.org
```

Certbot will ask for its contact email and terms during the interactive certificate request. Confirm that the domain resolves to this VPS and the ACME challenge is reachable before continuing. Do not bypass certificate warnings in a browser. After issuance, install the final site configuration and keep its HTTP challenge location for renewals:

```sh
set -euo pipefail
sudo rm /etc/nginx/sites-enabled/jev-flow-acme
sudo sed 's/__DOMAIN__/flow.example.org/g' deploy/nginx-jev-flow.conf | sudo tee /etc/nginx/sites-available/jev-flow >/dev/null
sudo ln -s /etc/nginx/sites-available/jev-flow /etc/nginx/sites-enabled/jev-flow
```

If these symlinks or files already exist, inspect them and preserve the active configuration rather than replacing them blindly. The final vhost redirects HTTP to HTTPS and proxies all authenticated application paths to Node. `/api/health` intentionally returns 404 on the public domain; monitor it through the local loopback socket. For a code update, retain the working certificate, enabled vhost and ACME renewal setup; do not repeat certificate issuance or replace its symlink.

## 5. Switch the release and start the service

Before an update, record whether the service is running, retain its current release, and make a verified backup of existing application state. If any backup or validation step fails, the error trap restarts the old release before returning the error. For a first install, there is no running service or data to back up yet:

```sh
set -euo pipefail
release="$(git -C ~/jev-flow-source rev-parse --short=12 HEAD)"
old_release=""
if [ -L /opt/jev-flow/current ] && [ -e /opt/jev-flow/current ]; then
  old_release="$(readlink -e /opt/jev-flow/current)"
fi
service_was_active=0
if sudo systemctl is-active --quiet jev-flow; then
  service_was_active=1
fi
switch_done=0
restore_check=""
restore_old_service() {
  status=$?
  trap - ERR
  if [ -n "$restore_check" ] && [[ "$restore_check" == /var/tmp/jev-flow-restore-check.* ]]; then
    sudo rm -r -- "$restore_check" || true
  fi
  if [ "$service_was_active" -eq 1 ]; then
    if [ "$switch_done" -eq 1 ] && [ -n "$old_release" ]; then
      sudo ln -sTf "$old_release" /opt/jev-flow/current.recovery
      sudo mv -Tf /opt/jev-flow/current.recovery /opt/jev-flow/current
      sudo systemctl restart jev-flow
    else
      sudo systemctl start jev-flow
    fi
  elif [ "$switch_done" -eq 1 ] && [ -z "$old_release" ]; then
    sudo systemctl stop jev-flow || true
  fi
  if [ "$service_was_active" -eq 1 ] && ! curl -fsS -H 'Host: flow.example.org' http://127.0.0.1:8723/api/health >/dev/null; then
    printf 'Previous release restart completed, but its local health check failed; inspect systemctl and journalctl.\n' >&2
  fi
  exit "$status"
}
trap restore_old_service ERR
if [ -n "$old_release" ]; then
  sudo ln -sTf "$old_release" /opt/jev-flow/previous
fi
if sudo test -d /var/lib/jev-flow; then
  if sudo systemctl is-active --quiet jev-flow; then
    sudo systemctl stop jev-flow
  fi
  backup="/var/backups/jev-flow-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
  sudo tar --numeric-owner -C /var/lib -czf "$backup" jev-flow
  sudo chmod 0600 "$backup"
  sudo tar -tzf "$backup" >/dev/null
  restore_check="$(mktemp -d /var/tmp/jev-flow-restore-check.XXXXXX)"
  sudo chmod 0700 "$restore_check"
  sudo tar -xzf "$backup" -C "$restore_check"
  sudo find "$restore_check/jev-flow" -type f -name '*.json' -exec node -e 'const fs=require("node:fs"); for (const path of process.argv.slice(1)) JSON.parse(fs.readFileSync(path,"utf8"))' {} +
  sudo rm -r -- "$restore_check"
  restore_check=""
fi
sudo ln -sTf "/opt/jev-flow/releases/$release" "/opt/jev-flow/current.next-$release"
sudo mv -Tf "/opt/jev-flow/current.next-$release" /opt/jev-flow/current
switch_done=1
sudo install -m 0644 deploy/jev-flow.service /etc/systemd/system/jev-flow.service
sudo systemctl daemon-reload
sudo systemctl enable jev-flow
if sudo systemctl is-active --quiet jev-flow; then
  sudo systemctl restart jev-flow
else
  sudo systemctl start jev-flow
fi
sudo nginx -t
sudo systemctl reload nginx
curl -fsS -H 'Host: flow.example.org' http://127.0.0.1:8723/api/health >/dev/null
trap - ERR
```

The recovery trap remains active through the local health check. If a command fails during backup, the previous release remains selected and a service that was active before the update is restarted. Once the local health check succeeds, the public checks in section 6 determine whether to keep the new release or use the manual rollback in section 7.

The service uses `HOST=127.0.0.1`, `PORT=8723`, `JEVFLOW_PUBLIC_ORIGIN` from `/etc/jev-flow/jev-flow.env`, and `JEVFLOW_DATA_DIR=/var/lib/jev-flow`. Nginx protects `/`, every app and API path, docs, examples and media with the same `htpasswd` database. Forwarded headers and Basic credentials are stripped before proxying. Mutations still require JSON and the exact HTTPS Origin.

Check that the release contains the app and that Node listens only on loopback:

```sh
sudo test -r /opt/jev-flow/current/server.mjs
sudo ss -ltnp | grep ':8723'
curl -i -H 'Host: flow.example.org' http://127.0.0.1:8723/api/health
```

The health response should be `200` locally, and `ss` should show only `127.0.0.1:8723` for Node.
On an update, confirm that the running process has loaded the new release after the restart:

```sh
set -euo pipefail
main_pid="$(sudo systemctl show -p MainPID --value jev-flow)"
readlink -f /opt/jev-flow/current
sudo readlink -f "/proc/$main_pid/cwd"
```

The two resolved paths must match the new `/opt/jev-flow/releases/<commit>` directory; the health response alone does not prove which release is active.

## 6. Verify the public surface, TLS and renewal

Run these from a machine outside the VPS after DNS and the certificate are active:

```sh
curl -I http://flow.example.org/                       # 301 to HTTPS
curl -I https://flow.example.org/                      # 401 without Basic Auth
curl -i https://flow.example.org/jev/flows             # 401 without Basic Auth
curl -i https://flow.example.org/api/jev/flows         # 401 without Basic Auth
curl -i https://flow.example.org/media/jev-flow-walkthrough.webm # 401 without Basic Auth
curl -i https://flow.example.org/api/health             # 404 without auth
curl -i --user operator https://flow.example.org/api/health # still 404 with auth
curl -I --user operator https://flow.example.org/       # 302 to /jev/flows
curl -i --user operator https://flow.example.org/jev/flows  # prompts for password; 200
curl -i --user operator https://flow.example.org/api/jev/flows # prompts for password; 200
```

The Nginx vhost checks the raw `Host` value, including any port. Verify that a noncanonical authority is rejected before authentication or proxying (replace `VPS_IPV4` with the selected server address):

```sh
curl -i --resolve flow.example.org:443:VPS_IPV4 -H 'Host: flow.example.org:444' https://flow.example.org/jev/flows
```

Expected status: `444` (Nginx closes the connection); the canonical host without an explicit port should continue to return `401` without credentials.

With authentication, send a harmless invalid-flow mutation to prove HTTPS Origin checking reaches Node without calling a model:

```sh
curl -i --user operator \
  -H 'Origin: https://flow.example.org' \
  -H 'Content-Type: application/json' \
  --data '{}' https://flow.example.org/api/jev/flows
```

It should return `422` after the origin check. Repeat with `Origin: https://attacker.invalid`; it must return `403`. Then open `/jev/flows` in a browser, authenticate, create a disposable local-only flow, and confirm static assets load. Verify Arena SSE through Nginx with a no-provider or harmless local test; do not make provider calls just to smoke-test the server. Check `journalctl -u jev-flow` for startup failures and keep request bodies, credentials, keys and private flow contents out of logs.

Verify the certificate can renew without stopping Nginx and that the timer is active:

```sh
set -euo pipefail
sudo systemctl enable --now certbot.timer
sudo certbot renew --dry-run
sudo systemctl list-timers certbot.timer
```

## 7. Roll back code without overwriting state

If the new release fails health or public smoke checks and `/opt/jev-flow/previous` exists, atomically restore the saved code pointer and restart the service:

```sh
set -euo pipefail
old_release="$(sudo readlink -e /opt/jev-flow/previous)"
sudo ln -sTf "$old_release" /opt/jev-flow/current.rollback
sudo mv -Tf /opt/jev-flow/current.rollback /opt/jev-flow/current
sudo systemctl restart jev-flow
curl -fsS -H 'Host: flow.example.org' http://127.0.0.1:8723/api/health
main_pid="$(sudo systemctl show -p MainPID --value jev-flow)"
test "$(sudo readlink -f "/proc/$main_pid/cwd")" = "$old_release"
```

Repeat the public 401/404/200 checks after rollback. Do not delete `/var/lib/jev-flow` or restore an old data archive over live state as part of code rollback. If restoring state is necessary, stop the service, copy the current state aside, and restore the verified archive to a separate inspection directory first.

## Security limits

Basic Auth over valid HTTPS is suitable here only for one trusted operator. It does not provide per-user data isolation, MFA or a real logout; browsers may cache credentials. Processes with shell access on this VPS can connect to loopback and bypass the Nginx password, so do not grant shell access to untrusted users. Do not expose port 8723 directly, and do not use an untrusted HTTP proxy. If Nginx or TLS is unavailable, keep Jev Flow offline rather than serving its Studio directly.
