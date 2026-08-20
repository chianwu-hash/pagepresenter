const assert = require('node:assert/strict');
const test = require('node:test');

function loadBackground({ apiKey = 'test-key', storedModel = 'gemini-3.5-flash' } = {}) {
  const listeners = {};
  let fetchCall = null;

  global.chrome = {
    contextMenus: {
      create() {},
      onClicked: { addListener(listener) { listeners.contextMenu = listener; } }
    },
    runtime: {
      onInstalled: { addListener(listener) { listeners.installed = listener; } },
      onMessage: { addListener(listener) { listeners.message = listener; } }
    },
    storage: {
      local: {
        get(_keys, callback) {
          callback({ geminiAPIKey: apiKey, geminiModel: storedModel });
        }
      }
    },
    tabs: { sendMessage() {} }
  };

  global.fetch = async (url, options) => {
    fetchCall = { url, options };
    return {
      ok: true,
      async json() {
        return {
          candidates: [{
            finishReason: 'STOP',
            content: { parts: [{ text: '測試結果' }] }
          }]
        };
      }
    };
  };

  const modulePath = require.resolve('../background.js');
  delete require.cache[modulePath];
  require(modulePath);

  return {
    listeners,
    getFetchCall: () => fetchCall
  };
}

function sendRuntimeMessage(listener, message) {
  return new Promise((resolve) => {
    const keepChannelOpen = listener(message, {}, resolve);
    assert.equal(keepChannelOpen, true);
  });
}

test('Gemini generation keeps the API key out of the URL and uses the background header', async () => {
  const harness = loadBackground();
  const response = await sendRuntimeMessage(harness.listeners.message, {
    action: 'geminiGenerate',
    prompt: '會議內容',
    model: 'gemini-3.5-flash',
    maxOutputTokens: 100
  });

  assert.equal(response.ok, true);
  assert.equal(response.text, '測試結果');

  const request = harness.getFetchCall();
  assert.match(request.url, /gemini-3\.5-flash:generateContent$/);
  assert.doesNotMatch(request.url, /key=/);
  assert.equal(request.options.headers['x-goog-api-key'], 'test-key');
  assert.equal(JSON.parse(request.options.body).contents[0].parts[0].text, '會議內容');
});

test('Gemini generation rejects a missing stored key without making a request', async () => {
  const harness = loadBackground({ apiKey: '' });
  const response = await sendRuntimeMessage(harness.listeners.message, {
    action: 'geminiGenerate',
    prompt: '會議內容',
    model: 'gemini-3.5-flash'
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /未設定 Gemini API 金鑰/);
  assert.equal(harness.getFetchCall(), null);
});

test('Gemini generation migrates an unsupported stored model to the safe default', async () => {
  const harness = loadBackground({ storedModel: 'gemini-1.5-flash' });
  const response = await sendRuntimeMessage(harness.listeners.message, {
    action: 'geminiGenerate',
    prompt: '會議內容',
    model: 'gemini-1.5-flash'
  });

  assert.equal(response.ok, true);
  assert.equal(response.model, 'gemini-3.5-flash');
  assert.match(harness.getFetchCall().url, /gemini-3\.5-flash:generateContent$/);
});
