import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { parsePoints, readCurrentPoints } from './current-points.mjs';

// Mirrors StepFun's signed-in top bar: a <header> holding menu icons, the balance
// as an icon plus a bare number, and the avatar.
function page({ header = '', body = '' } = {}) {
  return `<!doctype html><html lang="zh"><body>
    <header class="flex h-16 py-3 px-5 items-center justify-between w-full relative">
      <div class="flex items-center"><svg width="20" height="20"></svg></div>
      <div class="flex items-center gap-2">${header}<img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>
    </header>
    <main>${body}</main>
  </body></html>`;
}

const PILL = '<div class="flex items-center gap-1"><svg width="16" height="16"></svg><span>214</span></div>';
const HOME_BODY = `
  <h1>晚上好，有什麼可以幫你？</h1>
  <button>Agent 模式內測中</button>
  <button>深入核查</button>
  <p>邀好友 得积分</p>`;

test('parsePoints accepts balances and rejects prose', () => {
  assert.equal(parsePoints('214'), 214);
  assert.equal(parsePoints('1,234'), 1234);
  assert.equal(parsePoints('0'), 0);
  assert.equal(parsePoints('积分 214'), 214);
  assert.equal(parsePoints('44积分将在1天内过期'), null);
  assert.equal(parsePoints(''), null);
  assert.equal(parsePoints(null), null);
});

test('readCurrentPoints reads the balance from the signed-in top bar', async (t) => {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    t.skip(`Chromium is not installed: ${error.message.split('\n')[0]}`);
    return;
  }

  const open = async (html) => {
    const context = await browser.newContext();
    const tab = await context.newPage();
    await tab.setContent(html);
    return { tab, context };
  };

  try {
    await t.test('reads the pill next to the avatar', async () => {
      const { tab, context } = await open(page({ header: PILL, body: HOME_BODY }));
      assert.equal(await readCurrentPoints(tab), 214);
      await context.close();
    });

    await t.test('reads a thousands-separated balance', async () => {
      const { tab, context } = await open(
        page({ header: '<div><svg></svg><span>12,480</span></div>', body: HOME_BODY }),
      );
      assert.equal(await readCurrentPoints(tab), 12_480);
      await context.close();
    });

    await t.test('reads a labelled pill when one is shipped', async () => {
      const { tab, context } = await open(
        page({ header: '<button title="积分">积分 214</button>', body: HOME_BODY }),
      );
      assert.equal(await readCurrentPoints(tab), 214);
      await context.close();
    });

    await t.test('ignores numbers outside the top bar', async () => {
      // The points dialog lists 总积分/会员计划/购买积分 and an expiry notice; none of
      // it may override or contradict the balance in the bar.
      const { tab, context } = await open(
        page({
          header: PILL,
          body: `<div><p>总积分</p><p>214</p><p>44积分将在1天内过期</p>
            <p>会员计划</p><p>0</p><p>购买积分</p><p>0</p></div>`,
        }),
      );
      assert.equal(await readCurrentPoints(tab), 214);
      await context.close();
    });

    await t.test('reports nothing when the bar has no balance', async () => {
      const { tab, context } = await open(
        page({ header: '<button>登录</button>', body: HOME_BODY }),
      );
      assert.equal(await readCurrentPoints(tab), null);
      await context.close();
    });

    await t.test('reports nothing when the bar is ambiguous', async () => {
      const { tab, context } = await open(
        page({ header: `<span>7</span>${PILL}`, body: HOME_BODY }),
      );
      assert.equal(await readCurrentPoints(tab), null);
      await context.close();
    });
  } finally {
    await browser.close();
  }
});
