<script lang="ts">
	let { text }: { text: string } = $props();
</script>

<p class="font-mono text-xs tracking-[0.15em] uppercase text-dim">
	<span class="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent"></span>
	{text}
</p>
