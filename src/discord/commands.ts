import { SlashCommandBuilder } from 'discord.js';

import { SERVERS } from '../core/cfg.js';

export enum CommandBase {
	BASE = 'bot'
}

export enum CommandServer {
	START = 'start',
	STATUS = 'status',
	STOP = 'stop'
}

const SERVER_CHOICES = [...SERVERS].map(([value, srv]) => ({
	name: srv.label,
	value
}));

export const commands = [
	new SlashCommandBuilder()
		.setName('bot')
		.setDescription('Check that serverbot is up, tell user man commands'),
	new SlashCommandBuilder()
		.setName('status')
		.setDescription('Game server status')
		.addStringOption((o) =>
			o
				.setName('server')
				.setDescription('Which server?')
				.setRequired(true)
				.addChoices(...SERVER_CHOICES)
		),
	new SlashCommandBuilder()
		.setName('start')
		.setDescription('Start a game server')
		.addStringOption((o) =>
			o
				.setName('server')
				.setDescription('Which server?')
				.setRequired(true)
				.addChoices(...SERVER_CHOICES)
		),
	new SlashCommandBuilder()
		.setName('stop')
		.setDescription('Stop a game server')
		.addStringOption((o) =>
			o
				.setName('server')
				.setDescription('Which server?')
				.setRequired(true)
				.addChoices(...SERVER_CHOICES)
		)
].map((c) => c.toJSON());
