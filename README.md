# serverbot

Discord bot for starting and stopping game servers via systemd. The bot gets exactly two sudo rules per game and nothing else.

## Commands

- `/bot` — checks the bot is up and lists the available commands
- `/bot_version` — the running serverbot version (ephemeral)
- `/list` — state of every game server you have access to
- `/status server:<name>` — state of one game server
- `/start server:<name>` — starts the unit, then reports when the game socket actually opens
- `/stop server:<name>` — stops the unit and names who did it
- `/password server:<name>` — the server's join password, if one is configured (ephemeral)
- `/admin server:<name>` — the server's admin info, if admin mode is configured (ephemeral)

The `server` option is required and is a dropdown built from `servers.json`, so no free-text unit names ever reach `systemctl`. Refusals are ephemeral; successful actions are visible to the channel, which doubles as an audit trail.

Access has three tiers: **every** command requires the base role (`DEFAULT_ROLE_ID` from `.env`); a server whose config sets `roleId` requires that role in addition; `/admin` further requires the server's `adminRoleId`.

## Layout

```
src/
├── main.ts                 entry point — Discord client, base role gate, command dispatch
├── core/
│   └── cfg.ts              types, validated servers.json loader, env access
├── discord/
│   ├── commands.ts         slash-command definitions and command-name enums
│   └── roles.ts            role checks (base, per-server, admin)
├── handler/
│   └── resolve.ts          command handlers — base, server and admin command flows
└── server/
    └── state.ts            unit state, socket check, start/stop via sudo
```

## Configuration

- `.env` (see [.env.example](.env.example)): `DISCORD_TOKEN`, `APP_ID`, `GUILD_ID`, `DEFAULT_ROLE_ID`
- `servers.json` (see [servers.example.json](servers.example.json)): one entry per game with `label`, `unit`, `address`, `port`, `protocol`, plus optional `startupMs` (max 840000 — Discord interactions expire at 15 minutes), `roleId` (an *additional* role required for that server, on top of the base role), `password` (shown by `/password`), and `adminInfo` + `adminRoleId` (shown by `/admin`, gated by that role)

Both files are per-deployment and gitignored.

**Invariant: every `unit` in `servers.json` needs a matching `systemctl start`/`stop` pair in `/etc/sudoers.d/serverbot`.** Adding a game to the config without extending the sudoers file makes `/start` fail at runtime. The bot cross-checks at startup and logs a warning per missing entry — check `journalctl -u serverbot` after any config change.

## Development

```bash
npm install
npm run build        # or: npm run watch
npm start            # needs a filled-in .env and servers.json
npm test             # offline unit tests — no Discord connection needed
npm run testCommand -- status palworld   # run one bot command locally, print the reply
```

Node ≥ 20.6 (native `--env-file`). Relative imports use `.js` extensions on purpose — they must match the compiled output.

Tests live in [tests/](tests/), compiled by their own [tests/tsconfig.json](tests/tsconfig.json) into `dist-tests/` and run by Node's built-in runner. They import the built `dist/` (which is why the main tsconfig emits declarations) and talk to the handlers through fake interaction objects ([tests/fakes.ts](tests/fakes.ts)), so no bot token or gateway connection is involved; `.env.test` supplies a dummy `DEFAULT_ROLE_ID`. A `servers.json` must exist at the repo root (any valid one), since `cfg.ts` loads it at import. When renaming or deleting test files, `rm -rf dist-tests` first — `tsc` never removes stale output, and orphaned `*.test.js` files would keep running.

## Guides

- [Discord setup](docs/discord-setup.md) — create the application, fill `.env`, invite the bot, lock it down to a channel and role
- [VPS setup](docs/vps-setup.md) — service account, sudoers fence, deploy, systemd unit, updating, adding a game

## Deployment

Full walkthrough in [docs/vps-setup.md](docs/vps-setup.md): system account, sudoers fence, root-owned `/opt/serverbot`, and the hardened systemd unit with `ExecStart=/usr/bin/node /opt/serverbot/dist/main.js`. Three things worth remembering:

- The unit must keep `NoNewPrivileges=false` **and** avoid seccomp-backed hardening options (`ProtectKernelTunables=`, `RestrictSUIDSGID=`, `SystemCallFilter=`, …) — for a non-root service those silently force the no-new-privileges flag on and break sudo.
- When updating, clean the build output before compiling (`rm -rf dist`) — `tsc` never deletes stale files, and a leftover entry point from an older layout can silently keep running.
- After deploying, verify `grep NoNewPrivs /proc/$(systemctl show -p MainPID --value serverbot)/status` prints `0`, then do one real `/start` from Discord.
