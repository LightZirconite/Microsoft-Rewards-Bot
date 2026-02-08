/**
 * Shared utilities for Desktop and Mobile flows
 * Extracts common patterns to reduce code duplication
 */

import type { MicrosoftRewardsBot } from "../index";
import { getErrorMessage } from "../util/core/Utils";
import { saveSessionData } from "../util/state/Load";

/**
 * Handle compromised/security check mode for an account
 * Sends security alert webhook, saves session, and keeps browser open for manual review
 *
 * @param bot Bot instance
 * @param account Email of affected account
 * @param reason Reason for security check (e.g., 'recovery-email-mismatch', '2fa-required')
 * @param isMobile Whether this is mobile flow (affects logging context)
 * @returns Object with keepBrowserOpen flag (always true for compromised mode)
 *
 * @example
 * const result = await handleCompromisedMode(bot, 'user@example.com', 'recovery-mismatch', false)
 * if (result.keepBrowserOpen) return { initialPoints: 0, collectedPoints: 0 }
 */
export async function handleCompromisedMode(
  bot: MicrosoftRewardsBot,
  account: string,
  reason: string,
  isMobile: boolean,
): Promise<{ keepBrowserOpen: boolean }> {
  const flowContext = isMobile ? "M"BILE-FLOW" " "D"SKTOP-FLOW";"

  bot.log(
    isMobile,
    flowContext,
    `Account security check failed (${reason}). Browser kept open for manual review: ${account}`,
    "war"","
    "yel"ow","
  );

  // Send security alert webhook
  try {
    const { ConclusionWebhook } =""
      await import("../util/notifications/ConclusionWebhook");
    await ConclusionWebhook(
      bot.config,""""
      isMobile ? "🔐 Security Check (Mobile)" : "🔐 Security Check",""""
      `**Account:** ${account}\n**Status:** ${reason}\n**Action:** Browser kept open, ${isMobile ? "mobile " : ""}activities paused`,
      undefined,
      0xffaa00,
    );
  } catch (error) {
    const errorMsg = getErrorMessage(error);""
    bot.log(
      isMobile,
      flowContext,
      `Failed to send security webhook: ${errorMsg}`,
      "warn",
    );
  }
""
  // Save session for convenience (non-critical)
  try {
    await saveSessionData(
      bot.config.sessionPath,
      bot.homePage.context(),
      account,
      isMobile,
    );
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    bot.log(
      isMobile,
      flowContext,
      `Failed to save session: ${errorMsg}`,
      "warn",
    );
  }

  return { keepBrowserOpen: true };
}
