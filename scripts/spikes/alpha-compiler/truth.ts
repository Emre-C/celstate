/**
 * Synthetic ground-truth animation generators for the Alpha Compiler evaluation loop.
 *
 * Each scenario produces straight (non-premultiplied) RGBA truth frames where the true
 * alpha and true foreground RGB are known exactly, plus a per-frame mask marking pixels
 * that belong to detached elements (particles separated from the subject body).
 *
 * Everything here is deterministic: scenario parameters come from a seeded PRNG fixed
 * at construction time, and frames are pure functions of the frame index.
 */

import { clampByte, parseRgbColor, type RgbColor } from "./core.js";

export interface TruthFrame {
	/** Straight-alpha RGBA, width*height*4. RGB is the true foreground color, zeroed where alpha = 0. */
	readonly rgba: Buffer;
	/** 1 where the pixel belongs to a detached element and not the subject body. */
	readonly detachedMask: Uint8Array;
}

export interface ScenarioSpec {
	readonly frameCount: number;
	readonly frameRate: number;
	generateFrame(frameIndex: number): TruthFrame;
	readonly height: number;
	readonly id: string;
	/** Chroma plate color the truth frames are composited over. */
	readonly keyColor: string;
	readonly title: string;
	readonly width: number;
}

export interface ScenarioOptions {
	readonly frameCount: number;
	readonly height: number;
	readonly width: number;
}

export const DEFAULT_SCENARIO_OPTIONS: ScenarioOptions = {
	frameCount: 48,
	height: 360,
	width: 640,
};

/** Deterministic 32-bit PRNG (mulberry32). */
export function createPrng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Deterministic spatial hash noise in [-1, 1). */
export function hashNoise(x: number, y: number, salt: number): number {
	let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(salt, 83492791)) >>> 0;
	h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
	return ((h & 0xffff) / 0x8000) - 1;
}

interface FrameCanvas {
	readonly alpha: Float64Array;
	readonly b: Float64Array;
	readonly g: Float64Array;
	readonly height: number;
	readonly r: Float64Array;
	readonly width: number;
}

function createCanvas(width: number, height: number): FrameCanvas {
	const pixelCount = width * height;
	return {
		alpha: new Float64Array(pixelCount),
		b: new Float64Array(pixelCount),
		g: new Float64Array(pixelCount),
		height,
		r: new Float64Array(pixelCount),
		width,
	};
}

/** Composite a layer pixel over the existing canvas content (straight alpha "over"). */
function blendOver(canvas: FrameCanvas, index: number, r: number, g: number, b: number, layerAlpha: number): void {
	const a = Math.max(0, Math.min(1, layerAlpha));
	if (a <= 0) {
		return;
	}
	const previous = canvas.alpha[index];
	const outAlpha = a + previous * (1 - a);
	if (outAlpha <= 0) {
		return;
	}
	const weight = a / outAlpha;
	canvas.r[index] = r * weight + canvas.r[index] * (1 - weight);
	canvas.g[index] = g * weight + canvas.g[index] * (1 - weight);
	canvas.b[index] = b * weight + canvas.b[index] * (1 - weight);
	canvas.alpha[index] = outAlpha;
}

/** Anti-aliased disc coverage: 1 inside, linear 1px ramp at the boundary. */
function discCoverage(distance: number, radius: number): number {
	return Math.max(0, Math.min(1, radius - distance + 0.5));
}

function drawDisc(
	canvas: FrameCanvas,
	cx: number,
	cy: number,
	radius: number,
	color: RgbColor,
	alphaScale: number,
	textureSalt: number,
	textureAmplitude: number,
): void {
	const minX = Math.max(0, Math.floor(cx - radius - 2));
	const maxX = Math.min(canvas.width - 1, Math.ceil(cx + radius + 2));
	const minY = Math.max(0, Math.floor(cy - radius - 2));
	const maxY = Math.min(canvas.height - 1, Math.ceil(cy + radius + 2));
	for (let y = minY; y <= maxY; y += 1) {
		for (let x = minX; x <= maxX; x += 1) {
			const dist = Math.hypot(x - cx, y - cy);
			const coverage = discCoverage(dist, radius);
			if (coverage <= 0) {
				continue;
			}
			const noise = textureAmplitude === 0 ? 0 : hashNoise(x, y, textureSalt) * textureAmplitude;
			blendOver(
				canvas,
				y * canvas.width + x,
				color.r + noise,
				color.g + noise,
				color.b + noise * 0.6,
				coverage * alphaScale,
			);
		}
	}
}

function drawGaussianBlob(
	canvas: FrameCanvas,
	cx: number,
	cy: number,
	sigma: number,
	color: RgbColor,
	peakAlpha: number,
): void {
	const reach = sigma * 3;
	const minX = Math.max(0, Math.floor(cx - reach));
	const maxX = Math.min(canvas.width - 1, Math.ceil(cx + reach));
	const minY = Math.max(0, Math.floor(cy - reach));
	const maxY = Math.min(canvas.height - 1, Math.ceil(cy + reach));
	const denom = 2 * sigma * sigma;
	for (let y = minY; y <= maxY; y += 1) {
		for (let x = minX; x <= maxX; x += 1) {
			const dx = x - cx;
			const dy = y - cy;
			const a = peakAlpha * Math.exp(-(dx * dx + dy * dy) / denom);
			if (a < 0.004) {
				continue;
			}
			blendOver(canvas, y * canvas.width + x, color.r, color.g, color.b, a);
		}
	}
}

/** Anti-aliased thick line segment via distance-to-segment coverage. */
function drawSegment(
	canvas: FrameCanvas,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	halfWidth: number,
	color: RgbColor,
	alphaScale: number,
): void {
	const minX = Math.max(0, Math.floor(Math.min(x1, x2) - halfWidth - 2));
	const maxX = Math.min(canvas.width - 1, Math.ceil(Math.max(x1, x2) + halfWidth + 2));
	const minY = Math.max(0, Math.floor(Math.min(y1, y2) - halfWidth - 2));
	const maxY = Math.min(canvas.height - 1, Math.ceil(Math.max(y1, y2) + halfWidth + 2));
	const dx = x2 - x1;
	const dy = y2 - y1;
	const lengthSquared = dx * dx + dy * dy;
	for (let y = minY; y <= maxY; y += 1) {
		for (let x = minX; x <= maxX; x += 1) {
			let t = lengthSquared === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / lengthSquared;
			t = Math.max(0, Math.min(1, t));
			const px = x1 + t * dx;
			const py = y1 + t * dy;
			const dist = Math.hypot(x - px, y - py);
			const coverage = Math.max(0, Math.min(1, halfWidth - dist + 0.5));
			if (coverage <= 0) {
				continue;
			}
			blendOver(canvas, y * canvas.width + x, color.r, color.g, color.b, coverage * alphaScale);
		}
	}
}

function canvasToTruthFrame(canvas: FrameCanvas, detachedMask: Uint8Array): TruthFrame {
	const pixelCount = canvas.width * canvas.height;
	const rgba = Buffer.alloc(pixelCount * 4);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const alpha = canvas.alpha[pixel];
		const offset = pixel * 4;
		if (alpha <= 0) {
			continue;
		}
		rgba[offset] = clampByte(canvas.r[pixel]);
		rgba[offset + 1] = clampByte(canvas.g[pixel]);
		rgba[offset + 2] = clampByte(canvas.b[pixel]);
		rgba[offset + 3] = clampByte(alpha * 255);
	}
	return { detachedMask, rgba };
}

interface Spark {
	readonly birthRadius: number;
	readonly curve: number;
	readonly lifetime: number;
	readonly spawnAngle: number;
	readonly spawnFrame: number;
	readonly speed: number;
	readonly vy: number;
}

/**
 * GT-SPARKS: an opaque subject body that continuously sheds genuinely detached
 * particles. Sparks have opaque anti-aliased cores plus a soft gaussian halo, move
 * away from the subject, shrink, and fade out. Exercises the detached-element
 * (chroma re-add) path and partial-alpha handling on small geometry.
 */
function createSparkScenario(options: ScenarioOptions): ScenarioSpec {
	const { frameCount, height, width } = options;
	const random = createPrng(0x5eed5a01);
	const subjectX = width * 0.28;
	const subjectY = height * 0.55;
	const subjectRadius = Math.min(width, height) * 0.2;
	const subjectColor = parseRgbColor("#c2410c");
	const sparkColor: RgbColor = { b: 96, g: 196, r: 255 };
	const sparkCount = 16;
	const sparks: Spark[] = [];
	for (let index = 0; index < sparkCount; index += 1) {
		sparks.push({
			birthRadius: 2.6 + random() * 3.4,
			curve: (random() - 0.5) * 0.18,
			lifetime: 20 + Math.floor(random() * 12),
			spawnAngle: (random() - 0.5) * (Math.PI / 2.4),
			spawnFrame: Math.floor(random() * frameCount),
			speed: 3.4 + random() * 2.4,
			vy: -0.9 - random() * 1.1,
		});
	}
	return {
		frameCount,
		frameRate: 24,
		generateFrame(frameIndex: number): TruthFrame {
			const canvas = createCanvas(width, height);
			const pixelCount = width * height;
			const wobble = Math.sin((frameIndex / frameCount) * Math.PI * 2) * 4;
			drawDisc(canvas, subjectX + wobble, subjectY, subjectRadius, subjectColor, 1, 11, 9);
			const subjectAlpha = new Float64Array(canvas.alpha);
			for (const spark of sparks) {
				const age = (frameIndex - spark.spawnFrame + frameCount) % frameCount;
				if (age >= spark.lifetime) {
					continue;
				}
				const progress = age / spark.lifetime;
				const fade = 1 - progress * progress;
				const startX = subjectX + wobble + Math.cos(spark.spawnAngle) * (subjectRadius + 4);
				const startY = subjectY + Math.sin(spark.spawnAngle) * (subjectRadius + 4);
				const x = startX + spark.speed * age + spark.curve * age * age * 0.4;
				const y = startY + spark.vy * age + 0.05 * age * age;
				const radius = spark.birthRadius * (1 - progress * 0.55);
				drawGaussianBlob(canvas, x, y, radius * 2.1, sparkColor, 0.32 * fade);
				drawDisc(canvas, x, y, radius, sparkColor, fade, 0, 0);
			}
			const detachedMask = new Uint8Array(pixelCount);
			for (let pixel = 0; pixel < pixelCount; pixel += 1) {
				if (canvas.alpha[pixel] > 0.03 && subjectAlpha[pixel] <= 0.03) {
					detachedMask[pixel] = 1;
				}
			}
			return canvasToTruthFrame(canvas, detachedMask);
		},
		height,
		id: "gt-sparks",
		keyColor: "#23af42",
		title: "Detached sparks over green key",
		width,
	};
}

interface SmokeBlob {
	readonly lifetime: number;
	readonly maxSigma: number;
	readonly peakAlpha: number;
	readonly phase: number;
	readonly riseSpeed: number;
	readonly spawnFrame: number;
	readonly swayAmplitude: number;
}

/**
 * GT-SMOKE: a small opaque ember emitting genuinely soft smoke. Most smoke pixels
 * carry partial truth alpha in the 0.1-0.7 range, which is exactly the soft-alpha
 * regime the chroma path tends to binarize.
 */
function createSmokeScenario(options: ScenarioOptions): ScenarioSpec {
	const { frameCount, height, width } = options;
	const random = createPrng(0x5eed5a02);
	const emberX = width * 0.5;
	const emberY = height * 0.84;
	const emberRadius = Math.min(width, height) * 0.075;
	const emberColor = parseRgbColor("#46352c");
	const emberGlow: RgbColor = { b: 60, g: 140, r: 255 };
	const smokeColor: RgbColor = { b: 198, g: 208, r: 215 };
	const blobCount = 14;
	const blobs: SmokeBlob[] = [];
	for (let index = 0; index < blobCount; index += 1) {
		blobs.push({
			lifetime: 30 + Math.floor(random() * 14),
			maxSigma: 14 + random() * 12,
			peakAlpha: 0.34 + random() * 0.3,
			phase: random() * Math.PI * 2,
			riseSpeed: 3.4 + random() * 2,
			spawnFrame: Math.floor(random() * frameCount),
			swayAmplitude: 10 + random() * 16,
		});
	}
	return {
		frameCount,
		frameRate: 24,
		generateFrame(frameIndex: number): TruthFrame {
			const canvas = createCanvas(width, height);
			for (const blob of blobs) {
				const age = (frameIndex - blob.spawnFrame + frameCount) % frameCount;
				if (age >= blob.lifetime) {
					continue;
				}
				const progress = age / blob.lifetime;
				const y = emberY - emberRadius - blob.riseSpeed * age;
				const x = emberX + Math.sin(blob.phase + progress * Math.PI * 2.4) * blob.swayAmplitude * progress;
				const sigma = blob.maxSigma * (0.32 + progress * 0.68);
				const alpha = blob.peakAlpha * Math.sin(Math.min(1, progress / 0.25) * (Math.PI / 2)) * (1 - progress);
				if (y < -sigma * 3) {
					continue;
				}
				drawGaussianBlob(canvas, x, y, sigma, smokeColor, alpha);
			}
			drawDisc(canvas, emberX, emberY, emberRadius, emberColor, 1, 23, 8);
			drawGaussianBlob(canvas, emberX, emberY - emberRadius * 0.3, emberRadius * 0.5, emberGlow, 0.85);
			const detachedMask = new Uint8Array(width * height);
			return canvasToTruthFrame(canvas, detachedMask);
		},
		height,
		id: "gt-smoke",
		keyColor: "#23af42",
		title: "Soft smoke and ember over green key",
		width,
	};
}

interface Tassel {
	readonly accent: boolean;
	readonly baseX: number;
	readonly halfWidth: number;
	readonly length: number;
	readonly phase: number;
	readonly swing: number;
}

/**
 * GT-TASSELS: a scarf band with thin swinging strands (1.5-3 px wide) on a blue key.
 * Exercises fine repeated structures, sub-pixel anti-aliased edges, and key-agnostic
 * projection (non-green plate). Alternating strand colors make edge RGB fidelity
 * measurable on thin geometry.
 */
function createTasselScenario(options: ScenarioOptions): ScenarioSpec {
	const { frameCount, height, width } = options;
	const random = createPrng(0x5eed5a03);
	const bandTop = height * 0.16;
	const bandBottom = height * 0.34;
	const bandLeft = width * 0.14;
	const bandRight = width * 0.86;
	const bandColor = parseRgbColor("#ece5d1");
	const ivory = parseRgbColor("#e1d7be");
	const terracotta = parseRgbColor("#b4481e");
	const tasselCount = 12;
	const tassels: Tassel[] = [];
	for (let index = 0; index < tasselCount; index += 1) {
		tassels.push({
			accent: index % 2 === 1,
			baseX: bandLeft + ((index + 0.5) / tasselCount) * (bandRight - bandLeft),
			halfWidth: 0.7 + random() * 0.8,
			length: height * (0.2 + random() * 0.09),
			phase: random() * Math.PI * 2,
			swing: 8 + random() * 7,
		});
	}
	const swingPeriod = 36;
	return {
		frameCount,
		frameRate: 24,
		generateFrame(frameIndex: number): TruthFrame {
			const canvas = createCanvas(width, height);
			for (const tassel of tassels) {
				const color = tassel.accent ? terracotta : ivory;
				const sway = Math.sin((frameIndex / swingPeriod) * Math.PI * 2 + tassel.phase) * tassel.swing;
				const segments = 8;
				let previousX = tassel.baseX;
				let previousY = bandBottom - 1;
				for (let segment = 1; segment <= segments; segment += 1) {
					const s = segment / segments;
					const x = tassel.baseX + sway * s * s;
					const y = bandBottom - 1 + tassel.length * s;
					const halfWidth = tassel.halfWidth * (1 - s * 0.4);
					drawSegment(canvas, previousX, previousY, x, y, halfWidth, color, 1);
					previousX = x;
					previousY = y;
				}
				drawDisc(canvas, previousX, previousY, tassel.halfWidth + 1.6, color, 1, 31, 6);
			}
			for (let y = Math.floor(bandTop); y <= Math.ceil(bandBottom); y += 1) {
				if (y < 0 || y >= height) {
					continue;
				}
				for (let x = Math.floor(bandLeft); x <= Math.ceil(bandRight); x += 1) {
					if (x < 0 || x >= width) {
						continue;
					}
					const edgeFadeY = Math.min(y - bandTop + 0.5, bandBottom - y + 0.5);
					const edgeFadeX = Math.min(x - bandLeft + 0.5, bandRight - x + 0.5);
					const coverage = Math.max(0, Math.min(1, Math.min(edgeFadeX, edgeFadeY)));
					if (coverage <= 0) {
						continue;
					}
					const noise = hashNoise(x, y, 37) * 7;
					blendOver(
						canvas,
						y * width + x,
						bandColor.r + noise,
						bandColor.g + noise,
						bandColor.b + noise * 0.7,
						coverage,
					);
				}
			}
			const detachedMask = new Uint8Array(width * height);
			return canvasToTruthFrame(canvas, detachedMask);
		},
		height,
		id: "gt-tassels",
		keyColor: "#2040ff",
		title: "Fine tassel strands over blue key",
		width,
	};
}

export function createScenarios(options: ScenarioOptions = DEFAULT_SCENARIO_OPTIONS): ScenarioSpec[] {
	return [
		createSparkScenario(options),
		createSmokeScenario(options),
		createTasselScenario(options),
	];
}

/** Scenario ids expected in a full `pnpm alpha-eval run` (no --scenario filter). */
export const CANONICAL_SCENARIO_IDS = createScenarios().map((scenario) => scenario.id);

/**
 * Deterministic chroma plate with a mild diagonal gradient and spatial hash noise,
 * staying well inside the colorkey similarity radius so the keyer still detects it
 * after lossy encoding.
 */
export function renderPlateRgb(width: number, height: number, keyColor: string): Buffer {
	const key = parseRgbColor(keyColor);
	const data = Buffer.alloc(width * height * 3);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const offset = (y * width + x) * 3;
			const gradient = ((x / width) - 0.5) * 8 + ((y / height) - 0.5) * 5;
			const noise = hashNoise(x, y, 101) * 3;
			data[offset] = clampByte(key.r + gradient + noise);
			data[offset + 1] = clampByte(key.g + gradient + noise);
			data[offset + 2] = clampByte(key.b + gradient * 0.8 + noise);
		}
	}
	return data;
}

/** Composite a straight-alpha RGBA truth frame over an RGB plate. */
export function compositeOverPlate(truthRgba: Buffer, plateRgb: Buffer, width: number, height: number): Buffer {
	const pixelCount = width * height;
	const out = Buffer.alloc(pixelCount * 3);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const rgbaOffset = pixel * 4;
		const rgbOffset = pixel * 3;
		const alpha = truthRgba[rgbaOffset + 3] / 255;
		const inverse = 1 - alpha;
		out[rgbOffset] = clampByte(truthRgba[rgbaOffset] * alpha + plateRgb[rgbOffset] * inverse);
		out[rgbOffset + 1] = clampByte(truthRgba[rgbaOffset + 1] * alpha + plateRgb[rgbOffset + 1] * inverse);
		out[rgbOffset + 2] = clampByte(truthRgba[rgbaOffset + 2] * alpha + plateRgb[rgbOffset + 2] * inverse);
	}
	return out;
}
