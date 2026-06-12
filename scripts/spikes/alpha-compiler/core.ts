/**
 * Alpha Compiler numerical core.
 *
 * Pure, deterministic functions extracted from scripts/spikes/transparent-animation-spike.ts
 * so the compiler math can be unit-tested and reused by the synthetic ground-truth
 * evaluation loop without dragging in run-management or provider plumbing.
 *
 * Nothing in this module performs I/O.
 */

export interface RgbColor {
	readonly b: number;
	readonly g: number;
	readonly r: number;
}

export interface RawRgbImage {
	readonly data: Buffer;
	readonly height: number;
	readonly width: number;
}

export interface RawGrayImage {
	readonly data: Buffer;
	readonly height: number;
	readonly width: number;
}

export interface RawRgbaImage {
	readonly data: Buffer;
	readonly height: number;
	readonly width: number;
}

export interface V6ProjectionSettings {
	readonly bgPlateIterations: number;
	readonly chromaTransparentCutoff: number;
	readonly coreAlphaThreshold: number;
	readonly coreProjectionBand: number;
	readonly fringeRadius: number;
	readonly guardRadius: number;
	readonly keyColor: string;
	readonly leafAlphaFloor: number;
	readonly leafEdgeBand: number;
	readonly leafGateRamp: number;
	readonly leafInteriorMinDistance: number;
	readonly priorAlphaDir: string;
	readonly priorModel: string;
	readonly priorPackage: string;
	readonly selectedFrame: number;
	readonly subjectAlphaThreshold: number;
	readonly transparentCutoff: number;
}

export interface MetricSummary {
	readonly average: number;
	readonly max: number;
	/** 1-based frame number where the max occurred (frame-%05d numbering). 0 when empty. */
	readonly maxFrame: number;
	readonly min: number;
	/** 1-based frame number where the min occurred (frame-%05d numbering). 0 when empty. */
	readonly minFrame: number;
}

export function normalizeHexColor(value: string): string {
	const trimmed = value.trim().toLowerCase();
	const match = trimmed.match(/^(?:#|0x)?([0-9a-f]{6})$/);
	if (!match) {
		throw new Error(`Expected a 6-digit RGB hex color. Got: ${value}`);
	}
	return `#${match[1]}`;
}

export function parseRgbColor(value: string): RgbColor {
	const normalized = normalizeHexColor(value);
	return {
		b: parseInt(normalized.slice(5, 7), 16),
		g: parseInt(normalized.slice(3, 5), 16),
		r: parseInt(normalized.slice(1, 3), 16),
	};
}

export function rgbToHex(color: RgbColor): string {
	return `#${[color.r, color.g, color.b].map((channel) => clampByte(channel).toString(16).padStart(2, "0")).join("")}`;
}

export function clampByte(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

export function colorDistanceSquared(r: number, g: number, b: number, color: RgbColor): number {
	const dr = r - color.r;
	const dg = g - color.g;
	const db = b - color.b;
	return dr * dr + dg * dg + db * db;
}

export function smoothStep(value: number): number {
	const t = Math.max(0, Math.min(1, value));
	return t * t * (3 - 2 * t);
}

export function summarizeMetric(values: readonly number[]): MetricSummary {
	if (values.length === 0) {
		return { average: 0, max: 0, maxFrame: 0, min: 0, minFrame: 0 };
	}
	let maxIndex = 0;
	let minIndex = 0;
	for (let index = 1; index < values.length; index += 1) {
		if (values[index] > values[maxIndex]) {
			maxIndex = index;
		}
		if (values[index] < values[minIndex]) {
			minIndex = index;
		}
	}
	return {
		average: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)),
		max: Number(values[maxIndex].toFixed(4)),
		maxFrame: maxIndex + 1,
		min: Number(values[minIndex].toFixed(4)),
		minFrame: minIndex + 1,
	};
}

export function distanceToTransparent(alpha: RawGrayImage, transparentCutoff: number, maxDistance: number): Uint16Array {
	const pixelCount = alpha.width * alpha.height;
	const cap = maxDistance + 1;
	const distances = new Uint16Array(pixelCount);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		distances[pixel] = alpha.data[pixel] <= transparentCutoff ? 0 : cap;
	}
	for (let y = 0; y < alpha.height; y += 1) {
		for (let x = 0; x < alpha.width; x += 1) {
			const pixel = y * alpha.width + x;
			let best = distances[pixel];
			if (x > 0) {
				best = Math.min(best, distances[pixel - 1] + 1);
			}
			if (y > 0) {
				best = Math.min(best, distances[pixel - alpha.width] + 1);
				if (x > 0) {
					best = Math.min(best, distances[pixel - alpha.width - 1] + 1);
				}
				if (x < alpha.width - 1) {
					best = Math.min(best, distances[pixel - alpha.width + 1] + 1);
				}
			}
			distances[pixel] = Math.min(best, cap);
		}
	}
	for (let y = alpha.height - 1; y >= 0; y -= 1) {
		for (let x = alpha.width - 1; x >= 0; x -= 1) {
			const pixel = y * alpha.width + x;
			let best = distances[pixel];
			if (x < alpha.width - 1) {
				best = Math.min(best, distances[pixel + 1] + 1);
			}
			if (y < alpha.height - 1) {
				best = Math.min(best, distances[pixel + alpha.width] + 1);
				if (x > 0) {
					best = Math.min(best, distances[pixel + alpha.width - 1] + 1);
				}
				if (x < alpha.width - 1) {
					best = Math.min(best, distances[pixel + alpha.width + 1] + 1);
				}
			}
			distances[pixel] = Math.min(best, cap);
		}
	}
	return distances;
}

export function chamferDistanceToMask(mask: Uint8Array, width: number, height: number, maxDistance: number): Uint16Array {
	const pixelCount = width * height;
	const cap = maxDistance + 1;
	const distances = new Uint16Array(pixelCount);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		distances[pixel] = mask[pixel] === 1 ? 0 : cap;
	}
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const pixel = y * width + x;
			let best = distances[pixel];
			if (x > 0) {
				best = Math.min(best, distances[pixel - 1] + 1);
			}
			if (y > 0) {
				best = Math.min(best, distances[pixel - width] + 1);
				if (x > 0) {
					best = Math.min(best, distances[pixel - width - 1] + 1);
				}
				if (x < width - 1) {
					best = Math.min(best, distances[pixel - width + 1] + 1);
				}
			}
			distances[pixel] = Math.min(best, cap);
		}
	}
	for (let y = height - 1; y >= 0; y -= 1) {
		for (let x = width - 1; x >= 0; x -= 1) {
			const pixel = y * width + x;
			let best = distances[pixel];
			if (x < width - 1) {
				best = Math.min(best, distances[pixel + 1] + 1);
			}
			if (y < height - 1) {
				best = Math.min(best, distances[pixel + width] + 1);
				if (x > 0) {
					best = Math.min(best, distances[pixel + width - 1] + 1);
				}
				if (x < width - 1) {
					best = Math.min(best, distances[pixel + width + 1] + 1);
				}
			}
			distances[pixel] = Math.min(best, cap);
		}
	}
	return distances;
}

export function fillInwardCoreColors(
	frame: RawRgbImage,
	coreMask: Uint8Array,
	iterations: number,
): { readonly colors: Float32Array; readonly filled: Uint8Array } {
	const pixelCount = frame.width * frame.height;
	const colors = new Float32Array(pixelCount * 3);
	const filled = new Uint8Array(pixelCount);
	let frontier: number[] = [];
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		if (coreMask[pixel] === 1) {
			filled[pixel] = 1;
			const offset = pixel * 3;
			colors[offset] = frame.data[offset];
			colors[offset + 1] = frame.data[offset + 1];
			colors[offset + 2] = frame.data[offset + 2];
			frontier.push(pixel);
		}
	}
	const width = frame.width;
	const height = frame.height;
	for (let iteration = 0; iteration < iterations && frontier.length > 0; iteration += 1) {
		const nextFrontier: number[] = [];
		const pending = new Map<number, { b: number; count: number; g: number; r: number }>();
		for (const pixel of frontier) {
			const x = pixel % width;
			const y = (pixel - x) / width;
			const sourceOffset = pixel * 3;
			for (let dy = -1; dy <= 1; dy += 1) {
				for (let dx = -1; dx <= 1; dx += 1) {
					if (dx === 0 && dy === 0) {
						continue;
					}
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
						continue;
					}
					const neighbor = ny * width + nx;
					if (filled[neighbor] === 1) {
						continue;
					}
					const entry = pending.get(neighbor) ?? { b: 0, count: 0, g: 0, r: 0 };
					entry.r += colors[sourceOffset];
					entry.g += colors[sourceOffset + 1];
					entry.b += colors[sourceOffset + 2];
					entry.count += 1;
					pending.set(neighbor, entry);
				}
			}
		}
		for (const [pixel, entry] of pending) {
			const offset = pixel * 3;
			colors[offset] = entry.r / entry.count;
			colors[offset + 1] = entry.g / entry.count;
			colors[offset + 2] = entry.b / entry.count;
			filled[pixel] = 1;
			nextFrontier.push(pixel);
		}
		frontier = nextFrontier;
	}
	return { colors, filled };
}

export function keyDominance(r: number, g: number, b: number, keyColor: RgbColor): number {
	if (keyColor.g >= keyColor.r && keyColor.g >= keyColor.b) {
		return Math.max(0, g - Math.max(r, b));
	}
	if (keyColor.b >= keyColor.r && keyColor.b >= keyColor.g) {
		return Math.max(0, b - Math.max(r, g));
	}
	return Math.max(0, r - Math.max(g, b));
}

export function fillOutwardBackgroundPlate(
	frame: RawRgbImage,
	sureBackgroundMask: Uint8Array,
	iterations: number,
): { readonly colors: Float32Array; readonly filled: Uint8Array } {
	const pixelCount = frame.width * frame.height;
	const colors = new Float32Array(pixelCount * 3);
	const filled = new Uint8Array(pixelCount);
	let frontier: number[] = [];
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		if (sureBackgroundMask[pixel] === 1) {
			filled[pixel] = 1;
			const offset = pixel * 3;
			colors[offset] = frame.data[offset];
			colors[offset + 1] = frame.data[offset + 1];
			colors[offset + 2] = frame.data[offset + 2];
			frontier.push(pixel);
		}
	}
	const width = frame.width;
	const height = frame.height;
	for (let iteration = 0; iteration < iterations && frontier.length > 0; iteration += 1) {
		const nextFrontier: number[] = [];
		const pending = new Map<number, { b: number; count: number; g: number; r: number }>();
		for (const pixel of frontier) {
			const x = pixel % width;
			const y = (pixel - x) / width;
			const sourceOffset = pixel * 3;
			for (let dy = -1; dy <= 1; dy += 1) {
				for (let dx = -1; dx <= 1; dx += 1) {
					if (dx === 0 && dy === 0) {
						continue;
					}
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
						continue;
					}
					const neighbor = ny * width + nx;
					if (filled[neighbor] === 1) {
						continue;
					}
					const entry = pending.get(neighbor) ?? { b: 0, count: 0, g: 0, r: 0 };
					entry.r += colors[sourceOffset];
					entry.g += colors[sourceOffset + 1];
					entry.b += colors[sourceOffset + 2];
					entry.count += 1;
					pending.set(neighbor, entry);
				}
			}
		}
		for (const [pixel, entry] of pending) {
			const offset = pixel * 3;
			colors[offset] = entry.r / entry.count;
			colors[offset + 1] = entry.g / entry.count;
			colors[offset + 2] = entry.b / entry.count;
			filled[pixel] = 1;
			nextFrontier.push(pixel);
		}
		frontier = nextFrontier;
	}
	return { colors, filled };
}

export function projectDecontaminate(
	r: number,
	g: number,
	b: number,
	refR: number,
	refG: number,
	refB: number,
	bgR: number,
	bgG: number,
	bgB: number,
	strength: number,
): { readonly b: number; readonly g: number; readonly r: number; readonly t: number } {
	const dr = bgR - refR;
	const dg = bgG - refG;
	const db = bgB - refB;
	const denom = dr * dr + dg * dg + db * db;
	if (denom < 1) {
		return { b, g, r, t: 0 };
	}
	const sr = r - refR;
	const sg = g - refG;
	const sb = b - refB;
	let t = (sr * dr + sg * dg + sb * db) / denom;
	t = Math.max(0, Math.min(1, t)) * Math.max(0, Math.min(1, strength));
	return {
		b: clampByte(b - t * db),
		g: clampByte(g - t * dg),
		r: clampByte(r - t * dr),
		t,
	};
}

export interface V6FrameResult {
	readonly alphaCoverage: number;
	readonly coreCoverage: number;
	readonly data: Buffer;
	readonly detachedColorFidelity: number;
	readonly fringeCoverage: number;
	readonly leafAddedCoverage: number;
	readonly priorCoverage: number;
	readonly projectedCoverage: number;
	readonly residualSpill: number;
	readonly spillHeatmap: Uint8Array | undefined;
	readonly temporalAlphaDelta: number;
}

export function createV6RgbaFrame(
	frame: RawRgbImage,
	priorAlpha: RawGrayImage,
	chromaAlpha: RawGrayImage,
	settings: V6ProjectionSettings,
	previousAlpha: Uint8Array | undefined,
	captureHeatmap: boolean,
): V6FrameResult {
	if (frame.width !== priorAlpha.width || frame.height !== priorAlpha.height) {
		throw new Error("Frame and prior alpha dimensions do not match.");
	}
	if (frame.width !== chromaAlpha.width || frame.height !== chromaAlpha.height) {
		throw new Error("Frame and chroma alpha dimensions do not match.");
	}
	const width = frame.width;
	const height = frame.height;
	const pixelCount = width * height;
	const keyColor = parseRgbColor(settings.keyColor);
	const distanceCap = Math.max(settings.fringeRadius, settings.coreProjectionBand, settings.leafEdgeBand);
	const distancesToTransparent = distanceToTransparent(priorAlpha, settings.transparentCutoff, distanceCap);
	const chromaDistancesToTransparent = distanceToTransparent(chromaAlpha, settings.transparentCutoff, settings.leafEdgeBand + settings.leafInteriorMinDistance + 2);
	const subjectMask = new Uint8Array(pixelCount);
	const coreMask = new Uint8Array(pixelCount);
	const sureBackgroundMask = new Uint8Array(pixelCount);
	const detachedCoreMask = new Uint8Array(pixelCount);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		if (priorAlpha.data[pixel] > settings.subjectAlphaThreshold) {
			subjectMask[pixel] = 1;
		}
		if (priorAlpha.data[pixel] >= settings.coreAlphaThreshold && distancesToTransparent[pixel] > settings.fringeRadius) {
			coreMask[pixel] = 1;
		}
		if (priorAlpha.data[pixel] <= settings.transparentCutoff && chromaAlpha.data[pixel] <= settings.chromaTransparentCutoff) {
			sureBackgroundMask[pixel] = 1;
		}
	}
	const distancesToSubject = chamferDistanceToMask(subjectMask, width, height, settings.guardRadius + settings.leafGateRamp);
	const subjectRef = fillInwardCoreColors(frame, coreMask, settings.fringeRadius + 12);
	const bgPlate = fillOutwardBackgroundPlate(frame, sureBackgroundMask, settings.bgPlateIterations);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		if (
			distancesToSubject[pixel] > settings.guardRadius
			&& chromaAlpha.data[pixel] >= settings.leafAlphaFloor
			&& priorAlpha.data[pixel] <= settings.transparentCutoff
			&& chromaDistancesToTransparent[pixel] >= settings.leafInteriorMinDistance
		) {
			detachedCoreMask[pixel] = 1;
		}
	}
	const detachedRef = fillInwardCoreColors(frame, detachedCoreMask, settings.leafEdgeBand + 8);
	const rgba = Buffer.alloc(pixelCount * 4);
	const spillHeatmap = captureHeatmap ? new Uint8Array(pixelCount) : undefined;
	let alphaSum = 0;
	let priorSum = 0;
	let leafAddedSum = 0;
	let corePixels = 0;
	let fringePixels = 0;
	let projectedPixels = 0;
	let spillSum = 0;
	let spillCount = 0;
	let detachedFidelitySum = 0;
	let detachedFidelityCount = 0;
	let temporalAlphaDeltaSum = 0;
	let temporalAlphaCount = 0;
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const rgbOffset = pixel * 3;
		const rgbaOffset = pixel * 4;
		const prior = priorAlpha.data[pixel];
		priorSum += prior;
		const r = frame.data[rgbOffset];
		const g = frame.data[rgbOffset + 1];
		const b = frame.data[rgbOffset + 2];
		const bgOffset = pixel * 3;
		const bgR = bgPlate.filled[pixel] === 1 ? bgPlate.colors[bgOffset] : r;
		const bgG = bgPlate.filled[pixel] === 1 ? bgPlate.colors[bgOffset + 1] : g;
		const bgB = bgPlate.filled[pixel] === 1 ? bgPlate.colors[bgOffset + 2] : b;
		if (prior > settings.transparentCutoff) {
			const isCore = coreMask[pixel] === 1;
			let outR = r;
			let outG = g;
			let outB = b;
			let outAlpha = isCore ? 255 : prior;
			if (isCore) {
				const bandDistance = distancesToTransparent[pixel];
				if (bandDistance <= settings.coreProjectionBand) {
					const bandWeight = 1 - Math.max(0, bandDistance - settings.fringeRadius) / Math.max(1, settings.coreProjectionBand - settings.fringeRadius);
					const refOffset = pixel * 3;
					const projected = projectDecontaminate(
						r,
						g,
						b,
						subjectRef.colors[refOffset],
						subjectRef.colors[refOffset + 1],
						subjectRef.colors[refOffset + 2],
						bgR,
						bgG,
						bgB,
						smoothStep(bandWeight),
					);
					outR = projected.r;
					outG = projected.g;
					outB = projected.b;
					if (projected.t > 0) {
						projectedPixels += 1;
					}
				}
				corePixels += 1;
			} else {
				fringePixels += 1;
				const distanceWeight = distancesToTransparent[pixel] <= settings.fringeRadius
					? 1 - Math.max(0, distancesToTransparent[pixel] - 1) / Math.max(1, settings.fringeRadius)
					: 0;
				const partialWeight = prior < settings.coreAlphaThreshold
					? 1 - prior / Math.max(1, settings.coreAlphaThreshold)
					: 0;
				const edgeWeight = smoothStep(Math.max(distanceWeight, partialWeight));
				if (subjectRef.filled[pixel] === 1) {
					const refOffset = pixel * 3;
					const projected = projectDecontaminate(
						r,
						g,
						b,
						subjectRef.colors[refOffset],
						subjectRef.colors[refOffset + 1],
						subjectRef.colors[refOffset + 2],
						bgR,
						bgG,
						bgB,
						edgeWeight,
					);
					outR = projected.r;
					outG = projected.g;
					outB = projected.b;
					if (projected.t > 0) {
						projectedPixels += 1;
					}
				}
			}
			rgba[rgbaOffset] = outR;
			rgba[rgbaOffset + 1] = outG;
			rgba[rgbaOffset + 2] = outB;
			rgba[rgbaOffset + 3] = outAlpha;
			alphaSum += outAlpha;
			if (outAlpha > 0) {
				const refOffset = pixel * 3;
				const refR = subjectRef.filled[pixel] === 1 ? subjectRef.colors[refOffset] : r;
				const refG = subjectRef.filled[pixel] === 1 ? subjectRef.colors[refOffset + 1] : g;
				const refB = subjectRef.filled[pixel] === 1 ? subjectRef.colors[refOffset + 2] : b;
				const spill = Math.max(0, keyDominance(outR, outG, outB, keyColor) - keyDominance(refR, refG, refB, keyColor));
				spillSum += spill;
				spillCount += 1;
				if (spillHeatmap) {
					spillHeatmap[pixel] = clampByte(spill * 4);
				}
			}
			if (previousAlpha && subjectMask[pixel] === 1) {
				temporalAlphaDeltaSum += Math.abs(outAlpha - previousAlpha[pixel]);
				temporalAlphaCount += 1;
			}
			continue;
		}
		const guardDistance = distancesToSubject[pixel];
		if (guardDistance > settings.guardRadius) {
			const leafGate = smoothStep((guardDistance - settings.guardRadius) / settings.leafGateRamp);
			const leafAlpha = clampByte(chromaAlpha.data[pixel] * leafGate);
			if (leafAlpha > settings.leafAlphaFloor) {
				let outR = r;
				let outG = g;
				let outB = b;
				const chromaEdgeDistance = chromaDistancesToTransparent[pixel];
				if (chromaEdgeDistance <= settings.leafEdgeBand && detachedRef.filled[pixel] === 1) {
					const edgeWeight = 1 - smoothStep(chromaEdgeDistance / Math.max(1, settings.leafEdgeBand));
					const refOffset = pixel * 3;
					const projected = projectDecontaminate(
						r,
						g,
						b,
						detachedRef.colors[refOffset],
						detachedRef.colors[refOffset + 1],
						detachedRef.colors[refOffset + 2],
						bgR,
						bgG,
						bgB,
						edgeWeight,
					);
					outR = projected.r;
					outG = projected.g;
					outB = projected.b;
					if (projected.t > 0) {
						projectedPixels += 1;
					}
				} else if (
					chromaEdgeDistance > settings.leafEdgeBand
					&& chromaAlpha.data[pixel] >= 180
				) {
					const dr = outR - r;
					const dg = outG - g;
					const db = outB - b;
					detachedFidelitySum += Math.sqrt(dr * dr + dg * dg + db * db);
					detachedFidelityCount += 1;
				}
				rgba[rgbaOffset] = outR;
				rgba[rgbaOffset + 1] = outG;
				rgba[rgbaOffset + 2] = outB;
				rgba[rgbaOffset + 3] = leafAlpha;
				alphaSum += leafAlpha;
				leafAddedSum += leafAlpha;
				if (leafAlpha > 0 && spillHeatmap) {
					spillHeatmap[pixel] = clampByte(Math.max(0, keyDominance(outR, outG, outB, keyColor)) * 2);
				}
				continue;
			}
		}
		rgba[rgbaOffset] = 0;
		rgba[rgbaOffset + 1] = 0;
		rgba[rgbaOffset + 2] = 0;
		rgba[rgbaOffset + 3] = 0;
	}
	return {
		alphaCoverage: alphaSum / (pixelCount * 255),
		coreCoverage: corePixels / pixelCount,
		data: rgba,
		detachedColorFidelity: detachedFidelityCount === 0 ? 0 : detachedFidelitySum / detachedFidelityCount,
		fringeCoverage: fringePixels / pixelCount,
		leafAddedCoverage: leafAddedSum / (pixelCount * 255),
		priorCoverage: priorSum / (pixelCount * 255),
		projectedCoverage: projectedPixels / pixelCount,
		residualSpill: spillCount === 0 ? 0 : spillSum / spillCount,
		spillHeatmap,
		temporalAlphaDelta: temporalAlphaCount === 0 ? 0 : temporalAlphaDeltaSum / temporalAlphaCount,
	};
}

/*
 * ---------------------------------------------------------------------------
 * v7: color-line alpha fusion + matting-equation foreground recovery.
 *
 * v6's measured gaps (synthetic ground-truth baseline, 2026-06):
 *   - soft regions without a nearby opaque core get no RGB repair (smoke spill);
 *   - output alpha mirrors the (blurred) prior even when color evidence is sharp
 *     (fine strands blob, soft halos binarize);
 *   - the detached path multiplies a binary chroma key by a distance-only guard
 *     gate, deleting genuinely detached elements near the subject.
 *
 * v7 closes these with key-agnostic mechanisms:
 *   1. Reference seeding from key-free observations: any chroma-opaque pixel with
 *      negligible key dominance is a trustworthy foreground color sample, so thin
 *      strands and small detached elements supply their own references instead of
 *      relying on a deep opaque core.
 *   2. Color-line alpha: a pixel on the segment ref->bg has coverage 1 - t. The
 *      estimate is fused with the prior weighted by geometric confidence
 *      (ref/bg separation and off-line residual), so it corrects the prior only
 *      where the two-color model demonstrably applies.
 *   3. Matting-equation recovery: fg = src + min((1-a)/a, maxGain) * (src - bg)
 *      inverts compositing exactly where alpha is trusted, with a gain cap so
 *      sensor/codec noise is never amplified unboundedly. Opaque pixels pass
 *      through untouched, preserving the detached-interior fidelity invariant.
 *   4. Color-evidence detached gate: detached re-add opens on either distance
 *      from the subject (v6 behavior) or strong disagreement between the source
 *      pixel and the background plate, so detached elements near the subject
 *      survive without re-adding plate pixels.
 * ---------------------------------------------------------------------------
 */

/** Minimum ref<->bg separation (RGB euclidean) before color-line alpha gets any weight. */
export const COLOR_LINE_MIN_SEPARATION = 32;
/** Ref<->bg separation at which color-line confidence saturates. */
export const COLOR_LINE_FULL_SEPARATION = 96;
/** Off-line residual (relative to line length) where confidence starts decaying. */
export const COLOR_LINE_OFFLINE_SOFT = 0.12;
/** Off-line residual (relative to line length) where confidence reaches zero. */
export const COLOR_LINE_OFFLINE_HARD = 0.35;
/** Cap on the (1-a)/a gain in matting-equation foreground recovery. */
export const FG_RECOVERY_MAX_GAIN = 8;
/** Chroma alpha at or above this counts as a chroma-opaque observation. */
export const CHROMA_OPAQUE_MIN = 250;
/** Maximum key dominance for a pixel to serve as a key-free reference seed. */
export const REF_SEED_MAX_KEY_DOMINANCE = 4;
/** Distance from the background plate where detached color evidence starts opening the gate. */
export const DETACHED_EVIDENCE_MIN = 48;
/** Distance from the background plate where detached color evidence fully opens the gate. */
export const DETACHED_EVIDENCE_FULL = 120;
/** Implied color shift (|delta alpha| * separation) below which a color-line correction is indistinguishable from codec noise. */
export const COLOR_LINE_DISAGREEMENT_MIN = 10;
/** Implied color shift at which a color-line correction gets full weight. */
export const COLOR_LINE_DISAGREEMENT_FULL = 28;
/** Extra inward-fill reach beyond the leaf edge band so soft halos around small detached cores get references. */
export const DETACHED_REF_FILL_EXTRA = 16;
/**
 * Ceiling on the color-line fusion weight. Single-pixel color evidence carries
 * residual uncertainty (chroma subsampling, codec noise, reference fill error),
 * so it never fully overrides the baseline; corrections stay just short of
 * saturating alpha, which preserves genuinely soft anti-aliased coverage.
 */
export const COLOR_LINE_MAX_WEIGHT = 0.85;

export interface ColorLineAlphaEstimate {
	/** Estimated foreground coverage in [0, 1] (1 - projection parameter t). */
	readonly alpha: number;
	/** Fusion weight in [0, 1]; 0 when the two-color model does not apply. */
	readonly confidence: number;
	/** Distance from the source pixel to the ref->bg line, relative to the line length. */
	readonly offLineRatio: number;
	/** Euclidean ref<->bg separation in RGB units. */
	readonly separation: number;
}

/**
 * Estimate per-pixel alpha from the two-color line model src = a*ref + (1-a)*bg.
 * Confidence collapses to zero when ref and bg are too close to disambiguate
 * (e.g. green-adjacent foreground on a green plate) or when the source pixel is
 * far off the line (a different foreground color than the reference).
 */
export function estimateColorLineAlpha(
	r: number,
	g: number,
	b: number,
	refR: number,
	refG: number,
	refB: number,
	bgR: number,
	bgG: number,
	bgB: number,
): ColorLineAlphaEstimate {
	const dr = bgR - refR;
	const dg = bgG - refG;
	const db = bgB - refB;
	const lengthSquared = dr * dr + dg * dg + db * db;
	const separation = Math.sqrt(lengthSquared);
	if (separation < COLOR_LINE_MIN_SEPARATION) {
		return { alpha: 1, confidence: 0, offLineRatio: 0, separation };
	}
	const sr = r - refR;
	const sg = g - refG;
	const sb = b - refB;
	let t = (sr * dr + sg * dg + sb * db) / lengthSquared;
	t = Math.max(0, Math.min(1, t));
	const offR = sr - t * dr;
	const offG = sg - t * dg;
	const offB = sb - t * db;
	const offLineRatio = Math.sqrt(offR * offR + offG * offG + offB * offB) / separation;
	const separationWeight = smoothStep(
		(separation - COLOR_LINE_MIN_SEPARATION) / (COLOR_LINE_FULL_SEPARATION - COLOR_LINE_MIN_SEPARATION),
	);
	const offLineWeight = 1 - smoothStep(
		(offLineRatio - COLOR_LINE_OFFLINE_SOFT) / (COLOR_LINE_OFFLINE_HARD - COLOR_LINE_OFFLINE_SOFT),
	);
	return { alpha: 1 - t, confidence: separationWeight * offLineWeight, offLineRatio, separation };
}

/**
 * Fuse a baseline alpha (prior or chroma key) with a color-line estimate.
 *
 * The correction weight is the estimate confidence scaled by how detectable the
 * disagreement is in color units: |deltaAlpha| * separation below the codec noise
 * floor cannot be distinguished from noise, so the baseline wins; large implied
 * shifts mean the color evidence actively contradicts the baseline and overrides it.
 *
 * Upward corrections additionally require `allowRaise`. A key-free pixel color is
 * inherently ambiguous between "fully opaque foreground" and "mostly-opaque soft
 * foreground" (e.g. an 85% glow), so raising alpha above the baseline is only
 * trustworthy where structure scale explains the baseline's deficit - thin
 * strands and edge bands blurred by the prior - never in wide genuinely-soft
 * regions. Downward corrections (background-explained pixels) stay always-on.
 */
export function fuseAlphaWithColorLine(baselineAlpha: number, estimate: ColorLineAlphaEstimate, allowRaise: boolean): number {
	if (!allowRaise && estimate.alpha * 255 > baselineAlpha) {
		return clampByte(baselineAlpha);
	}
	const impliedShift = Math.abs(estimate.alpha - baselineAlpha / 255) * estimate.separation;
	const disagreementWeight = smoothStep(
		(impliedShift - COLOR_LINE_DISAGREEMENT_MIN) / (COLOR_LINE_DISAGREEMENT_FULL - COLOR_LINE_DISAGREEMENT_MIN),
	);
	const weight = estimate.confidence * disagreementWeight * COLOR_LINE_MAX_WEIGHT;
	return clampByte(baselineAlpha + weight * (estimate.alpha * 255 - baselineAlpha));
}

/**
 * Invert straight-alpha compositing against the local background plate:
 * src = a*fg + (1-a)*bg  =>  fg = src + ((1-a)/a) * (src - bg).
 * The gain is capped so low-alpha pixels recover partially instead of amplifying
 * codec noise. Alpha >= 1 is an exact pass-through.
 */
export function recoverForegroundRgb(
	r: number,
	g: number,
	b: number,
	bgR: number,
	bgG: number,
	bgB: number,
	alpha: number,
	maxGain: number,
): RgbColor {
	const a = Math.max(0, Math.min(1, alpha));
	if (a >= 1) {
		return { b: clampByte(b), g: clampByte(g), r: clampByte(r) };
	}
	const gain = Math.min((1 - a) / Math.max(a, 1e-3), Math.max(0, maxGain));
	return {
		b: clampByte(b + gain * (b - bgB)),
		g: clampByte(g + gain * (g - bgG)),
		r: clampByte(r + gain * (r - bgR)),
	};
}

export function createV7RgbaFrame(
	frame: RawRgbImage,
	priorAlpha: RawGrayImage,
	chromaAlpha: RawGrayImage,
	settings: V6ProjectionSettings,
	previousAlpha: Uint8Array | undefined,
	captureHeatmap: boolean,
): V6FrameResult {
	if (frame.width !== priorAlpha.width || frame.height !== priorAlpha.height) {
		throw new Error("Frame and prior alpha dimensions do not match.");
	}
	if (frame.width !== chromaAlpha.width || frame.height !== chromaAlpha.height) {
		throw new Error("Frame and chroma alpha dimensions do not match.");
	}
	const width = frame.width;
	const height = frame.height;
	const pixelCount = width * height;
	const keyColor = parseRgbColor(settings.keyColor);
	const distanceCap = Math.max(settings.fringeRadius, settings.coreProjectionBand, settings.leafEdgeBand);
	const distancesToTransparent = distanceToTransparent(priorAlpha, settings.transparentCutoff, distanceCap);
	const chromaDistancesToTransparent = distanceToTransparent(
		chromaAlpha,
		settings.transparentCutoff,
		settings.leafEdgeBand + settings.leafInteriorMinDistance + 2,
	);
	const subjectMask = new Uint8Array(pixelCount);
	const coreMask = new Uint8Array(pixelCount);
	const sureBackgroundMask = new Uint8Array(pixelCount);
	const foregroundEvidenceMask = new Uint8Array(pixelCount);
	const subjectRefSeedMask = new Uint8Array(pixelCount);
	const detachedRefSeedMask = new Uint8Array(pixelCount);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const prior = priorAlpha.data[pixel];
		if (prior > settings.subjectAlphaThreshold) {
			subjectMask[pixel] = 1;
		}
		if (prior >= settings.coreAlphaThreshold && distancesToTransparent[pixel] > settings.fringeRadius) {
			coreMask[pixel] = 1;
			subjectRefSeedMask[pixel] = 1;
		}
		if (prior > settings.transparentCutoff || chromaAlpha.data[pixel] > settings.chromaTransparentCutoff) {
			foregroundEvidenceMask[pixel] = 1;
		}
		if (prior <= settings.transparentCutoff && chromaAlpha.data[pixel] <= settings.chromaTransparentCutoff) {
			sureBackgroundMask[pixel] = 1;
		}
		if (chromaAlpha.data[pixel] >= CHROMA_OPAQUE_MIN) {
			const offset = pixel * 3;
			const dominance = keyDominance(frame.data[offset], frame.data[offset + 1], frame.data[offset + 2], keyColor);
			if (dominance <= REF_SEED_MAX_KEY_DOMINANCE) {
				if (prior > settings.subjectAlphaThreshold) {
					subjectRefSeedMask[pixel] = 1;
				} else if (prior <= settings.transparentCutoff) {
					detachedRefSeedMask[pixel] = 1;
				}
			}
		}
	}
	const distancesToSubject = chamferDistanceToMask(subjectMask, width, height, settings.guardRadius + settings.leafGateRamp);
	// Distance to the prior core disambiguates why the prior is soft: near a core the
	// softness is genuine partial coverage at a thick structure's edge (tangent bands,
	// glows), far from any core it is blur over thin structure (strands). Upward
	// color-line corrections - and observational reference seeds, whose key-freeness
	// cannot be verified for key-channel-dominant foregrounds - are only trusted in
	// the latter regime. Near cores, only genuine core pixels seed references.
	const distancesToCore = chamferDistanceToMask(coreMask, width, height, settings.coreProjectionBand + 1);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		if (subjectRefSeedMask[pixel] === 1 && coreMask[pixel] === 0 && distancesToCore[pixel] <= settings.coreProjectionBand) {
			subjectRefSeedMask[pixel] = 0;
		}
	}
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		if (
			distancesToSubject[pixel] > settings.guardRadius
			&& chromaAlpha.data[pixel] >= settings.leafAlphaFloor
			&& priorAlpha.data[pixel] <= settings.transparentCutoff
			&& chromaDistancesToTransparent[pixel] >= settings.leafInteriorMinDistance
		) {
			detachedRefSeedMask[pixel] = 1;
		}
	}
	const subjectRef = fillInwardCoreColors(frame, subjectRefSeedMask, settings.fringeRadius + 12);
	// Pixels just outside detected foreground carry sub-threshold contamination
	// (soft halos under the chroma keyer's detection floor), so background evidence
	// must keep clearance from foreground evidence or the plate inherits the halo
	// and the color line collapses to "already background".
	const bgClearance = settings.leafEdgeBand + 2;
	const distancesToForeground = chamferDistanceToMask(foregroundEvidenceMask, width, height, bgClearance + 1);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		if (sureBackgroundMask[pixel] === 1 && distancesToForeground[pixel] <= bgClearance) {
			sureBackgroundMask[pixel] = 0;
		}
	}
	// Matting-equation recovery needs a background estimate under every soft pixel,
	// and the frontier fill does O(pixels) total work regardless of the iteration
	// cap, so v7 fills the plate to closure instead of stopping at a fixed band.
	const bgPlate = fillOutwardBackgroundPlate(frame, sureBackgroundMask, Math.max(settings.bgPlateIterations, width + height));
	const detachedRef = fillInwardCoreColors(frame, detachedRefSeedMask, settings.leafEdgeBand + DETACHED_REF_FILL_EXTRA);
	const rgba = Buffer.alloc(pixelCount * 4);
	const spillHeatmap = captureHeatmap ? new Uint8Array(pixelCount) : undefined;
	let alphaSum = 0;
	let priorSum = 0;
	let leafAddedSum = 0;
	let corePixels = 0;
	let fringePixels = 0;
	let projectedPixels = 0;
	let spillSum = 0;
	let spillCount = 0;
	let detachedFidelitySum = 0;
	let detachedFidelityCount = 0;
	let temporalAlphaDeltaSum = 0;
	let temporalAlphaCount = 0;
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const rgbOffset = pixel * 3;
		const rgbaOffset = pixel * 4;
		const prior = priorAlpha.data[pixel];
		priorSum += prior;
		const r = frame.data[rgbOffset];
		const g = frame.data[rgbOffset + 1];
		const b = frame.data[rgbOffset + 2];
		const bgFilled = bgPlate.filled[pixel] === 1;
		const bgR = bgFilled ? bgPlate.colors[rgbOffset] : r;
		const bgG = bgFilled ? bgPlate.colors[rgbOffset + 1] : g;
		const bgB = bgFilled ? bgPlate.colors[rgbOffset + 2] : b;
		if (prior > settings.transparentCutoff) {
			const isCore = coreMask[pixel] === 1;
			let outR = r;
			let outG = g;
			let outB = b;
			let outAlpha = isCore ? 255 : prior;
			if (isCore) {
				const bandDistance = distancesToTransparent[pixel];
				if (bandDistance <= settings.coreProjectionBand) {
					const bandWeight = 1 - Math.max(0, bandDistance - settings.fringeRadius) / Math.max(1, settings.coreProjectionBand - settings.fringeRadius);
					const projected = projectDecontaminate(
						r,
						g,
						b,
						subjectRef.colors[rgbOffset],
						subjectRef.colors[rgbOffset + 1],
						subjectRef.colors[rgbOffset + 2],
						bgR,
						bgG,
						bgB,
						smoothStep(bandWeight),
					);
					outR = projected.r;
					outG = projected.g;
					outB = projected.b;
					if (projected.t > 0) {
						projectedPixels += 1;
					}
				}
				corePixels += 1;
			} else {
				fringePixels += 1;
				const refFilled = subjectRef.filled[pixel] === 1;
				let lineConfidence = 0;
				if (refFilled && bgFilled) {
					const estimate = estimateColorLineAlpha(
						r,
						g,
						b,
						subjectRef.colors[rgbOffset],
						subjectRef.colors[rgbOffset + 1],
						subjectRef.colors[rgbOffset + 2],
						bgR,
						bgG,
						bgB,
					);
					// Raising is safe wherever the prior's softness is explained by blur
					// around a hard opacity boundary (the band near prior-transparent
					// pixels). Wide soft interiors (smoke, glows) sit beyond that band
					// and keep the prior as their alpha ceiling.
					const allowRaise = distancesToTransparent[pixel] <= settings.fringeRadius;
					outAlpha = fuseAlphaWithColorLine(prior, estimate, allowRaise);
					lineConfidence = estimate.confidence;
				}
				// RGB repair: matting recovery is exact when the fused alpha is right,
				// which is the case when either the color-line model held (confident
				// estimate corrected/confirmed the prior) or no reference exists at all
				// (pure soft regions where the prior is authoritative). When a reference
				// exists but the two-color model broke down (three-color mixes such as a
				// particle overlapping the subject edge), the prior is unreliable there
				// too, so fall back to v6's alpha-independent edge projection.
				const useRecovery = bgFilled && (lineConfidence >= 0.5 || !refFilled);
				if (useRecovery) {
					const recovered = recoverForegroundRgb(r, g, b, bgR, bgG, bgB, outAlpha / 255, FG_RECOVERY_MAX_GAIN);
					if (recovered.r !== r || recovered.g !== g || recovered.b !== b) {
						projectedPixels += 1;
					}
					outR = recovered.r;
					outG = recovered.g;
					outB = recovered.b;
				} else if (refFilled) {
					const distanceWeight = distancesToTransparent[pixel] <= settings.fringeRadius
						? 1 - Math.max(0, distancesToTransparent[pixel] - 1) / Math.max(1, settings.fringeRadius)
						: 0;
					const partialWeight = prior < settings.coreAlphaThreshold
						? 1 - prior / Math.max(1, settings.coreAlphaThreshold)
						: 0;
					const edgeWeight = smoothStep(Math.max(distanceWeight, partialWeight));
					const projected = projectDecontaminate(
						r,
						g,
						b,
						subjectRef.colors[rgbOffset],
						subjectRef.colors[rgbOffset + 1],
						subjectRef.colors[rgbOffset + 2],
						bgR,
						bgG,
						bgB,
						edgeWeight,
					);
					outR = projected.r;
					outG = projected.g;
					outB = projected.b;
					if (projected.t > 0) {
						projectedPixels += 1;
					}
				}
			}
			rgba[rgbaOffset] = outR;
			rgba[rgbaOffset + 1] = outG;
			rgba[rgbaOffset + 2] = outB;
			rgba[rgbaOffset + 3] = outAlpha;
			alphaSum += outAlpha;
			if (outAlpha > 0) {
				const refR = subjectRef.filled[pixel] === 1 ? subjectRef.colors[rgbOffset] : r;
				const refG = subjectRef.filled[pixel] === 1 ? subjectRef.colors[rgbOffset + 1] : g;
				const refB = subjectRef.filled[pixel] === 1 ? subjectRef.colors[rgbOffset + 2] : b;
				const spill = Math.max(0, keyDominance(outR, outG, outB, keyColor) - keyDominance(refR, refG, refB, keyColor));
				spillSum += spill;
				spillCount += 1;
				if (spillHeatmap) {
					spillHeatmap[pixel] = clampByte(spill * 4);
				}
			}
			if (previousAlpha && subjectMask[pixel] === 1) {
				temporalAlphaDeltaSum += Math.abs(outAlpha - previousAlpha[pixel]);
				temporalAlphaCount += 1;
			}
			continue;
		}
		const guardDistance = distancesToSubject[pixel];
		const distanceGate = guardDistance > settings.guardRadius
			? smoothStep((guardDistance - settings.guardRadius) / settings.leafGateRamp)
			: 0;
		let colorGate = 0;
		if (bgFilled) {
			const bgDistance = Math.sqrt(colorDistanceSquared(r, g, b, { b: bgB, g: bgG, r: bgR }));
			colorGate = smoothStep((bgDistance - DETACHED_EVIDENCE_MIN) / (DETACHED_EVIDENCE_FULL - DETACHED_EVIDENCE_MIN));
		}
		const gate = Math.max(distanceGate, colorGate);
		if (gate > 0) {
			let physicalAlpha = chromaAlpha.data[pixel];
			if (detachedRef.filled[pixel] === 1 && bgFilled) {
				const estimate = estimateColorLineAlpha(
					r,
					g,
					b,
					detachedRef.colors[rgbOffset],
					detachedRef.colors[rgbOffset + 1],
					detachedRef.colors[rgbOffset + 2],
					bgR,
					bgG,
					bgB,
				);
				const inThinBand = chromaDistancesToTransparent[pixel] <= settings.leafEdgeBand;
				physicalAlpha = fuseAlphaWithColorLine(physicalAlpha, estimate, inThinBand);
			}
			const leafAlpha = clampByte(physicalAlpha * gate);
			if (leafAlpha > settings.leafAlphaFloor) {
				let outR = r;
				let outG = g;
				let outB = b;
				if (bgFilled) {
					const recovered = recoverForegroundRgb(r, g, b, bgR, bgG, bgB, physicalAlpha / 255, FG_RECOVERY_MAX_GAIN);
					if (recovered.r !== r || recovered.g !== g || recovered.b !== b) {
						projectedPixels += 1;
					}
					outR = recovered.r;
					outG = recovered.g;
					outB = recovered.b;
				} else if (chromaDistancesToTransparent[pixel] <= settings.leafEdgeBand && detachedRef.filled[pixel] === 1) {
					const edgeWeight = 1 - smoothStep(chromaDistancesToTransparent[pixel] / Math.max(1, settings.leafEdgeBand));
					const projected = projectDecontaminate(
						r,
						g,
						b,
						detachedRef.colors[rgbOffset],
						detachedRef.colors[rgbOffset + 1],
						detachedRef.colors[rgbOffset + 2],
						bgR,
						bgG,
						bgB,
						edgeWeight,
					);
					outR = projected.r;
					outG = projected.g;
					outB = projected.b;
					if (projected.t > 0) {
						projectedPixels += 1;
					}
				}
				if (
					chromaDistancesToTransparent[pixel] > settings.leafEdgeBand
					&& chromaAlpha.data[pixel] >= 180
				) {
					const dr = outR - r;
					const dg = outG - g;
					const db = outB - b;
					detachedFidelitySum += Math.sqrt(dr * dr + dg * dg + db * db);
					detachedFidelityCount += 1;
				}
				rgba[rgbaOffset] = outR;
				rgba[rgbaOffset + 1] = outG;
				rgba[rgbaOffset + 2] = outB;
				rgba[rgbaOffset + 3] = leafAlpha;
				alphaSum += leafAlpha;
				leafAddedSum += leafAlpha;
				if (leafAlpha > 0 && spillHeatmap) {
					spillHeatmap[pixel] = clampByte(Math.max(0, keyDominance(outR, outG, outB, keyColor)) * 2);
				}
				continue;
			}
		}
		rgba[rgbaOffset] = 0;
		rgba[rgbaOffset + 1] = 0;
		rgba[rgbaOffset + 2] = 0;
		rgba[rgbaOffset + 3] = 0;
	}
	return {
		alphaCoverage: alphaSum / (pixelCount * 255),
		coreCoverage: corePixels / pixelCount,
		data: rgba,
		detachedColorFidelity: detachedFidelityCount === 0 ? 0 : detachedFidelitySum / detachedFidelityCount,
		fringeCoverage: fringePixels / pixelCount,
		leafAddedCoverage: leafAddedSum / (pixelCount * 255),
		priorCoverage: priorSum / (pixelCount * 255),
		projectedCoverage: projectedPixels / pixelCount,
		residualSpill: spillCount === 0 ? 0 : spillSum / spillCount,
		spillHeatmap,
		temporalAlphaDelta: temporalAlphaCount === 0 ? 0 : temporalAlphaDeltaSum / temporalAlphaCount,
	};
}
