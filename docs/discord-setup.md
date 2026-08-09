# Adding kiwibot to a Discord server

Quick guide from zero to working slash commands. You need **Manage Server** permission on the target Discord server.

## 1. Create the application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → name it (e.g. `kiwibot`).
2. On **General Information**, copy the **Application ID** — this is `APP_ID` for your `.env`.
3. Go to the **Bot** tab → **Reset Token** → copy the token — this is `DISCORD_TOKEN`. It's the only real secret; if it ever leaks, reset it here and update `.env`.
4. Still on the Bot tab:
   - Turn **Public Bot off**, so only you can invite it.
   - Leave all three **Privileged Gateway Intents** (Presence, Server Members, Message Content) **off** — the bot doesn't use them.
5. Make sure **Interactions Endpoint URL** on General Information stays **empty**. Filling it switches command delivery from the gateway to HTTP and the bot goes silent. The **Public Key** shown there is for that HTTP mode only — this bot never uses it.

## 2. Collect the server-side IDs

Enable Discord's Developer Mode first: **User Settings → Advanced → Developer Mode**.

- Right-click your server icon → **Copy Server ID** → `GUILD_ID`.
- Create (or pick) the role that gates the bot, e.g. `@gameservers`. Server Settings → Roles → right-click the role → **Copy Role ID** → `DEFAULT_ROLE_ID`. Every command requires this role; a `roleId` in `servers.json` is an _additional_ requirement on top of it, and an `adminRoleId` further gates that server's `/admin` command.
- Assign the role to the people who may control the servers.

## 3. Invite the bot

Open this URL with your `APP_ID` substituted:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands&permissions=3072
```

- `bot` adds the bot user; `applications.commands` lets it register slash commands. Missing the second is the classic "bot is in the server but `/` shows nothing" mistake — if that happens, just open the URL again and re-authorize.
- `permissions=3072` is **View Channels + Send Messages**, which is all it needs. Do not grant Administrator or any Manage permission — replies travel through the interaction system, not ordinary message sending.

The bot appears in the member list **offline**. That's expected — it comes online when the process on the VPS starts. On startup it registers its commands (`/bot`, `/bot_version`, `/list`, `/address`, `/password`, `/admin`, `/players`, `/status`, `/start`, `/stop`, `/stop-force`); guild-scoped commands appear within seconds.

## 4. Lock it down (recommended)

**Server Settings → Integrations → kiwibot → Manage**:

- **Channels**: turn off _All Channels_, add the one channel the bot should work in. Everywhere else, the commands disappear from the `/` picker.
- **Roles/Members**: restrict who is offered the commands. People without the role would be refused on execution anyway (ephemerally), but hiding the commands is tidier.

The permission profile shown on the bot's role may list extra "granted" entries (Create Invite, Attach Files, …) — those come from the `@everyone` role's server defaults, not from the bot's own role. Harmless; a channel permission override on the kiwibot role can deny any of them (e.g. _Mention @everyone_) if you want.

## Troubleshooting

- **No commands in the picker**: check both OAuth scopes were granted, the bot can view the channel, and the startup log (`journalctl -u kiwibot`) shows the "kiwibot ready" registration line.
- **"The application did not respond"**: the process isn't running or can't reach Discord — check `systemctl status kiwibot` on the VPS.
- **"You don't have access to kiwibot."**: the invoker lacks the `DEFAULT_ROLE_ID` role.
