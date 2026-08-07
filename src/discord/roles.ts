import { type ChatInputCommandInteraction } from 'discord.js';
import { requireEnv, type ServerConfig } from '../core/cfg.js';

const DEFAULT_ROLE_ID = requireEnv('DEFAULT_ROLE_ID');

/**
 * True if the invoking member holds the role. Fails closed: no member, or a
 * raw uncached member shape (no roles.cache), means no access.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {string} roleId - Discord role id to look for.
 * @returns {boolean}
 */
function hasRole(interaction: ChatInputCommandInteraction, roleId: string): boolean {
	const roles = interaction.member?.roles;
	return roles !== undefined && 'cache' in roles && roles.cache.has(roleId);
}

/**
 * Base role check — DEFAULT_ROLE_ID gates every command the bot has.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {boolean}
 */
export function hasDefaultRole(interaction: ChatInputCommandInteraction): boolean {
	return hasRole(interaction, DEFAULT_ROLE_ID);
}

/**
 * Server access role check. A server's roleId does not replace the base role — it
 * is an extra requirement on top.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {ServerConfig} srv - Target server.
 * @returns {boolean}
 */
export function hasServerRole(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig
): boolean {
	return (
		hasDefaultRole(interaction) && (srv.roleId === undefined || hasRole(interaction, srv.roleId))
	);
}

/**
 * Admin access role check: base role, server role, and — when the config sets
 * adminRoleId — that role too. Each tier stacks on the previous one.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {ServerConfig} srv - Target server.
 * @returns {boolean}
 */
export function hasAdminRole(interaction: ChatInputCommandInteraction, srv: ServerConfig): boolean {
	return (
		hasDefaultRole(interaction) &&
		hasServerRole(interaction, srv) &&
		(srv.adminRoleId === undefined || hasRole(interaction, srv.adminRoleId))
	);
}
