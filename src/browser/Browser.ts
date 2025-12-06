import { FingerprintGenerator } from 'fingerprint-generator'
import { newInjectedContext } from 'fingerprint-injector'
import playwright, { BrowserContext } from 'rebrowser-playwright'

import { MicrosoftRewardsBot } from '../index'
import { AccountProxy } from '../interface/Account'
import { updateFingerprintUserAgent } from '../util/browser/UserAgent'
import { loadSessionData, saveFingerprintData } from '../util/state/Load'
import { logFingerprintValidation, validateFingerprintConsistency } from '../util/validation/FingerprintValidator'

class Browser {
    private bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    async createBrowser(proxy: AccountProxy, email: string): Promise<BrowserContext> {
        if (process.env.AUTO_INSTALL_BROWSERS === '1') {
            try {
                const { execSync } = await import('child_process')
                // FIXED: Add timeout to prevent indefinite blocking
                this.bot.log(this.bot.isMobile, 'BROWSER', 'Auto-installing Chromium...', 'log')
                execSync('npx playwright install chromium', { stdio: 'ignore', timeout: 120000 })
                this.bot.log(this.bot.isMobile, 'BROWSER', 'Chromium installed successfully', 'log')
            } catch (e) {
                // FIXED: Improved error logging (no longer silent)
                const errorMsg = e instanceof Error ? e.message : String(e)
                this.bot.log(this.bot.isMobile, 'BROWSER', `Auto-install failed: ${errorMsg}`, 'warn')
            }
        }

        let browser: import('rebrowser-playwright').Browser
        try {
            const envForceHeadless = process.env.FORCE_HEADLESS === '1'
            const headless = envForceHeadless ? true : (this.bot.config.browser?.headless ?? false)

            const engineName = 'chromium'
            this.bot.log(this.bot.isMobile, 'BROWSER', `Launching ${engineName} (headless=${headless})`)
            const proxyConfig = this.buildPlaywrightProxy(proxy)

            const isLinux = process.platform === 'linux'

            // CRITICAL: Anti-detection Chromium arguments
            const baseArgs = [
                '--no-sandbox',
                '--mute-audio',
                '--disable-setuid-sandbox',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list',
                '--ignore-ssl-errors',
                // ANTI-DETECTION: Disable blink features that expose automation
                '--disable-blink-features=AutomationControlled',
                // ANTI-DETECTION: Disable automation extensions
                '--disable-extensions',
                // ANTI-DETECTION: Start maximized (humans rarely start in specific window sizes)
                '--start-maximized',
                // ANTI-DETECTION: Disable save password bubble
                '--disable-save-password-bubble',
                // ANTI-DETECTION: Disable background timer throttling
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                // ANTI-DETECTION: Disable infobars
                '--disable-infobars',
                // PERFORMANCE: Disable unnecessary features
                '--disable-breakpad',
                '--disable-component-update',
                '--no-first-run',
                '--no-default-browser-check'
            ]

            // Linux stability fixes
            const linuxStabilityArgs = isLinux ? [
                '--disable-dev-shm-usage',
                '--disable-software-rasterizer',
                '--disable-http-cache',
                '--disk-cache-size=1'
            ] : []

            browser = await playwright.chromium.launch({
                headless,
                ...(proxyConfig && { proxy: proxyConfig }),
                args: [...baseArgs, ...linuxStabilityArgs],
                timeout: isLinux ? 90000 : 60000
            })
        } catch (e: unknown) {
            const msg = (e instanceof Error ? e.message : String(e))
            if (/Executable doesn't exist/i.test(msg)) {
                this.bot.log(this.bot.isMobile, 'BROWSER', 'Chromium not installed. Run "npm run pre-build" or set AUTO_INSTALL_BROWSERS=1', 'error')
            } else {
                this.bot.log(this.bot.isMobile, 'BROWSER', 'Failed to launch browser: ' + msg, 'error')
            }
            throw e
        }

        const legacyFp = (this.bot.config as { saveFingerprint?: { mobile: boolean; desktop: boolean } }).saveFingerprint
        const nestedFp = (this.bot.config.fingerprinting as { saveFingerprint?: { mobile: boolean; desktop: boolean } } | undefined)?.saveFingerprint
        const saveFingerprint = legacyFp || nestedFp || { mobile: false, desktop: false }

        const sessionData = await loadSessionData(this.bot.config.sessionPath, email, this.bot.isMobile, saveFingerprint)
        const fingerprint = sessionData.fingerprint ? sessionData.fingerprint : await this.generateFingerprint()

        // CRITICAL: Validate fingerprint consistency before using it
        const validationResult = validateFingerprintConsistency(fingerprint, this.bot.config)
        logFingerprintValidation(validationResult, email)

        // SECURITY: Abort if critical issues detected (optional, can be disabled)
        if (!validationResult.valid && this.bot.config.riskManagement?.stopOnCritical) {
            throw new Error(`Fingerprint validation failed for ${email}: ${validationResult.criticalIssues.join(', ')}`)
        }

        const context = await newInjectedContext(browser as unknown as import('playwright').Browser, { fingerprint: fingerprint })

        const globalTimeout = this.bot.config.browser?.globalTimeout ?? 30000
        context.setDefaultTimeout(typeof globalTimeout === 'number' ? globalTimeout : this.bot.utils.stringToMs(globalTimeout))

        try {
            context.on('page', async (page) => {
                try {
                    // IMPROVED: Randomized viewport sizes to avoid fingerprinting
                    // Fixed sizes are detectable bot patterns
                    const viewport = this.bot.isMobile
                        ? {
                            // Mobile: Vary between common phone screen sizes
                            width: 360 + Math.floor(Math.random() * 60), // 360-420px
                            height: 640 + Math.floor(Math.random() * 256) // 640-896px
                        }
                        : {
                            // Desktop: Vary between common desktop resolutions
                            width: 1280 + Math.floor(Math.random() * 640), // 1280-1920px
                            height: 720 + Math.floor(Math.random() * 360) // 720-1080px
                        }

                    await page.setViewportSize(viewport)

                    // CRITICAL: Advanced anti-detection scripts (MUST run before page load)
                    await page.addInitScript(() => {
                        // ═══════════════════════════════════════════════════════════════
                        // ANTI-DETECTION LAYER 1: Remove automation indicators
                        // ═══════════════════════════════════════════════════════════════

                        // CRITICAL: Remove navigator.webdriver (biggest bot indicator)
                        try {
                            Object.defineProperty(navigator, 'webdriver', {
                                get: () => undefined,
                                configurable: true
                            })
                        } catch { /* Already defined */ }

                        // CRITICAL: Mask Chrome DevTools Protocol detection
                        // Microsoft checks for window.chrome.runtime
                        try {
                            // @ts-ignore - window.chrome is intentionally injected
                            if (!window.chrome) {
                                // @ts-ignore
                                window.chrome = {}
                            }
                            // @ts-ignore
                            if (!window.chrome.runtime) {
                                // @ts-ignore
                                window.chrome.runtime = {
                                    // @ts-ignore
                                    connect: () => { },
                                    // @ts-ignore
                                    sendMessage: () => { }
                                }
                            }
                        } catch { /* Chrome object may be frozen */ }

                        // ═══════════════════════════════════════════════════════════════
                        // ANTI-DETECTION LAYER 2: WebGL & Canvas fingerprint randomization
                        // ═══════════════════════════════════════════════════════════════

                        // CRITICAL: Add noise to Canvas fingerprinting
                        // Microsoft uses Canvas to detect identical browser instances
                        try {
                            const originalToDataURL = HTMLCanvasElement.prototype.toDataURL
                            const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData

                            // Random noise generator (consistent per page load, different per session)
                            const noise = Math.random() * 0.0001

                            HTMLCanvasElement.prototype.toDataURL = function (...args) {
                                const context = this.getContext('2d')
                                if (context) {
                                    // Add imperceptible noise
                                    const imageData = context.getImageData(0, 0, this.width, this.height)
                                    for (let i = 0; i < imageData.data.length; i += 4) {
                                        imageData.data[i] = imageData.data[i]! + noise // R
                                        imageData.data[i + 1] = imageData.data[i + 1]! + noise // G
                                        imageData.data[i + 2] = imageData.data[i + 2]! + noise // B
                                    }
                                    context.putImageData(imageData, 0, 0)
                                }
                                return originalToDataURL.apply(this, args)
                            }

                            CanvasRenderingContext2D.prototype.getImageData = function (...args) {
                                const imageData = originalGetImageData.apply(this, args)
                                // Add noise to raw pixel data
                                for (let i = 0; i < imageData.data.length; i += 10) {
                                    imageData.data[i] = imageData.data[i]! + noise
                                }
                                return imageData
                            }
                        } catch { /* Canvas override may fail in strict mode */ }

                        // CRITICAL: WebGL fingerprint randomization
                        try {
                            const getParameter = WebGLRenderingContext.prototype.getParameter
                            WebGLRenderingContext.prototype.getParameter = function (parameter) {
                                // Randomize UNMASKED_VENDOR_WEBGL and UNMASKED_RENDERER_WEBGL
                                if (parameter === 37445) { // UNMASKED_VENDOR_WEBGL
                                    return 'Intel Inc.'
                                }
                                if (parameter === 37446) { // UNMASKED_RENDERER_WEBGL
                                    return 'Intel Iris OpenGL Engine'
                                }
                                return getParameter.apply(this, [parameter])
                            }
                        } catch { /* WebGL override may fail */ }

                        // ═══════════════════════════════════════════════════════════════
                        // ANTI-DETECTION LAYER 3: Permissions API masking
                        // ═══════════════════════════════════════════════════════════════

                        // CRITICAL: Mask permissions query (bots have different permissions)
                        try {
                            const originalQuery = navigator.permissions.query
                            // @ts-ignore
                            navigator.permissions.query = (parameters) => {
                                // Always return 'prompt' for notifications (human-like)
                                if (parameters.name === 'notifications') {
                                    return Promise.resolve({ state: 'prompt', onchange: null })
                                }
                                return originalQuery(parameters)
                            }
                        } catch { /* Permissions API may not be available */ }

                        // ═══════════════════════════════════════════════════════════════
                        // ANTI-DETECTION LAYER 4: Plugin/MIME type consistency
                        // ═══════════════════════════════════════════════════════════════

                        // CRITICAL: Add realistic plugins (headless browsers have none)
                        try {
                            Object.defineProperty(navigator, 'plugins', {
                                get: () => [
                                    {
                                        name: 'PDF Viewer',
                                        description: 'Portable Document Format',
                                        filename: 'internal-pdf-viewer',
                                        length: 2
                                    },
                                    {
                                        name: 'Chrome PDF Viewer',
                                        description: 'Portable Document Format',
                                        filename: 'internal-pdf-viewer',
                                        length: 2
                                    }
                                ]
                            })
                        } catch { /* Plugins may be frozen */ }

                        // ═══════════════════════════════════════════════════════════════
                        // Standard styling (non-detection related)
                        // ═══════════════════════════════════════════════════════════════
                        try {
                            const style = document.createElement('style')
                            style.id = '__mrs_fit_style'
                            style.textContent = `
                              html, body { overscroll-behavior: contain; }
                              @media (min-width: 1000px) {
                                html { zoom: 0.9 !important; }
                              }
                            `
                            document.documentElement.appendChild(style)
                        } catch { /* Non-critical: Style injection may fail if DOM not ready */ }
                    })
                } catch (e) {
                    this.bot.log(this.bot.isMobile, 'BROWSER', `Page setup warning: ${e instanceof Error ? e.message : String(e)}`, 'warn')
                }
            })
        } catch (e) {
            this.bot.log(this.bot.isMobile, 'BROWSER', `Context event handler warning: ${e instanceof Error ? e.message : String(e)}`, 'warn')
        }

        await context.addCookies(sessionData.cookies)

        if (saveFingerprint.mobile || saveFingerprint.desktop) {
            await saveFingerprintData(this.bot.config.sessionPath, email, this.bot.isMobile, fingerprint)
        }

        this.bot.log(this.bot.isMobile, 'BROWSER', `Browser ready with UA: "${fingerprint.fingerprint.navigator.userAgent}"`)

        return context as BrowserContext
    }

    private buildPlaywrightProxy(proxy: AccountProxy): { server: string; username?: string; password?: string } | undefined {
        const { url, port, username, password } = proxy
        if (!url) return undefined

        const trimmed = url.trim()
        const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
        const candidate = hasScheme ? trimmed : `http://${trimmed}`

        let parsed: URL
        try {
            parsed = new URL(candidate)
        } catch (err) {
            this.bot.log(this.bot.isMobile, 'BROWSER', `Invalid proxy URL "${url}": ${err instanceof Error ? err.message : String(err)}`, 'error')
            return undefined
        }

        if (!parsed.port) {
            if (port) {
                parsed.port = String(port)
            } else {
                this.bot.log(this.bot.isMobile, 'BROWSER', `Proxy port missing for "${url}"`, 'error')
                return undefined
            }
        }

        const server = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`

        const auth: { username?: string; password?: string } = {}
        if (username) auth.username = username
        if (password) auth.password = password

        return { server, ...auth }
    }

    async generateFingerprint() {
        const fingerPrintData = new FingerprintGenerator().getFingerprint()

        const updatedFingerPrintData = await updateFingerprintUserAgent(fingerPrintData, this.bot.isMobile)

        return updatedFingerPrintData
    }
}

export default Browser