import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { RawGrayImage, RawRgbImage, RawRgbaImage } from "../alpha-compiler/core.js";
import { keyFilter } from "./ffmpeg-filters.js";
import { ensureDirectory, runFfmpeg } from "./harness.js";
import type { ChromaSettings, RunContext } from "./model.js";

export async function readRgbImage(filePath: string): Promise<RawRgbImage> {
	const { data, info } = await sharp(filePath)
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return {
		data,
		height: info.height,
		width: info.width,
	};
}

export async function readGrayImage(filePath: string): Promise<RawGrayImage> {
	const { data, info } = await sharp(filePath)
		.greyscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	if (info.channels !== 1) {
		throw new Error(`Expected a single-channel grayscale image. Got ${info.channels} channels for ${filePath}.`);
	}
	return {
		data,
		height: info.height,
		width: info.width,
	};
}

export async function readRgbaImage(filePath: string): Promise<RawRgbaImage> {
	const { data, info } = await sharp(filePath)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	if (info.channels !== 4) {
		throw new Error(`Expected a four-channel RGBA image. Got ${info.channels} channels for ${filePath}.`);
	}
	return {
		data,
		height: info.height,
		width: info.width,
	};
}

export async function writeRgbImage(image: RawRgbImage, filePath: string): Promise<void> {
	await sharp(image.data, {
		raw: {
			channels: 3,
			height: image.height,
			width: image.width,
		},
	}).png().toFile(filePath);
}

export async function writeRgbaImage(data: Buffer, width: number, height: number, filePath: string): Promise<void> {
	await sharp(data, {
		raw: {
			channels: 4,
			height,
			width,
		},
	}).png().toFile(filePath);
}

export async function listFrameFiles(directory: string): Promise<string[]> {
	const files = await readdir(directory);
	return files
		.filter((file) => /^frame-\d+\.png$/u.test(file))
		.sort()
		.map((file) => path.join(directory, file));
}

export function sampleFramePaths(frames: readonly string[], count: number): string[] {
	if (frames.length <= count) {
		return [...frames];
	}
	const selected = new Set<number>();
	for (let index = 0; index < count; index += 1) {
		selected.add(Math.round((index * (frames.length - 1)) / Math.max(1, count - 1)));
	}
	return [...selected].sort((a, b) => a - b).map((index) => frames[index]);
}

export async function extractSourceFrames(source: string, framesDirectory: string, context: RunContext): Promise<string[]> {
	await rm(framesDirectory, { force: true, recursive: true });
	await ensureDirectory(framesDirectory);
	await runFfmpeg(
		["-y", "-i", source, "-vsync", "0", path.join(framesDirectory, "frame-%05d.png")],
		"celstate alpha v2 source frame extraction",
		context,
	);
	return listFrameFiles(framesDirectory);
}

export async function extractSharpChromaAlphaFrames(source: string, framesDirectory: string, settings: ChromaSettings, context: RunContext): Promise<string[]> {
	await rm(framesDirectory, { force: true, recursive: true });
	await ensureDirectory(framesDirectory);
	await runFfmpeg(
		[
			"-y",
			"-i",
			source,
			"-vf",
			`${keyFilter(settings)},alphaextract,format=gray`,
			"-vsync",
			"0",
			path.join(framesDirectory, "frame-%05d.png"),
		],
		"celstate alpha v5 sharp chroma alpha extraction",
		context,
	);
	return listFrameFiles(framesDirectory);
}

export async function extractRoughAlphaFrames(source: string, framesDirectory: string, settings: ChromaSettings, context: RunContext): Promise<string[]> {
	await rm(framesDirectory, { force: true, recursive: true });
	await ensureDirectory(framesDirectory);
	await runFfmpeg(
		[
			"-y",
			"-i",
			source,
			"-vf",
			`${keyFilter(settings)},alphaextract,tmix=frames=3:weights='1 2 1',format=gray`,
			"-vsync",
			"0",
			path.join(framesDirectory, "frame-%05d.png"),
		],
		"celstate alpha v3 rough alpha extraction",
		context,
	);
	return listFrameFiles(framesDirectory);
}

export function frameRateFromProbe(probe: unknown): string {
	if (probe && typeof probe === "object") {
		const streams = (probe as { streams?: Array<{ r_frame_rate?: unknown }> }).streams;
		const frameRate = streams?.[0]?.r_frame_rate;
		if (typeof frameRate === "string" && frameRate !== "0/0") {
			return frameRate;
		}
	}
	return "24";
}
