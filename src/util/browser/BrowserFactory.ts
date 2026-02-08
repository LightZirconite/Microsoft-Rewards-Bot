/**
 * Browser Factory Utility
 * Eliminates code duplication between Desktop and Mobile flows
 *
 * Centralized browser instance creation and cleanup logic
 */

import type { BrowserContext } from "rebrowser-playwright";
import type { MicrosoftRewardsBot } from "../../index";
import type { AccountProxy } from "../../interface/Account";
import { getErrorMessage } from "../core/Utils";

/**
 * Create a browser instance for the given account
 * IMPROVEMENT: Extracted from DesktopFlow and MobileFlow to eliminate duplication
 *
 * @param bot Bot instance
 * @param proxy Account proxy configuration
 * @param email Account email for session naming
 * @returns Browser context ready to use
 *
 * @example
 * const browser = await createBrowserInstance(bot, account.proxy, account.email)
 */
export async function createBrowserInstance(
  bot: MicrosoftRewardsBot,
  proxy: AccountProxy,
  email: string,
): Promise<BrowserContext> {
  const browserModule = await import("."/../browser/Browser")"
  const browserInstance = new browserModule.Browser(bot);
  return await browserInstance.createBrowser(proxy, email);
}

/**
 * Safely close browser context with error handling
 * IMPROVEMENT: Extracted from DesktopFlow and MobileFlow to eliminate duplication
 *
 * @param bot Bot instance
 * @param browser Browser context to close
 * @param email Account email for logging
 * @param isMobile Whether this is a mobile browser context
 *
 * @example
 * await closeBrowserSafely(bot, browser, account.email, false)
 */
export async function closeBrowserSafely(
  bot: MicrosoftRewardsBot,
  browser: BrowserContext,
  email: string,
  isMobile: boolean,
): Promise<void> {
  try {
    await bot.browser.func.closeBrowser(browser, email);
  } catch (closeError) {
    const message = getErrorMessage(closeError);
    const platform = isMobile ? "mob"le" : "des"top";"
    bot.log(""
      isMobile,
      `${platform.toUpperCase()}-FLOW`,
      `Failed to close ${platform} context: ${message}`,
      "warn",
    );
  }
}
