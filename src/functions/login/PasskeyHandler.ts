import type { Page } from 'playwright'
import { MicrosoftRewardsBot } from '../../index'
import { waitForElementSmart } from '../../util/browser/SmartWait'
import { logError } from '../../util/notifications/Logger'

export class PasskeyHandler {
    private bot: MicrosoftRewardsBot
    private passkeyHandled = false
    private noPromptIterations = 0
    private lastNoPromptLog = 0

    private static readonly SELECTORS = {
        passkeySecondary: 'button[data-testid="secondaryButton"]',
        passkeyPrimary: 'button[data-testid="primaryButton"]',
        passkeyTitle: '[data-testid="title"]',
        kmsiVideo: '[data-testid="kmsiVideo"]',
        biometricVideo: '[data-testid="biometricVideo"]'
    } as const

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    public async disableFido(page: Page) {
        await page.route('**/GetCredentialType.srf*', route => {
            try {
                const body = JSON.parse(route.request().postData() || '{}')
                body.isFidoSupported = false
                route.continue({ postData: JSON.stringify(body) })
            } catch { /* Route continue on parse failure */ route.continue() }
        }).catch(logError('LOGIN-FIDO', 'Route interception setup failed', this.bot.isMobile))
    }

    private escapeWatcherInterval: NodeJS.Timeout | null = null

    /**
     * Start automatic Escape key sender to dismiss native OS dialogs (Bluetooth, Windows Hello)
     * CRITICAL: Native system dialogs cannot be dismissed via Playwright dialog handlers
     * They can only be closed with Escape key (as user discovered)
     */
    public startEscapeWatcher(page: Page) {
        // Stop any existing watcher
        this.stopEscapeWatcher()

        this.bot.log(this.bot.isMobile, 'LOGIN-ESCAPE', 'Starting automatic Escape sender (500ms interval)', 'log', 'cyan')

        this.escapeWatcherInterval = setInterval(async () => {
            try {
                // Send Escape key to dismiss any native dialogs
                await page.keyboard.press('Escape').catch(() => {
                    // Silent failure - page might be closed
                })
            } catch {
                // Silent failure - interval will be cleared when stopEscapeWatcher is called
            }
        }, 500)
    }

    /**
     * Stop the automatic Escape key sender
     */
    public stopEscapeWatcher() {
        if (this.escapeWatcherInterval) {
            clearInterval(this.escapeWatcherInterval)
            this.escapeWatcherInterval = null
            this.bot.log(this.bot.isMobile, 'LOGIN-ESCAPE', 'Stopped automatic Escape sender', 'log', 'cyan')
        }
    }

    public async handlePasskeyPrompts(page: Page, context: 'main' | 'oauth') {
        let did = false

        // CRITICAL: Send Escape key FIRST to dismiss any native OS dialogs (Bluetooth, Windows Hello)
        // These dialogs appear AFTER password/TOTP and cannot be dismissed via DOM clicks
        try {
            await page.keyboard.press('Escape')
            await page.waitForTimeout(100) // Brief wait for dialog to close
            this.bot.log(this.bot.isMobile, 'PASSKEY-ESCAPE', 'Sent Escape key to dismiss native dialogs', 'log', 'green')
        } catch {
            // Silent failure - page might not be ready
        }

        // Early exit for passkey creation flows (common on mobile): hit cancel/skip if present
        const currentUrl = page.url()
        if (/fido\/create|passkey/i.test(currentUrl)) {
            const cancelled = await this.clickFirstVisible(page, [
                'button:has-text("Cancel")',
                'button:has-text("Not now")',
                'button:has-text("Skip")',
                'button:has-text("No thanks")',
                '[data-testid="secondaryButton"]',
                'button[class*="secondary"]'
            ], 500)

            if (cancelled) {
                did = true
                this.logPasskeyOnce('fido/create cancel')
            }
        }

        // Priority 1: Direct detection of "Skip for now" button by data-testid
        const skipBtnResult = await waitForElementSmart(page, 'button[data-testid="secondaryButton"]', {
            initialTimeoutMs: 300,
            extendedTimeoutMs: 500,
            state: 'visible'
        })

        if (skipBtnResult.found && skipBtnResult.element) {
            const text = (await skipBtnResult.element.textContent() || '').trim()
            // Check if it's actually a skip button (could be other secondary buttons)
            if (/skip|later|not now|non merci|pas maintenant/i.test(text)) {
                await skipBtnResult.element.click().catch(logError('LOGIN-PASSKEY', 'Skip button click failed', this.bot.isMobile))
                did = true
                this.logPasskeyOnce('data-testid secondaryButton')
            }
        }

        // Priority 2: Video heuristic (biometric prompt)
        if (!did) {
            const biometricResult = await waitForElementSmart(page, PasskeyHandler.SELECTORS.biometricVideo, {
                initialTimeoutMs: 300,
                extendedTimeoutMs: 500,
                state: 'visible'
            })

            if (biometricResult.found) {
                const btnResult = await waitForElementSmart(page, PasskeyHandler.SELECTORS.passkeySecondary, {
                    initialTimeoutMs: 200,
                    extendedTimeoutMs: 300,
                    state: 'visible'
                })
                if (btnResult.found && btnResult.element) {
                    await btnResult.element.click().catch(logError('LOGIN-PASSKEY', 'Video heuristic click failed', this.bot.isMobile))
                    did = true
                    this.logPasskeyOnce('video heuristic')
                }
            }
        }

        // Priority 3: Title + secondary button detection
        if (!did) {
            const titleResult = await waitForElementSmart(page, PasskeyHandler.SELECTORS.passkeyTitle, {
                initialTimeoutMs: 300,
                extendedTimeoutMs: 500,
                state: 'attached'
            })

            if (titleResult.found && titleResult.element) {
                const title = (await titleResult.element.textContent() || '').trim()
                const looksLike = /sign in faster|passkey|fingerprint|face|pin|empreinte|visage|windows hello|hello/i.test(title)

                if (looksLike) {
                    const secBtnResult = await waitForElementSmart(page, PasskeyHandler.SELECTORS.passkeySecondary, {
                        initialTimeoutMs: 200,
                        extendedTimeoutMs: 300,
                        state: 'visible'
                    })

                    if (secBtnResult.found && secBtnResult.element) {
                        await secBtnResult.element.click().catch(logError('LOGIN-PASSKEY', 'Title heuristic click failed', this.bot.isMobile))
                        did = true
                        this.logPasskeyOnce('title heuristic ' + title)
                    }
                }
            }

            // Check secondary button text if title heuristic didn't work
            if (!did) {
                const secBtnResult = await waitForElementSmart(page, PasskeyHandler.SELECTORS.passkeySecondary, {
                    initialTimeoutMs: 200,
                    extendedTimeoutMs: 300,
                    state: 'visible'
                })

                if (secBtnResult.found && secBtnResult.element) {
                    const text = (await secBtnResult.element.textContent() || '').trim()
                    if (/skip for now|not now|later|passer|plus tard/i.test(text)) {
                        await secBtnResult.element.click().catch(logError('LOGIN-PASSKEY', 'Secondary button text click failed', this.bot.isMobile))
                        did = true
                        this.logPasskeyOnce('secondary button text')
                    }
                }
            }
        }

        // Priority 4: XPath fallback (includes Windows Hello specific patterns)
        if (!did) {
            const textBtn = await page.locator('xpath=//button[contains(normalize-space(.),"Skip for now") or contains(normalize-space(.),"Not now") or contains(normalize-space(.),"Passer") or contains(normalize-space(.),"No thanks")]').first()
            // FIXED: Add explicit timeout to isVisible
            if (await textBtn.isVisible({ timeout: 500 }).catch(() => false)) {
                await textBtn.click().catch(logError('LOGIN-PASSKEY', 'XPath fallback click failed', this.bot.isMobile))
                did = true
                this.logPasskeyOnce('xpath fallback')
            }
        }

        // Priority 4.5: Windows Hello specific detection
        if (!did) {
            // FIXED: Add explicit timeout
            const windowsHelloTitle = await page.locator('text=/windows hello/i').first().isVisible({ timeout: 500 }).catch(() => false)
            if (windowsHelloTitle) {
                // Try common Windows Hello skip patterns
                const skipPatterns = [
                    'button:has-text("Skip")',
                    'button:has-text("No thanks")',
                    'button:has-text("Maybe later")',
                    'button:has-text("Cancel")',
                    '[data-testid="secondaryButton"]',
                    'button[class*="secondary"]'
                ]
                for (const pattern of skipPatterns) {
                    const btn = await page.locator(pattern).first()
                    // FIXED: Add explicit timeout
                    if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
                        await btn.click().catch(logError('LOGIN-PASSKEY', 'Windows Hello skip failed', this.bot.isMobile))
                        did = true
                        this.logPasskeyOnce('Windows Hello skip')
                        break
                    }
                }
            }
        }

        // Priority 5: Close button fallback (FIXED: Add explicit timeout instead of using page.$)
        if (!did) {
            const closeResult = await waitForElementSmart(page, '#close-button', {
                initialTimeoutMs: 300,
                extendedTimeoutMs: 500,
                state: 'visible'
            })

            if (closeResult.found && closeResult.element) {
                await closeResult.element.click().catch(logError('LOGIN-PASSKEY', 'Close button fallback failed', this.bot.isMobile))
                did = true
                this.logPasskeyOnce('close button')
            }
        }

        // KMSI prompt
        const kmsi = await page.waitForSelector(PasskeyHandler.SELECTORS.kmsiVideo, { timeout: 400 }).catch(() => null)
        if (kmsi) {
            const yes = await page.$(PasskeyHandler.SELECTORS.passkeyPrimary)
            if (yes) {
                await yes.click().catch(logError('LOGIN-KMSI', 'KMSI accept click failed', this.bot.isMobile))
                did = true
                this.bot.log(this.bot.isMobile, 'LOGIN-KMSI', 'Accepted KMSI prompt')
            }
        }

        if (!did && context === 'main') {
            this.noPromptIterations++
            const now = Date.now()
            if (this.noPromptIterations === 1 || now - this.lastNoPromptLog > 10000) {
                this.lastNoPromptLog = now
                this.bot.log(this.bot.isMobile, 'LOGIN-NO-PROMPT', `No dialogs (x${this.noPromptIterations})`)
                if (this.noPromptIterations > 50) this.noPromptIterations = 0
            }
        } else if (did) {
            this.noPromptIterations = 0
        }
    }

    private async clickFirstVisible(page: Page, selectors: string[], timeoutMs = 300): Promise<boolean> {
        for (const selector of selectors) {
            const el = page.locator(selector).first()
            const visible = await el.isVisible({ timeout: timeoutMs }).catch(() => false)
            if (!visible) continue

            await el.click().catch(logError('LOGIN-PASSKEY', `Click failed for ${selector}`, this.bot.isMobile))
            return true
        }
        return false
    }

    private logPasskeyOnce(reason: string) {
        if (this.passkeyHandled) return
        this.passkeyHandled = true
        this.bot.log(this.bot.isMobile, 'LOGIN-PASSKEY', `Dismissed passkey prompt (${reason})`)
    }
}
