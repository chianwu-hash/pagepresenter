class PopupController {
  constructor() {
    this.init();
  }

  init() {
    this.loadElements();
    this.bindEvents();
    this.updateStatus();
  }

  loadElements() {
    this.toggleButton = document.getElementById('toggleReader');
    this.fontIncreaseButton = document.getElementById('fontIncrease');
    this.fontDecreaseButton = document.getElementById('fontDecrease');
    this.contrastButton = document.getElementById('highContrast');
    this.focusButton = document.getElementById('focusMode');
    this.statusElement = document.getElementById('currentStatus');

    // API設定元素
    this.apiToggle = document.getElementById('apiToggle');
    this.apiConfig = document.getElementById('apiConfig');
    this.geminiApiKey = document.getElementById('geminiApiKey');
    this.geminiModel = document.getElementById('geminiModel');
    this.saveApiKey = document.getElementById('saveApiKey');
    this.testApiKey = document.getElementById('testApiKey');
    this.saveModelOnly = document.getElementById('saveModelOnly');

    // OpenAI API設定元素
    this.openaiApiToggle = document.getElementById('openaiApiToggle');
    this.openaiApiConfig = document.getElementById('openaiApiConfig');
    this.openaiApiKey = document.getElementById('openaiApiKey');
    this.openaiModel = document.getElementById('openaiModel');
    this.saveOpenaiApiKey = document.getElementById('saveOpenaiApiKey');
    this.testOpenaiApiKey = document.getElementById('testOpenaiApiKey');
    this.saveOpenaiModelOnly = document.getElementById('saveOpenaiModelOnly');

    // AI 模型優先順序設定元素
    this.priorityToggle = document.getElementById('priorityToggle');
    this.priorityConfig = document.getElementById('priorityConfig');
    this.sortableModelList = document.getElementById('sortableModelList');
    this.resetPriorityButton = document.getElementById('resetPriority');

    // 檢查關鍵元素是否存在
    if (!this.saveApiKey) {
      console.error('找不到 saveApiKey 按鈕元素');
    }
    if (!this.testApiKey) {
      console.error('找不到 testApiKey 按鈕元素');
    }
    if (!this.geminiApiKey) {
      console.error('找不到 geminiApiKey 輸入欄位');
    }
    if (!this.geminiModel) {
      console.error('找不到 geminiModel 選擇器元素');
    }

    // 檢查 OpenAI API 元素
    if (!this.saveOpenaiApiKey) {
      console.error('找不到 saveOpenaiApiKey 按鈕元素');
    }
    if (!this.testOpenaiApiKey) {
      console.error('找不到 testOpenaiApiKey 按鈕元素');
    }
    if (!this.openaiApiKey) {
      console.error('找不到 openaiApiKey 輸入欄位');
    }
    if (!this.openaiModel) {
      console.error('找不到 openaiModel 選擇器元素');
    }
  }

  bindEvents() {
    this.toggleButton.onclick = () => this.toggleReader();
    this.fontIncreaseButton.onclick = () => this.adjustFont(4);
    this.fontDecreaseButton.onclick = () => this.adjustFont(-4);
    this.contrastButton.onclick = () => this.toggleContrast();
    this.focusButton.onclick = () => this.toggleFocus();

    // API設定事件
    if (this.apiToggle) {
      this.apiToggle.onclick = () => this.toggleApiConfig();
    }

    if (this.saveApiKey) {
      this.saveApiKey.onclick = () => {
        console.log('儲存按鈕被點擊');
        this.saveGeminiApiKey();
      };
    }

    if (this.testApiKey) {
      this.testApiKey.onclick = () => {
        console.log('測試按鈕被點擊');
        this.testGeminiApiKey();
      };
    }

    if (this.saveModelOnly) {
      this.saveModelOnly.onclick = () => {
        console.log('僅儲存模型按鈕被點擊');
        this.saveModelOnly_();
      };
    }

    // OpenAI API設定事件
    if (this.openaiApiToggle) {
      this.openaiApiToggle.onclick = () => this.toggleOpenaiApiConfig();
    }

    if (this.saveOpenaiApiKey) {
      this.saveOpenaiApiKey.onclick = () => {
        console.log('OpenAI儲存按鈕被點擊');
        this.saveOpenaiApiKey_();
      };
    }

    if (this.testOpenaiApiKey) {
      this.testOpenaiApiKey.onclick = () => {
        console.log('OpenAI測試按鈕被點擊');
        this.testOpenaiApiKey_();
      };
    }

    if (this.saveOpenaiModelOnly) {
      this.saveOpenaiModelOnly.onclick = () => {
        console.log('OpenAI僅儲存模型按鈕被點擊');
        this.saveOpenaiModelOnly_();
      };
    }

    // 當用戶點擊輸入欄位且內容是遮罩時，清空以便重新輸入
    if (this.geminiApiKey) {
      this.geminiApiKey.onfocus = () => {
        if (this.geminiApiKey.value.startsWith('••••••••')) {
          this.geminiApiKey.value = '';
          this.geminiApiKey.placeholder = '輸入新的API金鑰或留空清除';
        }
      };
    }

    if (this.openaiApiKey) {
      this.openaiApiKey.onfocus = () => {
        if (this.openaiApiKey.value.startsWith('••••••••')) {
          this.openaiApiKey.value = '';
          this.openaiApiKey.placeholder = '輸入新的OpenAI API金鑰或留空清除';
        }
      };
    }

    // AI 模型優先順序設定事件
    if (this.priorityToggle) {
      this.priorityToggle.onclick = () => this.togglePriorityConfig();
    }

    if (this.resetPriorityButton) {
      this.resetPriorityButton.onclick = () => this.resetModelPriority();
    }

    // 初始化拖拽排序功能
    this.initSortableList();

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.webReaderSettings) {
        this.updateStatus();
      }
    });

    // 載入API設定
    this.loadApiSettings();
    this.loadOpenaiApiSettings();
    this.loadModelPriority();

    // 備用事件綁定 - 使用 addEventListener 作為備用方案
    setTimeout(() => {
      const saveBtn = document.getElementById('saveApiKey');
      const testBtn = document.getElementById('testApiKey');

      if (saveBtn && !saveBtn.onclick) {
        console.log('使用備用方式綁定儲存按鈕');
        saveBtn.addEventListener('click', () => {
          console.log('備用儲存按鈕被點擊');
          this.saveGeminiApiKey();
        });
      }

      if (testBtn && !testBtn.onclick) {
        console.log('使用備用方式綁定測試按鈕');
        testBtn.addEventListener('click', () => {
          console.log('備用測試按鈕被點擊');
          this.testGeminiApiKey();
        });
      }
    }, 100);
  }

  async getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async queryTabs(query) {
    try {
      return await chrome.tabs.query(query);
    } catch (error) {
      console.warn('查詢分頁失敗:', error?.message || error);
      return [];
    }
  }

  isLikelyExtensionPage(tab) {
    const url = tab?.url || tab?.pendingUrl || '';
    return url.startsWith('chrome-extension://') || url.startsWith('chrome://') ||
      url.startsWith('edge://') || url.startsWith('about:');
  }

  uniqueTabs(tabs) {
    const seen = new Set();
    return tabs.filter(tab => {
      if (!tab?.id || seen.has(tab.id)) return false;
      seen.add(tab.id);
      return true;
    });
  }

  async collectReaderTabCandidates() {
    const groups = await Promise.all([
      this.queryTabs({ active: true, currentWindow: true }),
      this.queryTabs({ active: true, lastFocusedWindow: true }),
      this.queryTabs({ active: true }),
      this.queryTabs({})
    ]);

    return this.uniqueTabs(groups.flat())
      .filter(tab => !this.isLikelyExtensionPage(tab));
  }

  async findReaderTab() {
    const candidates = await this.collectReaderTabCandidates();

    for (const tab of candidates) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getReaderState' });
        if (response?.ok) {
          return { tab, state: response.state || null };
        }
      } catch (_error) {
        // Some tabs cannot receive content-script messages; keep looking.
      }
    }

    return { tab: candidates[0] || null, state: null };
  }

  async sendMessageToTab(message) {
    try {
      const { tab } = await this.findReaderTab();
      if (!tab?.id) {
        throw new Error('找不到目前分頁');
      }
      return await this.sendMessageWithContentScriptFallback(tab, message);
    } catch (error) {
      console.error('發送消息到內容腳本失敗:', error);
      this.showError('無法與網頁通信，請重新整理頁面');
      return { ok: false, error: error?.message || '無法與網頁通信' };
    }
  }

  async sendMessageWithContentScriptFallback(tab, message) {
    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (firstError) {
      if (!this.isMissingContentScriptError(firstError)) {
        throw firstError;
      }

      await this.injectContentScript(tab.id);
      return await chrome.tabs.sendMessage(tab.id, message);
    }
  }

  isMissingContentScriptError(error) {
    const message = error?.message || '';
    return message.includes('Receiving end does not exist') ||
      message.includes('Could not establish connection');
  }

  async injectContentScript(tabId) {
    if (!chrome.scripting?.executeScript) {
      throw new Error('此版本缺少 scripting 權限，請重新載入擴充功能');
    }

    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['styles.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  }

  async getCurrentTabReaderState() {
    const { state } = await this.findReaderTab();
    return state;
  }

  async toggleReader() {
    try {
      this.toggleButton.textContent = '正在啟動...';
      this.toggleButton.disabled = true;

      const response = await this.sendMessageToTab({ action: 'toggleReader' });
      if (!response?.ok) {
        throw new Error(response?.error || '目前分頁沒有回應簡報器操作');
      }

      setTimeout(() => {
        if (response.state) {
          this.applyStatus(response.state);
        } else {
          this.updateStatus();
        }
        this.toggleButton.disabled = false;
      }, 500);
    } catch (error) {
      console.error('切換簡報模式失敗:', error);
      this.toggleButton.textContent = '啟動簡報模式';
      this.toggleButton.disabled = false;
      this.showError('啟動失敗');
    }
  }

  async adjustFont(delta) {
    try {
      await this.sendMessageToTab({
        action: 'adjustFont',
        delta: delta
      });

      setTimeout(() => this.updateStatus(), 200);
    } catch (error) {
      console.error('調整字體大小失敗:', error);
    }
  }

  async toggleContrast() {
    try {
      await this.sendMessageToTab({ action: 'toggleContrast' });
      setTimeout(() => this.updateStatus(), 200);
    } catch (error) {
      console.error('切換對比模式失敗:', error);
    }
  }

  async toggleFocus() {
    try {
      await this.sendMessageToTab({ action: 'toggleFocus' });
      setTimeout(() => this.updateStatus(), 200);
    } catch (error) {
      console.error('切換聚焦模式失敗:', error);
    }
  }

  async updateStatus() {
    chrome.storage.local.get(['webReaderSettings', 'openaiAPIKey', 'openaiModel', 'geminiAPIKey'], async (result) => {
      const storedSettings = result.webReaderSettings || {
        isActive: false,
        fontSize: 32,
        isHighContrast: false,
        isFocusMode: false
      };
      const tabState = await this.getCurrentTabReaderState();
      const settings = tabState
        ? { ...storedSettings, ...tabState }
        : { ...storedSettings, isActive: false };

      const apiInfo = {
        hasOpenAI: !!(result.openaiAPIKey && result.openaiAPIKey.length > 0),
        hasGemini: !!(result.geminiAPIKey && result.geminiAPIKey.length > 0),
        openaiModel: result.openaiModel || 'gpt-4o-mini'
      };

      this.applyStatus(settings, apiInfo);
    });
  }

  applyStatus(settings, apiInfo = null) {
    this.updateToggleButton(settings.isActive);
    this.updateControlButtons(settings);
    this.updateStatusText(settings, apiInfo);
  }

  updateToggleButton(isActive) {
    if (isActive) {
      this.toggleButton.textContent = '關閉簡報模式';
      this.toggleButton.classList.add('active');
    } else {
      this.toggleButton.textContent = '啟動簡報模式';
      this.toggleButton.classList.remove('active');
    }
  }

  updateControlButtons(settings) {
    this.contrastButton.classList.toggle('active', settings.isHighContrast);
    this.focusButton.classList.toggle('active', settings.isFocusMode);

    const isActive = settings.isActive;
    this.fontIncreaseButton.disabled = !isActive;
    this.fontDecreaseButton.disabled = !isActive;
    this.contrastButton.disabled = !isActive;
    this.focusButton.disabled = !isActive;

    this.fontIncreaseButton.style.opacity = isActive ? '1' : '0.5';
    this.fontDecreaseButton.style.opacity = isActive ? '1' : '0.5';
    this.contrastButton.style.opacity = isActive ? '1' : '0.5';
    this.focusButton.style.opacity = isActive ? '1' : '0.5';
  }

  updateStatusText(settings, apiInfo) {
    if (settings.isActive) {
      const modes = [];
      if (settings.isHighContrast) modes.push('高對比');
      if (settings.isFocusMode) modes.push('聚焦');

      const modeText = modes.length > 0 ? ` (${modes.join(', ')})` : '';
      this.statusElement.innerHTML = `
        <strong>已啟動</strong><br>
        字體大小: ${settings.fontSize}px${modeText}
      `;
    } else {
      // 顯示 API 設定狀態
      const apiStatus = [];
      if (apiInfo && apiInfo.hasOpenAI) {
        const modelDisplay = apiInfo.openaiModel.replace('gpt-', 'GPT-').toUpperCase();
        apiStatus.push(`OpenAI: ${modelDisplay}`);
      }
      if (apiInfo && apiInfo.hasGemini) {
        apiStatus.push('Gemini: 已設定');
      }

      let statusText = '未啟動';
      if (apiStatus.length > 0) {
        statusText += `<br><small style="color: #28a745;">AI: ${apiStatus.join(', ')}</small>`;
      } else {
        statusText += '<br><small style="color: #6c757d;">未設定AI服務</small>';
      }

      this.statusElement.innerHTML = statusText;
    }
  }

  showError(message) {
    const originalText = this.statusElement.textContent;
    this.statusElement.style.color = '#dc3545';
    this.statusElement.textContent = `錯誤: ${message}`;

    setTimeout(() => {
      this.statusElement.style.color = '#212529';
      this.statusElement.textContent = originalText;
    }, 3000);
  }

  // 新增：切換API設定顯示
  toggleApiConfig() {
    const isHidden = this.apiConfig.classList.contains('hidden');
    if (isHidden) {
      this.apiConfig.classList.remove('hidden');
    } else {
      this.apiConfig.classList.add('hidden');
    }
  }

  // 儲存Gemini API金鑰
  async saveGeminiApiKey() {
    console.log('🔑 saveGeminiApiKey 函數被呼叫');

    if (!this.geminiApiKey) {
      console.error('❌ geminiApiKey 元素不存在');
      this.showError('系統錯誤：找不到輸入欄位');
      return;
    }

    console.log('開始儲存 API 金鑰');
    const inputValue = this.geminiApiKey.value.trim();

    // 如果輸入是遮罩格式，從 storage 讀取實際的 API 金鑰
    let actualApiKey = inputValue;
    if (inputValue.startsWith('••••••••')) {
      console.log('偵測到遮罩格式，從 storage 讀取實際 API 金鑰');
      const storageResult = await new Promise(resolve => {
        chrome.storage.local.get(['geminiAPIKey'], resolve);
      });
      actualApiKey = storageResult.geminiAPIKey || '';
      console.log('從 storage 讀取到 API 金鑰長度:', actualApiKey.length);
    }

    console.log('處理後的 API 金鑰長度:', actualApiKey.length);

    // 處理清空或新輸入
    const apiKey = actualApiKey === '' ? '' : actualApiKey;

    if (apiKey && apiKey.length > 0) {
      // 放寬API金鑰格式驗證（Gemini API金鑰可能包含各種字符）
      if (apiKey.length < 15) {
        console.log('API 金鑰長度不足');
        this.showError('API金鑰長度過短，請確認是否正確');
        return;
      }
    }

    // 取得選擇的模型
    const selectedModel = this.geminiModel ? this.geminiModel.value : 'gemini-3.5-flash';

    console.log('📝 即將儲存的設定:');
    console.log('  - API金鑰長度:', apiKey ? apiKey.length : 0);
    console.log('  - 選擇的模型:', selectedModel);
    console.log('  - geminiModel 元素存在:', !!this.geminiModel);

    if (this.geminiModel) {
      console.log('  - 模型選擇器當前值:', this.geminiModel.value);
      console.log('  - 模型選擇器所有選項:', Array.from(this.geminiModel.options).map(opt => opt.value));
    }

    // 儲存API金鑰和模型選擇
    chrome.storage.local.set({
      geminiAPIKey: apiKey,
      geminiModel: selectedModel
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('儲存失敗:', chrome.runtime.lastError);
        this.showError('儲存失敗: ' + chrome.runtime.lastError.message);
        return;
      }

      console.log('API 金鑰和模型選擇儲存成功');
      this.showApiSuccess(apiKey ? 'API設定已儲存' : 'API金鑰已清除');

      // 立即更新顯示
      this.loadApiSettings();
    });
  }

  // 載入API設定
  loadApiSettings() {
    // 加入延遲重試機制，確保 DOM 元素完全載入
    const loadSettings = () => {
      chrome.storage.local.get(['geminiAPIKey', 'geminiModel'], (result) => {
        const apiKey = result.geminiAPIKey || '';
        const availableModels = this.geminiModel
          ? Array.from(this.geminiModel.options).map(option => option.value)
          : ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];
        const selectedModel = availableModels.includes(result.geminiModel)
          ? result.geminiModel
          : 'gemini-3.5-flash';

        // 舊版本儲存的模型可能已下架；載入時直接遷移到目前預設值。
        if (result.geminiModel && result.geminiModel !== selectedModel) {
          chrome.storage.local.set({ geminiModel: selectedModel });
        }

        console.log('📥 載入的設定:');
        console.log('  - API金鑰存在:', !!apiKey);
        console.log('  - 儲存的模型:', selectedModel);
        console.log('  - geminiModel 元素存在:', !!this.geminiModel);

        if (apiKey && apiKey.length > 0) {
          // 顯示遮罩的API金鑰，但保留更多後綴以便識別
          const maskedKey = '••••••••' + apiKey.slice(-6);
          this.geminiApiKey.value = maskedKey;
          this.geminiApiKey.placeholder = 'API金鑰已設定 (點擊可修改)';
        } else {
          // 清空顯示
          this.geminiApiKey.value = '';
          this.geminiApiKey.placeholder = '輸入Gemini API金鑰 (免費額度)';
        }

        // 設定模型選擇器的值 - 加入重試機制
        this.setModelSelection(selectedModel);

        this.updateApiStatus();
      });
    };

    // 立即嘗試載入，如果失敗則延遲重試
    if (this.geminiModel) {
      loadSettings();
    } else {
      console.log('⏳ 元素尚未載入，100ms 後重試...');
      setTimeout(() => {
        this.geminiModel = document.getElementById('geminiModel');
        loadSettings();
      }, 100);
    }
  }

  // 新增：設定模型選擇器值的輔助函數
  setModelSelection(selectedModel) {
    if (this.geminiModel) {
      this.geminiModel.value = selectedModel;
      console.log('✅ 模型選擇器已設定為:', this.geminiModel.value);

      // 驗證設定是否成功
      if (this.geminiModel.value !== selectedModel) {
        console.warn('⚠️ 模型設定未生效，值不匹配:', {
          期望: selectedModel,
          實際: this.geminiModel.value,
          可用選項: Array.from(this.geminiModel.options).map(opt => opt.value)
        });
      }
    } else {
      console.error('❌ 無法設定模型選擇器 - 元素不存在');

      // 最後一次嘗試重新獲取元素
      setTimeout(() => {
        this.geminiModel = document.getElementById('geminiModel');
        if (this.geminiModel) {
          this.geminiModel.value = selectedModel;
          console.log('🔄 延遲設定成功:', this.geminiModel.value);
        }
      }, 200);
    }
  }

  // 更新API狀態顯示
  updateApiStatus() {
    chrome.storage.local.get(['geminiAPIKey'], (result) => {
      const hasApiKey = !!(result.geminiAPIKey);
      const titleSpan = document.querySelector('.api-title span');

      if (hasApiKey) {
        titleSpan.textContent = 'Google Gemini AI 排版增強 (免費) ✓';
        titleSpan.style.color = '#155724';
      } else {
        titleSpan.textContent = 'Google Gemini AI 排版增強 (免費)';
        titleSpan.style.color = '#856404';
      }
    });
  }

  // 新增：顯示API成功訊息
  showApiSuccess(message) {
    const originalText = this.statusElement.textContent;
    this.statusElement.style.color = '#28a745';
    this.statusElement.textContent = message;

    setTimeout(() => {
      this.statusElement.style.color = '#212529';
      this.updateStatus();
    }, 2000);
  }

  showApiInfo(message) {
    this.statusElement.style.color = '#17a2b8';
    this.statusElement.textContent = message;
  }

  // 新增：僅儲存模型選擇
  async saveModelOnly_() {
    console.log('🎯 開始僅儲存模型選擇');

    if (!this.geminiModel) {
      console.error('❌ 模型選擇器元素不存在');
      this.showError('系統錯誤：找不到模型選擇器');
      return;
    }

    const selectedModel = this.geminiModel.value;
    console.log('📝 選擇的模型:', selectedModel);

    // 僅儲存模型選擇，保持現有的 API 金鑰
    chrome.storage.local.get(['geminiAPIKey'], (result) => {
      const existingApiKey = result.geminiAPIKey || '';

      chrome.storage.local.set({
        geminiAPIKey: existingApiKey, // 保持現有的 API 金鑰
        geminiModel: selectedModel
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('儲存失敗:', chrome.runtime.lastError);
          this.showError('儲存失敗: ' + chrome.runtime.lastError.message);
          return;
        }

        console.log('✅ 模型選擇儲存成功:', selectedModel);
        this.showApiSuccess('模型設定已儲存: ' + selectedModel);

        // 立即驗證儲存結果
        setTimeout(() => {
          chrome.storage.local.get(['geminiModel'], (verifyResult) => {
            console.log('🔍 驗證儲存結果:', verifyResult.geminiModel);
          });
        }, 100);
      });
    });
  }

  // 新增：測試Gemini API金鑰
  async testGeminiApiKey() {
    const inputValue = this.geminiApiKey.value.trim();
    let apiKey = inputValue;

    // 如果是遮罩格式，從storage讀取實際的key
    if (inputValue.startsWith('••••••••')) {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['geminiAPIKey'], resolve);
      });
      apiKey = result.geminiAPIKey || '';
    }

    if (!apiKey) {
      this.showError('請先輸入API金鑰');
      return;
    }

    // 取得選擇的模型
    const selectedModel = this.geminiModel ? this.geminiModel.value : 'gemini-3.5-flash';

    // 顯示測試狀態
    this.testApiKey.textContent = '測試中...';
    this.testApiKey.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'geminiTest',
        apiKey,
        model: selectedModel
      });

      if (response?.ok) {
        this.showApiSuccess('API金鑰測試成功！');
      } else {
        let errorMessage = response?.error || 'API金鑰測試失敗';
        if (response?.status === 400) {
          errorMessage = 'API金鑰格式錯誤';
        } else if (response?.status === 401 || response?.status === 403) {
          errorMessage = 'API金鑰無效或權限不足';
        } else if (response?.status === 429) {
          errorMessage = 'API請求頻率超過限制';
        }

        this.showError(errorMessage);
      }
    } catch (error) {
      console.error('API測試錯誤:', error);
      this.showError('網路錯誤或API服務不可用');
    } finally {
      // 恢復按鈕狀態
      this.testApiKey.textContent = '測試';
      this.testApiKey.disabled = false;
    }
  }

  // OpenAI API 相關方法
  toggleOpenaiApiConfig() {
    const isHidden = this.openaiApiConfig.classList.contains('hidden');
    if (isHidden) {
      this.openaiApiConfig.classList.remove('hidden');
    } else {
      this.openaiApiConfig.classList.add('hidden');
    }
  }

  async saveOpenaiApiKey_() {
    console.log('🔑 saveOpenaiApiKey 函數被呼叫');

    if (!this.openaiApiKey) {
      console.error('❌ openaiApiKey 元素不存在');
      this.showError('系統錯誤：找不到輸入欄位');
      return;
    }

    console.log('開始儲存 OpenAI API 金鑰');
    const inputValue = this.openaiApiKey.value.trim();

    // 如果輸入是遮罩格式，從 storage 讀取實際的 API 金鑰
    let actualApiKey = inputValue;
    if (inputValue.startsWith('••••••••')) {
      console.log('偵測到遮罩格式，從 storage 讀取實際 API 金鑰');
      const storageResult = await new Promise(resolve => {
        chrome.storage.local.get(['openaiAPIKey'], resolve);
      });
      actualApiKey = storageResult.openaiAPIKey || '';
      console.log('從 storage 讀取到 API 金鑰長度:', actualApiKey.length);
    }

    console.log('處理後的 API 金鑰長度:', actualApiKey.length);

    // 處理清空或新輸入
    const apiKey = actualApiKey === '' ? '' : actualApiKey;

    if (apiKey && apiKey.length > 0) {
      // 驗證OpenAI API金鑰格式 (通常以 sk- 開頭)
      if (!apiKey.startsWith('sk-') || apiKey.length < 20) {
        console.log('OpenAI API 金鑰格式不正確');
        this.showError('API金鑰格式不正確，OpenAI API金鑰應以 sk- 開頭');
        return;
      }
    }

    // 取得選擇的模型
    const selectedModel = this.openaiModel ? this.openaiModel.value : 'gpt-4o-mini';

    console.log('📝 即將儲存的OpenAI設定:');
    console.log('  - API金鑰長度:', apiKey ? apiKey.length : 0);
    console.log('  - 選擇的模型:', selectedModel);

    // 儲存API金鑰和模型選擇
    chrome.storage.local.set({
      openaiAPIKey: apiKey,
      openaiModel: selectedModel
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('儲存失敗:', chrome.runtime.lastError);
        this.showError('儲存失敗: ' + chrome.runtime.lastError.message);
        return;
      }

      console.log('OpenAI API 金鑰和模型選擇儲存成功');
      this.showApiSuccess(apiKey ? 'OpenAI API設定已儲存' : 'OpenAI API金鑰已清除');

      // 立即更新顯示
      this.loadOpenaiApiSettings();
    });
  }

  async testOpenaiApiKey_() {
    console.log('🧪 testOpenaiApiKey 函數被呼叫');

    if (!this.openaiApiKey) {
      console.error('❌ openaiApiKey 元素不存在');
      this.showError('系統錯誤：找不到輸入欄位');
      return;
    }

    const inputValue = this.openaiApiKey.value.trim();
    console.log('🔍 輸入值:', inputValue);

    // 如果輸入是遮罩格式，從 storage 讀取實際的 API 金鑰
    let apiKey = inputValue;
    if (inputValue.startsWith('••••••••')) {
      console.log('🔍 偵測到遮罩格式，從 storage 讀取實際 API 金鑰');
      const storageResult = await new Promise(resolve => {
        chrome.storage.local.get(['openaiAPIKey'], resolve);
      });
      apiKey = storageResult.openaiAPIKey || '';
      console.log('🔍 從 storage 讀取的 API 金鑰長度:', apiKey.length);
    }

    console.log('🔍 最終使用的 API 金鑰長度:', apiKey.length);
    console.log('🔍 API 金鑰前綴:', apiKey.substring(0, 7));

    if (!apiKey) {
      console.log('❌ API 金鑰為空');
      this.showError('請先輸入API金鑰');
      return;
    }

    // 驗證API金鑰格式
    if (!apiKey.startsWith('sk-') || apiKey.length < 20) {
      console.log('❌ API 金鑰格式驗證失敗');
      console.log('  - 以 sk- 開頭:', apiKey.startsWith('sk-'));
      console.log('  - 長度 >= 20:', apiKey.length >= 20);
      console.log('  - 實際長度:', apiKey.length);
      this.showError('API金鑰格式不正確，應以 sk- 開頭');
      return;
    }

    console.log('✅ API 金鑰格式驗證通過');

    // 取得選擇的模型
    const selectedModel = this.openaiModel ? this.openaiModel.value : 'gpt-4o-mini';

    // 顯示測試狀態
    this.testOpenaiApiKey.textContent = '測試中...';
    this.testOpenaiApiKey.disabled = true;

    try {
      console.log('發送測試請求到 OpenAI API');

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: 'user',
              content: 'Hello! This is a test message. Please respond with "API test successful".'
            }
          ],
          max_tokens: 50
        })
      });

      console.log('API回應狀態:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('API測試成功:', data);
        this.showApiSuccess(`✅ OpenAI API測試成功！模型: ${selectedModel}`);
      } else {
        const errorData = await response.json();
        console.error('API回應錯誤:', errorData);
        if (response.status === 401) {
          this.showError('❌ API金鑰無效，請檢查是否正確');
        } else if (response.status === 429) {
          this.showError('❌ API請求頻率過高，請稍後再試');
        } else {
          this.showError(`❌ API錯誤 (${response.status}): ${errorData.error?.message || '未知錯誤'}`);
        }
      }
    } catch (error) {
      console.error('API測試錯誤:', error);
      this.showError('❌ 網路錯誤：無法連接到OpenAI API');
    } finally {
      // 恢復按鈕狀態
      this.testOpenaiApiKey.textContent = '測試';
      this.testOpenaiApiKey.disabled = false;
    }
  }

  async saveOpenaiModelOnly_() {
    console.log('📝 saveOpenaiModelOnly 函數被呼叫');

    if (!this.openaiModel) {
      console.error('❌ openaiModel 元素不存在');
      this.showError('系統錯誤：找不到模型選擇器');
      return;
    }

    const selectedModel = this.openaiModel.value;
    console.log('選擇的OpenAI模型:', selectedModel);

    chrome.storage.local.set({
      openaiModel: selectedModel
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('儲存模型失敗:', chrome.runtime.lastError);
        this.showError('儲存失敗: ' + chrome.runtime.lastError.message);
        return;
      }

      console.log('OpenAI模型選擇儲存成功');
      this.showApiSuccess(`✅ OpenAI模型已設定為: ${selectedModel}`);
    });
  }

  loadOpenaiApiSettings() {
    chrome.storage.local.get(['openaiAPIKey', 'openaiModel'], (result) => {
      const apiKey = result.openaiAPIKey || '';
      const selectedModel = result.openaiModel || 'gpt-4o-mini';

      console.log('📥 載入的OpenAI設定:');
      console.log('  - API金鑰存在:', !!apiKey);
      console.log('  - 選擇的模型:', selectedModel);

      // 更新API金鑰顯示
      if (this.openaiApiKey) {
        if (apiKey && apiKey.length > 0) {
          // 顯示遮罩的API金鑰
          const maskedKey = '••••••••••••••••' + apiKey.slice(-4);
          this.openaiApiKey.value = maskedKey;
          this.openaiApiKey.placeholder = '點擊修改或留空清除';
        } else {
          this.openaiApiKey.value = '';
          this.openaiApiKey.placeholder = '輸入OpenAI API金鑰';
        }
      }

      // 更新模型選擇器
      if (this.openaiModel) {
        this.openaiModel.value = selectedModel;
        console.log('✅ OpenAI模型選擇器已設定為:', selectedModel);
      } else {
        console.warn('⚠️ openaiModel 元素不存在，無法更新模型選擇');
      }
    });
  }

  // AI 模型優先順序管理方法
  togglePriorityConfig() {
    if (this.priorityConfig) {
      this.priorityConfig.classList.toggle('hidden');
    }
  }

  async loadModelPriority() {
    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['modelPriority'], resolve);
      });

      const savedPriority = result.modelPriority || ['gemini', 'openai', 'manual'];
      this.updatePriorityDisplay(savedPriority);
    } catch (error) {
      console.error('載入模型優先順序失敗:', error);
      // 使用預設順序
      this.updatePriorityDisplay(['gemini', 'openai', 'manual']);
    }
  }

  updatePriorityDisplay(priority) {
    if (!this.sortableModelList) return;

    const modelData = {
      'gemini': {
        name: 'Google Gemini',
        description: '免費額度 · 高品質處理 · 中文友好'
      },
      'openai': {
        name: 'OpenAI GPT',
        description: '高速處理 · 穩定可靠 · 多模型選擇'
      },
      'manual': {
        name: '離線排版',
        description: '離線處理 · 快速響應 · 基礎格式化'
      }
    };

    this.sortableModelList.innerHTML = '';

    priority.forEach((modelKey, index) => {
      const model = modelData[modelKey];
      if (model) {
        const listItem = document.createElement('li');
        listItem.className = 'sortable-item';
        listItem.dataset.model = modelKey;
        listItem.draggable = true;

        listItem.innerHTML = `
          <span class="drag-handle">⋮⋮</span>
          <div class="model-info">
            <div class="model-name">${model.name}</div>
            <div class="model-description">${model.description}</div>
          </div>
          <div class="priority-number">${index + 1}</div>
        `;

        this.sortableModelList.appendChild(listItem);
      }
    });
  }

  initSortableList() {
    if (!this.sortableModelList) return;

    let draggedElement = null;

    this.sortableModelList.addEventListener('dragstart', (e) => {
      draggedElement = e.target.closest('.sortable-item');
      if (draggedElement) {
        draggedElement.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', draggedElement.outerHTML);
      }
    });

    this.sortableModelList.addEventListener('dragend', (e) => {
      if (draggedElement) {
        draggedElement.classList.remove('dragging');
        draggedElement = null;
      }

      // 移除所有拖拽樣式
      const items = this.sortableModelList.querySelectorAll('.sortable-item');
      items.forEach(item => item.classList.remove('drag-over'));
    });

    this.sortableModelList.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const afterElement = this.getDragAfterElement(this.sortableModelList, e.clientY);
      const draggedItem = this.sortableModelList.querySelector('.dragging');

      if (afterElement == null) {
        this.sortableModelList.appendChild(draggedItem);
      } else {
        this.sortableModelList.insertBefore(draggedItem, afterElement);
      }
    });

    this.sortableModelList.addEventListener('drop', (e) => {
      e.preventDefault();
      this.savePriorityOrder();
      this.updatePriorityNumbers();
    });
  }

  getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.sortable-item:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;

      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  updatePriorityNumbers() {
    const items = this.sortableModelList.querySelectorAll('.sortable-item');
    items.forEach((item, index) => {
      const numberElement = item.querySelector('.priority-number');
      if (numberElement) {
        numberElement.textContent = index + 1;
      }
    });
  }

  savePriorityOrder() {
    const items = this.sortableModelList.querySelectorAll('.sortable-item');
    const newPriority = Array.from(items).map(item => item.dataset.model);

    chrome.storage.local.set({ modelPriority: newPriority }, () => {
      if (chrome.runtime.lastError) {
        console.error('儲存模型優先順序失敗:', chrome.runtime.lastError);
      } else {
        console.log('模型優先順序已儲存:', newPriority);
      }
    });
  }

  resetModelPriority() {
    const defaultPriority = ['gemini', 'openai', 'manual'];

    chrome.storage.local.set({ modelPriority: defaultPriority }, () => {
      if (chrome.runtime.lastError) {
        console.error('重設模型優先順序失敗:', chrome.runtime.lastError);
      } else {
        console.log('模型優先順序已重設為預設值');
        this.updatePriorityDisplay(defaultPriority);
      }
    });
  }
}

// 等待 DOM 載入完成
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
