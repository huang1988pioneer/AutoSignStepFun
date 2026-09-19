import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCookieHeader, resolveBrowserEngine, storageStateFile } from './browser-session.mjs';
import { readCurrentPoints } from './current-points.mjs';
import { PLATFORM_ORIGIN, formatAmount, readPlatformBalance } from './platform-balance.mjs';
import { canRotate, inspectSession, updateRepositorySecret } from './session-store.mjs';
import { isDailyCheckInMissionRequest, parseMissionResult } from './stepfun-mission.mjs';

const ORIGIN = 'https://chat.stepfun.com';
const HOME_URL = ORIGIN + '/';
const CHECK_IN_URL = ORIGIN + '/newcomers';
const ACCOUNT_NAME = process.env.STEPFUN_ACCOUNT_NAME ?? 'default';
const ACCOUNT_NUMBER = Number(process.env.STEPFUN_ACCOUNT_NUMBER) || null;
const STATE_B64 = process.env.STEPFUN_STORAGE_STATE_B64;
const COOKIE_HEADER = process.env.STEPFUN_COOKIE;
const MAX_RETRIES = Number(process.env.STEPFUN_MAX_RETRIES) || 2;
const SCREENSHOT_DIR = process.env.STEPFUN_SCREENSHOT_DIR || './screenshots';
const RESULT_DIR = process.env.STEPFUN_RESULT_DIR || './artifacts';
const SESSION_WARN_DAYS = Number(process.env.STEPFUN_SESSION_WARN_DAYS) || 7;
const BROWSER_NAME = (process.env.STEPFUN_BROWSER || 'chromium').trim().toLowerCase();
const SECRET_WRITE_TOKEN = process.env.STEPFUN_SECRET_WRITE_TOKEN;
const PLATFORM_STATE_B64 = process.env.STEPFUN_PLATFORM_STORAGE_STATE_B64;
const PLATFORM_COOKIE_HEADER = process.env.STEPFUN_PLATFORM_COOKIE;
// The daily check-in is the fixed job; reading the open platform balance is an
// extra the operator asks for, so it stays off unless STEPFUN_PLATFORM_BALANCE
// is switched on (the workflow exposes it as a manual-run input).
const READ_PLATFORM_BALANCE = /^(?:1|true|yes|on)$/i.test((process.env.STEPFUN_PLATFORM_BALANCE ?? '').trim());
const SECRET_NAME =
  process.env.STEPFUN_SECRET_NAME ||
  (ACCOUNT_NUMBER ? 'STEPFUN_STORAGE_STATE_B64_' + ACCOUNT_NUMBER : null);
const REPOSITORY = process.env.GITHUB_REPOSITORY;
const GITHUB_API_URL = process.env.GITHUB_API_URL || 'https://api.github.com';

const sessionReport = { session: null, rotation: null };
let currentPoints = null;
let platformBalance = null;
let sessionEverValid = false;
let refreshedState = null;

const DAILY_CHECK_IN_TEXT_RE = /(?:每日|每天|今日|今天)\s*(?:簽到|签到)|daily\s*(?:check.?in|sign.?in)/i;
const ALREADY_CHECKED_IN_TEXT_RE =
  /(?:今日|今天|当天|本日)\s*(?:已簽到|已签到|已領取|已领取)|(?:已簽到|已签到|已領取|已领取)|(?:come\s*back|see\s*you)\s*tomorrow|明天(?:再来|再來|见|見)/i;

function log(message) {
  console.log('[account ' + ACCOUNT_NAME + '] ' + message);
}

function warn(message) {
  console.warn('::warning::[account ' + ACCOUNT_NAME + '] ' + message);
}

function sessionError(message) {
  const error = new Error(message);
  error.kind = 'session';
  return error;
}

function cleanError(error) {
  return String(error?.message ?? error).replace(/\s+/g, ' ').trim().slice(0, 600);
}

async function writeClaimResult(status, message) {
  await mkdir(RESULT_DIR, { recursive: true });
  const result = {
    account: ACCOUNT_NUMBER,
    name: ACCOUNT_NAME,
    status,
    message,
    currentPoints,
    platformBalance,
    finishedAt: new Date().toISOString(),
    ...sessionReport,
  };
  await writeFile(join(RESULT_DIR, 'claim-result.json'), JSON.stringify(result, null, 2) + '\n');
}

function reportSessionLifetime(state, label) {
  const info = inspectSession(state);
  sessionReport.session = { ...info, checkedAt: new Date().toISOString() };

  if (info.daysLeft === null) {
    log('Session (' + label + '): ' + info.cookieCount + ' cookie(s); expiry cannot be predicted.');
    return;
  }

  const detail =
    'expires ' + info.expiresAt + ' (' + info.daysLeft + 'd left, from ' + info.source + ')';
  if (info.daysLeft <= SESSION_WARN_DAYS) {
    warn(
      'Login credential ' + detail + '. Re-run StepFunFlow login and update ' +
        (SECRET_NAME ?? 'the storage-state Secret') + ' before it lapses.',
    );
  } else {
    log('Session (' + label + '): ' + detail + '.');
  }
}

async function rotateStoredSession(previous, next) {
  if (!next) return;
  if (!SECRET_WRITE_TOKEN) {
    sessionReport.rotation = { rotated: false, reason: 'STEPFUN_SECRET_WRITE_TOKEN not configured' };
    return;
  }
  if (!REPOSITORY || !SECRET_NAME) {
    sessionReport.rotation = {
      rotated: false,
      reason: 'GITHUB_REPOSITORY or the target secret name is unknown',
    };
    return;
  }

  const verdict = canRotate(previous ?? { cookies: [], origins: [] }, next);
  if (!verdict.ok) {
    sessionReport.rotation = { rotated: false, reason: verdict.reason, secret: SECRET_NAME };
    if (verdict.reason !== 'unchanged') warn('Not rotating ' + SECRET_NAME + ': ' + verdict.reason + '.');
    return;
  }

  try {
    await updateRepositorySecret({
      repository: REPOSITORY,
      secretName: SECRET_NAME,
      value: Buffer.from(JSON.stringify(next), 'utf8').toString('base64'),
      token: SECRET_WRITE_TOKEN,
      apiUrl: GITHUB_API_URL,
    });
    sessionReport.rotation = { rotated: true, secret: SECRET_NAME };
    log('Rotated ' + SECRET_NAME + ' with the refreshed login state.');
  } catch (error) {
    sessionReport.rotation = { rotated: false, reason: cleanError(error), secret: SECRET_NAME };
    warn('Could not rotate ' + SECRET_NAME + ': ' + cleanError(error));
  }
}

async function saveScreenshot(page, label) {
  try {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    const safeAccount = ACCOUNT_NAME.replaceAll(/[^a-z0-9._-]+/gi, '-');
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    const path = join(SCREENSHOT_DIR, 'account-' + safeAccount + '-' + label + '-' + timestamp + '.png');
    await page.screenshot({ path, fullPage: true });
    log('Screenshot saved: ' + path);
  } catch (error) {
    warn('Could not save screenshot: ' + cleanError(error));
  }
}

async function waitForStable(page, ms = 1200) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(ms);
}

async function clickDailyCheckIn(page) {
  const candidates = page
    .locator(
      'button:visible, a:visible, [role="button"]:visible, [class*="cursor-pointer"]:visible, [class*="clickable"]:visible',
    )
    .filter({ hasText: DAILY_CHECK_IN_TEXT_RE });
  const count = await candidates.count().catch(() => 0);

  for (let index = 0; index < Math.min(count, 12); index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    const label = ((await candidate.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (!label || ALREADY_CHECKED_IN_TEXT_RE.test(label)) continue;
    await candidate.scrollIntoViewIfNeeded().catch(() => {});
    const clicked = await candidate.click({ timeout: 5_000 }).then(() => true).catch(() => false);
    if (!clicked) continue;
    log('Clicked the StepFun daily check-in control: ' + label.slice(0, 120));
    return true;
  }

  // Some revisions render the label in a nested span inside a clickable card.
  const labels = page.getByText(DAILY_CHECK_IN_TEXT_RE);
  const labelCount = await labels.count().catch(() => 0);
  for (let index = 0; index < Math.min(labelCount, 12); index += 1) {
    const label = labels.nth(index);
    if (!(await label.isVisible().catch(() => false))) continue;
    const text = ((await label.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    if (!text || ALREADY_CHECKED_IN_TEXT_RE.test(text)) continue;
    const clickableAncestor = label.locator(
      'xpath=ancestor-or-self::*[self::button or self::a or @role="button" or contains(@class,"cursor-pointer") or contains(@class,"clickable")][1]',
    );
    if (await clickableAncestor.count().catch(() => 0)) {
      await clickableAncestor.scrollIntoViewIfNeeded().catch(() => {});
      const clicked = await clickableAncestor.click({ timeout: 5_000 }).then(() => true).catch(() => false);
      if (!clicked) continue;
      log('Clicked the StepFun daily check-in card: ' + text.slice(0, 120));
      return true;
    }
  }

  return false;
}

async function isAlreadyCheckedIn(page) {
  const indicator = page.getByText(ALREADY_CHECKED_IN_TEXT_RE);
  for (let index = 0, count = await indicator.count().catch(() => 0); index < Math.min(count, 12); index += 1) {
    if (await indicator.nth(index).isVisible().catch(() => false)) return true;
  }
  return false;
}

async function isLoggedOut(page) {
  const buttonNames = [/^log in$/i, /^sign in$/i, /^登录$/, /^登入$/];
  for (const name of buttonNames) {
    if (await page.getByRole('button', { name, exact: true }).first().isVisible().catch(() => false)) {
      return true;
    }
  }

  const loggedOutCopy = page.getByText(
    /please log in to access your history|请登录(?:后)?(?:查看|访问)|請登入(?:後)?(?:查看|存取)/i,
  );
  if (await loggedOutCopy.first().isVisible().catch(() => false)) return true;

  // The newcomer page is a phone-registration form when there is no signed-in
  // account. We use this only on that page, never as a broad page-level match.
  if (new URL(page.url()).pathname === '/newcomers') {
    const phoneInput = page.locator(
      'input[type="tel"], input[placeholder*="手机号"], input[placeholder*="手機號"]',
    );
    if (await phoneInput.first().isVisible().catch(() => false)) return true;
  }

  return false;
}

function observeDailyMission(page, timeoutMs = 20_000) {
  let resolveResult;
  let settled = false;
  const result = new Promise((resolve) => {
    resolveResult = resolve;
  });

  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    page.off('response', listener);
    resolveResult(value);
  };

  const listener = async (response) => {
    try {
      const request = response.request();
      if (!isDailyCheckInMissionRequest(request)) return;
      const payload = await response.json().catch(() => null);
      finish({ status: response.status(), ...parseMissionResult(payload) });
    } catch (error) {
      finish({ ok: false, message: 'Could not read daily_check_in response: ' + cleanError(error) });
    }
  };

  const timeout = setTimeout(() => finish(null), timeoutMs);
  page.on('response', listener);
  return { result, cancel: () => finish(null) };
}

async function refreshStateAndPoints(context, page) {
  try {
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitForStable(page, 900);
    if (!await isLoggedOut(page)) {
      currentPoints = await readCurrentPoints(page);
      if (currentPoints !== null) log('Current points: ' + currentPoints);
    }
  } catch (error) {
    warn('Could not refresh the post-check-in dashboard: ' + cleanError(error));
  }

  refreshedState = await context.storageState().catch((error) => {
    warn('Could not read refreshed storage state: ' + cleanError(error));
    return refreshedState;
  });
}

async function tryCheckInOnce(browser, state, contextOptions) {
  currentPoints = null;
  const context = await browser.newContext({
    ...(state ? { storageState: state.file } : {}),
    ...contextOptions,
  });
  if (COOKIE_HEADER) await context.addCookies(parseCookieHeader(COOKIE_HEADER, HOME_URL));

  const page = await context.newPage();
  let sessionValid = false;
  let missionObserver = null;

  try {
    log('Opening StepFun home page to validate the stored session…');
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForStable(page);
    if (await isLoggedOut(page)) {
      await saveScreenshot(page, 'login-expired');
      throw sessionError(
        'The stored StepFun login is expired. Refresh STEPFUN_STORAGE_STATE_B64 or STEPFUN_COOKIE; this workflow never bypasses OTP, login, or CAPTCHA.',
      );
    }

    sessionValid = true;
    sessionEverValid = true;
    missionObserver = observeDailyMission(page);
    log('Opening StepFun newcomer benefits page and waiting for its official daily_check_in event…');
    await page.goto(CHECK_IN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForStable(page);
    if (await isLoggedOut(page)) {
      await saveScreenshot(page, 'login-expired');
      throw sessionError('The session became unauthenticated before StepFun completed the check-in.');
    }

    await clickDailyCheckIn(page);
    const mission = await missionObserver.result;
    if (!mission) {
      if (await isAlreadyCheckedIn(page)) {
        log('StepFun shows that this account already checked in today.');
        return true;
      }
      await saveScreenshot(page, 'daily-check-in-not-observed');
      warn('No daily_check_in request was observed while visiting /newcomers.');
      return false;
    }
    if (!mission.ok) {
      await saveScreenshot(page, 'daily-check-in-rejected');
      throw new Error(
        'StepFun did not accept daily_check_in (HTTP ' + (mission.status ?? 'unknown') + '): ' + mission.message,
      );
    }

    await saveScreenshot(page, 'daily-check-in-accepted');
    log(
      mission.alreadyClaimed
        ? 'StepFun confirms this account already checked in today.'
        : 'StepFun accepted the official daily_check_in event.',
    );
    return true;
  } finally {
    missionObserver?.cancel();
    if (sessionValid) await refreshStateAndPoints(context, page);
    await context.close();
  }
}

/**
 * Read the open platform balance after the check-in, in its own context.
 * The platform is a separate site from the chat app: it uses the dedicated
 * platform login state when one is configured, otherwise the chat login state,
 * which only reaches it when the same browser session also signed in there.
 * A missing balance is reported, never fatal.
 */
async function readBalance(browser, chatState, contextOptions) {
  const platformState = PLATFORM_STATE_B64
    ? await storageStateFile(PLATFORM_STATE_B64, 'STEPFUN_PLATFORM_STORAGE_STATE_B64').catch((error) => {
        warn(cleanError(error));
        return undefined;
      })
    : chatState;
  const context = await browser.newContext({
    ...(platformState ? { storageState: platformState.file } : {}),
    ...contextOptions,
  });
  // A chat Cookie header does not authenticate the platform, so only the
  // platform's own header is planted here.
  if (PLATFORM_COOKIE_HEADER) {
    await context.addCookies(
      parseCookieHeader(PLATFORM_COOKIE_HEADER, PLATFORM_ORIGIN + '/', 'STEPFUN_PLATFORM_COOKIE'),
    );
  }
  const page = await context.newPage();

  try {
    log('Opening the StepFun open platform account overview to read the balance…');
    const outcome = await readPlatformBalance(page);
    platformBalance = {
      status: outcome.status,
      message: outcome.message,
      ...(outcome.balance ?? {}),
    };

    if (outcome.status === 'ok') {
      const amount = formatAmount(outcome.balance.accountBalance, outcome.balance.currency);
      log('Open platform balance: ' + (amount ?? 'account amount not shown') +
        ' (' + PLATFORM_ORIGIN + ')');
    } else {
      await saveScreenshot(page, 'platform-balance-' + outcome.status.replaceAll('_', '-'));
      warn('Could not read the open platform balance: ' + outcome.message);
    }
  } catch (error) {
    platformBalance = { status: 'unavailable', message: cleanError(error) };
    warn('Could not read the open platform balance: ' + cleanError(error));
  } finally {
    await context.close().catch(() => {});
    if (platformState && platformState !== chatState) {
      await rm(platformState.directory, { recursive: true, force: true });
    }
  }
}

async function main() {
  if (!STATE_B64 && !COOKIE_HEADER) {
    throw new Error('Set STEPFUN_STORAGE_STATE_B64 (recommended) or STEPFUN_COOKIE in GitHub Actions secrets.');
  }

  const state = await storageStateFile(STATE_B64, 'STEPFUN_STORAGE_STATE_B64');
  let browser;
  let contextOptions = {};
  let claimed = false;
  let resultMessage = 'Daily check-in was not completed.';

  try {
    const browserInfo = resolveBrowserEngine(BROWSER_NAME);
    contextOptions = browserInfo.contextOptions;
    log('Using Playwright browser: ' + browserInfo.name);
    browser = await browserInfo.engine.launch(browserInfo.launchOptions);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      log('Attempt ' + attempt + '/' + MAX_RETRIES);
      try {
        if (await tryCheckInOnce(browser, state, browserInfo.contextOptions)) {
          claimed = true;
          resultMessage = 'StepFun accepted the daily_check_in event.';
          return;
        }
      } catch (error) {
        if (error?.kind === 'session') throw error;
        warn('Attempt ' + attempt + ' failed: ' + cleanError(error));
        resultMessage = cleanError(error);
      }

      if (attempt < MAX_RETRIES) {
        const delayMs = attempt * 4_000;
        log('Waiting ' + delayMs / 1000 + 's before retry…');
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error(
      'StepFun daily_check_in was not confirmed after all retries. Check the workflow screenshots; the eligibility or the site flow may have changed.',
    );
  } catch (error) {
    resultMessage = cleanError(error);
    throw error;
  } finally {
    // The balance is extra reporting, so it runs after the check-in verdict is
    // settled and only when there is a session that can reach the platform.
    if (browser && READ_PLATFORM_BALANCE && (PLATFORM_STATE_B64 || PLATFORM_COOKIE_HEADER || sessionEverValid)) {
      await readBalance(browser, state, contextOptions);
    }
    await browser?.close();
    if (refreshedState) {
      reportSessionLifetime(refreshedState, 'after run');
      await rotateStoredSession(state?.parsed, refreshedState);
    } else if (state?.parsed) {
      reportSessionLifetime(state.parsed, 'stored secret');
    }
    await writeClaimResult(claimed ? 'checked_in' : 'failed', resultMessage);
    if (state?.directory) await rm(state.directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('::error::[account ' + ACCOUNT_NAME + '] ' + cleanError(error));
  process.exitCode = 1;
});
