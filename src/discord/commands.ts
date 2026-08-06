import {
	ChatInputCommandInteraction,
	SlashCommandBuilder,
	SlashCommandStringOption
} from 'discord.js';

import { SERVERS } from '../core/cfg.js';

export enum CommandType {
	UNKNOWN,
	BASE,
	SERVER
}

export enum Command {
	UNKNOWN = 'unknown',
	BASE = 'bot',
	LIST = 'list',
	SERVER_START = 'start',
	SERVER_STATUS = 'status',
	SERVER_STOP = 'stop'
}

type FullCommand = {
	readonly name: Command;
	readonly description: string;
	readonly type: CommandType;
	readonly selectOptions?: (o: SlashCommandStringOption) => SlashCommandStringOption;
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

const serverSelect = (o: SlashCommandStringOption) =>
	o
		.setName('server')
		.setDescription('Which server?')
		.setRequired(true)
		.addChoices(...SERVER_CHOICES);

export const COMMANDS: FullCommand[] = [
	{
		name: Command.BASE,
		description: 'Check that serverbot is up, tell user man commands',
		type: CommandType.BASE
	},
	{
		name: Command.LIST,
		description: 'List all available commands, with description',
		type: CommandType.BASE
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
		description: 'Stop specific server',
		type: CommandType.SERVER,
		selectOptions: serverSelect
	}
];

export const discordCommands = COMMANDS.map((cmd) => {
	const builder = new SlashCommandBuilder().setName(cmd.name).setDescription(cmd.description);
	if (cmd.selectOptions) builder.addStringOption(cmd.selectOptions);
	return builder.toJSON();
});

export function getCommandFromName(interaction: ChatInputCommandInteraction): FullCommand {
	return COMMANDS.find((command) => command.name === interaction.commandName) ?? UNKNOWN_COMMAND;
}
