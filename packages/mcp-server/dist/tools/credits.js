import { createTextResult, READ_ONLY_TOOL_ANNOTATIONS, } from "../tool-results.js";
export function registerCreditsTools(server, context) {
    server.registerTool("celstate_check_credits", {
        annotations: READ_ONLY_TOOL_ANNOTATIONS,
        description: "Check how many image generation credits the user has remaining. Each generation costs 1 credit.",
        title: "Check credits",
    }, async () => {
        return createTextResult(`Credits remaining: ${context.user.credits ?? 0}`);
    });
}
