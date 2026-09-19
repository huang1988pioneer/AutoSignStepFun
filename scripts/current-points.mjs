// Read only the account points balance, never rewards, expiry notices or pricing.

// The balance is rendered as a bare number next to an icon, so the text we accept
// is deliberately narrow: digits with optional thousands separators, nothing else.
const POINTS_ONLY_RE = /^\s*\d{1,3}(?:,\d{3})*\s*$/;

export function parsePoints(text) {
  const match = String(text ?? '').trim().match(
    /^(?:(?:點數|点数|積分|积分|Credits|Points)\s*[:：]?\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:FREE|BASE|PRO|PLUS|PREMIUM|點|点|积分|積分)?$/i,
  );
  if (!match) return null;
  const value = Number(match[0].match(/\d[\d,.]*/)[0].replaceAll(',', ''));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * StepFun puts the balance in the top bar with no label of its own — just an icon
 * and the number. Scoping to <header> is what makes a numeric match safe: that bar
 * holds the menu icons, the balance and the avatar, while the rest of the page is
 * prose and suggestion chips a bare-number scan would happily misread.
 */
function candidateLocators(page) {
  return [
    page.locator('header').locator('*').filter({ hasText: POINTS_ONLY_RE }),
    // Still work if a build ships an explicit label for the pill.
    page.locator(
      'button[title="积分"], button[title="積分"], button[title="點數"], button[title="点数"], ' +
      'button[title="Credits"], button[aria-label*="积分"], button[aria-label*="積分"]',
    ),
  ];
}

export async function readCurrentPoints(page) {
  const locators = candidateLocators(page);

  // The top bar hydrates after the first paint, so the balance can be absent for a
  // moment on an otherwise finished page. Whichever rendering shows up first ends
  // the wait; a signed-out page simply spends the full timeout and reports nothing.
  await Promise.race(
    locators.map((locator) =>
      locator.first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {}),
    ),
  );

  const values = new Set();
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, 20); index += 1) {
      const candidate = locator.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      const value = parsePoints(await candidate.innerText({ timeout: 2_000 }).catch(() => ''));
      if (value !== null) values.add(value);
    }
  }

  // Two different numbers mean we matched something that is not the balance —
  // reporting nothing beats publishing a wrong figure.
  return values.size === 1 ? [...values][0] : null;
}
