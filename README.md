# serverbot

Discord bot for starting and stopping game servers via systemd. Friends get three slash commands; the bot gets exactly two sudo rules per game and nothing else.

## Commands

- `/status` — state of every server you have access to (or one, with the `server` option)
- `/start server:<name>` — starts the unit, then reports when the game socket actually opens
- `/stop server:<name>` — stops the unit and names who did it

The `server` option is a dropdown built from `servers.json`, so no free-text unit names ever reach `systemctl`. Refusals are ephemeral; successful actions are visible to the channel, which doubles as an audit trail.

## Configuration

- `.env` (see [.env.example](.env.example)): `DISCORD_TOKEN`, `APP_ID`, `GUILD_ID`, `DEFAULT_ROLE_ID`
- `servers.json` (see [servers.example.json](servers.example.json)): one entry per game with `label`, `unit`, `address`, `port`, `protocol`, optional `startupMs` (max 840000 — Discord interactions expire at 15 minutes) and optional `roleId` (falls back to `DEFAULT_ROLE_ID`)

Both files are per-deployment and gitignored.

**Invariant: every `unit` in `servers.json` needs a matching `systemctl start`/`stop` pair in `/etc/sudoers.d/serverbot`.** Adding a game to the config without extending the sudoers file makes `/start` fail at runtime. The bot cross-checks at startup and logs a warning per missing entry — check `journalctl -u serverbot` after any config change.

## Development

```bash
npm install
npm run build        # or: npm run watch
npm start            # needs a filled-in .env and servers.json
```

Node ≥ 20.6 (native `--env-file`). Relative imports use `.js` extensions on purpose — they must match the compiled output.

## Deployment

System account, sudoers fence, root-owned `/opt/serverbot`, and the hardened systemd unit. Two things worth remembering:

- The unit must keep `NoNewPrivileges=false` **and** avoid seccomp-backed hardening options (`ProtectKernelTunables=`, `RestrictSUIDSGID=`, `SystemCallFilter=`, …) — for a non-root service those silently force the no-new-privileges flag on and break sudo.
- After deploying, verify `grep NoNewPrivs /proc/$(systemctl show -p MainPID --value serverbot)/status` prints `0`, then do one real `/start` from Discord.
