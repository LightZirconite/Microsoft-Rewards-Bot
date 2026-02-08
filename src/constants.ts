/**
 * Central constants for the Microsoft Rewards Script
 * All timeouts, retry limits, delays, selectors, and other magic numbers are defined here
 */

/**
 * Parse environment variable as number with validation
 * @param key Environment variable name
 * @param defaultValue Default value if parsing fails or out of range
 * @param min Minimum allowed value
 * @param max Maximum allowed value
 * @returns Parsed number or default value
 */
function parseEnvNumber(
  key: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    queueMicrotask(() => {
      import("./util/notifications/Logger")
        .then(({ log }) => {
          log(
            "main",
            "CONSTANTS",
            `Invalid ${key}="${raw}" (not a finite number), using default: ${defaultValue}`,
            "warn",
          );
        })
        .catch(() => {
          process.stderr.write(
            `[Constants] Invalid ${key}="${raw}" (not a finite number), using default: ${defaultValue}\n`,
          );
        });
    });
    return defaultValue;
  }

  if (parsed < min || parsed > max) {
    queueMicrotask(() => {
      import("./util/notifications/Logger")
        .then(({ log }) => {
          log(
            "main",
            "CONSTANTS",
            `${key}=${parsed} out of range [${min}, ${max}], using default: ${defaultValue}`,
            "warn",
          );
        })
        .catch(() => {
          process.stderr.write(
            `[Constants] ${key}=${parsed} out of range [${min}, ${max}], using default: ${defaultValue}\n`,
          );
        });
    });
    return defaultValue;
  }

  return parsed;
}

// Login timeout boundaries (in milliseconds)
const LOGIN_TIMEOUT_MIN_MS = 30000; // 30 seconds - minimum login wait
const LOGIN_TIMEOUT_MAX_MS = 600000; // 10 minutes - maximum login wait
const LOGIN_TIMEOUT_DEFAULT_MS = 180000; // 3 minutes - default login timeout

export const TIMEOUTS = {
  SHORT: 500,
  ONE_SECOND: 1000,
  MEDIUM: 1500,
  MEDIUM_LONG: 2000,
  LONG: 3000,
  VERY_LONG: 5000,
  EXTRA_LONG: 10000,
  ACTIVITY_PAGE_LOAD: 4000, // Standard wait after activity interactions (LONG + 1s buffer)
  SMART_WAIT_EXTENDED: 8000, // Extended smart-wait timeout for page transitions
  DASHBOARD_WAIT: 10000,
  LOGIN_MAX: parseEnvNumber(
    "LOGIN_MAX_WAIT_MS",
    LOGIN_TIMEOUT_DEFAULT_MS,
    LOGIN_TIMEOUT_MIN_MS,
    LOGIN_TIMEOUT_MAX_MS,
  ),
  NETWORK_IDLE: 5000,
  ONE_MINUTE: 60000,
  FIVE_MINUTES: 300000,
  TEN_MINUTES: 600000,
  ONE_HOUR: 3600000,
  TWO_MINUTES: 120000,
} as const;

export const RETRY_LIMITS = {
  MAX_ITERATIONS: 5,
  DASHBOARD_RELOAD: 2,
  MOBILE_SEARCH: 3,
  ABC_MAX: 15,
  POLL_MAX: 15,
  QUIZ_MAX: 15,
  QUIZ_ANSWER_TIMEOUT: 10000,
  GO_HOME_MAX: 5,
} as const;

export const DELAYS = {
  ACTION_MIN: 1000,
  ACTION_MAX: 3000,
  SEARCH_DEFAULT_MIN: 2000,
  SEARCH_DEFAULT_MAX: 5000,
  BROWSER_CLOSE: 2000,
  TYPING_DELAY: 20,
  SEARCH_ON_BING_WAIT: 5000,
  SEARCH_ON_BING_COMPLETE: 3000,
  SEARCH_ON_BING_FOCUS: 200,
  SEARCH_BAR_TIMEOUT: 15000,
  QUIZ_ANSWER_WAIT: 2000,
  THIS_OR_THAT_START: 2000,
} as const;

export const SELECTORS = {
  // FIXED: Use more specific selector to avoid strict mode violation (2 elements with id='more-activities')
  // Target the mee-card-group element specifically, not the div wrapper
  MORE_ACTIVITIES: 'mee-card-group#more-activities[role="list"]',
  // IMPROVED: Expanded fallback selectors to handle Microsoft's frequent HTML structure changes
  MORE_ACTIVITIES_FALLBACKS: [
    "mee-card-group#more-activities", // Without role attribute
    "#more-activities", // ID only (most permissive)
    '[id="more-activities"]', // Attribute selector
    'mee-card-group[role="list"]', // Element type with role (catches any list-type card group)
    "mee-card-group", // Ultra-permissive: any mee-card-group element
    ".daily-sets", // Class-based fallback
    '[data-bi-name="daily-set"]', // Data attribute fallback
    "main#daily-sets", // Main content area
    'main[data-bi-name="dashboard"]', // Dashboard root element
    ".mee-card", // Individual card element
    '[class*="rewards"]', // Any element with rewards in class name
  ],
  SUSPENDED_ACCOUNT: "#suspendedAccountHeader",
  QUIZ_COMPLETE: "#quizCompleteContainer",
  QUIZ_CREDITS: "span.rqMCredits",
} as const;

export const URLS = {
  REWARDS_BASE: "https://rewards.bing.com",
  REWARDS_REDEEM: "https://rewards.bing.com/redeem",
  REWARDS_DASHBOARD: "https://www.bing.com/rewards/dashboard",
  REWARDS_API_BASE: "https://prod.rewardsplatform.microsoft.com",
  REWARDS_API_ME: "https://prod.rewardsplatform.microsoft.com/dapi/me",
  REWARDS_API_ACTIVITIES:
    "https://prod.rewardsplatform.microsoft.com/dapi/me/activities",
  APP_USER_DATA:
    "https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613",
  BING_HOME: "https://www.bing.com",
  BING_SEARCH: "https://www.bing.com/search",
  BING_SIGNIN:
    "https://www.bing.com/fd/auth/signin?action=interactive&provider=windows_live_id&return_url=https%3A%2F%2Fwww.bing.com%2F",
} as const;

export const DISCORD = {
  MAX_EMBED_LENGTH: 1900,
  RATE_LIMIT_DELAY: 500,
  WEBHOOK_TIMEOUT: 10000,
  DEBOUNCE_DELAY: 750,
  COLOR_RED: 0xff0000,
  COLOR_CRIMSON: 0xdc143c,
  COLOR_ORANGE: 0xffa500,
  COLOR_BLUE: 0x3498db,
  COLOR_GREEN: 0x00d26a,
  COLOR_GRAY: 0x95a5a6,
  WEBHOOK_USERNAME: "Microsoft-Rewards-Bot",
  AVATAR_URL:
    "https://raw.githubusercontent.com/LightZirconite/Microsoft-Rewards-Bot/main/assets/logo.png",
} as const;

export const LOGGER_CLEANUP = {
  BUFFER_MAX_AGE_MS: TIMEOUTS.ONE_HOUR,
  BUFFER_CLEANUP_INTERVAL_MS: TIMEOUTS.TEN_MINUTES,
} as const;

export const DISMISSAL_DELAYS = {
  BETWEEN_BUTTONS: 150, // Delay between dismissing multiple popup buttons
  AFTER_DIALOG_CLOSE: 1000, // Wait for dialog close animation to complete
} as const;
