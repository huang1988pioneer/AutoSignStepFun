import { chromium, firefox } from 'playwright';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Resolve the Playwright engine and the launch/context options for a
 * STEPFUN_BROWSER value.
 */
export function resolveBrowserEngine(browserName) {
  const name = String(browserName || 'chromium').trim().toLowerCase();

  if (name === 'firefox') {
    return {
      name: 'firefox',
      engine: firefox,
      launchOptions: { headless: true },
      contextOptions: { locale: 'zh-CN' },
    };
  }

  if (name === 'edge' || name === 'msedge') {
    return {
      name: 'edge',
      engine: chromium,
      launchOptions: {
        headless: true,
        channel: 'msedge',
        args: ['--disable-blink-features=AutomationControlled'],
      },
      contextOptions: {
        locale: 'zh-CN',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
      },
    };
  }

  if (name === 'chromium' || name === 'chrome') {
    return {
      name: 'chromium',
      engine: chromium,
      launchOptions: {
        headless: true,
        args: ['--disable-blink-features=AutomationControlled'],
      },
      contextOptions: {
        locale: 'zh-CN',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    };
  }

  throw new Error(
    'Unsupported STEPFUN_BROWSER="' + name + '". Use chromium (default), firefox, or edge.',
  );
}

/**
 * Materialise a Base64 storage state into a temporary file Playwright can load.
 * Returns undefined when the value is unset, otherwise
 * { directory, file, parsed }; the caller removes `directory` when done.
 */
export async function storageStateFile(value, variableName = 'STEPFUN_STORAGE_STATE_B64') {
  if (!value) return undefined;
  const directory = await mkdtemp(join(tmpdir(), 'stepfun-state-'));
  const file = join(directory, 'storage-state.json');
  try {
    const decoded = Buffer.from(value, 'base64');
    const parsed = JSON.parse(decoded.toString('utf8'));
    await writeFile(file, decoded);
    return { directory, file, parsed };
  } catch {
    await rm(directory, { recursive: true, force: true });
    throw new Error(variableName + ' is not valid base64-encoded Playwright storage state JSON.');
  }
}

/** Split a Cookie header into Playwright cookie records for `url`. */
export function parseCookieHeader(header, url, variableName = 'STEPFUN_COOKIE') {
  return String(header)
    .split(';')
    .map((part) => {
      const separator = part.indexOf('=');
      if (separator < 1) throw new Error(variableName + ' contains an invalid cookie segment.');
      return {
        name: part.slice(0, separator).trim(),
        value: part.slice(separator + 1).trim(),
        url,
        sameSite: 'Lax',
      };
    })
    .filter(({ name, value }) => name && value);
}
