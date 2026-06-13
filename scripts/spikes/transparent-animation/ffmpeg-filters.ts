import { normalizeHexColor } from "../alpha-compiler/core.js";
import type { ChromaSettings } from "./model.js";

export function ffmpegColor(value: string): string {
	return `0x${normalizeHexColor(value).slice(1)}`;
}

export function keyFilter(settings: ChromaSettings): string {
	return `format=rgba,colorkey=${ffmpegColor(settings.color)}:${settings.similarity}:${settings.blend}`;
}

export function celstateAlphaGraph(settings: ChromaSettings): string {
	const keyed = keyFilter(settings);
	return `[0:v]${keyed},split[keyed][rgb];[keyed]alphaextract,tmix=frames=3:weights='1 2 1',format=gray[alpha];[rgb][alpha]alphamerge,format=yuva444p10le[out]`;
}

export function despillParams(color: string, mix: number): string {
	const normalized = normalizeHexColor(color).toUpperCase();
	// FFmpeg 8.x despill AVOptions: type, mix, expand, red, green, blue, brightness, alpha
	// Defaults: type=green, mix=0.5, green=-1, red=0, blue=0
	if (normalized === "#00FF00") {
		return `despill=type=green:mix=${mix}`;
	}
	if (normalized === "#0000FF") {
		return `despill=type=blue:blue=-1:green=0:mix=${mix}`;
	}
	const r = parseInt(normalized.slice(1, 3), 16);
	const g = parseInt(normalized.slice(3, 5), 16);
	const b = parseInt(normalized.slice(5, 7), 16);
	const maxChannel = Math.max(r, g, b);
	if (maxChannel === g && g > 100) {
		return `despill=type=green:mix=${mix}`;
	}
	if (maxChannel === b && b > 100) {
		return `despill=type=blue:blue=-1:green=0:mix=${mix}`;
	}
	if (maxChannel === r && r > 100) {
		return `despill=type=green:red=-1:green=0:mix=${mix}`;
	}
	return `despill=type=green:mix=${mix}`;
}

export function celstateAlphaV1DespillGraph(settings: ChromaSettings, despillMix: number): string {
	const keyed = keyFilter(settings);
	const despill = despillParams(settings.color, despillMix);
	// Key first to create alpha, then despill the keyed RGB. Despill preserves
	// alpha by default (alpha=false), so the keyed background stays transparent.
	// Alpha is extracted from the keyed stream, temporally smoothed, then merged
	// with the despilled RGB for the final output.
	return `[0:v]${keyed},split[keyed][rgb];[keyed]alphaextract,tmix=frames=3:weights='1 2 1',format=gray[alpha];[rgb]${despill}[despilled];[despilled][alpha]alphamerge,format=yuva444p10le[out]`;
}
