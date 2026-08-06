import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  type ChatInputCommandInteraction,
} from "discord.js";
import { commands } from "./commands.js";
import { SERVERS, requireEnv, type ServerConfig } from "./config.js";
import {
  describe,
  getState,
  startUnit,
  stopUnit,
  sudoAllows,
  waitFor,
} from "./state.js";

const TOKEN = requireEnv("DISCORD_TOKEN");
const APP_ID = requireEnv("APP_ID");
const GUILD_ID = requireEnv("GUILD_ID");
const DEFAULT_ROLE_ID = requireEnv("DEFAULT_ROLE_ID");

function permitted(
  interaction: ChatInputCommandInteraction,
  srv: ServerConfig,
): boolean {
  const roleId = srv.roleId ?? DEFAULT_ROLE_ID;
  const roles = interaction.member?.roles;
  return roles !== undefined && "cache" in roles && roles.cache.has(roleId);
}

async function handleStatusAll(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const visible = [...SERVERS.values()].filter((srv) =>
    permitted(interaction, srv),
  );
  if (visible.length === 0) {
    await interaction.reply({
      content: "No servers available to you.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply();
  const lines = await Promise.all(
    visible.map(async (srv) => describe(srv, await getState(srv))),
  );
  await interaction.editReply(lines.join("\n"));
}

// ENTRY POINT
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", async (c) => {
  // Fail loudly (in the journal) if servers.json and the sudoers file disagree.
  for (const srv of SERVERS.values()) {
    for (const verb of ["start", "stop"] as const) {
      if (!(await sudoAllows(verb, srv.unit))) {
        console.warn(
          `WARNING: sudoers does not allow 'systemctl ${verb} ${srv.unit}' — /${verb} will fail for ${srv.label}`,
        );
      }
    }
  }
  await new REST()
    .setToken(TOKEN)
    .put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: commands });
  console.log(
    `serverbot ready as ${c.user.tag} — ${SERVERS.size} server(s): ${[...SERVERS.keys()].join(", ")}`,
  );
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const key = interaction.options.getString("server");

  try {
    if (interaction.commandName === "status" && key === null) {
      await handleStatusAll(interaction);
      return;
    }

    // Resolve from config. noUncheckedIndexedAccess makes this check mandatory.
    const srv = key === null ? undefined : SERVERS.get(key);
    if (srv === undefined) {
      await interaction.reply({
        content: "Unknown server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!permitted(interaction, srv)) {
      await interaction.reply({
        content: `You don't have access to ${srv.label}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Defer before touching systemctl/ss: Discord gives us 3 seconds to ack,
    // and subprocess spawns on a loaded VPS can blow that window.
    await interaction.deferReply();

    switch (interaction.commandName) {
      case "status": {
        await interaction.editReply(describe(srv, await getState(srv)));
        return;
      }
      case "start": {
        const state = await getState(srv);
        if (state !== "stopped" && state !== "failed") {
          await interaction.editReply(describe(srv, state));
          return;
        }
        await startUnit(srv.unit);
        await interaction.editReply(`🟡 Starting **${srv.label}**…`);
        const up = await waitFor(srv, "running");
        await interaction.editReply(
          up
            ? `🟢 **${srv.label}** ready · \`${srv.address}\``
            : `🟡 **${srv.label}** is taking longer than usual — try \`/status\`.`,
        );
        return;
      }
      case "stop": {
        if ((await getState(srv)) === "stopped") {
          await interaction.editReply(describe(srv, "stopped"));
          return;
        }
        await stopUnit(srv.unit);
        const down = await waitFor(srv, "stopped");
        await interaction.editReply(
          down
            ? `🔴 **${srv.label}** stopped by ${interaction.user.username}`
            : `🟡 **${srv.label}** is still shutting down — check \`/status\`.`,
        );
        return;
      }
    }
  } catch (err) {
    console.error(err);
    const msg = `Command failed: \`${String((err as Error).message).slice(0, 200)}\``;
    // The report itself can fail (e.g. the interaction token expired). Swallow
    // that: an unhandled rejection here would take down the whole process.
    try {
      if (interaction.deferred) await interaction.editReply(msg);
      else if (!interaction.replied) await interaction.reply(msg);
    } catch (replyErr) {
      console.error("Could not report failure to Discord:", replyErr);
    }
  }
});

await client.login(TOKEN);
