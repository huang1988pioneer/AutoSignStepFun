import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLATFORM_BALANCE_URL,
  formatAmount,
  isPlatformLoginUrl,
  parseAmount,
  parsePlatformBalance,
} from './platform-balance.mjs';

// The overview card as the page renders it: the big account amount keeps its
// unit on its own line, the two gift pills keep theirs inline.
const OVERVIEW_ZH_CN = [
  '用量和费用',
  '账户金额',
  '15.00',
  '元',
  '累计充值金额 0.00元',
  '剩余赠送金额 15.00元',
  'API 15.00元',
  'Step Plan 0.00元',
  '余额不足提醒',
  '使用详情',
  '扣费来源 Step Plan',
  '2026-08-20 - 2026-09-19',
  '调用时间 模型 调用次数 Credit用量',
  '暂无更多',
].join('\n');

test('parses a single amount with or without its unit', () => {
  assert.equal(parseAmount('15.00元'), 15);
  assert.equal(parseAmount(' ¥ 1,234.50 '), 1234.5);
  assert.equal(parseAmount('0.00 CNY'), 0);
  assert.equal(parseAmount('無'), null);
  assert.equal(parseAmount('15.00元 / 月'), null);
  assert.equal(parseAmount(''), null);
});

test('reads every labelled amount from the overview card', () => {
  assert.deepEqual(parsePlatformBalance(OVERVIEW_ZH_CN), {
    currency: 'CNY',
    accountBalance: 15,
    rechargedTotal: 0,
    giftRemaining: 15,
    apiCredit: 15,
    stepPlanCredit: 0,
  });
});

test('reads the traditional Chinese and English renderings', () => {
  const zhTw = '帳戶金額\n1,280.50\n元\n累計充值金額 1,300.00元\n剩餘贈送金額 20.00元';
  const zhTwBalance = parsePlatformBalance(zhTw);
  assert.equal(zhTwBalance.accountBalance, 1280.5);
  assert.equal(zhTwBalance.rechargedTotal, 1300);
  assert.equal(zhTwBalance.giftRemaining, 20);
  assert.equal(zhTwBalance.apiCredit, null);

  const en = 'Account Balance ¥15.00 Total Recharge ¥0.00 Remaining Bonus ¥15.00';
  const enBalance = parsePlatformBalance(en);
  assert.equal(enBalance.accountBalance, 15);
  assert.equal(enBalance.rechargedTotal, 0);
  assert.equal(enBalance.giftRemaining, 15);
});

test('returns null when the page carries no labelled amount', () => {
  assert.equal(parsePlatformBalance('用量和费用\n加载中…'), null);
  assert.equal(parsePlatformBalance(''), null);
  assert.equal(parsePlatformBalance(null), null);
});

test('never reads a neighbouring row into the wrong field', () => {
  // A still-loading card: the label is present but its amount is not, and the
  // next row's number must not be picked up for it.
  const loading = '账户金额\n--\n元\n累计充值金额 0.00元';
  const balance = parsePlatformBalance(loading);
  assert.equal(balance.accountBalance, null);
  assert.equal(balance.rechargedTotal, 0);

  // The usage filter also says "Step Plan", but without an amount.
  const filterOnly = '账户金额 15.00元\n扣费来源 Step Plan\n2026-08-20';
  assert.equal(parsePlatformBalance(filterOnly).stepPlanCredit, null);
});

test('detects the platform login page from its URL', () => {
  assert.equal(isPlatformLoginUrl(PLATFORM_BALANCE_URL), false);
  assert.equal(isPlatformLoginUrl('https://platform.stepfun.com/login?redirect=%2F'), true);
  assert.equal(isPlatformLoginUrl('https://platform.stepfun.com/user/login'), true);
  assert.equal(isPlatformLoginUrl('not a url'), false);
});

test('formats amounts for the summary, and rejects unusable values', () => {
  assert.equal(formatAmount(15), '15.00 元');
  assert.equal(formatAmount(1234.5), '1,234.50 元');
  assert.equal(formatAmount(0), '0.00 元');
  assert.equal(formatAmount(null), null);
  assert.equal(formatAmount(-1), null);
  assert.equal(formatAmount(15, 'USD'), '15.00 USD');
});
