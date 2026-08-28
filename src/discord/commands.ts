import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
	type SlashCommandIntegerOption,
	type SlashCommandStringOption
} from 'discord.js';

import { MAX_STOP_DELAY_MINUTES, SERVERS } from '../core/cfg.ts';

export enum CommandType {
	UNKNOWN,
	BASE,
	SERVER,
	ADMIN
}

export enum Command {
	UNKNOWN = 'unknown',
	BASE = 'bot',
	BOT_VERSION = 'bot_version',
	LIST = 'list',
	SERVER_ADDRESS = 'address',
	SERVER_ADMIN = 'admin',
	SERVER_PLAYERS = 'players',
	SERVER_PW = 'password',
	SERVER_START = 'start',
	SERVER_STATUS = 'status',
	SERVER_STOP = 'stop',
	SERVER_STOP_CANCEL = 'stop-cancel',
	SERVER_STOP_FORCE = 'stop-force'
}

type FullCommand = {
	readonly name: Command;
	readonly description: string;
	readonly type: CommandType;
	readonly selectOptions?: (o: SlashCommandStringOption) => SlashCommandStringOption;
	readonly integerOptions?: (o: SlashCommandIntegerOption) => SlashCommandIntegerOption;
};

const UNKNOWN_COMMAND: FullCommand = {
	name: Command.UNKNOWN,
	description: '',
	type: CommandType.UNKNOWN
};

const SERVER_CHOICES = [...SERVERS].map(([value, srv]) => ({
	name: srv.label,
	value
}));

/**
 * The required 'server' option shared by every server-type command. Choices
 * come from the config, so free text never reaches the handlers.
 *
 * @param {SlashCommandStringOption} o - Option builder passed by discord.js.
 * @returns {SlashCommandStringOption} The configured option.
 */
const serverSelect = (o: SlashCommandStringOption) =>
	o
		.setName('server')
		.setDescription('Which server?')
		.setRequired(true)
		.addChoices(...SERVER_CHOICES);

// Lives in core so config validation can share it; re-exported for convenience.
export { MAX_STOP_DELAY_MINUTES } from '../core/cfg.ts';

/**
 * The optional 'delay' option shared by the stop commands.
 *
 * @param {SlashCommandIntegerOption} o - Option builder passed by discord.js.
 * @returns {SlashCommandIntegerOption} The configured option.
 */
const delaySelect = (o: SlashCommandIntegerOption) =>
	o
		.setName('delay')
		.setDescription('Minutes to wait before stopping. 0-30 minutes.')
		.setRequired(false)
		.setMinValue(0)
		.setMaxValue(MAX_STOP_DELAY_MINUTES);

/**
 * Actual bot command list.
 */
export const COMMANDS: FullCommand[] = [
	{
		name: Command.BASE,
		description: 'Check kiwibot is up and list available commands',
		type: CommandType.BASE
	},
	{
		name: Command.BOT_VERSION,
		description: 'Show the current kiwibot version',
		type: CommandType.BASE
	},
	{
		name: Command.LIST,
		description: 'List all game servers and their current status',
		type: CommandType.BASE
	},
	{
		name: Command.SERVER_ADMIN,
		description: 'Show specific server admin mode info',
		type: CommandType.ADMIN,
		selectOptions: serverSelect
	},
	{
		name: Command.SERVER_ADDRESS,
		description: 'Show specific server connection address',
		type: CommandType.SERVER,
		selectOptions: serverSelect
	},
	{
		name: Command.SERVER_PLAYERS,
		description: 'Show who is connected to a specific server',
		type: CommandType.SERVER,
		selectOptions: serverSelect
	},
	{
		name: Command.SERVER_PW,
		description: 'Show specific server connection password',
		type: CommandType.SERVER,
		selectOptions: serverSelect
	},
	{
		name: Command.SERVER_STATUS,
		description: 'Check specific server status',
		type: CommandType.SERVER,
		selectOptions: serverSelect
	},
	{
		name: Command.SERVER_START,
		description: 'Start specific server',
		type: CommandType.SERVER,
		selectOptions: serverSelect
	},
	{
		name: Command.SERVER_STOP,
		description: 'Stop specific server, unless players are connected',
		type: CommandType.SERVER,
		selectOptions: serverSelect,
		integerOptions: delaySelect
	},
	{
		name: Command.SERVER_STOP_CANCEL,
		description: 'Cancel a scheduled stop for a specific server',
		type: CommandType.SERVER,
		selectOptions: serverSelect
	},
	{
		name: Command.SERVER_STOP_FORCE,
		description: 'Stop specific server even with players connected',
		type: CommandType.ADMIN,
		selectOptions: serverSelect,
		integerOptions: delaySelect
	}
];

export const discordCommands = COMMANDS.map((cmd) => {
	const builder = new SlashCommandBuilder().setName(cmd.name).setDescription(cmd.description);
	if (cmd.selectOptions) builder.addStringOption(cmd.selectOptions);
	if (cmd.integerOptions) builder.addIntegerOption(cmd.integerOptions);
	return builder.toJSON();
});

/**
 * Looks the invoked command up in the registry.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {FullCommand} The matching entry, or the unknown sentinel.
 */
export function getCommandFromName(interaction: ChatInputCommandInteraction): FullCommand {
	return COMMANDS.find((command) => command.name === interaction.commandName) ?? UNKNOWN_COMMAND;
}
