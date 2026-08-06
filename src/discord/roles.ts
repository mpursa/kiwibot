import { type ChatInputCommandInteraction } from 'discord.js';
import { requireEnv, type ServerConfig } from '../core/cfg.js';

const DEFAULT_ROLE_ID = requireEnv('DEFAULT_ROLE_ID');

function hasRole(interaction: ChatInputCommandInteraction, roleId: string): boolean {
	const roles = interaction.member?.roles;
	return roles !== undefined && 'cache' in roles && roles.cache.has(roleId);
}

export function hasDefaultRole(interaction: ChatInputCommandInteraction): boolean {
	return hasRole(interaction, DEFAULT_ROLE_ID);
}

/**
 * DEFAULT_ROLE_ID is the base role, required for every command. A server's
 * roleId does not replace it — it is an extra requirement on top.
 */
export function hasServerRole(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig
): boolean {
	return (
		hasDefaultRole(interaction) && (srv.roleId === undefined || hasRole(interaction, srv.roleId))
	);
}
