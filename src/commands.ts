import { SlashCommandBuilder } from "discord.js";
import { SERVERS } from "./config.js";

const choices = [...SERVERS].map(([value, srv]) => ({
  name: srv.label,
  value,
}));

export const commands = [
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Game server status")
    .addStringOption((o) =>
      o
        .setName("server")
        .setDescription("Which server (all if omitted)")
        .addChoices(...choices),
    ),
  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Start a game server")
    .addStringOption((o) =>
      o
        .setName("server")
        .setDescription("Which server")
        .setRequired(true)
        .addChoices(...choices),
    ),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop a game server")
    .addStringOption((o) =>
      o
        .setName("server")
        .setDescription("Which server")
        .setRequired(true)
        .addChoices(...choices),
    ),
].map((c) => c.toJSON());
