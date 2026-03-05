export function buildWhiteBgPrompt(userPrompt: string): string {
  return `${userPrompt}.

The subject is centered with comfortable margins from all edges.
The background is pure solid white (#FFFFFF).
No shadows cast onto the background. No gradients. No textures.
No ground plane. The subject floats against a perfectly flat white field.`;
}

export function buildBlackBgPrompt(): string {
  return `Now regenerate the exact same subject — identical in every detail: same pose, same proportions, same colors, same lighting on the subject, same angle, same level of detail. The ONLY change is the background, which must now be pure solid black (#000000). No shadows cast onto the background. No reflections. No gradients. The subject floats against a perfectly flat black field. Everything about the subject itself must be pixel-identical to the previous image.`;
}

export function buildWhiteBgRetryPrompt(userPrompt: string): string {
  return `${userPrompt}.

The subject is centered with comfortable margins from all edges.
The background MUST be pure white #FFFFFF with absolutely no texture, shadow, or gradient. The entire background area must be a single flat color.
No shadows cast onto the background. No gradients. No textures.
No ground plane. The subject floats against a perfectly flat white field.`;
}

export function buildBlackBgRetryPrompt(): string {
  return `Regenerate the exact same subject — identical in every detail: same pose, same proportions, same colors, same lighting on the subject, same angle, same level of detail. The ONLY change is the background, which MUST be pure solid black #000000 with absolutely no texture, shadow, reflection, or gradient. The entire background area must be a single flat color. The subject floats against a perfectly flat black field. Everything about the subject itself must be pixel-identical to the previous image.`;
}
