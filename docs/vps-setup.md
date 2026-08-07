# Setting up serverbot on a VPS

Quick guide for a Debian/Ubuntu-style VPS with systemd. Prerequisites: Node.js ≥ 20.6, git, `ss` (package `iproute2`, present on virtually every distro), and the game servers already running as systemd units (e.g. `palworld.service`).

## 1. Service account and sudo fence

Create a system account and grant it exactly the commands it needs:

```bash
sudo useradd -r -s /usr/sbin/nologin -d /opt/serverbot serverbot
sudo visudo -f /etc/sudoers.d/serverbot
```

```
Cmnd_Alias GAMECTL = /usr/bin/systemctl start palworld, \
                     /usr/bin/systemctl stop palworld

serverbot ALL=(root) NOPASSWD: GAMECTL
```

```bash
sudo chmod 440 /etc/sudoers.d/serverbot
sudo visudo -c
```

**Invariant: every `unit` in `servers.json` needs its `start` and `stop` pair in `GAMECTL`.** The bot warns in the journal at startup when an entry is missing.

Verify the fence — the first two must **fail**, the third succeeds (and actually starts the game, so stop it after if unwanted):

```bash
sudo -u serverbot sudo -n systemctl start nginx
sudo -u serverbot sudo -n systemctl restart palworld
sudo -u serverbot sudo -n systemctl start palworld
```

## 2. Deploy the code

Clone and build root-owned — the bot only ever reads its own code, so a compromised bot can't rewrite itself:

```bash
sudo git clone https://github.com/YOU/serverbot.git /opt/serverbot
cd /opt/serverbot
sudo npm ci --ignore-scripts
sudo npm run build
sudo cp servers.example.json servers.json
sudo nano servers.json
```

Then the environment file — the only thing `serverbot` owns (values come from the [Discord setup guide](discord-setup.md)):

```bash
sudo cp .env.example .env
sudo nano .env
sudo chown serverbot:serverbot /opt/serverbot/.env
sudo chmod 600 /opt/serverbot/.env
```

## 3. The systemd unit

```bash
sudo nano /etc/systemd/system/serverbot.service
```

```ini
[Unit]
Description=serverbot — Discord game server control
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=serverbot
Group=serverbot
WorkingDirectory=/opt/serverbot
EnvironmentFile=/opt/serverbot/.env
ExecStart=/usr/bin/node /opt/serverbot/dist/main.js
Restart=always
RestartSec=10

NoNewPrivileges=false
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

Why the hardening list stops there: sudo only works while the kernel's no-new-privileges flag is off, and for a non-root `User=` systemd silently forces that flag **on** if the unit uses any seccomp-backed option (`ProtectKernelTunables=`, `RestrictSUIDSGID=`, `SystemCallFilter=`, `PrivateDevices=`, …) — an explicit `NoNewPrivileges=false` does not override it. Add one of those and every `/start` dies with `sudo: The "no new privileges" flag is set`. The mount-namespace options above are safe.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now serverbot
sudo journalctl -u serverbot -f
```

## 4. Verify

- The journal shows `serverbot ready as … — 1 server(s): palworld` and no sudoers warnings.
- The sandbox didn't re-enable the flag behind your back:

  ```bash
  grep NoNewPrivs /proc/$(systemctl show -p MainPID --value serverbot)/status
  ```

  must print `NoNewPrivs: 0`.

- One real `/start` from Discord — that exercises the full path (sandbox → sudo → systemctl), which no shell test can.

## Updating

```bash
cd /opt/serverbot
sudo git pull
sudo rm -rf dist            # tsc never deletes stale output
sudo npm ci --ignore-scripts
sudo npm run build
sudo systemctl restart serverbot
```

## Adding a game

1. Add the entry to `servers.json` (key, `label`, `unit`, `address`, `port`, `protocol`, optional `startupMs`/`roleId`).
2. Add its `systemctl start`/`stop` pair to `/etc/sudoers.d/serverbot` (via `sudo visudo -f`).
3. `sudo systemctl restart serverbot`, then check the journal for warnings.
