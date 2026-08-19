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