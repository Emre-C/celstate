import { logToolResult } from "../logging.js";
import { createTextResult, READ_ONLY_TOOL_ANNOTATIONS, } from "../tool-results.js";
export function registerCreditsTools(server, context) {
    server.registerTool("celstate_check_credits", {
        annotations: READ_ONLY_TOOL_ANNOTATIONS,
        description: "Check how many image generation credits the user has remaining. Each generation costs 1 credit.",
        title: "Check credits",
    }, async () => {
        logToolResult(context, "celstate_check_credits", "succeeded", {
            creditsRemaining: context.user.credits ?? 0,
        });
        return createTextResult(`Credits remaining: ${context.user.credits ?? 0}`);
    });
}
