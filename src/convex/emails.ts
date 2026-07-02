import { v } from "convex/values";
import { components, internal } from "./_generated/api.js";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
} from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";
import { Resend, vOnEmailEventArgs, type EmailId } from "@convex-dev/resend";
import { posthog } from "./posthog.js";
import {
  readOpsAlertRuntimeConfig,
  sendOpsWebhook,
} from "./lib/ops.js";
import { applyCreditsToUser } from "./users.js";

const MAX_WELCOME_EMAIL_ATTEMPTS = 3;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailLayout(subject: string, greeting: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#F5F3ED;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1917;line-height:1.6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F3ED;padding:24px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#efede5;border-radius:4px;overflow:hidden;border:1px solid #e7e5e4;max-width:560px;">
          <tr>
            <td style="padding:32px 40px 24px 40px;">
              <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1c1917;">${greeting}</h1>
${bodyHtml}
            </td>
          </tr>
          ${emailFooter(emailEnvConfig.appUrl)}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function generateUnsubscribeToken(email: string): Promise<string> {
  const secret = process.env.EMAIL_HMAC_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "EMAIL_HMAC_SECRET is not set — cannot generate unsubscribe tokens",
    );
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(email),
  );
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

interface EmailEnvConfig {
  testMode: boolean;
  fromAddress: string;
  appUrl: string;
}

function readEmailEnvConfig(
  env: Record<string, string | undefined> = process.env,
): EmailEnvConfig {
  const siteUrl = env.SITE_URL?.trim() || "https://celstate.com";
  const fromAddress =
    env.RESEND_FROM_ADDRESS?.trim() ||
    "Celstate <hello@contact.celstate.com>";

  // In non-production deployments, suppress real email sends so dev/staging
  // never delivers to real user inboxes. RESEND_TEST_MODE can force either
  // state; otherwise we infer from NODE_ENV or the deployment URL.
  const explicitTestMode = env.RESEND_TEST_MODE?.trim().toLowerCase();
  let testMode: boolean;
  if (explicitTestMode === "true") {
    testMode = true;
  } else if (explicitTestMode === "false") {
    testMode = false;
  } else {
    testMode = env.NODE_ENV?.trim() !== "production";
  }

  return {
    testMode,
    fromAddress,
    appUrl: siteUrl.replace(/\/+$/, ""),
  };
}

const emailEnvConfig = readEmailEnvConfig();

export const resend: Resend = new Resend(components.resend, {
  testMode: emailEnvConfig.testMode,
  onEmailEvent: internal.emails.handleEmailEvent,
});

function emailFooter(appUrl: string): string {
  return `          <tr>
            <td style="padding:20px 40px;background-color:#F5F3ED;border-top:1px solid #e7e5e4;">
              <p style="margin:0 0 8px 0;font-size:12px;color:#78716c;">
                You're receiving this email because you signed up at celstate.com.
              </p>
              <p style="margin:0;font-size:12px;color:#78716c;">
                <a href="${appUrl}/unsubscribe?email={EMAIL}&token={TOKEN}" style="color:#78716c;text-decoration:underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>`;
}

export const handleEmailEvent = internalMutation({
  args: vOnEmailEventArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const { event, id: componentEmailId } = args;
    const eventType = event.type;

    console.log(`[emails] Resend event: ${eventType} for email ${componentEmailId}`);

    // Capture delivery events to PostHog for analytics.
    const posthogEventMap: Record<string, string> = {
      "email.sent": "email_sent",
      "email.delivered": "email_delivered",
      "email.bounced": "email_bounced",
      "email.complained": "email_complained",
      "email.failed": "email_failed",
      "email.delivery_delayed": "email_delivery_delayed",
      "email.opened": "email_opened",
      "email.clicked": "email_clicked",
    };

    const posthogEvent = posthogEventMap[eventType];
    if (posthogEvent) {
      const recipient = Array.isArray(event.data.to)
        ? event.data.to.join(",")
        : event.data.to;

      // Join to the user and scenario via the emailEvent record so delivery
      // events (opens, clicks, bounces) can be attributed in per-scenario
      // PostHog funnels.
      const emailEvent = await ctx.db
        .query("emailEvents")
        .withIndex("by_component_email_id", (q) =>
          q.eq("componentEmailId", componentEmailId),
        )
        .first();

      await posthog.capture(ctx, {
        distinctId: emailEvent?.userId
          ? String(emailEvent.userId)
          : componentEmailId,
        event: posthogEvent,
        properties: {
          component_email_id: componentEmailId,
          resend_email_id: event.data.email_id,
          recipient,
          subject: event.data.subject,
          ...(emailEvent?.scenario
            ? { scenario: emailEvent.scenario }
            : {}),
        },
      });
    }

    // Alert on bounce/complaint/failure — these threaten deliverability.
    const alertingEvents = new Set([
      "email.bounced",
      "email.complained",
      "email.failed",
    ]);

    if (alertingEvents.has(eventType)) {
      const opsConfig = readOpsAlertRuntimeConfig();
      if (opsConfig.webhookUrl) {
        const recipient = Array.isArray(event.data.to)
          ? event.data.to.join(",")
          : event.data.to;
        const detail =
          eventType === "email.bounced"
            ? `bounce: ${event.data.bounce.type} — ${event.data.bounce.message}`
            : eventType === "email.failed"
              ? `failed: ${event.data.failed.reason}`
              : "complained";

        const result = await sendOpsWebhook(
          {
            url: opsConfig.webhookUrl,
            body: JSON.stringify({
              type: "email_delivery_alert",
              event: eventType,
              recipient,
              subject: event.data.subject,
              componentEmailId,
              resendEmailId: event.data.email_id,
              detail,
              timestamp: event.created_at,
            }),
            headers: { "content-type": "application/json" },
          },
          {
            onError: (error) =>
              console.error("Failed to send email delivery alert", error),
          },
        );

        try {
          await ctx.runMutation(internal.ops.recordOpsAlertEvent, {
            alertType: "email_delivery_alert",
            outcome: result.ok ? "sent" : "failed",
            error: result.ok
              ? undefined
              : result.error instanceof Error
                ? result.error.message
                : String(result.error),
          });
        } catch (recordError) {
          console.error("Failed to record ops alert event", recordError);
        }
      }
    }

    return null;
  },
});

type EmailEventOutcome =
  | { outcome: "sent"; componentEmailId: string }
  | { outcome: "failed"; error: string };

const recordEmailEvent = async (
  ctx: MutationCtx,
  userId: Id<"users">,
  emailType: "welcome",
  recipientEmail: string,
  result: EmailEventOutcome,
  scenario?: string,
) => {
  await ctx.db.insert("emailEvents", {
    userId,
    emailType,
    scenario,
    recipientEmail,
    componentEmailId:
      "componentEmailId" in result ? result.componentEmailId : undefined,
    outcome: result.outcome,
    error: "error" in result ? result.error : undefined,
    createdAt: Date.now(),
  });
};

export const sendWelcomeEmail = internalAction({
  args: {
    userId: v.id("users"),
    email: v.string(),
    name: v.optional(v.string()),
    scenario: v.optional(v.string()),
    subScenario: v.optional(v.string()),
    subject: v.optional(v.string()),
    html: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const subject = args.subject ?? "Welcome to Celstate";
    const token = await generateUnsubscribeToken(args.email);
    const html = (args.html ?? "").replace(
      "{EMAIL}",
      encodeURIComponent(args.email),
    ).replace(
      "{TOKEN}",
      encodeURIComponent(token),
    );
    const scenario = args.scenario ?? "default";
    const subScenario = args.subScenario;
    const listUnsubscribeUrl = `${emailEnvConfig.appUrl}/api/unsubscribe?email=${encodeURIComponent(args.email)}&token=${encodeURIComponent(token)}`;

    try {
      const componentEmailId: EmailId = await resend.sendEmail(ctx, {
        from: emailEnvConfig.fromAddress,
        to: args.email,
        subject,
        html,
        headers: [
          { name: "List-Unsubscribe", value: `<${listUnsubscribeUrl}>` },
          { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
        ],
      });

      await ctx.runMutation(internal.emails.recordEmailSent, {
        userId: args.userId,
        emailType: "welcome",
        scenario,
        recipientEmail: args.email,
        componentEmailId,
      });

      await posthog.capture(ctx, {
        distinctId: String(args.userId),
        event: "welcome_email_sent",
        properties: {
          recipient: args.email,
          scenario,
          ...(subScenario ? { sub_scenario: subScenario } : {}),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[emails] Welcome email failed for ${args.email}: ${message}`);

      await ctx.runMutation(internal.emails.recordEmailFailed, {
        userId: args.userId,
        emailType: "welcome",
        scenario,
        recipientEmail: args.email,
        error: message,
      });
    }

    return null;
  },
});

export const recordEmailSent = internalMutation({
  args: {
    userId: v.id("users"),
    emailType: v.literal("welcome"),
    scenario: v.optional(v.string()),
    recipientEmail: v.string(),
    componentEmailId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordEmailEvent(ctx, args.userId, args.emailType, args.recipientEmail, {
      outcome: "sent",
      componentEmailId: args.componentEmailId,
    }, args.scenario);

    await ctx.db.patch(args.userId, {
      welcomeEmailStatus: "sent",
      welcomeEmailSentAt: Date.now(),
    });

    return null;
  },
});

export const recordEmailFailed = internalMutation({
  args: {
    userId: v.id("users"),
    emailType: v.literal("welcome"),
    scenario: v.optional(v.string()),
    recipientEmail: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordEmailEvent(ctx, args.userId, args.emailType, args.recipientEmail, {
      outcome: "failed",
      error: args.error,
    }, args.scenario);

    const user = await ctx.db.get(args.userId);
    const attempts = (user?.welcomeEmailAttempts ?? 0) + 1;
    const status = attempts >= MAX_WELCOME_EMAIL_ATTEMPTS ? "failed" : "pending";

    await ctx.db.patch(args.userId, {
      welcomeEmailStatus: status,
      welcomeEmailAttempts: attempts,
    });

    return null;
  },
});

// ========== BEHAVIOR-DRIVEN WELCOME EMAIL ==========

export const SCENARIO_1_SUBJECT = "You still have credits waiting";

export function scenario1EmailHtml(name?: string, creditsRemaining?: number): string {
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const creditText = creditsRemaining !== undefined
    ? `You still have ${creditsRemaining} credit${creditsRemaining === 1 ? "" : "s"} left.`
    : "You still have credits left.";

  return emailLayout(SCENARIO_1_SUBJECT, greeting, `              <p style="margin:0 0 16px 0;font-size:15px;color:#44403c;">
                You brought a vision to life with Celstate. What are you
                planning to use it for?
              </p>
              <p style="margin:0 0 24px 0;font-size:15px;color:#44403c;">
                ${creditText} Here are a few ideas that take you in a completely
                different direction:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="padding:14px 16px;background-color:#F5F3ED;border-radius:4px;border-left:3px solid #C2410C;font-size:14px;color:#1c1917;">
                    A vintage botanical illustration of a fern, detailed ink lines, scientific style
                  </td>
                </tr>
                <tr><td style="height:8px;"></td></tr>
                <tr>
                  <td style="padding:14px 16px;background-color:#F5F3ED;border-radius:4px;border-left:3px solid #C2410C;font-size:14px;color:#1c1917;">
                    A geometric mountain range silhouette, sharp angles, minimal color palette
                  </td>
                </tr>
                <tr><td style="height:8px;"></td></tr>
                <tr>
                  <td style="padding:14px 16px;background-color:#F5F3ED;border-radius:4px;border-left:3px solid #C2410C;font-size:14px;color:#1c1917;">
                    A playful 3D render of a floating rubber duck, soft lighting, pastel tones
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 24px 0;font-size:15px;color:#44403c;">
                When you do run out, credit packs start at $5 for 15 credits.
                $10 gets you 40. They never expire.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px 0;">
                <tr>
                  <td style="background-color:#C2410C;border-radius:4px;text-align:center;">
                    <a href="${emailEnvConfig.appUrl}/app?utm_source=welcome_email&utm_medium=email&utm_campaign=scenario_1" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Use your remaining credits</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:14px;color:#44403c;border-top:1px solid #e7e5e4;padding-top:20px;">
                <strong>P.S.</strong> I'd love to hear what you're making. Just reply
                to this email. It goes straight to me, and I read every one.
              </p>`);
}

const SCENARIO_2_SUBJECT = "Did you forget something?";

export function scenario2EmailHtml(
  name?: string,
  creditsRemaining?: number,
  prompt?: string | null,
  imageUrl?: string | null,
): string {
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const creditText = creditsRemaining !== undefined && creditsRemaining > 0
    ? `You still have ${creditsRemaining} credit${creditsRemaining === 1 ? "" : "s"} left.`
    : "";

  const imageBlock = imageUrl
    ? `              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                <tr>
                  <td style="padding:16px;background-color:#F5F3ED;border-radius:4px;text-align:center;">
                    <img src="${imageUrl}" alt="Your generated image${prompt ? `: ${escapeHtml(prompt)}` : ""}" style="max-width:100%;height:auto;border-radius:4px;" />
                  </td>
                </tr>
              </table>`
    : "";

  const promptBlock = prompt
    ? `              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                <tr>
                  <td style="padding:14px 16px;background-color:#F5F3ED;border-radius:4px;border-left:3px solid #C2410C;font-size:14px;color:#1c1917;">
                    ${escapeHtml(prompt)}
                  </td>
                </tr>
              </table>`
    : "";

  const creditLine = creditText
    ? `              <p style="margin:0 0 24px 0;font-size:15px;color:#44403c;">${creditText}</p>`
    : "";

  return emailLayout(SCENARIO_2_SUBJECT, greeting, `              <p style="margin:0 0 20px 0;font-size:15px;color:#44403c;">
                You left something behind on Celstate. Your image is ready
                and waiting for you.
              </p>
${imageBlock}
${promptBlock}
              <p style="margin:0 0 24px 0;font-size:15px;color:#44403c;">
                That's a preview. The full high-resolution transparent PNG is
                ready to download in the app. No background to remove, no edges
                to clean up. Just drop it into whatever you're making.
              </p>
${creditLine}
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px 0;">
                <tr>
                  <td style="background-color:#C2410C;border-radius:4px;text-align:center;">
                    <a href="${emailEnvConfig.appUrl}/app?utm_source=welcome_email&utm_medium=email&utm_campaign=scenario_2" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Get your high-res image</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:14px;color:#44403c;border-top:1px solid #e7e5e4;padding-top:20px;">
                <strong>P.S.</strong> I'd love to hear what you're making. Just reply
                to this email. It goes straight to me, and I read every one.
              </p>`);
}

export const SCENARIO_3_SUBJECT = "You're out of credits, but you don't have to be";

export function scenario3EmailHtml(name?: string, generationsCount?: number): string {
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const madeText = generationsCount !== undefined && generationsCount > 0
    ? `You used your free credits to make ${generationsCount} image${generationsCount === 1 ? "" : "s"} on Celstate and downloaded what you made. That means the tool worked for you.`
    : "You used your free credits on Celstate and downloaded what you made. That means the tool worked for you.";

  return emailLayout(SCENARIO_3_SUBJECT, greeting, `              <p style="margin:0 0 24px 0;font-size:15px;color:#44403c;">
                ${madeText}
              </p>
              <p style="margin:0 0 24px 0;font-size:15px;color:#44403c;">
                Here's what you could make with 15 more credits:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="padding:14px 16px;background-color:#F5F3ED;border-radius:4px;border-left:3px solid #C2410C;font-size:14px;color:#1c1917;">
                    A watercolor coffee cup with steam rising, soft pastel tones, hand-painted style
                  </td>
                </tr>
                <tr><td style="height:8px;"></td></tr>
                <tr>
                  <td style="padding:14px 16px;background-color:#F5F3ED;border-radius:4px;border-left:3px solid #C2410C;font-size:14px;color:#1c1917;">
                    A cute cartoon fox mascot for a tech startup, bold outlines, friendly expression
                  </td>
                </tr>
                <tr><td style="height:8px;"></td></tr>
                <tr>
                  <td style="padding:14px 16px;background-color:#F5F3ED;border-radius:4px;border-left:3px solid #C2410C;font-size:14px;color:#1c1917;">
                    An art deco style peacock feather, gold and emerald, symmetrical, elegant
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 24px 0;font-size:15px;color:#44403c;">
                Credit packs start at $5 for 15 credits. $10 gets you 40.
                They never expire, and there's no subscription.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px 0;">
                <tr>
                  <td style="background-color:#C2410C;border-radius:4px;text-align:center;">
                    <a href="${emailEnvConfig.appUrl}/app/credits?utm_source=welcome_email&utm_medium=email&utm_campaign=scenario_3" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Get more credits</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:14px;color:#44403c;border-top:1px solid #e7e5e4;padding-top:20px;">
                <strong>P.S.</strong> If $5 isn't right for you, just reply and
                tell me why. It goes straight to me, and I read every one.
              </p>`);
}

export const SCENARIO_4_SUBJECT = "Did we miss the mark?";

export function scenario4EmailHtml(
  name?: string,
  generationsCount?: number,
  prompt?: string | null,
  imageUrl?: string | null,
): string {
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const madeText = generationsCount !== undefined && generationsCount > 0
    ? `You generated ${generationsCount} image${generationsCount === 1 ? "" : "s"} on Celstate`
    : "You generated images on Celstate";

  const imageBlock = imageUrl
    ? `              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                <tr>
                  <td style="padding:16px;background-color:#F5F3ED;border-radius:4px;text-align:center;">
                    <img src="${imageUrl}" alt="Your generated image${prompt ? `: ${escapeHtml(prompt)}` : ""}" style="max-width:100%;height:auto;border-radius:4px;" />
                  </td>
                </tr>
              </table>`
    : "";

  const promptBlock = prompt
    ? `              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                <tr>
                  <td style="padding:14px 16px;background-color:#F5F3ED;border-radius:4px;border-left:3px solid #C2410C;font-size:14px;color:#1c1917;">
                    ${escapeHtml(prompt)}
                  </td>
                </tr>
              </table>`
    : "";

  return emailLayout(SCENARIO_4_SUBJECT, greeting, `              <p style="margin:0 0 20px 0;font-size:15px;color:#44403c;">
                ${madeText} but didn't download any of them.
                That tells me we might have missed the mark for you.
              </p>
${imageBlock}
${promptBlock}
              <p style="margin:0 0 24px 0;font-size:15px;color:#44403c;">
                Was it the quality? The style? Did it not fit
                what you needed? I want to know.
              </p>
              <p style="margin:0 0 24px 0;font-size:15px;color:#44403c;">
                I've added <strong>3 bonus credits</strong> to your
                account so you can try again. No strings attached.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px 0;">
                <tr>
                  <td style="background-color:#C2410C;border-radius:4px;text-align:center;">
                    <a href="${emailEnvConfig.appUrl}/app?utm_source=welcome_email&utm_medium=email&utm_campaign=scenario_4" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Try again with 3 bonus credits</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:14px;color:#44403c;border-top:1px solid #e7e5e4;padding-top:20px;">
                <strong>P.S.</strong> If you're willing to tell me what
                went wrong, just reply to this email. It goes straight to
                me, and I read every one.
              </p>`);
}

// ========== SCENARIO 5: NO CREDITS USED ==========

export const SCENARIO_5_NEVER_TRIED_SUBJECT = "Your 3 free credits are waiting";

const SCENARIO_5_CURATED_PROMPTS = [
  "A cute cartoon fox mascot for a tech startup, bold outlines, friendly expression",
  "A vintage botanical illustration of a fern, detailed ink lines, scientific style",
  "A minimalist logo for a coffee shop, simple geometric shape, single color",
];

export function scenario5NeverTriedEmailHtml(
  name?: string,
  creditsRemaining?: number,
): string {
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const creditText = creditsRemaining !== undefined && creditsRemaining > 0
    ? `You have ${creditsRemaining} free credit${creditsRemaining === 1 ? "" : "s"} waiting. Each generation costs 1. No card needed.`
    : "You have free credits waiting. Each generation costs 1. No card needed.";

  const promptLinks = SCENARIO_5_CURATED_PROMPTS.map(
    (prompt, _i) =>
      `                <tr>
                  <td style="padding:14px 16px;background-color:#F5F3ED;border-radius:4px;border-left:3px solid #C2410C;font-size:14px;color:#1c1917;">
                    <a href="${emailEnvConfig.appUrl}/app?prompt=${encodeURIComponent(prompt)}&source=welcome_email_scenario_5_never_tried" style="color:#1c1917;text-decoration:none;font-weight:500;">${prompt}</a>
                  </td>
                </tr>
                <tr><td style="height:8px;"></td></tr>`,
  ).join("\n");

  return emailLayout(SCENARIO_5_NEVER_TRIED_SUBJECT, greeting, `              <p style="margin:0 0 20px 0;font-size:15px;color:#44403c;">
                You signed up for Celstate but haven't generated
                anything yet. That's okay. Here's the easiest way to start.
              </p>
              <p style="margin:0 0 20px 0;font-size:15px;color:#44403c;">
                Click any of these and hit Generate. You'll get a
                transparent PNG in seconds, no background to remove:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
${promptLinks}
              </table>
              <p style="margin:0 0 24px 0;font-size:15px;color:#44403c;">
                ${creditText}
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px 0;">
                <tr>
                  <td style="background-color:#C2410C;border-radius:4px;text-align:center;">
                    <a href="${emailEnvConfig.appUrl}/app?prompt=${encodeURIComponent(SCENARIO_5_CURATED_PROMPTS[0]!)}&source=welcome_email_scenario_5_never_tried" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Try your first generation</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:14px;color:#44403c;border-top:1px solid #e7e5e4;padding-top:20px;">
                <strong>P.S.</strong> What stopped you from trying? Just reply
                to this email. It goes straight to me, and I read every one.
              </p>`);
}

export const SCENARIO_5_TRIED_FAILED_SUBJECT = "Let's try that again";

export function scenario5TriedFailedEmailHtml(
  name?: string,
  creditsRemaining?: number,
  failedPrompt?: string | null,
): string {
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const creditText = creditsRemaining !== undefined && creditsRemaining > 0
    ? `You still have ${creditsRemaining} credit${creditsRemaining === 1 ? "" : "s"} available. Your failed generation was refunded.`
    : "Your failed generation was refunded, so your credits are still available.";

  const failedPromptBlock = failedPrompt
    ? `              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                <tr>
                  <td style="padding:14px 16px;background-color:#F5F3ED;border-radius:4px;border-left:3px solid #C2410C;font-size:14px;color:#1c1917;">
                    ${escapeHtml(failedPrompt)}
                  </td>
                </tr>
              </table>`
    : "";

  const knownGoodPrompt = SCENARIO_5_CURATED_PROMPTS[0]!;

  return emailLayout(SCENARIO_5_TRIED_FAILED_SUBJECT, greeting, `              <p style="margin:0 0 20px 0;font-size:15px;color:#44403c;">
                I noticed your first generation on Celstate didn't
                complete. That shouldn't have happened, and I'm sorry it did.
              </p>
${failedPromptBlock}
              <p style="margin:0 0 20px 0;font-size:15px;color:#44403c;">
                ${creditText}
              </p>
              <p style="margin:0 0 20px 0;font-size:15px;color:#44403c;">
                Let's try something different. This one works great with
                our transparent background process:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="padding:14px 16px;background-color:#F5F3ED;border-radius:4px;border-left:3px solid #C2410C;font-size:14px;color:#1c1917;">
                    <a href="${emailEnvConfig.appUrl}/app?prompt=${encodeURIComponent(knownGoodPrompt)}&source=welcome_email_scenario_5_tried_failed" style="color:#1c1917;text-decoration:none;font-weight:500;">${knownGoodPrompt}</a>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px 0;">
                <tr>
                  <td style="background-color:#C2410C;border-radius:4px;text-align:center;">
                    <a href="${emailEnvConfig.appUrl}/app?prompt=${encodeURIComponent(knownGoodPrompt)}&source=welcome_email_scenario_5_tried_failed" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Try this prompt</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:14px;color:#44403c;border-top:1px solid #e7e5e4;padding-top:20px;">
                <strong>P.S.</strong> What were you trying to make? Reply and
                tell me. I'll help you get it right.
              </p>`);
}

export const grantWelcomeEmailBonusCredits = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return false;
    if (user.welcomeEmailBonusCreditsGranted) return false;

    const applied = await applyCreditsToUser(ctx, args.userId, args.amount);
    if (!applied) return false;

    await ctx.db.insert("creditGrants", {
      userId: args.userId,
      amount: args.amount,
      reason: "reengagement_bonus",
      createdAt: Date.now(),
    });

    await ctx.db.patch(args.userId, {
      welcomeEmailBonusCreditsGranted: true,
    });

    await posthog.capture(ctx, {
      distinctId: String(args.userId),
      event: "welcome_email_bonus_credits_granted",
      properties: {
        scenario: "credits_exhausted_no_download",
        amount: args.amount,
      },
    });

    return true;
  },
});

// ========== CLASSIFICATION ==========

type WelcomeScenario =
  | "credits_remaining_downloaded"
  | "credits_remaining_no_download"
  | "credits_exhausted_downloaded"
  | "credits_exhausted_no_download"
  | "no_credits_used";

interface UserClassification {
  scenario: WelcomeScenario;
  generationsCount: number;
  downloadedCount: number;
  creditsRemaining: number;
  recentGenerationPrompt: string | null;
  recentGenerationImageUrl: string | null;
  hasFailedGenerations: boolean;
  failedGenerationPrompt: string | null;
}

export const classifyUser = internalQuery({
  args: {
    userId: v.id("users"),
  },
  returns: v.object({
    scenario: v.string(),
    generationsCount: v.number(),
    downloadedCount: v.number(),
    creditsRemaining: v.number(),
    recentGenerationPrompt: v.union(v.string(), v.null()),
    recentGenerationImageUrl: v.union(v.string(), v.null()),
    hasFailedGenerations: v.boolean(),
    failedGenerationPrompt: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args): Promise<UserClassification> => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const completedGenerations = await ctx.db
      .query("generations")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "complete"),
      )
      .collect();

    const downloadedGenerations = completedGenerations.filter(
      (g) => g.downloadedAt !== undefined,
    );

    const generationsCount = completedGenerations.length;
    const downloadedCount = downloadedGenerations.length;
    const creditsRemaining = user.credits ?? 0;

    let scenario: WelcomeScenario;
    if (generationsCount === 0) {
      scenario = "no_credits_used";
    } else if (creditsRemaining > 0 && downloadedCount > 0) {
      scenario = "credits_remaining_downloaded";
    } else if (creditsRemaining > 0 && downloadedCount === 0) {
      scenario = "credits_remaining_no_download";
    } else if (creditsRemaining === 0 && downloadedCount > 0) {
      scenario = "credits_exhausted_downloaded";
    } else {
      scenario = "credits_exhausted_no_download";
    }

    let recentGenerationPrompt: string | null = null;
    let recentGenerationImageUrl: string | null = null;

    if (completedGenerations.length > 0) {
      const sorted = [...completedGenerations].sort(
        (a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt),
      );
      const mostRecent = sorted[0];
      recentGenerationPrompt = mostRecent.prompt;

      const storageId = mostRecent.optimizedStorageId ?? mostRecent.resultStorageId;
      if (storageId) {
        recentGenerationImageUrl = await ctx.storage.getUrl(storageId);
      }
    }

    const failedGenerations = await ctx.db
      .query("generations")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "failed"),
      )
      .collect();

    const hasFailedGenerations = failedGenerations.length > 0;
    let failedGenerationPrompt: string | null = null;

    if (hasFailedGenerations) {
      const sortedFailed = [...failedGenerations].sort(
        (a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt),
      );
      failedGenerationPrompt = sortedFailed[0]!.prompt;
    }

    return {
      scenario,
      generationsCount,
      downloadedCount,
      creditsRemaining,
      recentGenerationPrompt,
      recentGenerationImageUrl,
      hasFailedGenerations,
      failedGenerationPrompt,
    };
  },
});

// ========== ELIGIBLE USERS QUERY ==========

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

export const getEligibleUsersForWelcomeEmail = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("users"),
      email: v.string(),
      name: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const now = Date.now();
    const minSignupTime = now - THREE_HOURS_MS;

    // No upper bound: the welcomeEmailStatus === "pending" index already
    // guarantees at-most-once delivery. A previous 24h upper bound caused
    // users who signed up within 3h before the cron to be too young at that
    // run and >24h old at the next — permanently skipped (~12.5% of signups).
    const pendingUsers = await ctx.db
      .query("users")
      .withIndex("by_welcome_email_status", (q) =>
        q.eq("welcomeEmailStatus", "pending"),
      )
      .collect();

    return pendingUsers
      .filter((user) => {
        if (!user.email) return false;
        if (user.emailUnsubscribed) return false;

        return user._creationTime <= minSignupTime;
      })
      .map((user) => ({
        _id: user._id,
        email: user.email!,
        name: user.name,
      }));
  },
});

export const claimUserForWelcomeEmail = internalMutation({
  args: {
    userId: v.id("users"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return false;
    if (user.welcomeEmailStatus !== "pending") return false;

    await ctx.db.patch(args.userId, {
      welcomeEmailStatus: "sent",
    });

    return true;
  },
});

// ========== DAILY PROCESSING ACTION ==========

export const processWelcomeEmails = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const eligibleUsers = await ctx.runQuery(
      internal.emails.getEligibleUsersForWelcomeEmail,
      {},
    );

    console.log(
      `[emails] Processing welcome emails for ${eligibleUsers.length} eligible users`,
    );

    for (const user of eligibleUsers) {
      const claimed = await ctx.runMutation(
        internal.emails.claimUserForWelcomeEmail,
        { userId: user._id },
      );
      if (!claimed) continue;

      const classification = await ctx.runQuery(
        internal.emails.classifyUser,
        { userId: user._id },
      );

      let subject: string;
      let html: string;

      switch (classification.scenario) {
        case "credits_remaining_downloaded":
          subject = SCENARIO_1_SUBJECT;
          html = scenario1EmailHtml(user.name, classification.creditsRemaining);
          break;
        case "credits_remaining_no_download":
          subject = SCENARIO_2_SUBJECT;
          html = scenario2EmailHtml(
            user.name,
            classification.creditsRemaining,
            classification.recentGenerationPrompt,
            classification.recentGenerationImageUrl,
          );
          break;
        case "credits_exhausted_downloaded":
          subject = SCENARIO_3_SUBJECT;
          html = scenario3EmailHtml(
            user.name,
            classification.generationsCount,
          );
          break;
        case "credits_exhausted_no_download":
          await ctx.runMutation(internal.emails.grantWelcomeEmailBonusCredits, {
            userId: user._id,
            amount: 3,
          });
          subject = SCENARIO_4_SUBJECT;
          html = scenario4EmailHtml(
            user.name,
            classification.generationsCount,
            classification.recentGenerationPrompt,
            classification.recentGenerationImageUrl,
          );
          break;
        case "no_credits_used": {
          const subScenario = classification.hasFailedGenerations
            ? "tried_and_failed"
            : "never_tried";

          if (classification.hasFailedGenerations) {
            subject = SCENARIO_5_TRIED_FAILED_SUBJECT;
            html = scenario5TriedFailedEmailHtml(
              user.name,
              classification.creditsRemaining,
              classification.failedGenerationPrompt,
            );
          } else {
            subject = SCENARIO_5_NEVER_TRIED_SUBJECT;
            html = scenario5NeverTriedEmailHtml(
              user.name,
              classification.creditsRemaining,
            );
          }

          await ctx.scheduler.runAfter(0, internal.emails.sendWelcomeEmail, {
            userId: user._id,
            email: user.email,
            name: user.name,
            scenario: classification.scenario,
            subScenario,
            subject,
            html,
          });
          continue;
        }
        default:
          console.error(
            `[emails] Unreachable: unexpected scenario "${classification.scenario}" for user ${user._id}`,
          );
          await ctx.runMutation(internal.emails.recordEmailSkipped, {
            userId: user._id,
          });
          continue;
      }

      await ctx.scheduler.runAfter(0, internal.emails.sendWelcomeEmail, {
        userId: user._id,
        email: user.email,
        name: user.name,
        scenario: classification.scenario,
        subject,
        html,
      });
    }

    return null;
  },
});

export const recordEmailSkipped = internalMutation({
  args: {
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      welcomeEmailStatus: "skipped",
      welcomeEmailSentAt: Date.now(),
    });
    return null;
  },
});

export const unsubscribe = mutation({
  args: {
    email: v.string(),
    token: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const expectedToken = await generateUnsubscribeToken(args.email);
    if (args.token !== expectedToken) {
      return false;
    }

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();

    if (!user) {
      return false;
    }

    await ctx.db.patch(user._id, {
      emailUnsubscribed: true,
    });

    return true;
  },
});

export const resubscribe = mutation({
  args: {
    email: v.string(),
    token: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const expectedToken = await generateUnsubscribeToken(args.email);
    if (args.token !== expectedToken) {
      return false;
    }

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();

    if (!user) {
      return false;
    }

    await ctx.db.patch(user._id, {
      emailUnsubscribed: false,
    });

    return true;
  },
});
