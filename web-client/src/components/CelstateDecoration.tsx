import React, { type CSSProperties } from 'react';
import { useJobAsset } from '../hooks/useJobAsset';

interface CelstateDecorationProps {
    jobId: string;
    anchor?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center-bottom' | 'center-top' | 'center';
    offset?: { x?: number; y?: number };
    className?: string;
    style?: CSSProperties;
    scale?: number;
    /**
     * Optional width/height override to force a specific size,
     * though typically decorations should be native resolution.
     */
    width?: number | string;
    height?: number | string;
    initialWidth?: number;
    initialHeight?: number;
}

/**
 * CelstateDecoration
 * 
 * Renders a Celstate asset as an anchored decoration (e.g. valid "sticker" model).
 * Does not use 9-slice scaling. Renders at native resolution or simple scale.
 */
export const CelstateDecoration: React.FC<CelstateDecorationProps> = ({
    jobId,
    anchor = 'top-right',
    offset = { x: 0, y: 0 },
    className = '',
    style = {},
    scale = 1,
    width,
    height,
}) => {
    const { asset, loading } = useJobAsset(jobId);

    if (loading || !asset) {
        return null;
    }

    const { assets, intrinsics } = asset.manifest;

    // Determine anchor positioning
    const anchorStyle: CSSProperties = {
        position: 'absolute',
        zIndex: 10,
        pointerEvents: 'none', // Decorations shouldn't block clicks by default
        ...style,
    };

    // Apply anchor logic
    switch (anchor) {
        case 'top-left':
            anchorStyle.top = 0;
            anchorStyle.left = 0;
            break;
        case 'top-right':
            anchorStyle.top = 0;
            anchorStyle.right = 0;
            break;
        case 'bottom-left':
            anchorStyle.bottom = 0;
            anchorStyle.left = 0;
            break;
        case 'bottom-right':
            anchorStyle.bottom = 0;
            anchorStyle.right = 0;
            break;
        case 'center-top':
            anchorStyle.top = 0;
            anchorStyle.left = '50%';
            // translate X handled below
            break;
        case 'center-bottom':
            anchorStyle.bottom = 0;
            anchorStyle.left = '50%';
            // translate X handled below
            break;
        case 'center':
            anchorStyle.top = '50%';
            anchorStyle.left = '50%';
            // translate X/Y handled below
            break;
    }

    // Compose transforms
    const transforms: string[] = [];

    // Centering adjustments
    if (anchor === 'center') {
        transforms.push('translate(-50%, -50%)');
    } else if (anchor === 'center-top' || anchor === 'center-bottom') {
        transforms.push('translate(-50%, 0)');
    }

    // Offset
    if (offset.x || offset.y) {
        transforms.push(`translate(${offset.x || 0}px, ${offset.y || 0}px)`);
    }

    // Scale
    if (scale !== 1) {
        transforms.push(`scale(${scale})`);
    }

    if (transforms.length > 0) {
        anchorStyle.transform = transforms.join(' ');
    }

    // If explicit width/height not provided, use intrinsic layout bounds
    const finalWidth = width ?? intrinsics.layout_bounds.width;
    const finalHeight = height ?? intrinsics.layout_bounds.height;

    return (
        <img
            src={assets.image_final}
            alt={`decoration-${jobId}`}
            style={{
                ...anchorStyle,
                width: finalWidth,
                height: finalHeight,
            }}
            className={`celstate-decoration ${className}`}
        />
    );
};
