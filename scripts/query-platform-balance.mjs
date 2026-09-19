// Read the StepFun open platform balance on its own, without running a check-in.
//   node scripts/query-platform-balance.mjs [storage-state.json]
// The login state comes from the file argument, STEPFUN_PLATFORM_STORAGE_STATE_B64
// or STEPFUN_STORAGE_STATE_B64, in that order.
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCookieHeader, resolveBrowserEngine, storageStateFile } from './browser-session.mjs';
import { PLATFORM_ORIGIN, formatAmount, readPlatformBalance } from './platform-balance.mjs';

const STATE_FILE = process.argv[2];
const PLATFORM_STATE_B64 = process.env.STEPFUN_PLATFORM_STORAGE_STATE_B64;
const STATE_B64 = process.env.STEPFUN_STORAGE_STATE_B64;
const PLATFORM_COOKIE_HEADER = process.env.STEPFUN_PLATFORM_COOKIE;
const BROWSER_NAME = process.env.STEPFUN_BROWSER || 'chromium';
const SCREENSHOT_DIR = process.env.STEPFUN_SCREENSHOT_DIR || './screenshots';

async function main() {
  const stateB64 = PLATFORM_STATE_B64 || STATE_B64;
  const variableName = PLATFORM_STATE_B64
    ? 'STEPFUN_PLATFORM_STORAGE_STATE_B64'
    : 'STEPFUN_STORAGE_STATE_B64';
  const state = STATE_FILE ? null : await storageStateFile(stateB64, variableName);
  if (!STATE_FILE && !state && !PLATFORM_COOKIE_HEADER) {
    throw new Error(
      'Pass a storage-state file, or set STEPFUN_PLATFORM_STORAGE_STATE_B64, STEPFUN_STORAGE_STATE_B64 or STEPFUN_PLATFORM_COOKIE.',
    );
  }

  const browserInfo = resolveBrowserEngine(BROWSER_NAME);
  const browser = await browserInfo.engine.launch(browserInfo.launchOptions);
  const storageState = STATE_FILE ?? state?.file;

  try {
    const context = await browser.newContext({
      ...(storageState ? { storageState } : {}),
      ...browserInfo.contextOptions,
    });
    if (PLATFORM_COOKIE_HEADER) {
      await context.addCookies(
        parseCookieHeader(PLATFORM_COOKIE_HEADER, PLATFORM_ORIGIN + '/', 'STEPFUN_PLATFORM_COOKIE'),
      );
    }

    const page = await context.newPage();
    const outcome = await readPlatformBalance(page);
    console.log(JSON.stringify(outcome, null, 2));

    if (outcome.status === 'ok') {
      const { accountBalance, giftRemaining, currency } = outcome.balance;
      console.log(
        '帳戶金額 ' + (formatAmount(accountBalance, currency) ?? '—') +
          '（剩餘贈送 ' + (formatAmount(giftRemaining, currency) ?? '—') + '）',
      );
    } else {
      await mkdir(SCREENSHOT_DIR, { recursive: true });
      const path = join(
        SCREENSHOT_DIR,
        'platform-balance-' + new Date().toISOString().replaceAll(/[:.]/g, '-') + '.png',
      );
      await page.screenshot({ path, fullPage: true }).catch(() => {});
      console.error('Screenshot saved: ' + path);
      process.exitCode = 1;
    }

    await context.close();
  } finally {
    await browser.close();
    if (state?.directory) await rm(state.directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(String(error?.message ?? error));
  process.exitCode = 1;
});
