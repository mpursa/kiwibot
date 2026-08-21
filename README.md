# KiwiBot

[![Release](https://img.shields.io/github/v/release/mpursa/kiwibot)](https://github.com/mpursa/kiwibot/releases/latest)
[![CI](https://github.com/mpursa/kiwibot/actions/workflows/ci.yml/badge.svg)](https://github.com/mpursa/kiwibot/actions/workflows/ci.yml)

Discord bot for starting and stopping game servers via systemd. The bot gets exactly two sudo rules per game and nothing else.

## Commands

- `/bot` — checks the bot is up and lists the available commands
- `/bot_version` — the running kiwibot version (ephemeral)
- `/list` — state of every game server you have access to, with player counts where RCON can answer
- `/status server:<name>` — state of one game server
- `/start server:<name>` — starts the unit, then reports when the game socket actually opens
- `/stop server:<name>` — stops the unit and names who did it, unless players are connected
- `/stop-force server:<name>` — stops the unit even with players connected (admin only)
- `/address server:<name>` — the address to connect to, as host:port (ephemeral)
- `/password server:<name>` — the server's join password, if one is configured (ephemeral)
- `/admin server:<name>` — the server's admin info, if admin mode is configured (ephemeral)
- `/players server:<name>` — who is connected, if RCON is configured

The `server` option is required and is a dropdown built from `servers.json`, so no free-text unit names ever reach `systemctl`. Refusals are ephemeral; successful actions are visible to the channel, which doubles as an audit trail.

Access has three tiers: **every** command requires the base role (`DEFAULT_ROLE_ID` from `.env`); a server whose config sets `roleId` requires that role in addition; `/admin` and `/stop-force` further require the server's `adminRoleId`.

`/stop` asks the game who is connected before stopping, and refuses while anyone is playing. That check needs `rcon.playersFormat` to be set — without it (or when RCON does not answer) the answer is unknown and `/stop` proceeds as it always did, so the guard never blocks stopping a broken server.

## Layout

```
src/
├── main.ts                 entry point — Discord client, command registration, error reporting
├── core/
│   └── cfg.ts              types, validated servers.json loader, env access
├── discord/
│   ├── alerts.ts           posts notices to ALERT_CHANNEL_ID
│   ├── commands.ts         slash-command definitions and command-name enums
│   └── roles.ts            role checks (base, per-server, admin)
├── handler/
│   └── resolve.ts          base role gate, command dispatch, and all command handlers
└── server/
    ├── autostop.ts         idle tracker and the poller that stops empty servers
    ├── players.ts          who is connected, from the game's own answer
    ├── rcon.ts             Source RCON client
    └── state.ts            unit state, socket check, start/stop via sudo
```

## Configuration

- `.env` (see [.env.example](.env.example)): `DISCORD_TOKEN`, `APP_ID`, `GUILD_ID`, `DEFAULT_ROLE_ID`, plus optional `ALERT_CHANNEL_ID` for alert notices
- `servers.json` (see [servers.example.json](servers.example.json)): one entry per game with `label`, `unit`, `address`, `port`, `protocol`, plus optional `startupMs` (max 840000 — Discord interactions expire at 15 minutes), `roleId` (an *additional* role required for that server, on top of the base role), `password` (shown by `/password`), `adminInfo` + `adminRoleId` (shown by `/admin`, gated by that role), and `rcon` (enables `/players`)

The `rcon` block is `{ port, password, playersCommand }` plus optional `host` (default `127.0.0.1`) and `playersFormat`. `playersCommand` is the only game-specific part — `list` for Minecraft, `ShowPlayers` for Palworld — and `/players` relays the game's raw answer unparsed, which is what keeps it game-agnostic. `playersFormat` names the generic *shape* of that answer so `/stop` can count players: `csv` (header row then one row per player, e.g. Palworld), `sentence` (names after the last colon, e.g. Minecraft) or `lines` (one per line). Omit it and the stop guard simply stays off.

`autoStopMinutes` stops a server by itself once it has been empty that long, announcing it in `ALERT_CHANNEL_ID` when that is set. It requires `rcon.playersFormat` — without a readable players answer the bot cannot tell when the server is empty, so the config is refused at startup rather than silently doing nothing. Only a *confirmed* empty reading counts down: RCON failing, or answering with nothing, resets the clock, so a server is never stopped on an unverified guess. Countdowns live in memory and restart with the bot. Enable RCON in the game's own config (`enable-rcon`/`rcon.port` for Minecraft, `RCONEnabled`/`RCONPort` for Palworld) and keep the port on loopback or firewalled: the password crosses that socket in the clear.

Both files are per-deployment and gitignored.

**Invariant: every `unit` in `servers.json` needs a matching `systemctl start`/`stop` pair in `/etc/sudoers.d/kiwibot`.** Adding a game to the config without extending the sudoers file makes `/start` fail at runtime. The bot cross-checks at startup and logs a warning per missing entry — check `journalctl -u kiwibot` after any config change.

## Development

```bash
npm install
npm run build        # or: npm run watch
npm start            # needs a filled-in .env and servers.json
npm test             # offline unit tests — no Discord connection needed
npm run testCommand -- status palworld   # run one bot command locally, print the reply
```

Node ≥ 20.6 (native `--env-file`). Relative imports use `.js` extensions on purpose — they must match the compiled output.

Tests live in [tests/](tests/), compiled by their own [tests/tsconfig.json](tests/tsconfig.json) into `dist-tests/` and run by Node's built-in runner. They import the built `dist/` (which is why the main tsconfig emits declarations) and talk to the handlers through fake interaction objects ([tests/fakes.ts](tests/fakes.ts)), so no bot token or gateway connection is involved. `.env.test` supplies a dummy `DEFAULT_ROLE_ID` and sets `SERVERS_PATH=servers.test.json`, so tests and `testCommand` read the committed [servers.test.json](servers.test.json) fixture instead of your real `servers.json` (production leaves `SERVERS_PATH` unset). When renaming or deleting test files, `rm -rf dist-tests` first — `tsc` never removes stale output, and orphaned `*.test.js` files would keep running.

## Guides

- [Discord setup](docs/discord-setup.md) — create the application, fill `.env`, invite the bot, lock it down to a channel and role
- [VPS setup](docs/vps-setup.md) — service account, sudoers fence, deploy, systemd unit, updating, adding a game

## Deployment

Full walkthrough in [docs/vps-setup.md](docs/vps-setup.md): system account, sudoers fence, root-owned `/opt/kiwibot`, and the hardened systemd unit with `ExecStart=/usr/bin/node /opt/kiwibot/dist/main.js`. Three things worth remembering:

- The unit must keep `NoNewPrivileges=false` **and** avoid seccomp-backed hardening options (`ProtectKernelTunables=`, `RestrictSUIDSGID=`, `SystemCallFilter=`, …) — for a non-root service those silently force the no-new-privileges flag on and break sudo.
- When updating, clean the build output before compiling (`rm -rf dist`) — `tsc` never deletes stale files, and a leftover entry point from an older layout can silently keep running.
- After deploying, verify `grep NoNewPrivs /proc/$(systemctl show -p MainPID --value kiwibot)/status` prints `0`, then do one real `/start` from Discord.
