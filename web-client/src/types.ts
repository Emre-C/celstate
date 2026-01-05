/**
 * Shared types for Celstate Web Client
 */

export interface ManifestIntrinsics {
    content_zones: {
        inset_top: number;
        inset_right: number;
        inset_bottom: number;
        inset_left: number;
        [key: string]: any;
    };
    slice_insets: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    safe_zone: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    layout_bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

export interface ManifestStates {
    idle: {
        clip: string;
    };
}

export interface ComponentManifest {
    intrinsics: ManifestIntrinsics;
    states: ManifestStates;
    // Optional variants for multi-size support (Server-side variants within one job)
    variants?: Record<string, {
        intrinsics: ManifestIntrinsics;
        states: ManifestStates;
        optimization?: {
            target_width?: number;
            target_height?: number;
        };
    }>;
}

/**
 * SmartAsset Interface
 * Matches the JSON structure returned by the Celstate API
 */
export interface SmartAsset {
    manifest: {
        intrinsics: ManifestIntrinsics;
        assets: {
            image_final: string;
            [key: string]: string;
        };
    };
}

export interface SizeHint {
    width?: number;
    height?: number;
}

export type JobIdentifier = string | {
    small?: string;
    medium?: string;
    large?: string;
    [key: string]: string | undefined;
};
