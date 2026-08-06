# serverbot

Discord bot for starting and stopping game servers via systemd. Friends get four slash commands; the bot gets exactly two sudo rules per game and nothing else.

## Commands

- `/bot` — checks the bot is up and points at the other commands
- `/status server:<name>` — state of one game server
- `/start server:<name>` — starts the unit, then reports when the game socket actually opens
- `/stop server:<name>` — stops the unit and names who did it

The `server` option is required and is a dropdown built from `servers.json`, so no free-text unit names ever reach `systemctl`. Refusals are ephemeral; successful actions are visible to the channel, which doubles as an audit trail.

Access has two tiers: **every** command requires the base role (`DEFAULT_ROLE_ID` from `.env`); a server whose config sets `roleId` requires that role in addition.

## Layout

```
src/
├── main.ts                 entry point — Discord client and command handlers
├── core/
│   └── cfg.ts              types, validated servers.json loader, env access
├── discord/
│   ├── commands.ts         slash-command definitions (dropdown built from servers.json)
│   └── roles.ts            role checks (base role + per-server role)
└── server/
    └── state.ts            unit state, socket check, start/stop via sudo
```

## Configuration

- `.env` (see [.env.example](.env.example)): `DISCORD_TOKEN`, `APP_ID`, `GUILD_ID`, `DEFAULT_ROLE_ID`
- `servers.json` (see [servers.example.json](servers.example.json)): one entry per game with `label`, `unit`, `address`, `port`, `protocol`, optional `startupMs` (max 840000 — Discord interactions expire at 15 minutes) and optional `roleId` (an *additional* role required for that server, on top of the base role)

Both files are per-deployment and gitignored.

**Invariant: every `unit` in `servers.json` needs a matching `systemctl start`/`stop` pair in `/etc/sudoers.d/serverbot`.** Adding a game to the config without extending the sudoers file makes `/start` fail at runtime. The bot cross-checks at startup and logs a warning per missing entry — check `journalctl -u serverbot` after any config change.

## Development

```bash
npm install
npm run build        # or: npm run watch
npm start            # needs a filled-in .env and servers.json
```

Node ≥ 20.6 (native `--env-file`). Relative imports use `.js` extensions on purpose — they must match the compiled output.

## Guides

- [Discord setup](docs/discord-setup.md) — create the application, fill `.env`, invite the bot, lock it down to a channel and role
- [VPS setup](docs/vps-setup.md) — service account, sudoers fence, deploy, systemd unit, updating, adding a game

## Deployment

Full walkthrough in [docs/vps-setup.md](docs/vps-setup.md): system account, sudoers fence, root-owned `/opt/serverbot`, and the hardened systemd unit with `ExecStart=/usr/bin/node /opt/serverbot/dist/main.js`. Three things worth remembering:

- The unit must keep `NoNewPrivileges=false` **and** avoid seccomp-backed hardening options (`ProtectKernelTunables=`, `RestrictSUIDSGID=`, `SystemCallFilter=`, …) — for a non-root service those silently force the no-new-privileges flag on and break sudo.
- When updating, clean the build output before compiling (`rm -rf dist`) — `tsc` never deletes stale files, and a leftover entry point from an older layout can silently keep running.
- After deploying, verify `grep NoNewPrivs /proc/$(systemctl show -p MainPID --value serverbot)/status` prints `0`, then do one real `/start` from Discord.
