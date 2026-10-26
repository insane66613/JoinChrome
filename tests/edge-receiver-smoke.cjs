const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'cross_context.js'), 'utf8');
async function probe(tokenApi, receiverApi, identityApi) {
  class WorkerScope {}
  const self = new WorkerScope();
  let calls = 0;
  const chrome = {
    runtime: { onMessage: { addListener() {} } },
    contextMenus: { onClicked: { addListener() {} } }
  };
  if (tokenApi) chrome.instanceID = {
    getToken(_options, callback) { calls++; callback('fake-token'); }
  };
  if (receiverApi) chrome.gcm = { onMessage: { addListener() {} } };
  if (identityApi) chrome.identity = {
    launchWebAuthFlow: async () => 'fake-auth-url'
  };
  const quiet = { log() {}, warn() {}, error() {} };
  vm.runInNewContext(source, {
    self, chrome, ServiceWorkerGlobalScope: WorkerScope,
    console: quiet, setTimeout, clearTimeout, setInterval, clearInterval
  }, { filename: 'cross_context.js' });
  assert.equal(self.isInstanceIdAvailable(), tokenApi && receiverApi);
  if (tokenApi && receiverApi) {
    const results = await Promise.all([
      chrome.instanceID.getToken({ authorizedEntity: 'sender', scope: 'GCM' }),
      chrome.instanceID.getToken({ authorizedEntity: 'sender', scope: 'GCM' })
    ]);
    assert.deepEqual(results, ['fake-token', 'fake-token']);
    assert.equal(calls, 1, 'identical registration requests must coalesce');
  }
  if (identityApi) {
    assert.equal(await chrome.identity.launchWebAuthFlow({ interactive: true }),
      'fake-auth-url');
  }
}
(async () => {
  await probe(false, false, false);
  await probe(true, false, false);
  await probe(false, true, true);
  await probe(true, true, true);
  console.log('Receiver API gate and token coalescing: 4 scenarios passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
