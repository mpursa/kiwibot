# Changelog

All notable changes to KiwiBot, per release. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

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

- `/bot_version`: reports the running version from package.json.
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

[1.6.1]: https://github.com/mpursa/kiwibot/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/mpursa/kiwibot/compare/v1.5.4...v1.6.0
[1.5.4]: https://github.com/mpursa/kiwibot/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/mpursa/kiwibot/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/mpursa/kiwibot/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/mpursa/kiwibot/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/mpursa/kiwibot/compare/v1.4.2...v1.5.0
[1.4.2]: https://github.com/mpursa/kiwibot/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/mpursa/kiwibot/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/mpursa/kiwibot/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/mpursa/kiwibot/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/mpursa/kiwibot/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/mpursa/kiwibot/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mpursa/kiwibot/releases/tag/v1.0.0
