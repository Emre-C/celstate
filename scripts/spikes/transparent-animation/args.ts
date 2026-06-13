import type { ParsedArgs } from "./model.js";

export function parseArgs(argv: readonly string[]): ParsedArgs {
	const [command = "help", ...rest] = argv;
	const options = new Map<string, string[]>();
	const positionals: string[] = [];

	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (!token.startsWith("--")) {
			positionals.push(token);
			continue;
		}

		const withoutPrefix = token.slice(2);
		const equalsIndex = withoutPrefix.indexOf("=");
		if (equalsIndex >= 0) {
			appendOption(options, withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
			continue;
		}

		const next = rest[index + 1];
		if (next && !next.startsWith("--")) {
			appendOption(options, withoutPrefix, next);
			index += 1;
			continue;
		}

		appendOption(options, withoutPrefix, "true");
	}

	return { command, options, positionals };
}

function appendOption(options: Map<string, string[]>, key: string, value: string): void {
	const current = options.get(key) ?? [];
	current.push(value);
	options.set(key, current);
}

export function getOption(args: ParsedArgs, key: string): string | undefined {
	return args.options.get(key)?.[0];
}

export function getOptions(args: ParsedArgs, key: string): readonly string[] {
	return args.options.get(key) ?? [];
}

export function getRequiredOption(args: ParsedArgs, key: string): string {
	const value = getOption(args, key)?.trim();
	if (!value) {
		throw new Error(`Pass --${key} <value>.`);
	}
	return value;
}

export function getNumberOption(args: ParsedArgs, key: string, fallback: number): number {
	const value = getOption(args, key);
	if (value === undefined) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`--${key} must be a finite number. Got: ${value}`);
	}
	return parsed;
}

export function getOptionalNumberOption(args: ParsedArgs, key: string): number | undefined {
	const value = getOption(args, key);
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`--${key} must be a finite number. Got: ${value}`);
	}
	return parsed;
}
