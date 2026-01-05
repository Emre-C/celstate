import React, { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useJobAsset } from '../hooks/useJobAsset';
import type { JobIdentifier, SmartAsset, SizeHint } from '../types';

export type { SmartAsset };

interface CelstateContainerProps {
    jobId?: JobIdentifier; // Pass ID or Variants map here for auto-fetching
    asset?: SmartAsset; // Direct asset injection
    children?: React.ReactNode;
    className?: string;
    style?: CSSProperties;
    initialWidth?: number;
}

export const CelstateContainer: React.FC<CelstateContainerProps> = ({
    jobId,
    asset: propAsset,
    children,
    className = "",
    style = {},
    initialWidth
}) => {
    // 1. Measure the container size to provide hints for variant selection
    const containerRef = useRef<HTMLDivElement>(null);
    const [sizeHint, setSizeHint] = useState<SizeHint>({ width: initialWidth });

    useEffect(() => {
        if (!containerRef.current) return;

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                // CRITICAL FIX: Use borderBoxSize instead of contentRect.
                // Our component applies dynamic border-width (slice_insets).
                // If we measure contentRect, adding borders shrinks it -> triggers resize -> triggers reload -> removes borders -> grows it -> infinite loop.
                // BorderBoxSize is stable because it includes the borders.
                if (entry.borderBoxSize && entry.borderBoxSize.length > 0) {
                    setSizeHint({
                        width: entry.borderBoxSize[0].inlineSize,
                        height: entry.borderBoxSize[0].blockSize
                    });
                } else {
                    // Fallback for older browsers
                    const rect = entry.target.getBoundingClientRect();
                    setSizeHint({
                        width: rect.width,
                        height: rect.height
                    });
                }
            }
        });

        observer.observe(containerRef.current, { box: 'border-box' });
        return () => observer.disconnect();
    }, []);

    // 2. Fetch Asset if jobId is provided (and not explicitly passed via prop)
    const { asset: fetchedAsset, loading, error } = useJobAsset(propAsset ? undefined : jobId, sizeHint);

    const asset = propAsset || fetchedAsset;

    // 3. Render Skeleton or Loading State if needed
    if (!asset) {
        // If we are loading and have a jobId, show loading state
        // If we just don't have an asset yet (and are measuring), render the wrapper to allow measurement

        return (
            <div
                ref={containerRef}
                className={`flex items-center justify-center bg-gray-50/50 rounded-lg ${className}`}
                style={{
                    ...style,
                    minHeight: style.minHeight || '32px',
                    width: '100%',
                    height: '100%'
                }} // Ensure constant size for measurement
            >
                {loading ? (
                    <span className="text-[10px] text-gray-400">Loading...</span>
                ) : error ? (
                    <span className="text-[10px] text-red-300 pointer-events-none" title={error}>!</span>
                ) : (
                    // Just render children if no asset, or waiting for measurement
                    // If children exist, they give size.
                    <div style={{ opacity: 0.5 }}>{children}</div>
                )}
            </div>
        );
    }

    const { intrinsics } = asset.manifest;
    const { assets } = asset.manifest;
    const { slice_insets } = intrinsics;

    // 9-Slice Style Construction
    const containerStyle: CSSProperties = {
        ...style,
        display: 'flex',
        position: 'relative',
        // 9-Slice Logic
        borderStyle: 'solid',
        borderWidth: `${slice_insets.top}px ${slice_insets.right}px ${slice_insets.bottom}px ${slice_insets.left}px`,
        borderImageSource: `url(${assets.image_final})`,
        borderImageSlice: `${slice_insets.top} ${slice_insets.right} ${slice_insets.bottom} ${slice_insets.left} fill`,
        borderImageWidth: 'auto', // Or strict px values if needed
        borderImageRepeat: 'stretch', // Or 'round' for textures
        backgroundColor: 'transparent',
        boxSizing: 'border-box',
        width: '100%',
        height: '100%',
    };

    // Safe Zone Calculation with Smart Fallback
    const { layout_bounds, safe_zone } = intrinsics;

    // HEURISTIC: If safe_zone covers > 90% of the area, it's likely a fallback LIR that included transparent edges.
    // In this case, we TRUST the Slice Insets as the "Structural Safe Zone".
    const totalArea = layout_bounds.width * layout_bounds.height;
    const safeArea = safe_zone.width * safe_zone.height;
    const isLazySafeZone = (safeArea / totalArea) > 0.90;

    let finalSafeZone = safe_zone;

    if (isLazySafeZone) {
        // Construct a safe zone that respects the slice insets
        finalSafeZone = {
            x: slice_insets.left,
            y: slice_insets.top,
            width: layout_bounds.width - slice_insets.left - slice_insets.right,
            height: layout_bounds.height - slice_insets.top - slice_insets.bottom,
            _strategy: 'sdk_fallback_insets'
        } as any;
    }

    const safeZoneStyle: CSSProperties = {
        position: 'absolute',
        left: `${(finalSafeZone.x / layout_bounds.width) * 100}%`,
        top: `${(finalSafeZone.y / layout_bounds.height) * 100}%`,
        width: `${(finalSafeZone.width / layout_bounds.width) * 100}%`,
        height: `${(finalSafeZone.height / layout_bounds.height) * 100}%`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
    };

    return (
        <div ref={containerRef} className={`celstate-runtime ${className}`} style={containerStyle}>
            {/* Debug visualization - helpful for verifying safe zones */}
            {/* <div style={{
                ...safeZoneStyle, 
                border: '1px solid rgba(255, 0, 0, 0.5)', 
                background: 'rgba(255, 0, 0, 0.1)' 
            }} /> */}

            <div style={safeZoneStyle}>
                <div style={{ pointerEvents: 'auto', display: 'inherit', alignItems: 'inherit', justifyContent: 'inherit', width: '100%', height: '100%' }}>
                    {children}
                </div>
            </div>
        </div>
    );
};
