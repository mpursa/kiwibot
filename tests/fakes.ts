import { ChatInputCommandInteraction } from 'discord.js';

import { ServerConfig } from '../dist/core/cfg.js';

export interface FakeInteractionOptions {
	/** Value the 'server' option resolves to; omitted means the option was not given. */
	readonly server?: string;
	/** Role ids the invoking member holds. */
	readonly roles?: string[];
	readonly username?: string;
}

export interface FakeInteractionHandle {
	readonly interaction: ChatInputCommandInteraction;
	/** Everything passed to reply()/editReply(), in order. */
	readonly replies: unknown[];
}

/**
 * The handlers only touch a handful of interaction properties, so a plain
 * object stands in for Discord — no gateway connection involved. The roles
 * cache is a Set because the role checks only ever call .has().
 *
 * @param {string} commandName - Command being invoked, without the slash.
 * @param {FakeInteractionOptions} options - Server option and member roles.
 * @returns {FakeInteractionHandle} The interaction plus its recorded replies.
 */
export function fakeInteraction(
	commandName: string,
	options: FakeInteractionOptions = {}
): FakeInteractionHandle {
	const replies: unknown[] = [];
	const state = { replied: false, deferred: false };
	const fake = {
		commandName,
		get replied() {
			return state.replied;
		},
		get deferred() {
			return state.deferred;
		},
		options: {
			getString: () => options.server ?? null
		},
		member: {
			roles: { cache: new Set(options.roles ?? []) }
		},
		user: { username: options.username ?? 'tester' },
		async reply(message: unknown): Promise<void> {
			state.replied = true;
			replies.push(message);
		},
		async deferReply(): Promise<void> {
			state.deferred = true;
		},
		async editReply(message: unknown): Promise<void> {
			replies.push(message);
		}
	};
	return { interaction: fake as unknown as ChatInputCommandInteraction, replies };
}

/**
 * Extracts the text of a reply, whether it was a bare string or { content }.
 *
 * @param {unknown} reply - A recorded reply()/editReply() argument.
 * @returns {string} The reply text, or '' when there is none.
 */
export function contentOf(reply: unknown): string {
	if (typeof reply === 'string') return reply;
	if (typeof reply === 'object' && reply !== null && 'content' in reply) {
		const content = (reply as { content?: unknown }).content;
		if (typeof content === 'string') return content;
	}
	return '';
}

/**
 * A ServerConfig fixture, independent of the local servers.json.
 *
 * @param {Partial<ServerConfig>} overrides - Fields to override on the fixture.
 * @returns {ServerConfig}
 */
export function makeServer(overrides: Partial<ServerConfig> = {}): ServerConfig {
	return {
		label: 'Testworld',
		unit: 'testworld',
		address: 'test.example.com',
		port: 8211,
		protocol: 'udp',
		startupMs: 120_000,
		...overrides
	};
}
