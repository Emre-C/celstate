import { useState, useEffect, useMemo } from 'react';
import type { SmartAsset, ComponentManifest, SizeHint, JobIdentifier } from '../types';

interface JobData {
    id: string;
    status: string;
    component: {
        manifest: ComponentManifest;
    } | null;
}

interface UseJobAssetResult {
    asset: SmartAsset | null;
    loading: boolean;
    error: string | null;
}

/**
 * Hook to load a Celstate job and transform it into a SmartAsset.
 * Supports selecting a specific variant based on size hints.
 * 
 * @param jobIdentifier - The UUID of the job to load, OR a map of { size: uuid } variants
 * @param sizeHint - Optional target dimensions to select the best variant
 * @returns Object containing the asset, loading state, and any error
 */
export function useJobAsset(jobIdentifier: JobIdentifier | undefined, sizeHint?: SizeHint): UseJobAssetResult {
    const [asset, setAsset] = useState<SmartAsset | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    // Resolve the specific Job ID to load based on the identifier type and size hint
    const activeJobId = useMemo(() => {
        if (!jobIdentifier) return undefined;

        if (typeof jobIdentifier === 'string') {
            return jobIdentifier;
        }

        // It's a client-side variant map
        const width = sizeHint?.width || 0;

        // Breakpoints based on generated asset hints (80, 160, 300)
        // Midpoints: (80+160)/2 = 120, (160+300)/2 = 230

        if (width > 0) {
            if (width < 120 && jobIdentifier.small) return jobIdentifier.small;
            if (width < 230 && jobIdentifier.medium) return jobIdentifier.medium;
            if (jobIdentifier.large) return jobIdentifier.large;
        }

        // Fallbacks if no size hint or specific match
        return jobIdentifier.medium || jobIdentifier.large || jobIdentifier.small || Object.values(jobIdentifier)[0];
    }, [jobIdentifier, sizeHint?.width]);

    useEffect(() => {
        if (!activeJobId) {
            setAsset(null);
            setLoading(false);
            setError(null);
            return;
        }

        let cancelled = false;

        async function loadJob() {
            console.log(`[useJobAsset] Starting fetch for job: ${activeJobId}`);
            const startTime = performance.now();
            setLoading(true);
            setError(null);
            // CRITICAL FIX: Do NOT clear asset here. Keep the stale asset visible while loading the new one.
            // setAsset(null); 

            try {
                // Fetch the job.json from the jobs directory (symlinked in public/)
                const response = await fetch(`/jobs/${activeJobId}/job.json`);

                if (!response.ok) {
                    throw new Error(`Failed to load job: ${response.status} ${response.statusText}`);
                }

                const jobData: JobData = await response.json();

                if (cancelled) return;

                // Check if the job succeeded and has component data
                if (jobData.status !== 'succeeded' || !jobData.component) {
                    throw new Error(`Job ${activeJobId} has no valid component data (status: ${jobData.status})`);
                }

                let { manifest } = jobData.component;
                let selectedManifest = manifest;

                // Server-side Variant selection logic (for single-job variants)
                if (sizeHint && manifest.variants) {
                    let bestVariantKey: string | null = null;
                    let minDiff = Infinity;

                    for (const [key, variant] of Object.entries(manifest.variants)) {
                        // Simple logic: Minimize area difference or width difference
                        // Here we prioritize width matching if provided
                        const variantWidth = variant.intrinsics.layout_bounds.width;
                        const targetWidth = sizeHint.width || variantWidth;

                        const diff = Math.abs(variantWidth - targetWidth);

                        if (diff < minDiff) {
                            minDiff = diff;
                            bestVariantKey = key;
                        }
                    }

                    if (bestVariantKey) {
                        console.log(`[useJobAsset] Selected server-side variant: ${bestVariantKey} for job ${activeJobId}`);
                        // Merge the variant into the selected manifest structure
                        selectedManifest = {
                            ...manifest,
                            intrinsics: manifest.variants[bestVariantKey].intrinsics,
                            states: manifest.variants[bestVariantKey].states,
                        };
                    }
                }

                const { intrinsics } = selectedManifest;

                // Resolve the asset filename from the idle state
                // Fallback to manifest.states if selectedManifest (variant) states are missing/invalid
                const states = selectedManifest.states || manifest.states;
                const assetFilename = states.idle.clip;

                // Transform into SmartAsset format
                const smartAsset: SmartAsset = {
                    manifest: {
                        intrinsics: {
                            content_zones: intrinsics.content_zones as SmartAsset['manifest']['intrinsics']['content_zones'],
                            slice_insets: intrinsics.slice_insets,
                            safe_zone: intrinsics.safe_zone,
                            layout_bounds: intrinsics.layout_bounds,
                        },
                        assets: {
                            // Resolve to the full path in the outputs directory
                            image_final: `/jobs/${activeJobId}/outputs/${assetFilename}`,
                        },
                    },
                };

                const endTime = performance.now();
                console.log(`[useJobAsset] Successfully loaded job ${activeJobId} in ${(endTime - startTime).toFixed(1)}ms`);
                setAsset(smartAsset);
                setError(null);
            } catch (err) {
                if (cancelled) return;
                console.error(`[useJobAsset] Error loading job ${activeJobId}:`, err);
                setError(err instanceof Error ? err.message : 'Unknown error loading job');
                setAsset(null);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        loadJob();

        return () => {
            console.log(`[useJobAsset] Cancelling fetch for job: ${activeJobId}`);
            cancelled = true;
        };
    }, [activeJobId]);

    return { asset, loading, error };
}
