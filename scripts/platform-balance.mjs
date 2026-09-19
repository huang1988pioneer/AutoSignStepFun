// Read the StepFun open platform account balance (https://platform.stepfun.com/account-overview).
// Only the amounts shown on the overview card are read — never API keys, invoices
// or the per-call usage rows on that page.

export const PLATFORM_ORIGIN = 'https://platform.stepfun.com';
export const PLATFORM_BALANCE_URL = PLATFORM_ORIGIN + '/account-overview';
export const PLATFORM_CURRENCY = 'CNY';

const AMOUNT = String.raw`((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)`;
const UNIT = String.raw`(?:元|¥|￥|CNY|RMB)`;

// The overview card labels every amount, so each field is matched from its own
// label. Chinese (both scripts) and the EN toggle are covered; anything else
// reads as "not available" instead of guessing at an unlabelled number.
const FIELDS = [
  {
    key: 'accountBalance',
    labels: ['账户金额', '帳戶金額', '账户余额', '帳戶餘額', 'Account Balance', 'Account Amount'],
  },
  {
    key: 'rechargedTotal',
    labels: ['累计充值金额', '累計充值金額', 'Total Recharge', 'Cumulative Recharge'],
  },
  {
    key: 'giftRemaining',
    labels: ['剩余赠送金额', '剩餘贈送金額', 'Remaining Bonus', 'Remaining Gift'],
  },
  // The two pills inside the card. Their labels are short and appear elsewhere on
  // the page, so these only match when the currency unit follows the number.
  { key: 'apiCredit', labels: ['API'], requireUnit: true },
  { key: 'stepPlanCredit', labels: ['Step Plan'], requireUnit: true },
];

function toNumber(raw) {
  const value = Number(String(raw ?? '').replaceAll(',', ''));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Parse a single amount cell, with or without its currency unit. */
export function parseAmount(text) {
  const pattern = new RegExp(
    String.raw`^\s*(?:¥|￥)?\s*` + AMOUNT + String.raw`\s*` + UNIT + String.raw`?\s*$`,
    'i',
  );
  const match = String(text ?? '').replace(/\s+/g, ' ').match(pattern);
  return match ? toNumber(match[1]) : null;
}

function escapeForRegExp(label) {
  return label.replace(/[.*+?^${}()|[\]\\]/g, (character) => '\\' + character);
}

function labelPattern(label, requireUnit) {
  // Only whitespace and a separator may sit between the label and its amount, so
  // a neighbouring row's number can never be read into the wrong field.
  return new RegExp(
    escapeForRegExp(label) +
      String.raw`[\s:：]*(?:¥|￥)?\s*` +
      AMOUNT +
      (requireUnit ? String.raw`\s*` + UNIT : ''),
    'i',
  );
}

/**
 * Pull the balance amounts out of the overview page text.
 * Returns null when no labelled amount was present at all (still loading, or a
 * different page), so callers can report it as unavailable rather than as zero.
 */
export function parsePlatformBalance(text) {
  const source = String(text ?? '');
  const balance = { currency: PLATFORM_CURRENCY };
  let found = 0;

  for (const field of FIELDS) {
    let value = null;
    for (const label of field.labels) {
      const match = source.match(labelPattern(label, field.requireUnit));
      value = match ? toNumber(match[1]) : null;
      if (value !== null) break;
    }
    balance[field.key] = value;
    if (value !== null) found += 1;
  }

  return found ? balance : null;
}

export function isPlatformLoginUrl(url) {
  try {
    return /^\/(?:login|signin|sign-in|user\/login)\b/.test(new URL(String(url)).pathname);
  } catch {
    return false;
  }
}

async function isPlatformLoggedOut(page) {
  if (isPlatformLoginUrl(page.url())) return true;

  const buttonNames = [/^log in$/i, /^sign in$/i, /^登录$/, /^登入$/, /^立即登录$/, /^立即登入$/];
  for (const name of buttonNames) {
    if (await page.getByRole('button', { name, exact: true }).first().isVisible().catch(() => false)) {
      return true;
    }
  }

  const phoneInput = page.locator(
    'input[type="tel"], input[placeholder*="手机号"], input[placeholder*="手機號"]',
  );
  return await phoneInput.first().isVisible().catch(() => false);
}

function cleanError(error) {
  return String(error?.message ?? error).replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * Open the open platform overview page and read the account balance.
 * Resolves to { status, balance, message } where status is 'ok',
 * 'login_required' (the platform needs its own signed-in session) or
 * 'unavailable'. It never throws for a missing balance: the daily check-in must
 * not fail because of this extra read.
 */
export async function readPlatformBalance(page, { attempts = 4, waitMs = 1500 } = {}) {
  try {
    await page.goto(PLATFORM_BALANCE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  } catch (error) {
    return {
      status: 'unavailable',
      balance: null,
      message: 'Could not open ' + PLATFORM_BALANCE_URL + ': ' + cleanError(error),
    };
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await page.waitForTimeout(waitMs);
    if (await isPlatformLoggedOut(page)) {
      return {
        status: 'login_required',
        balance: null,
        message:
          'The open platform (' +
          PLATFORM_ORIGIN +
          ') has no signed-in session. Sign in to it while capturing the login state, or set STEPFUN_PLATFORM_STORAGE_STATE_B64.',
      };
    }

    const text = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
    const balance = parsePlatformBalance(text);
    if (balance) {
      return {
        status: 'ok',
        balance: { ...balance, readAt: new Date().toISOString() },
        message: 'Read the open platform balance.',
      };
    }
  }

  return {
    status: 'unavailable',
    balance: null,
    message:
      'No labelled balance amount was found on ' +
      PLATFORM_BALANCE_URL +
      '. The page layout may have changed.',
  };
}

/** One-line rendering for logs and the job summary, e.g. "15.00 元". */
export function formatAmount(value, currency = PLATFORM_CURRENCY) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const unit = currency === PLATFORM_CURRENCY ? ' 元' : ' ' + currency;
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + unit;
}
