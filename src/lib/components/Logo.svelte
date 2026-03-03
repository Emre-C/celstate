<script lang="ts">
	let { class: className = '' } = $props();
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	class={className}
>
	<defs>
		<pattern id="checker-logo" width="4" height="4" patternUnits="userSpaceOnUse">
			<rect width="2" height="2" fill="currentColor" fill-opacity="0.2" />
			<rect x="2" y="2" width="2" height="2" fill="currentColor" fill-opacity="0.2" />
		</pattern>
	</defs>
	<rect x="4" y="4" width="16" height="16" fill="url(#checker-logo)" />
	<path d="M2 8V2H8" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" />
	<path d="M22 8V2H16" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" />
	<path d="M2 16V22H8" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" />
	<path d="M22 16V22H16" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" />
</svg>
