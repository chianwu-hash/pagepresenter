// 擴充功能安裝時創建右鍵選單
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'webReaderStart',
    title: '啟動簡報模式',
    contexts: ['selection']
  });
});

// 處理右鍵選單點擊事件
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'webReaderStart' && info.selectionText) {
    // 向當前分頁發送消息，啟動簡報模式
    chrome.tabs.sendMessage(tab.id, {
      action: 'startWithSelection',
      selectedText: info.selectionText
    });
  }
});

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_ALLOWED_MODELS = new Set([
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash'
]);

function getStoredGeminiSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['geminiAPIKey', 'geminiModel'], (result) => {
      resolve({
        apiKey: result.geminiAPIKey || '',
        model: GEMINI_ALLOWED_MODELS.has(result.geminiModel)
          ? result.geminiModel
          : 'gemini-3.5-flash'
      });
    });
  });
}

// 只允許已知的回應格式，不讓呼叫端把任意值透傳給供應商。
const GEMINI_ALLOWED_RESPONSE_TYPES = new Set(['application/json']);

async function callGemini({
  prompt,
  model,
  apiKey,
  maxOutputTokens = 16000,
  responseMimeType = '',
  thinkingBudget = null
}) {
  const safeModel = GEMINI_ALLOWED_MODELS.has(model) ? model : 'gemini-3.5-flash';
  const safePrompt = typeof prompt === 'string' ? prompt : '';
  const safeMaxOutputTokens = Math.min(Math.max(Number(maxOutputTokens) || 16000, 1), 32000);

  if (!apiKey) throw new Error('未設定 Gemini API 金鑰');
  if (!safePrompt.trim()) throw new Error('沒有可送往 Gemini 的內容');
  if (safePrompt.length > 200000) throw new Error('內容過長，請縮小處理範圍');

  const response = await fetch(`${GEMINI_API_BASE}/${safeModel}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: safePrompt }]
      }],
      generationConfig: {
        maxOutputTokens: safeMaxOutputTokens,
        candidateCount: 1,
        ...(GEMINI_ALLOWED_RESPONSE_TYPES.has(responseMimeType) ? { responseMimeType } : {}),
        // 只允許關閉思考；結構化的小任務不需要它，開著會把輸出額度用光。
        ...(thinkingBudget === 0 ? { thinkingConfig: { thinkingBudget: 0 } } : {})
      }
    })
  });

  if (!response.ok) {
    let providerMessage = '';
    try {
      const errorJson = await response.json();
      providerMessage = errorJson?.error?.message || '';
    } catch (_error) {
      // Do not return raw provider bodies; they may contain request details.
    }

    const error = new Error(providerMessage || `Gemini API 請求失敗 (${response.status})`);
    error.status = response.status;
    throw error;
  }

  const result = await response.json();
  const candidate = result?.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map(part => typeof part.text === 'string' ? part.text : '')
    .join('')
    .trim();

  if (!text) throw new Error('Gemini API 未返回可用文字');

  return {
    text,
    finishReason: candidate.finishReason || '',
    model: safeModel,
    maxOutputTokens: safeMaxOutputTokens,
    usageMetadata: result?.usageMetadata || null
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== 'geminiGenerate' && message?.action !== 'geminiTest') {
    return false;
  }

  (async () => {
    try {
      const stored = await getStoredGeminiSettings();
      const model = GEMINI_ALLOWED_MODELS.has(message.model) ? message.model : stored.model;
      const apiKey = message.action === 'geminiTest' && typeof message.apiKey === 'string'
        ? message.apiKey.trim()
        : stored.apiKey;
      const prompt = message.action === 'geminiTest' ? '請只回答：OK' : message.prompt;
      const result = await callGemini({
        prompt,
        model,
        apiKey,
        maxOutputTokens: message.action === 'geminiTest' ? 10 : message.maxOutputTokens,
        responseMimeType: message.action === 'geminiTest' ? '' : message.responseMimeType,
        thinkingBudget: message.action === 'geminiTest' ? null : message.thinkingBudget
      });

      sendResponse({ ok: true, ...result });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error?.message || 'Gemini API 處理失敗',
        status: error?.status || 0
      });
    }
  })();

  return true;
});
