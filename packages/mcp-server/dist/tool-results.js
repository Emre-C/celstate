export const READ_ONLY_TOOL_ANNOTATIONS = {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true,
};
export const GENERATE_TOOL_ANNOTATIONS = {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
};
export function createTextResult(text) {
    return {
        content: [{ type: "text", text }],
    };
}
export function createErrorResult(text) {
    return {
        content: [{ type: "text", text }],
        isError: true,
    };
}
export function getErrorMessage(error) {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return "Unknown error";
}
export function truncateText(value, maxLength) {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength)}…`;
}
