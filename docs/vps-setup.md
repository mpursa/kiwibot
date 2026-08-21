# Setting up kiwibot on a VPS

Quick guide for a Debian/Ubuntu-style VPS with systemd. Prerequisites: Node.js ≥ 20.6, git, `ss` (package `iproute2`, present on virtually every distro), and the game servers already running as systemd units (e.g. `palworld.service`).

## 1. Service account and sudo fence

Create a system account and grant it exactly the commands it needs:

```bash
sudo useradd -r -s /usr/sbin/nologin -d /opt/kiwibot kiwibot
sudo visudo -f /etc/sudoers.d/kiwibot
```

```
Cmnd_Alias GAMECTL = /usr/bin/systemctl start palworld, \
                     /usr/bin/systemctl stop palworld

kiwibot ALL=(root) NOPASSWD: GAMECTL
```

```bash
sudo chmod 440 /etc/sudoers.d/kiwibot
sudo visudo -c
```

**Invariant: every `unit` in `servers.json` needs its `start` and `stop` pair in `GAMECTL`.** The bot warns in the journal at startup when an entry is missing.

Verify the fence — the first two must **fail**, the third succeeds (and actually starts the game, so stop it after if unwanted):

```bash
sudo -u kiwibot sudo -n systemctl start nginx
sudo -u kiwibot sudo -n systemctl restart palworld
sudo -u kiwibot sudo -n systemctl start palworld
```

## 2. Deploy the code

Clone and build root-owned — the bot only ever reads its own code, so a compromised bot can't rewrite itself:

```bash
sudo git clone https://github.com/YOU/kiwibot.git /opt/kiwibot
cd /opt/kiwibot
sudo npm ci --ignore-scripts
sudo npm run build
sudo cp servers.example.json servers.json
sudo nano servers.json
```

Then the environment file — the only thing `kiwibot` owns (values come from the [Discord setup guide](discord-setup.md)):

```bash
sudo cp .env.example .env
sudo nano .env
sudo chown kiwibot:kiwibot /opt/kiwibot/.env
sudo chmod 600 /opt/kiwibot/.env
```

## 3. The systemd unit

```bash
sudo nano /etc/systemd/system/kiwibot.service
```

```ini
[Unit]
Description=kiwibot — Discord game server control
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=kiwibot
Group=kiwibot
WorkingDirectory=/opt/kiwibot
EnvironmentFile=/opt/kiwibot/.env
ExecStart=/usr/bin/node /opt/kiwibot/dist/main.js
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
sudo systemctl enable --now kiwibot
sudo journalctl -u kiwibot -f
```

## 4. Verify

- The journal shows `kiwibot ready as … — 1 server(s): palworld` and no sudoers warnings.
- The sandbox didn't re-enable the flag behind your back:

  ```bash
  grep NoNewPrivs /proc/$(systemctl show -p MainPID --value kiwibot)/status
  ```

  must print `NoNewPrivs: 0`.

- One real `/start` from Discord — that exercises the full path (sandbox → sudo → systemctl), which no shell test can.

## Updating

```bash
cd /opt/kiwibot
sudo git pull
sudo rm -rf dist            # tsc never deletes stale output
sudo npm ci --ignore-scripts
sudo npm run build
sudo systemctl restart kiwibot
```

## Enabling /players (optional)

`/players` asks the game itself who is connected, over Source RCON. Per game:

1. Turn RCON on in the game's own config (varies based on game, look it up).
2. **Bind it to loopback or firewall the port.** RCON sends its password in the clear, and kiwibot connects from the same host, so nothing outside the machine needs to reach it.
3. Add the matching block to that server's `servers.json` entry:

   ```json
   "rcon": {
   	"port": 25575,
   	"password": "the-rcon-password",
   	"playersCommand": "ShowPlayers",
   	"playersFormat": "csv"
   }
   ```

   `playersCommand` is the game's own query. `playersFormat` describes the shape of its answer — `csv` (header row then one row per player, as Palworld answers), `sentence` (names after the last colon, as Minecraft answers) or `lines` — and is what lets `/stop` count connected players. Leave it out if the answer fits none of those: `/players` still works, and `/stop` simply skips the check.

4. `sudo systemctl restart kiwibot`, then try `/players` from Discord. A server with no `rcon` block simply answers that RCON isn't set; an unreachable port reports the connection error rather than failing the command.

## The /stop guard

With `playersFormat` configured, `/stop` asks the game who is connected and refuses while anyone is playing, pointing at `/stop-force`. `/stop-force` is an **admin** command: it needs the server's `adminRoleId`, so only holders of that role can end a session out from under players. Both use the same `systemctl stop`, so the sudoers file needs no new entry.

When the answer is unknown — no `playersFormat`, or RCON not responding because the game is already broken — `/stop` goes ahead. The guard protects against thoughtlessness, not against a server that cannot answer for itself.

## Enabling auto-stop (optional)

A server can stop itself once nobody has been connected for a while, which is worth having on a VPS you pay for by the hour.

1. Give the server an `rcon` block **with `playersFormat`** (previous section) — the bot refuses `autoStopMinutes` without it, since it could not otherwise tell when the server is empty.
2. **Verify the format first.** Run `/players` with the server empty and again with someone connected, and check the answer looks the way `playersFormat` expects. A mis-declared format can make a server look permanently empty, and auto-stop would then end a live session.
3. Add the idle time to that server's `servers.json` entry:

   ```json
   "autoStopMinutes": 30
   ```

   Ten minutes is a sensible floor: shorter values can fire between two players swapping sessions.

4. Optionally set `ALERT_CHANNEL_ID` in `.env` to the channel that should receive the notice (Developer Mode on → right-click the channel → Copy Channel ID). Leave it unset and auto-stops are recorded in the journal only. The bot needs permission to post in that channel — a channel permission override can block it even though it can post elsewhere. The bot posts a "KiwiBot vX is online" message there on every startup, so restarting is also how you verify the channel works — no need to wait for the first real auto-stop.
5. `sudo systemctl restart kiwibot`. The journal prints which servers are watched and their idle times at startup, then a line for each auto-stop.

Notes on behaviour: the countdown only advances on a _confirmed_ empty reading, so an RCON outage or a blank answer resets it — the bot stops late rather than stopping a server it could not verify. Countdowns are in memory, so restarting the bot starts them over. No sudoers change is needed: auto-stop uses the same `systemctl stop` as `/stop`.

## Adding a game

1. Add the entry to `servers.json` (key, `label`, `unit`, `address`, `port`, `protocol`, optional `startupMs`/`roleId`/`rcon`).
2. Add its `systemctl start`/`stop` pair to `/etc/sudoers.d/kiwibot` (via `sudo visudo -f`).
3. `sudo systemctl restart kiwibot`, then check the journal for warnings.
