# Changelog

All notable changes to KiwiBot, per release. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `/cfg-reload`: re-reads `servers.json` without restarting the bot and replies
  with the servers it loaded. A malformed file is rejected with the validation
  error and the previous config stays in place. Available to anyone with the
  base role; the reply is private. The `server` option's choices and the
  auto-stop watcher keep the startup config until a restart, so a new server
  cannot be picked yet and `autoStopMinutes` changes are ignored.
- `/search`: the name to look for in the game's server browser, from the new
  optional `search` block in `servers.json` (`{ "name": "..." }`, a single
  field for now). Ephemeral like `/address` and `/password`; a server without
  the block says so.

## [1.8.2] - 2026-10-25

### Changed

- TypeScript 5.9.3 → 7.0.2 (dev dependency). TypeScript 6+ no longer loads
  `@types/*` packages automatically, so tsconfig now lists `"types": ["bun"]`.
  No runtime changes.

## [1.8.1] - 2026-10-25

### Changed

- Dev dependencies bumped by Dependabot: `@types/bun` 1.4.0 → 1.4.3,
  `prettier` 3.9.6 → 3.9.10. No runtime changes.

## [1.8.0] - 2026-08-28

### Added

- Optional per-server `stopDelayMinutes` (1–30): the default `delay` for
  `/stop` and `/stop-force` when the option is omitted. An explicit `delay`
  always wins — `delay:0` still stops immediately. When the default applies,
  the confirmation says the delay comes from the server's configuration.
- `/stop-cancel`: cancels a server's scheduled stop. Available to anyone with
  the server's role; the confirmation is public, like the schedule it undoes.
- `/status` shows the server's standing policies under its state line: the
  auto-stop idle time and the default stop delay, each only when configured —
  so a server that vanishes overnight or waits after `/stop` explains itself.

## [1.7.0] - 2026-08-28

### Added

- This changelog, covering every release back to 1.0.0.
- `/bot-version` now includes the running version's changelog entry and a link
  to the full changelog on GitHub.
- `repository` metadata and `private: true` in package.json.

## [1.6.1] - 2026-08-28

### Added

- Optional `delay` option (0–30 minutes) on `/stop` and `/stop-force`: schedules
  the stop, announces a warning in the channel one minute before it fires, and
  re-runs the player checks at the deadline — a delayed `/stop` whose server
  gained players in the meantime cancels itself. One scheduled stop per server.

## [1.6.0] - 2026-08-24

### Changed

- Runtime migrated from Node.js to Bun: no build step, TypeScript sources run
  directly, tests run under `bun test`, and deploys become pull + install +
  restart. CI, docs and the systemd unit updated to match.

## [1.5.4] - 2026-08-21

### Added

- `/list` shows a live player count next to each running server that can
  answer over RCON.

## [1.5.3] - 2026-08-21

### Added

- Startup notice to the alert channel ("KiwiBot vX is online"), which also
  verifies the alert wiring without waiting for the first auto-stop.
- Tests for the RCON packet codec, including TCP chunk-splitting.

### Fixed

- An auto-stop whose unit hung past its shutdown deadline was announced as a
  completed stop; it now warns instead.

## [1.5.2] - 2026-08-18

### Added

- Repository automation: Dependabot (npm + actions), auto-merge for
  non-major Dependabot PRs, release-on-tag workflow, dependency review.
- Release and CI badges in the README.

## [1.5.1] - 2026-08-18

### Added

- CI workflow: format check, typecheck and tests on every PR and push to main.
- Prettier as a dev dependency with `format`/`format:check` scripts.

## [1.5.0] - 2026-08-17

### Added

- Auto-stop: a server with `autoStopMinutes` stops itself once it has been
  confirmed empty that long. Only verified-empty readings count down; an RCON
  outage or blank answer resets the clock.
- Optional `ALERT_CHANNEL_ID` for auto-stop notices.

## [1.4.2] - 2026-08-17

### Changed

- `/start`'s ready message includes the port.
- `sudoAllows` probes the same `systemctl` invocation the real calls use.

### Fixed

- Removed a redundant role check.

## [1.4.1] - 2026-08-09

### Changed

- Renamed the project from serverbot to KiwiBot.

## [1.4.0] - 2026-08-09

### Added

- Source RCON client and per-server `rcon` config block.
- `/players`: relays the game's own who-is-connected answer.
- `/address`: the host:port players connect to.
- `/stop` guard: refuses while players are connected (needs `playersFormat`);
  `/stop-force` (admin-only) overrides it.

## [1.3.0] - 2026-08-07

### Added

- `/bot-version`: reports the running version from package.json.
- Offline test suite (fake interactions, no Discord connection) and the
  `testCommand` local runner, with a committed `servers.test.json` fixture.

### Changed

- Command resolution moved from the entry point into `src/handler/resolve.ts`;
  JSDoc across all functions.

## [1.2.0] - 2026-08-07

### Added

- `/password` and `/admin` commands, with a per-server `adminRoleId` as a
  third access tier.

### Changed

- `/list` lists the game servers and their state (the command list moved
  into `/bot`).
- `address` and `port` are separate config fields — no more duplicated port.

## [1.1.0] - 2026-08-06

### Added

- `/list` command and the single-source-of-truth command registry that drives
  registration, dispatch and `/bot`'s help text.
- Setup guides in `docs/` (Discord application, VPS deployment).

## [1.0.0] - 2026-08-05

### Added

- Initial release: `/bot`, `/status`, `/start`, `/stop` over systemd units,
  two-tier role access, socket-aware server states, sudoers fence, hardened
  systemd unit.

[Unreleased]: https://github.com/mpursa/kiwibot/compare/v1.8.2...HEAD
[1.8.2]: https://github.com/mpursa/kiwibot/releases/tag/v1.8.2
[1.8.1]: https://github.com/mpursa/kiwibot/releases/tag/v1.8.1
[1.8.0]: https://github.com/mpursa/kiwibot/releases/tag/v1.8.0
[1.7.0]: https://github.com/mpursa/kiwibot/releases/tag/v1.7.0
[1.6.1]: https://github.com/mpursa/kiwibot/releases/tag/v1.6.1
[1.6.0]: https://github.com/mpursa/kiwibot/releases/tag/v1.6.0
[1.5.4]: https://github.com/mpursa/kiwibot/releases/tag/v1.5.4
[1.5.3]: https://github.com/mpursa/kiwibot/releases/tag/v1.5.3
[1.5.2]: https://github.com/mpursa/kiwibot/releases/tag/v1.5.2
[1.5.1]: https://github.com/mpursa/kiwibot/releases/tag/v1.5.1
[1.5.0]: https://github.com/mpursa/kiwibot/releases/tag/v1.5.0
[1.4.2]: https://github.com/mpursa/kiwibot/releases/tag/v1.4.2
[1.4.1]: https://github.com/mpursa/kiwibot/releases/tag/v1.4.1
[1.4.0]: https://github.com/mpursa/kiwibot/releases/tag/v1.4.0
[1.3.0]: https://github.com/mpursa/kiwibot/releases/tag/v1.3.0
[1.2.0]: https://github.com/mpursa/kiwibot/releases/tag/v1.2.0
[1.1.0]: https://github.com/mpursa/kiwibot/releases/tag/v1.1.0
[1.0.0]: https://github.com/mpursa/kiwibot/releases/tag/v1.0.0
