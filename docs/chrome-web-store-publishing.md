# Chrome Web Store 發布與更新流程

## 結論

第一次上架建議手動完成。Chrome Web Store API 可用於建立、更新與發布項目，但新項目在發布前仍需要先到 Developer Dashboard 填完 Store listing 與 Privacy 等資訊。

後續版本更新可以自動化：

1. `npm run build:extension` 產生 `dist/pagepresenter-版本號.zip`
2. `npm run publish:cws:upload` 上傳為草稿，不送審
3. `npm run publish:cws:submit` 上傳並送審

## 第一次上架

1. 到 Chrome Web Store Developer Dashboard。
2. 新增項目並上傳 `dist/pagepresenter-1.1.0.zip`。
3. 填寫 Store Listing、Privacy、Distribution、Test instructions。
4. 送出審查。
5. 通過後記下 extension ID。

## GitHub Secrets

後續要讓 GitHub Actions 自動更新，請在 GitHub repository secrets 加入：

- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`
- `CWS_PUBLISHER_ID`
- `CWS_EXTENSION_ID`

前三項來自 Google Cloud OAuth / Chrome Web Store API 設定；`CWS_PUBLISHER_ID` 可在 Developer Dashboard 的 Publisher settings 找到；`CWS_EXTENSION_ID` 是 Chrome Web Store 項目的 extension ID。

## 建議的權限說明

`activeTab`：

> 用於在使用者主動啟動簡報模式時讀取目前分頁內容，並將頁面轉換成適合大螢幕閱讀的簡報格式。

`storage`：

> 用於儲存使用者的字級、主題、AI API 設定與最近一次 AI 處理結果，避免重複消耗 API 額度。

`contextMenus`：

> 用於提供右鍵選單，讓使用者可對選取文字啟動簡報閱讀。

`scripting`：

> 用於在使用者主動啟動時注入或切換簡報閱讀介面。

Host permissions：

> 僅在使用者設定 API 金鑰並按下 AI 處理時，連線到 Google Gemini 或 OpenAI API。網頁內容會送至使用者選擇的 AI 服務進行精簡或重點標示；擴充功能本身不會將資料傳送到其他伺服器。

Single purpose：

> 將使用者目前網頁或選取文字轉換成適合會議室大螢幕閱讀的簡報格式，並可選擇使用 AI 進行精簡與重點標示。
