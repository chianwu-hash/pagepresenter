# Chrome Web Store 上架欄位草稿

## Store Listing

### 名稱

網頁簡報器

### 簡短說明

將網頁內容轉換成適合會議室大螢幕閱讀的簡報格式

### 詳細說明

網頁簡報器是一款為會議室、大螢幕與教職員會議閱讀情境設計的 Chrome 擴充功能。

它可以將目前網頁或使用者選取的文字，轉換成更適合投影、簡報與共同閱讀的版面，包含放大字級、段落整理、目錄導覽、重點顯示與圖片燈箱檢視等功能。

本工具特別針對新北市校務行政系統「會議管理」頁面最佳化，可協助教師週會、主任會議、校務會議等長篇會議資料更容易在大螢幕上閱讀。

主要功能：

- 啟動簡報模式，將網頁內容轉為大螢幕閱讀版面
- 支援字級調整、主題切換、對比與聚焦
- 自動產生左側目錄，方便快速跳轉段落
- 支援圖片點擊放大，以燈箱方式檢視圖片
- 可選擇使用 AI 進行精簡版或原文重點標示
- AI 處理結果會暫存在本機，避免重複消耗 API 額度
- 支援 Google Gemini API 與 OpenAI API，由使用者自行設定金鑰

隱私說明：

本擴充功能不會將資料傳送到開發者伺服器。若使用者啟用 AI 功能，網頁文字內容會依使用者選擇傳送至 Google Gemini 或 OpenAI API 進行處理。API 金鑰與 AI 暫存結果儲存在使用者本機瀏覽器中。

### 分類

Productivity / 生產力

### 語言

繁體中文

### 隱私權政策網址

https://github.com/chianwu-hash/pagepresenter/blob/main/PRIVACY.md

## Privacy

### Single purpose

將使用者目前網頁或選取文字轉換成適合會議室大螢幕閱讀的簡報格式，並可選擇使用 AI 進行精簡與重點標示。

### Permission justification

#### activeTab

用於在使用者主動啟動簡報模式時讀取目前分頁內容，並將頁面轉換成適合大螢幕閱讀的簡報格式。

#### storage

用於儲存使用者的字級、主題、AI API 設定與最近一次 AI 處理結果，避免重複消耗 API 額度。

#### contextMenus

用於提供右鍵選單，讓使用者可以對選取文字啟動簡報閱讀。

#### scripting

用於在使用者主動啟動時注入或切換簡報閱讀介面。

#### Host permissions

僅在使用者設定 API 金鑰並按下 AI 處理時，連線到 Google Gemini 或 OpenAI API。網頁內容會送至使用者選擇的 AI 服務進行精簡或重點標示；擴充功能本身不會將資料傳送到開發者伺服器。

### Data usage disclosure

建議揭露的資料類型：

- Website content：用於將目前頁面或選取文字轉換為簡報閱讀版面，並在使用者啟用 AI 功能時產生精簡或重點標示。
- Authentication information：使用者自行輸入的 Google Gemini API 或 OpenAI API 金鑰，僅儲存在本機瀏覽器中，用於呼叫使用者選擇的 AI API。

建議勾選：

- 不出售資料
- 不將資料用於廣告
- 不將資料用於追蹤
- 不將資料提供給資料仲介或資訊轉售商
- 資料使用目的僅限於擴充功能的單一用途

## Distribution

### Visibility

建議先選 Unlisted / 不公開連結。

理由：第一次送審可以先用不公開連結測試安裝與審查流程，確認穩定後再改公開。

### Regions

建議先選 Taiwan / 台灣；若要讓其他地區老師也能安裝，再擴大到更多地區。

### Pricing

Free / 免費。

### In-app purchases

No / 無。

## Test instructions

測試人員可在任意網頁啟動擴充功能，或在新北市校務行政系統「會議管理」頁面使用。若頁面有大量會議文字，點擊擴充功能圖示後按「啟動簡報模式」，即可看到大螢幕閱讀版面、字級調整、目錄、重點切換與圖片燈箱功能。

AI 功能為選用功能，需要使用者自行在 popup 設定 Google Gemini API 或 OpenAI API 金鑰。未設定 API 金鑰時，離線版簡報閱讀功能仍可正常使用。

