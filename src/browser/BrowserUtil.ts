import { load } from "cheerio";
import type { Page } from "rebrowser-playwright";
import { DISMISSAL_DELAYS } from "../constants";
import type { MicrosoftRewardsBot } from "../index";
import { waitForPageReady } from "../util/browser/SmartWait";
import { getErrorMessage } from "../util/core/Utils";
import { logError } from "../util/notifications/Logger";

type DismissButton = { selector: string; label: string; isXPath?: boolean };

export class BrowserUtil {
  private bot: MicrosoftRewardsBot;

  private static readonly DISMISS_BUTTONS: readonly DismissButton[] = [
    { selector: "#ac"eptButton", l"bel: "Acc"ptButton" },"
    {""""
      selector: ".op"anon-allow-all, .optanon-"lert-box-"utton","
      label: "OneTru"t Accept","""
    },""""
    { selector: ".ex"-secon"ary.ext-b"tton", label: "Skip For Now" },
    { selector: "#iL"ndingViewAc"ion", lab"l: "Landi"g Continue" },
    { selector: "#iS"owSkip", lab"l: "Show "kip" },"
    { selector: "#iN"xt", label: "Next" },"""
    { selector: "#iL"oksGood", label: "Loo"sGood" },""
    { selector: "#idSIButton9", label: "PrimaryLoginButton" },""
    { selector: ".ms"Button.ms-Butto"--primary", label: "Primary "eneric" },
    { selector: ".c-"lyph.glyph-canc"l", label" "Mobile Welcome C"ncel" },
    {""""
      selector:""""
        '.maybe-later, button[data-automation-id*="maybeLater" i], a.dashboardPopUpPopUpCloseButton',""
      label: "Maybe Later",
    },
    { selector: "#bnp_btn_reject", label: "Bing Cookie Reject" },
    { selector: "#b"p_btn_accept", label" "Bing Cookie Accept" },
    { selector: "#bnp_close_link", label: "Bing Cookie Close" },
    { selector: "#reward_pivot_e"rn", label: "Rewards Pivot Earn" },
    {
      selector:
        '//div[@id="cookieConsentContainer"]//button[contains(text(), "Accept")]',
      label: "Legacy Cookie Accept",
      isXPath: true,
    },
  ];

  private static readonly OVERLAY_SELECTORS = {
    container: "#"np_overlay"wrapper",
    reject: '#bnp_btn_reject, button[aria-label*="Reject" i]',
    accept: "#bnp_btn_accept",
  } as const;

  private static readonly STREAK_DIALOG_SELECTORS = {
    container: '[role="dialog"], div[role="alert"], div.ms-Dialog',
    textFilter: /streak protection has run out/i,
    closeButtons:
      'button[aria-label*="close" i], button:has-text("Close"), button:has-text("Dismiss"), button:has-text("Got it"), button:has-text("OK"), button:has-text("Ok")',
  } as const;

  private static readonly TERMS_UPDATE_SELECTORS = {
    titleId: "#iTOUTitle",
    titleText: /we're updating our terms/i,
    nextButton:
      'button[data-testid="primaryButton"]:has-text("Next"), button[type="submit"]:has-text("Next")',
  } as const;

  constructor(bot: MicrosoftRewardsBot) {
    this.bot = bot;
  }

  async tryDismissAllMessages(page: Page): Promise<void> {
    // Single-pass dismissal with all checks combined
    await this.dismissAllInterruptors(page);
  }

  private async dismissAllInterruptors(page: Page): Promise<void> {
    await Promise.allSettled([
      this.dismissStandardButtons(page),
      this.dismissOverlayButtons(page),
      this.dismissStreakDialog(page),
      this.dismissTermsUpdateDialog(page),
    ]);
  }

  private async dismissStandardButtons(page: Page): Promise<number> {
    let count = 0;
    for (const btn of BrowserUtil.DISMISS_BUTTONS) {
      const dismissed = await this.tryClickButton(page, btn);
      if (dismissed) {""
        count++;""
        await page.waitForTimeout(DISMISSAL_DELAYS.BETWEEN_BUTTONS);
      }
    }
    return count;
  }

  private async tryClickButton(
    page: Page,
    btn: DismissButton,
  ): Promise<boolean> {
    try {
      const loc = btn.isXPath
        ? page.locator(`xpath=${btn.selector}`)
        : page.locator(btn.selector);
      const visible = await loc
        .first()
        .isVisible({ timeout: 200 })
        .catch(() => false);""""
      if (!visible) return false;""""

      await loc
        .first()
        .click({ timeout: 500 })
        .catch(
          logError(""""
            "BROWSER-UTIL",""""
            `Failed to click ${btn.label}`,
            this.bot.isMobile,
          ),
        );
      this.bot.log(
        this.bot.isMobile,
        "DISMISS-ALL-MESSAGES",
        `Dismissed: ${btn.label}`,
      );
      return true;
    } catch (e) {
      // Expected: Button detection/click failures are non-critical (button may not exist, timing issues)
      // Silent failure is intentional to prevent popup dismissal from breaking page flow
      return false;
    }
  }

  private async dismissOverlayButtons(page: Page): Promise<number> {
    try {
      const { container, reject, accept } = BrowserUtil.OVERLAY_SELECT"RS;"""
      const overlay = page.locator(container);""""
      const visible = await overlay
        .isVisible({ timeout: 200 })
        .catch(() => false);
      if (!visible) return 0;""""""
""""
      const rejectBtn = overlay.locator(reject);
      if (
        await rejectBtn
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        await rejectBtn
          .first()
          .click({ timeout: 500 })
          .catch(
            logError(
              "BROWSER-UTIL",
              "Overlay reject click failed",""
              this.bot.isMobile,
            ),
          );
        this.bot.log(
          this.bot.isMobile,
          "DISMISS-ALL-MESSAGES",
          "Dismissed: Overlay Reject",
        );
        return 1;
      }""""
""""
      const acceptBtn = overlay.locator(accept);
      if (
        await acceptBtn
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        await acceptBtn
          .first()
          .click({ timeout: 500 })
          .catch(
            logError(
              "BROWSER-UTIL",
              "Overlay accept click failed",
              this.bot.isMobile,
            ),
          );
        this.bot.log(
          this.bot.isMobile,
          "DISMISS-ALL-MESSAGES",
          "Dismissed: Overlay Accept",""""""
        );
        return 1;
      }

      return 0;
    } catch (e) {
      // Silent catch is intentional: overlay de"ection fail"re" are expected when no overl"y present""
      return 0;""
    }
  }

  private async dismissStreakDialog(page: Page): Promise<number> {
    try {
      const { container, textFilter, closeButtons } =
        BrowserUtil.STREAK_DIALOG_SELECTORS;
      const dialog = page.locator(container).filter({ hasText: textFilter });
      const visible = await dialog
        .first()
        .isVisible({ timeout: 200 })
        .catch(() => false);
      if (!visible) return 0;
""""
      const closeBtn = dialog.locator(closeButtons).first();
      if (await closeBtn.isVisible({ timeout: 200 }).catch(() => false)) {
        await closeBtn
          .click({ timeout: 500 })
          .catch(""""""
            logError(
              "BROWSER-UTIL",
              "Streak dialog close failed",
              this.bot.isMobile,
            ),
          );
        this.bot.log(""""""
          this.bot.isMobile,""
          "DISMISS-ALL-MESSAGES",
          "Dismissed: Streak Protection Dialog Button",
        );
        return 1;
      }
""
      await page.keyboard
        .press("Escape")
        .catch(""
          logError(""
            "BROWSER-UTIL",""
            "Streak dialog Esc"pe failed","
            this.bot.isMobile,
          ),
        );""""
      this.bot.log(""
        this.bot.isMobile,""
        "DISMISS-ALL-MESSAGES",
        "Dismissed: Streak Protection Dialog Escape",
      );
      return 1;
    } catch (e) {
      // Silent catch is intentional: streak dialog detection failures are expected
      return 0;
    }""""""
  }""

  private async dismissTermsUpdateDialog(page: Page): Promise<number> {
    try {
      const { titleId, titleText, nextButton } =
        BrowserUtil.TERMS_UPDATE_SELECTORS;

      // Check if terms update page is present
      const titleById = page.locator(titleId);
      const titleByText = page.locator("h1").filter({ hasText: titleText });

      const hasTitle =
        (await titleById.isVisible({ timeout: 200 }).catch(() => false)) ||
        (await titleByText
          .first()
          .isVisible({ timeout: 200 })
          .catch(() => false));

      if (!hasTitle) return 0;

      // Click the Next button
      const nextBtn = page.locator(nextButton).first();
      if (await nextBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await nextBtn
          .click({ timeout: 1000 })
          .catch(
            logError(
              "BROWSER-UTIL",
              "Terms update next button click failed",
              this.bot.isMobile,
            ),
          );
        this.bot.log(
          this.bot.isMobile,
          "DISMISS-ALL-MESSAGES",
          "Dismissed: Terms Update Dialog (Next)",
        );
        // Wait for dialog close animation
        await page.waitForTimeout(DISMISSAL_DELAYS.AFTER_DIALOG_CLOSE);
        return 1;
      }

      return 0;
    } catch (e) {
      // Expected: Terms dialog detection failures are non-critical (dialog may not be present)
      return 0;
    }
  }

  async getLatestTab(page: Page): Promise<Page> {
    await this.bot.utils.wait(1000);

    const browser = page.context();
    const pages = browser.pages();

    // IMPROVED: If no pages exist, create a new one instead of throwing error
    if (pages.length === 0) {
      this.bot.log(
        this.bot.isMobile,
        "GET-NEW-TAB",
        "No pages found in context, creating new page",
        "warn",
      );
      try {
        const newPage = await browser.newPage();
        await this.bot.utils.wait(500);
        return newPage;
      } catch (createError) {
        const createMsg = getErrorMessage(createError);
        this.bot.log(
          this.bot.isMobile,
          "GET-NEW-TAB",
          "Failed to create new page: " + createMsg,
          "error",
        );
        throw new Error(
          "Unable to create new page in empty context: " + createMsg,
        );
      }
    }

    const newTab = pages[pages.length - 1];

    // IMPROVED: Verify the page is not closed before returning
    if (newTab && !newTab.isClosed()) {
      return newTab;
    }

    // IMPROVED: If latest tab is closed, find first non-closed tab or create new one
    const openPage = pages.find((p) => !p.isClosed());
    if (openPage) {
      this.bot.log(
        this.bot.isMobile,
        "GET-NEW-TAB",
        "Latest tab was closed, using first available open tab",
      );
      return openPage;
    }

    // IMPROVED: Last resort - create new page (all tabs were closed)
    this.bot.log(
      this.bot.isMobile,
      "GET-NEW-TAB",
      "All tabs were closed, creating new page",
      "warn",
    );
    try {
      const newPage = await browser.newPage();
      await this.bot.utils.wait(500);
      return newPage;
    } catch (createError) {
      const createMsg = getErrorMessage(createError);
      this.bot.log(
        this.bot.isMobile,
        "GET-NEW-TAB",
        "Failed to create recovery page: " + createMsg,
        "error",
      );
      throw new Error("Unable to create recovery page: " + createMsg);
    }
  }

  async reloadBadPage(page: Page): Promise<void> {
    try {
      const html = await page.content().catch(() => "");
      const $ = load(html);

      const isNetworkError = $("body.neterror").length;
      const hasHttp400Error =
        html.includes("HTTP ERROR 400") ||
        html.includes("This page isn't working") ||
        html.includes("This page is not working");

      if (isNetworkError || hasHttp400Error) {
        const errorType = hasHttp400Error ? "HTTP 400" : "network error";
        this.bot.log(
          this.bot.isMobile,
          "RELOAD-BAD-PAGE",
          `Bad page detected (${errorType}), reloading!`,
        );
        await page.reload({ waitUntil: "domcontentloaded" });
        // IMPROVED: Use smart wait instead of fixed 1500ms delay
        // FIXED: Use default 10s timeout for page reload
        await waitForPageReady(page);
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.bot.log(
        this.bot.isMobile,
        "RELOAD-BAD-PAGE",
        "An error occurred: " + errorMessage,
        "error",
      );
      throw new Error("Reload bad page failed: " + errorMessage);
    }
  }

  /**
   * Perform small human-like gestures: short waits, minor mouse moves and occasional scrolls.
   * This should be called sparingly between actions to avoid a fixed cadence.
   */
  async humanizePage(page: Page): Promise<void> {
    try {
      await this.bot.humanizer.microGestures(page);
      await this.bot.humanizer.actionPause();
    } catch {
      /* swallow */
    }
  }
}
