export const DAILY_CHECK_IN_ACTION = 'daily_check_in';
export const MISSION_PATH =
  '/api/step.growth.activity_center.ActivityService/TriggerUserMission';

function readRequestValue(request, property) {
  const value = request?.[property];
  return typeof value === 'function' ? value.call(request) : value;
}

/**
 * True only for StepFun's daily check-in mission request. This deliberately
 * checks both the endpoint and the action, so unrelated activity missions do
 * not turn into a false successful check-in.
 */
export function isDailyCheckInMissionRequest(request) {
  const url = String(readRequestValue(request, 'url') ?? '');
  const method = String(readRequestValue(request, 'method') ?? '').toUpperCase();
  if (method !== 'POST' || !url.includes(MISSION_PATH)) return false;

  const rawBody = readRequestValue(request, 'postData');
  if (typeof rawBody !== 'string' || rawBody.trim() === '') return false;

  try {
    return JSON.parse(rawBody)?.triggerAction === DAILY_CHECK_IN_ACTION;
  } catch {
    return false;
  }
}

/**
 * Normalise the public mission response without preserving any account data.
 */
export function parseMissionResult(payload) {
  const code = payload?.code;
  const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
  const alreadyClaimed =
    /(?:今日|今天|当天|本日).*(?:已签到|已簽到|已领取|已領取|完成)|(?:已签到|已簽到|已领取|已領取)|(?:签到|簽到).*(?:已完成|完成)|(?:already|today).*(?:check.?in|claimed|completed)|(?:check.?in|sign.?in).*(?:already|done)/i.test(
      message,
    );
  if (code === 0 || code === '0') {
    return {
      ok: true,
      alreadyClaimed,
      message: message || 'OK',
    };
  }

  if (alreadyClaimed) return { ok: true, alreadyClaimed: true, message: message || 'Already checked in today' };

  const detail = message || 'unknown response';
  return {
    ok: false,
    alreadyClaimed: false,
    message: 'StepFun returned ' + (code ?? 'no code') + ': ' + detail,
  };
}
