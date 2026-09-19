import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_CHECK_IN_ACTION,
  MISSION_PATH,
  isDailyCheckInMissionRequest,
  parseMissionResult,
} from './stepfun-mission.mjs';

function request({ method = 'POST', url = 'https://chat.stepfun.com' + MISSION_PATH, body } = {}) {
  return {
    method: () => method,
    url: () => url,
    postData: () => JSON.stringify(body ?? { triggerAction: DAILY_CHECK_IN_ACTION }),
  };
}

test('recognises only the StepFun daily check-in mission request', () => {
  assert.equal(isDailyCheckInMissionRequest(request()), true);
  assert.equal(isDailyCheckInMissionRequest(request({ method: 'GET' })), false);
  assert.equal(
    isDailyCheckInMissionRequest(request({ body: { triggerAction: 'complete_profile' } })),
    false,
  );
  assert.equal(
    isDailyCheckInMissionRequest(request({ url: 'https://chat.stepfun.com/api/other' })),
    false,
  );
  assert.equal(
    isDailyCheckInMissionRequest({ method: 'POST', url: 'https://chat.stepfun.com' + MISSION_PATH, postData: '{' }),
    false,
  );
});

test('parses accepted, already-completed and rejected mission responses', () => {
  assert.deepEqual(parseMissionResult({ code: 0, message: '签到成功' }), {
    ok: true,
    alreadyClaimed: false,
    message: '签到成功',
  });
  assert.deepEqual(parseMissionResult({ code: 409, message: '今日已签到' }), {
    ok: true,
    alreadyClaimed: true,
    message: '今日已签到',
  });
  assert.deepEqual(parseMissionResult({ code: 12, message: 'not eligible' }), {
    ok: false,
    alreadyClaimed: false,
    message: 'StepFun returned 12: not eligible',
  });
});
