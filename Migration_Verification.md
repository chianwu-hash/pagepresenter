# 🔄 Claude → Gemini API 遷移驗證清單

## ✅ 已完成項目

### 1. 核心程式檔案更新
- [x] **manifest.json**: 更新權限為 `generativelanguage.googleapis.com`
- [x] **content.js**:
  - 函數名稱：`processWithClaudeAPI` → `processWithGeminiAPI`
  - API 端點：Anthropic → Google Generative Language
  - 請求格式：完全重寫以符合 Gemini API
  - 金鑰獲取：`claudeAPIKey` → `geminiAPIKey`
  - 結果處理：`formatClaudeResult` → `formatGeminiResult`

### 2. 使用者介面更新
- [x] **popup.html**:
  - 標題：「Claude AI 排版增強」→「Google Gemini AI 排版增強 (免費)」
  - 輸入欄位：`claudeApiKey` → `geminiApiKey`
  - 說明文字：更新為 Gemini 相關資訊
  - API 連結：指向 Google AI Studio

- [x] **popup.js**:
  - 函數名稱：`saveClaudeApiKey` → `saveGeminiApiKey`
  - 金鑰驗證：`sk-ant-` → `AIza`
  - 儲存鍵值：`claudeAPIKey` → `geminiAPIKey`
  - 狀態顯示：更新為 Gemini 相關文字

### 3. 文件與說明更新
- [x] **test.html**: 更新測試說明和注意事項
- [x] **Claude_AI_Integration_Summary.md**: 重命名並更新為 Gemini 版本
- [x] **Gemini_API_Key_教學.md**: 新建詳細教學文件

## 🧪 測試步驟

### 1. 功能測試
1. **載入擴充功能**：
   - 開啟 Chrome 擴充功能管理頁面
   - 選擇「載入未封裝項目」
   - 選擇專案資料夾

2. **UI 測試**：
   - 點擊擴充功能圖示
   - 確認顯示「Google Gemini AI 排版增強 (免費)」
   - 點擊 ⚙️ 按鈕，確認設定界面正常

3. **API 金鑰設定測試**：
   - 輸入錯誤格式金鑰，確認顯示錯誤訊息
   - 輸入正確格式金鑰 (AIza...)，確認儲存成功
   - 重新開啟擴充功能，確認金鑰狀態顯示正確

4. **排版功能測試**：
   - 開啟 `test.html`
   - 選取測試區域內容
   - 右鍵選擇「啟動簡報模式」
   - 驗證 AI 排版效果（需要有效的 Gemini API Key）

### 2. 降級機制測試
1. **無 API Key 測試**：
   - 清除 API Key 設定
   - 測試選取內容啟動簡報模式
   - 確認使用規則式處理且功能正常

2. **API 錯誤測試**：
   - 設定無效的 API Key
   - 測試簡報模式啟動
   - 確認自動降級至規則式處理

## 🔍 驗證點

### API 請求格式驗證
- [ ] 請求 URL：`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent`
- [ ] 請求方法：POST
- [ ] 認證方式：URL 參數 `?key=API_KEY`
- [ ] 請求體格式：符合 Gemini API 規範

### 回應處理驗證
- [ ] 正確解析 `result.candidates[0].content.parts[0].text`
- [ ] 錯誤處理：檢查 candidates 存在性
- [ ] Markdown 格式處理：標題、列表、粗體等

### 儲存機制驗證
- [ ] Chrome Storage 使用 `geminiAPIKey` 鍵值
- [ ] 金鑰格式驗證：`AIza` 開頭
- [ ] 安全顯示：遮罩處理

## 📊 功能對比

| 功能 | Claude API | Gemini API | 狀態 |
|------|------------|------------|------|
| 智能排版 | ✅ | ✅ | 已遷移 |
| 免費層級 | ❌ (需付費) | ✅ (每日100-1000次) | ✅ 改善 |
| 中文支援 | ✅ | ✅ | 維持 |
| 降級機制 | ✅ | ✅ | 維持 |
| API 穩定性 | ✅ | ✅ | 維持 |

## 🎯 遷移優勢

1. **成本優勢**：從付費 API 改為提供免費層級
2. **使用門檻**：從需要信用卡到免費層級註冊即用
3. **用戶接受度**：免費層級更容易被採用
4. **功能穩定性**：保持原有的混合策略
5. **擴展性**：Google 生態系統支援，可升級付費層級

## ⚠️ 注意事項

1. **API 額度限制**：免費層級每日 100-1,000 次（依模型而定），適合個人測試
2. **網路依賴**：仍需網路連線使用 AI 功能
3. **備用機制**：確保無 API Key 時仍可正常運作
4. **版本相容**：確認新的 API 呼叫格式穩定性
5. **升級選項**：可升級付費層級獲得更高額度

## 🚀 部署準備

- [x] 所有程式碼已更新
- [x] 測試檔案已準備
- [x] 說明文件已完成
- [ ] 使用者測試驗證
- [ ] 效能與穩定性測試

**遷移完成！用戶現在可以享受免費層級的 AI 智能排版功能，需要更高使用量可升級付費層級。** 🎉