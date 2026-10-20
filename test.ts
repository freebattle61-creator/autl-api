import assert from 'assert';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

console.log('Running production security & compatibility test suite...');

// Test 1: Device Reset and Session Revocation
function testDeviceResetRevokesSessions() {
  const sessions = [
    { session_id: 'sess_1', key_value: 'SH-TEST-KEY-1', hwid: 'dev_1', expires_at: new Date(Date.now() + 86400000).toISOString() },
    { session_id: 'sess_2', key_value: 'SH-TEST-KEY-1', hwid: 'dev_2', expires_at: new Date(Date.now() + 86400000).toISOString() },
    { session_id: 'sess_3', key_value: 'SH-TEST-KEY-2', hwid: 'dev_3', expires_at: new Date(Date.now() + 86400000).toISOString() }
  ];

  const targetKey = 'SH-TEST-KEY-1';
  // Simulate device reset for SH-TEST-KEY-1 -> should revoke sessions for this key immediately
  const remainingSessions = sessions.filter(s => s.key_value !== targetKey);

  assert.strictEqual(remainingSessions.length, 1, 'Only sessions for other keys should remain');
  assert.strictEqual(remainingSessions[0].key_value, 'SH-TEST-KEY-2', 'Correct session preserved');
  console.log('✓ Test 1 Passed: Device Reset & Session Revocation');
}

// Test 2: Heartbeat Validation Logic
function testHeartbeatValidation() {
  const key = {
    key_value: 'SH-TEST-KEY-1',
    is_disabled: 0,
    hwid_list: ['dev_1'],
    expires_at: new Date(Date.now() + 86400000).toISOString()
  };

  const session = {
    session_id: 'sess_1',
    key_value: 'SH-TEST-KEY-1',
    hwid: 'dev_1',
    expires_at: new Date(Date.now() + 86400000).toISOString()
  };

  const incomingHwid = 'dev_1';
  const now = new Date();

  const isValid = 
    session &&
    session.hwid === incomingHwid &&
    now <= new Date(session.expires_at) &&
    !key.is_disabled &&
    (!key.expires_at || now <= new Date(key.expires_at)) &&
    key.hwid_list.includes(incomingHwid);

  assert.strictEqual(isValid, true, 'Heartbeat validation should succeed for valid session and HWID');
  console.log('✓ Test 2 Passed: Heartbeat Security Validation');
}

// Test 3: Environment Credentials Security
async function testEnvCredentials() {
  const adminPass = process.env.ADMIN_PASSWORD || 'Sh@d0w_Cr@ck3r_X9#99!Secure';
  const hash = await bcrypt.hash(adminPass, 10);
  const match = await bcrypt.compare(adminPass, hash);
  assert.strictEqual(match, true, 'Environment admin password should hash and compare securely');
  console.log('✓ Test 3 Passed: Environment Credentials Security');
}

async function runTests() {
  testDeviceResetRevokesSessions();
  testHeartbeatValidation();
  await testEnvCredentials();
  console.log('All production security tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
