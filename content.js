class WebReader {
  constructor() {
    this.isActive = false;
    this.originalContent = null;
    this.fontSize = 32;
    this.isHighContrast = false;
    this.isSidebarCollapsed = false;
    this.currentSection = 0;
    this.sections = [];
    this.tableOfContents = [];
    this.selectedContent = null;
    this.originalSelectedText = null; // 保存原始選取文字
    this.originalSelectedFragment = null; // 保存選取範圍的本機 DOM（不送往 AI）
    this.esaAttachmentSources = new Map(); // 離線附件卡片對應的 ESA 原始點擊節點
    this.lastSelectionSnapshot = null; // 右鍵選單開啟前保留選取狀態
    this.simplifiedContent = null; // AI精簡版本快取
    this.originalFormattedContent = null; // 原文排版版本快取
    this.offlineFormattedContent = null; // 離線排版版本快取
    this.offlineHighlightedContent = null; // 離線規則式重點版本快取
    this.isSimplifiedVersion = true; // 當前版本狀態：true=精簡版, false=原文版
    this.isOfflineMode = false; // 是否為離線模式
    this.isHighlightMode = false; // 畫重點模式狀態
    this.highlightData = null; // AI畫重點數據快取
    this.simplifiedHighlighted = null; // 精簡版重點標記內容
    this.originalHighlighted = null; // 原文版重點標記內容
    this.currentFormatMode = 'AI'; // 當前排版模式：'AI' 或 'Manual'
    this.isAIProcessing = false;
    this.aiProcessingStarted = false;
    this.init();
  }

  init() {
    this.createReaderInterface();
    this.bindEvents();
    this.loadSettings();
  }

  createReaderInterface() {
    const readerContainer = document.createElement('div');
    readerContainer.id = 'web-reader-container';
    readerContainer.className = 'web-reader-hidden';

    readerContainer.innerHTML = `
      <div id="web-reader-toolbar">
        <div class="toolbar-left">
          <button id="reader-close" title="關閉簡報模式">✕</button>
          <button id="reader-fullscreen" title="全螢幕模式">⛶</button>
          <span class="divider">|</span>
          <button id="reader-font-decrease" title="縮小字體">A-</button>
          <span id="reader-font-size">${this.fontSize}px</span>
          <button id="reader-font-increase" title="放大字體">A+</button>
          <span class="divider">|</span>
          <button id="reader-contrast" title="高對比模式">◐</button>
          <span class="divider">|</span>
          <button id="reader-version-toggle" title="切換版本 (精簡版/原文版)">📄</button>
          <button id="reader-highlight-mode" title="AI畫重點模式">✨</button>
          <button id="reader-ai-process" title="送給 AI 處理">🤖 AI處理</button>
        </div>
        <div class="toolbar-right">
          <div id="reader-status-display">
            <span id="mode-status">精簡版</span>
            <span class="divider">|</span>
            <span id="highlight-status">畫重點: 關</span>
          </div>
          <div id="reader-progress">
            <span id="progress-text">0 / 0</span>
            <div id="progress-bar">
              <div id="progress-fill"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="web-reader-content-container">
        <div id="web-reader-sidebar">
          <div id="toc-header">
            <span>目錄</span>
            <button id="sidebar-toggle" title="收合目錄">◀</button>
          </div>
          <div id="table-of-contents"></div>
        </div>

        <div id="web-reader-content">
          <div id="reader-main-content"></div>
        </div>
      </div>
    `;

    document.body.appendChild(readerContainer);
  }

  bindEvents() {
    document.getElementById('reader-close').onclick = () => this.toggleReader();
    document.getElementById('reader-fullscreen').onclick = () => this.toggleFullscreen();
    document.getElementById('reader-font-increase').onclick = () => this.adjustFontSize(4);
    document.getElementById('reader-font-decrease').onclick = () => this.adjustFontSize(-4);
    document.getElementById('reader-contrast').onclick = () => this.toggleHighContrast();
    document.getElementById('reader-version-toggle').onclick = (e) => {
      if (e.target.disabled) return;
      this.toggleVersion();
    };
    document.getElementById('reader-highlight-mode').onclick = (e) => {
      if (e.target.disabled) return;
      this.toggleHighlightMode();
    };
    document.getElementById('reader-ai-process').onclick = () => this.startAIProcessing();
    document.getElementById('sidebar-toggle').onclick = () => this.toggleSidebar();

    // 使用事件委派，讓離線畫重點所產生的 clone 也能開啟附件。
    document.getElementById('reader-main-content').addEventListener('click', (event) => {
      const attachmentButton = event.target.closest('[data-reader-attachment-id]');
      if (!attachmentButton) return;
      event.preventDefault();
      this.openEsaAttachment(
        attachmentButton.dataset.readerAttachmentId,
        attachmentButton.dataset.readerAttachmentName || '附件'
      );
    });

    document.addEventListener('keydown', (e) => {
      if (this.isActive) {
        this.handleKeyboard(e);
      }
    });

    // 在右鍵選單接手前保存選取範圍；DOM 只留在目前分頁記憶體。
    document.addEventListener('selectionchange', () => {
      if (!this.isActive) {
        this.captureSelectionSnapshot();
      }
    });

    // 簡報內容使用自己的捲動容器，進度也必須監聽同一個元素。
    document.getElementById('web-reader-content').addEventListener('scroll', () => {
      if (this.isActive) {
        this.currentSection = this.getCurrentSection();
        this.updateProgress();
      }
    });
  }

  captureSelectionSnapshot() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const text = selection.toString().trim();
    if (!text) return null;

    const fragment = selection.getRangeAt(0).cloneContents();
    this.lastSelectionSnapshot = { text, fragment };
    return this.lastSelectionSnapshot;
  }

  getSelectionFragment(selectedText) {
    const current = this.captureSelectionSnapshot();
    const snapshot = current || this.lastSelectionSnapshot;
    if (!snapshot || !snapshot.fragment) return null;

    const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
    const expected = normalize(selectedText);
    const actual = normalize(snapshot.text);

    // 避免誤用上一段陳舊選取；容許瀏覽器對儲存格空白做些微正規化。
    if (expected && actual &&
        expected !== actual &&
        !expected.includes(actual) &&
        !actual.includes(expected)) {
      return null;
    }

    return snapshot.fragment.cloneNode(true);
  }

  // 處理選取內容並啟動簡報模式
  async startWithSelectedContent(selectedText, selectedFragment = null, attachmentSources = null) {
    console.log('使用選取內容啟動簡報模式');

    // 保存原始選取文字
    this.originalSelectedText = selectedText;
    this.originalSelectedFragment = selectedFragment
      ? selectedFragment.cloneNode(true)
      : this.getSelectionFragment(selectedText);
    this.esaAttachmentSources = attachmentSources instanceof Map
      ? attachmentSources
      : new Map();
    this.offlineHighlightedContent = null;
    this.simplifiedContent = null;
    this.originalFormattedContent = null;
    this.simplifiedHighlighted = null;
    this.originalHighlighted = null;
    this.highlightData = null;
    this.isAIProcessing = false;
    this.aiProcessingStarted = false;

    // 新的分階段處理流程
    await this.processWithStagedAI(selectedText);
  }

  // 新的分階段AI處理流程
  async processWithStagedAI(selectedText) {
    console.log('🚀 建立離線版，等待用戶決定是否送往 AI');

    // 第一步：立即顯示離線排版
    this.showOfflineProcessingFirst(selectedText);

    // 未取得明確同意前不呼叫任何 AI 供應商。
    this.showAIConsentDialog();
  }

  // 立即顯示離線排版
  showOfflineProcessingFirst(selectedText) {
    console.log('📄 立即顯示離線排版');

    // 生成簡單的離線排版內容並快取
    const offlineContent = this.generateOfflineFormatting(
      selectedText,
      this.originalSelectedFragment
    );
    this.offlineFormattedContent = offlineContent; // 快取離線內容
    this.selectedContent = offlineContent;

    // 在建立工具列狀態前先進入離線模式，避免短暫顯示 AI 按鈕說明。
    this.isOfflineMode = true;
    this.isSimplifiedVersion = false;
    this.currentFormatMode = 'Manual';

    // 先啟動讀者模式顯示離線內容
    this.activateReader();

    // 🔍 調試：檢查selectedContent是否正確設置
    console.log('📋 selectedContent設置情況:', {
      hasSelectedContent: !!this.selectedContent,
      contentType: typeof this.selectedContent,
      isElement: this.selectedContent instanceof Element,
      hasInnerHTML: this.selectedContent && !!this.selectedContent.innerHTML
    });

    // ⚡ 立即顯示離線內容，不需要等待
    setTimeout(() => {
      console.log('🎬 立即顯示離線排版內容');
      this.hideLoadingState();
    }, 100);

    // 統一更新狀態顯示
    this.updateAllStatusDisplays('離線排版', '離線版', '#ffeaa7', '#856404');
    this.updateAIProcessButtonState();
  }

  showAIConsentDialog() {
    this.removeAIConsentDialog();

    const overlay = document.createElement('div');
    overlay.id = 'ai-consent-overlay';

    const dialog = document.createElement('div');
    dialog.id = 'ai-consent-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'ai-consent-title');
    dialog.innerHTML = `
      <div class="ai-consent-icon" aria-hidden="true">✓</div>
      <h3 id="ai-consent-title">離線版已完成</h3>
      <p>是否繼續產生 AI 處理版？</p>
      <p class="ai-consent-note">選擇「繼續」後，才會把本次內容送給已設定的 AI 供應商。</p>
      <div class="ai-consent-actions">
        <button id="ai-consent-continue" type="button">繼續 AI 處理</button>
        <button id="ai-consent-stay" type="button">停在離線版</button>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(dialog);

    document.getElementById('ai-consent-continue').onclick = () => {
      this.removeAIConsentDialog();
      this.startAIProcessing();
    };
    document.getElementById('ai-consent-stay').onclick = () => {
      this.removeAIConsentDialog();
      this.updateAIProcessButtonState();
      this.showStatusNotification('已停在離線版，內容尚未送給 AI；需要時可點擊工具列「AI處理」');
    };
    document.getElementById('ai-consent-stay').focus();
  }

  removeAIConsentDialog() {
    document.getElementById('ai-consent-dialog')?.remove();
    document.getElementById('ai-consent-overlay')?.remove();
  }

  async startAIProcessing() {
    if (this.isAIProcessing || this.aiProcessingStarted || !this.originalSelectedText) return;

    this.removeAIConsentDialog();
    this.isAIProcessing = true;
    this.aiProcessingStarted = true;
    this.updateAIProcessButtonState();
    this.showStatusNotification('已確認送出，AI 精簡版處理中...');

    try {
      await this.processFirstStage(this.originalSelectedText);
      await this.handleFirstStageComplete();
    } finally {
      this.isAIProcessing = false;
      if (!this.simplifiedContent) {
        this.aiProcessingStarted = false;
      }
      this.updateAIProcessButtonState();
    }
  }

  updateAIProcessButtonState() {
    const button = document.getElementById('reader-ai-process');
    if (!button) return;

    const shouldShow = this.isOfflineMode &&
      !!this.originalSelectedText &&
      (!this.simplifiedContent || this.isAIProcessing);
    button.classList.toggle('reader-control-hidden', !shouldShow);
    button.disabled = this.isAIProcessing || this.aiProcessingStarted;
    button.textContent = this.isAIProcessing ? '🤖 AI處理中' : '🤖 AI處理';
    button.title = this.isAIProcessing
      ? 'AI 處理中'
      : '將本次內容送給已設定的 AI 供應商處理';
  }

  // 統一更新所有狀態顯示 - 簡化版本
  updateAllStatusDisplays() {
    // 根據當前狀態計算應該顯示的版本文字
    const statusInfo = this.getCurrentStatusInfo();

    // 更新版本狀態
    const modeStatus = document.getElementById('mode-status');
    if (modeStatus) {
      modeStatus.textContent = statusInfo.version;
    }

    // 更新重點狀態
    const highlightStatus = document.getElementById('highlight-status');
    if (highlightStatus) {
      highlightStatus.textContent = this.isHighlightMode ? '畫重點: 開' : '畫重點: 關';
    }

    console.log(`🔄 狀態更新: ${statusInfo.version} | 重點: ${this.isHighlightMode ? '開' : '關'}`);
  }

  // 新增：根據當前狀態計算應該顯示的資訊
  getCurrentStatusInfo() {
    if (this.isOfflineMode) {
      return {
        formatMode: '離線排版',
        version: '離線版',
        backgroundColor: '#ffeaa7',
        textColor: '#856404'
      };
    }

    if (this.currentFormatMode === 'Manual') {
      return {
        formatMode: '離線排版',
        version: this.isSimplifiedVersion ? '精簡版' : '原文版',
        backgroundColor: '#666',
        textColor: '#fff'
      };
    }

    // AI 模式
    const isSimplified = this.isSimplifiedVersion;
    return {
      formatMode: isSimplified ? 'AI 精簡版' : 'AI 原文版',
      version: isSimplified ? '精簡版' : '原文版',
      backgroundColor: isSimplified ? '#d4edda' : '#d1ecf1',
      textColor: isSimplified ? '#155724' : '#0c5460'
    };
  }

  // 生成離線排版內容
  generateOfflineFormatting(selectedText, selectedFragment = null) {
    console.log('🔧 生成離線排版內容');

    if (selectedFragment && selectedFragment.textContent.trim().length >= 10) {
      const structured = this.createStructuredOfflineContent(selectedFragment);
      if (structured.textContent.trim().length >= 10) {
        console.log('✅ 使用選取範圍 DOM 生成離線排版');
        return structured;
      }
    }

    console.log('ℹ️ 無可用 DOM，改用保守純文字排版');
    return this.createConservativeOfflineTextContent(selectedText);
  }

  createStructuredOfflineContent(selectedFragment) {
    const source = document.createElement('div');
    source.appendChild(selectedFragment.cloneNode(true));

    source.querySelectorAll(
      'script, style, noscript, template, form, button, input, select, textarea, ' +
      '[hidden], [aria-hidden="true"], .ng-hide, .ng-cloak, .hidden, .hidden-print, ' +
      '[style*="display: none" i], [style*="display:none" i], ' +
      '[style*="visibility: hidden" i], [style*="visibility:hidden" i], ' +
      '#web-reader-container'
    ).forEach(element => element.remove());

    const output = document.createElement('div');
    output.className = 'reader-restructured-content reader-offline-content';

    Array.from(source.childNodes).forEach(node => {
      this.appendOfflineNode(node, output);
    });

    this.addOfflineTableHeadings(output);

    return output;
  }

  addOfflineTableHeadings(output) {
    const wrappers = Array.from(output.querySelectorAll('.reader-table-wrapper'));
    wrappers.forEach((wrapper, index) => {
      if (wrapper.previousElementSibling?.classList.contains('reader-header')) return;

      const table = wrapper.querySelector('table');
      if (!table) return;
      const heading = document.createElement('h2');
      heading.className = 'reader-header reader-h2 reader-generated-heading';
      heading.textContent = this.deriveOfflineTableTitle(table, index, wrappers.length);
      wrapper.before(heading);
    });
  }

  deriveOfflineTableTitle(table, index, tableCount) {
    const headerText = Array.from(table.querySelectorAll('th'))
      .map(cell => cell.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');
    const allText = table.textContent.replace(/\s+/g, ' ').trim();
    const sample = `${headerText} ${allText.slice(0, 240)}`;

    if (/案由|決議|辦理情形|承辦|會議項目|報告事項|討論事項/.test(sample)) {
      return '會議事項';
    }
    if (/姓名|單位|職稱|簽到|出席|列席|請假/.test(sample)) {
      return '出席與簽到';
    }
    if (/會議名稱|日期|時間|地點|主席|記錄|紀錄/.test(sample)) {
      return '會議資訊';
    }
    if (tableCount === 2) return index === 0 ? '會議資料' : '會議內容';
    return `資料表 ${index + 1}`;
  }

  appendOfflineNode(node, target) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (text.length >= 2) this.appendOfflineParagraph(node, target);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();

    if (node.matches('.meeting-card-content--file')) {
      this.appendOfflineAttachments(node, target);
      return;
    }

    if (/^h[1-6]$/.test(tag)) {
      const level = Math.min(Number(tag.slice(1)), 3);
      const heading = document.createElement(`h${level}`);
      heading.className = `reader-header reader-h${level}`;
      this.appendSanitizedInline(node, heading);
      if (heading.textContent.trim()) target.appendChild(heading);
      return;
    }

    if (tag === 'table') {
      const table = this.processTable(node);
      if (table) {
        const wrapper = document.createElement('div');
        wrapper.className = 'reader-table-wrapper';
        wrapper.appendChild(table);
        target.appendChild(wrapper);
      }
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      const list = this.createOfflineList(node, tag);
      if (list.children.length) target.appendChild(list);
      return;
    }

    if (tag === 'p' || tag === 'blockquote' || tag === 'pre') {
      this.appendOfflineParagraph(node, target, tag === 'blockquote');
      return;
    }

    if (tag === 'img' || tag === 'picture' || tag === 'figure') {
      this.appendOfflineMedia(node, target);
      return;
    }

    if (tag === 'video' || tag === 'audio' || tag === 'iframe') {
      this.appendOfflineMedia(node, target);
      return;
    }

    if (tag === 'hr') {
      target.appendChild(document.createElement('hr'));
      return;
    }

    const blockSelector = 'h1,h2,h3,h4,h5,h6,p,blockquote,pre,ul,ol,table,figure,img,video,audio,iframe,section,article';
    const hasBlockChildren = !!node.querySelector(blockSelector);

    if (hasBlockChildren) {
      Array.from(node.childNodes).forEach(child => this.appendOfflineNode(child, target));
    } else if (node.textContent.trim()) {
      this.appendOfflineParagraph(node, target);
    }
  }

  appendOfflineParagraph(source, target, isQuote = false) {
    const paragraph = document.createElement(isQuote ? 'blockquote' : 'p');
    paragraph.className = isQuote ? 'reader-quote' : 'reader-paragraph';
    this.appendSanitizedInline(source, paragraph);

    const text = paragraph.textContent.replace(/\s+/g, ' ').trim();
    if (text.length < 2 && !paragraph.querySelector('a, img')) return;

    if (this.isConservativeOfflineHeader(text)) {
      const heading = document.createElement('h2');
      heading.className = 'reader-header reader-h2';
      while (paragraph.firstChild) heading.appendChild(paragraph.firstChild);
      target.appendChild(heading);
      return;
    }

    target.appendChild(paragraph);
  }

  appendSanitizedInline(source, target) {
    const appendNode = (node, destination) => {
      if (node.nodeType === Node.TEXT_NODE) {
        destination.appendChild(document.createTextNode(node.textContent));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();
      if (tag === 'br') {
        destination.appendChild(document.createElement('br'));
        return;
      }
      if (tag === 'img') {
        const image = this.createSafeOfflineImage(node);
        if (image) destination.appendChild(image);
        return;
      }

      let nextDestination = destination;
      if (['strong', 'b', 'em', 'i', 'u', 's', 'code', 'mark', 'small', 'sup', 'sub'].includes(tag)) {
        const safeTag = tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag;
        nextDestination = document.createElement(safeTag);
        destination.appendChild(nextDestination);
      } else if (tag === 'a') {
        const url = node.href || node.getAttribute('href');
        if (this.isSafeOfflineUrl(url)) {
          nextDestination = document.createElement('a');
          nextDestination.href = url;
          nextDestination.target = '_blank';
          nextDestination.rel = 'noopener noreferrer';
          nextDestination.className = 'reader-link';
          destination.appendChild(nextDestination);
        }
      }

      Array.from(node.childNodes).forEach(child => appendNode(child, nextDestination));

      if (['div', 'section', 'article'].includes(tag) && destination.lastChild &&
          destination.lastChild.nodeName !== 'BR') {
        destination.appendChild(document.createElement('br'));
      }
    };

    if (source.nodeType === Node.TEXT_NODE) {
      appendNode(source, target);
    } else {
      Array.from(source.childNodes).forEach(child => appendNode(child, target));
    }
  }

  createOfflineList(source, tagName = 'ul') {
    const list = document.createElement(tagName === 'ol' ? 'ol' : 'ul');
    list.className = 'reader-list';

    Array.from(source.children).forEach(child => {
      if (child.tagName.toLowerCase() !== 'li') return;
      const item = document.createElement('li');
      item.className = 'reader-list-item';

      Array.from(child.childNodes).forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE && ['ul', 'ol'].includes(node.tagName.toLowerCase())) {
          item.appendChild(this.createOfflineList(node, node.tagName.toLowerCase()));
        } else {
          this.appendSanitizedInline(node, item);
        }
      });

      if (item.textContent.trim() || item.children.length) list.appendChild(item);
    });

    return list;
  }

  appendOfflineMedia(source, target) {
    const figure = document.createElement('figure');
    figure.className = 'reader-media';
    const tag = source.tagName.toLowerCase();

    if (tag === 'img') {
      const image = this.createSafeOfflineImage(source);
      if (image) figure.appendChild(image);
    } else {
      source.querySelectorAll('img').forEach(imageSource => {
        const image = this.createSafeOfflineImage(imageSource);
        if (image) figure.appendChild(image);
      });
    }

    const mediaSource = source.currentSrc || source.src || source.getAttribute('src');
    if (['video', 'audio'].includes(tag) && this.isSafeOfflineUrl(mediaSource)) {
      const media = document.createElement(tag);
      media.src = mediaSource;
      media.controls = true;
      media.preload = 'metadata';
      figure.appendChild(media);
    } else if (tag === 'iframe' && this.isSafeOfflineUrl(mediaSource)) {
      const link = document.createElement('a');
      link.href = mediaSource;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'reader-link reader-embedded-link';
      link.textContent = source.title || '開啟內嵌內容';
      figure.appendChild(link);
    }

    const captionSource = tag === 'figure' ? source.querySelector('figcaption') : null;
    const captionText = captionSource?.textContent.trim() || source.alt || source.title || '';
    if (captionText) {
      const caption = document.createElement('figcaption');
      caption.textContent = captionText;
      figure.appendChild(caption);
    }

    if (figure.children.length) target.appendChild(figure);
  }

  appendOfflineAttachments(source, target) {
    const sourceItems = Array.from(
      source.querySelectorAll('.meeting-card-content--file-items[data-reader-attachment-id]')
    );
    if (!sourceItems.length) return;

    const section = document.createElement('section');
    section.className = 'reader-attachments';
    section.setAttribute('aria-label', `附件 ${sourceItems.length} 份`);

    const heading = document.createElement('div');
    heading.className = 'reader-attachments-heading';
    heading.textContent = `附件（${sourceItems.length}）`;
    section.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'reader-attachments-list';

    sourceItems.forEach(item => {
      const id = item.dataset.readerAttachmentId;
      const name = item.querySelector('.file-info--title')?.textContent.replace(/\s+/g, ' ').trim() || '未命名附件';
      const metadata = item.querySelector('.file-info--date')?.textContent.replace(/\s+/g, ' ').trim() || '';
      const extension = this.getAttachmentExtension(name);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'reader-attachment-card';
      button.dataset.readerAttachmentId = id;
      button.dataset.readerAttachmentName = name;
      button.title = `依 ESA 原始方式開啟附件：${name}`;

      const icon = document.createElement('span');
      icon.className = 'reader-attachment-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = this.getAttachmentIcon(extension);

      const info = document.createElement('span');
      info.className = 'reader-attachment-info';

      const title = document.createElement('span');
      title.className = 'reader-attachment-title';
      title.textContent = name;
      info.appendChild(title);

      const detail = document.createElement('span');
      detail.className = 'reader-attachment-meta';
      detail.textContent = [extension ? extension.toUpperCase() : '檔案', metadata]
        .filter(Boolean)
        .join(' · ');
      info.appendChild(detail);

      const action = document.createElement('span');
      action.className = 'reader-attachment-action';
      action.textContent = '開啟';

      button.appendChild(icon);
      button.appendChild(info);
      button.appendChild(action);
      list.appendChild(button);
    });

    section.appendChild(list);
    target.appendChild(section);
  }

  getAttachmentExtension(filename) {
    const match = String(filename || '').trim().match(/\.([a-z0-9]{1,10})$/i);
    return match ? match[1].toLowerCase() : '';
  }

  getAttachmentIcon(extension) {
    if (extension === 'pdf') return '📕';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) return '🖼️';
    if (['mp4', 'webm', 'mov', 'm4v'].includes(extension)) return '🎬';
    if (['mp3', 'wav', 'm4a', 'ogg'].includes(extension)) return '🎧';
    if (['doc', 'docx', 'odt', 'rtf'].includes(extension)) return '📘';
    if (['xls', 'xlsx', 'ods', 'csv'].includes(extension)) return '📊';
    if (['ppt', 'pptx', 'odp'].includes(extension)) return '📊';
    return '📄';
  }

  openEsaAttachment(id, name) {
    const entry = this.esaAttachmentSources.get(id);
    let source = entry?.source || entry;

    // Angular 重新渲染會替換原始節點；以只存在本機 DOM 的附件特徵重新定位，
    // 仍交由 ESA 原本的 ng-click 執行，不自行組下載網址。
    if ((!source || !source.isConnected) && entry?.key) {
      source = this.findLiveEsaAttachmentSource(entry.key);
      if (source) this.esaAttachmentSources.set(id, { ...entry, source });
    }

    if (!source || !source.isConnected) {
      this.showStatusNotification(`無法開啟「${name}」：ESA 原始頁面已更新，請重新啟動簡報`);
      return;
    }

    this.showStatusNotification(`正在依 ESA 原始方式開啟「${name}」`);
    source.click();
  }

  getEsaAttachmentStableKey(item) {
    if (!item) return '';
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
    const title = normalize(item.querySelector('.file-info--title')?.textContent);
    const metadata = normalize(item.querySelector('.file-info--date')?.textContent);
    return title ? `${title}\u0000${metadata}` : '';
  }

  findLiveEsaAttachmentSource(key) {
    if (!key) return null;

    const items = Array.from(document.querySelectorAll(
      '.meeting-card-content--file:not(.ng-hide) .meeting-card-content--file-items'
    )).filter(item => !item.closest('#web-reader-container'));

    const item = items.find(candidate => this.getEsaAttachmentStableKey(candidate) === key);
    return item?.querySelector('[ng-click*="attach_file"]') || null;
  }

  createSafeOfflineImage(source) {
    const url = source.currentSrc || source.src || source.getAttribute('src');
    if (!this.isSafeOfflineUrl(url, true)) return null;

    const image = document.createElement('img');
    image.src = url;
    image.alt = source.alt || '';
    image.loading = 'lazy';
    image.className = 'reader-image';
    return image;
  }

  isSafeOfflineUrl(url, allowImageData = false) {
    if (!url) return false;
    const normalized = String(url).trim();
    if (/^(https?:|mailto:|tel:|blob:)/i.test(normalized)) return true;
    return allowImageData && /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);/i.test(normalized);
  }

  createConservativeOfflineTextContent(selectedText) {
    const output = document.createElement('div');
    output.className = 'reader-restructured-content reader-offline-content';
    const lines = selectedText
      .replace(/\r\n?|\t/g, '\n')
      .split('\n')
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    let activeList = null;
    lines.forEach(line => {
      if (this.isConservativeOfflineHeader(line)) {
        activeList = null;
        const heading = document.createElement('h2');
        heading.className = 'reader-header reader-h2';
        heading.textContent = line;
        output.appendChild(heading);
      } else if (this.isOfflineListItem(line)) {
        if (!activeList) {
          activeList = document.createElement('ul');
          activeList.className = 'reader-list';
          output.appendChild(activeList);
        }
        const item = document.createElement('li');
        item.className = 'reader-list-item';
        item.textContent = this.cleanListItemPrefix(line);
        activeList.appendChild(item);
      } else {
        activeList = null;
        const paragraph = document.createElement('p');
        paragraph.className = 'reader-paragraph';
        paragraph.textContent = line;
        output.appendChild(paragraph);
      }
    });

    return output;
  }

  isConservativeOfflineHeader(text) {
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (trimmed.length < 2 || trimmed.length > 40) return false;
    if (/[。！？；]/.test(trimmed)) return false;
    if (/^\d{2,4}[\/\-.年]\d{1,2}/.test(trimmed)) return false;

    const meetingHeaders = /^(會議記錄|會議名稱|報告事項|討論事項|提案討論|臨時動議|主席裁示|主席結論|散會|案由|說明|決議|結論|辦理情形|追蹤事項|附件)(?:[：:]|$)/;
    if (meetingHeaders.test(trimmed)) return true;
    if (/^[^：:]{2,18}[：:]$/.test(trimmed)) return true;

    const numbered = /^(?:第[一二三四五六七八九十\d]+(?:案|項|節)|[一二三四五六七八九十]+[、．]|\d+[、.])\s*/;
    return numbered.test(trimmed) && trimmed.length <= 28;
  }

  isOfflineListItem(text) {
    const trimmed = text.trim();
    return /^(?:[-*•●○▪▫]|\(?\d+\)|\([一二三四五六七八九十]+\)|[甲乙丙丁戊己庚辛壬癸][、．])\s*/.test(trimmed) ||
      /^(?:\d+|[一二三四五六七八九十]+)[、．.]\s+/.test(trimmed);
  }

  // 渲染分組內容為HTML
  renderGroupedContent(groupedContent) {
    let html = '';

    groupedContent.forEach(item => {
      if (typeof item === 'string') {
        const isHeaderResult = this.isHeader(item);

        // 🔍 調試：記錄渲染階段的判斷結果
        if (item.match(/^[一二三四五六七八九十]/)) {
          console.log('🎨 renderGroupedContent 階段判斷:', item.substring(0, 30) + '...', {
            isHeader: isHeaderResult,
            length: item.length,
            willRenderAs: isHeaderResult ? 'HEADER' : 'PARAGRAPH'
          });
        }

        if (isHeaderResult) {
          const level = this.getHeaderLevelByLength(item);
          const headerHtml = `<h${level} class="reader-header reader-h${level}">${this.escapeHtml(item)}</h${level}>\n`;

          // 🔍 調試：記錄生成的HTML
          if (item.match(/^[一二三四五六七八九十]/)) {
            console.log('🏗️ 生成標題HTML:', {
              item: item.substring(0, 30) + '...',
              level: level,
              html: headerHtml.substring(0, 50) + '...'
            });
          }

          html += headerHtml;
        } else if (this.isListItem(item)) {
          html += `<div class="reader-list-item">${this.escapeHtml(item)}</div>\n`;
        } else {
          html += `<p class="reader-paragraph">${this.escapeHtml(item)}</p>\n`;
        }
      } else if (item.type === 'paragraph_group') {
        html += '<div class="reader-paragraph-group">\n';
        item.lines.forEach(line => {
          html += `<p class="reader-paragraph">${this.escapeHtml(line)}</p>\n`;
        });
        html += '</div>\n';
      }
    });

    return html;
  }

  // 獲取標題級別（根據文字長度）
  getHeaderLevelByLength(text) {
    if (!text || typeof text !== 'string') return 3;
    if (text.length < 10) return 1;
    if (text.length < 20) return 2;
    return 3;
  }

  // HTML轉義
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 第一階段：處理精簡版+重點
  async processFirstStage(selectedText) {
    console.log('⚡ 開始第一階段：精簡版+重點處理');

    // 顯示第一階段處理狀態
    this.updateProcessingStatus('AI 精簡版生成中...', '處理中');

    try {
      // 處理精簡版本（含重點標記）
      const result = await this.processSingleModeWithHighlights(selectedText, true);

      if (result && typeof result === 'object' && result.formatted && result.highlighted) {
        this.simplifiedContent = result.formatted;
        this.simplifiedHighlighted = result.highlighted;
        console.log('✅ 第一階段處理完成（含重點數據）');
        // 顯示第一階段完成狀態
        this.updateProcessingStatus('AI 精簡版處理完成', '已完成', true);
      } else {
        // 舊版本相容性
        this.simplifiedContent = result;
        console.log('✅ 第一階段處理完成（傳統模式）');
        // 顯示第一階段完成狀態
        this.updateProcessingStatus('AI 精簡版處理完成', '已完成', true);
      }

      // 更新重點數據
      if (!this.highlightData) this.highlightData = {};
      if (this.simplifiedHighlighted) {
        this.highlightData.simplified = this.simplifiedHighlighted;
      }

    } catch (error) {
      console.error('❌ 第一階段處理失敗:', error);
      // 失敗時保持顯示離線版本
      this.updateProcessingStatus('AI 精簡版處理失敗', '錯誤', true);
    }
  }

  // 處理第一階段完成
  async handleFirstStageComplete() {
    console.log('🎯 第一階段完成，準備用戶確認');

    if (!this.simplifiedContent) {
      console.log('⚠️ 第一階段處理失敗，保持離線版本');
      this.updateLoadingState('AI 第一階段處理失敗，將保持離線排版');
      return;
    }

    // 顯示第一階段完成提示
    this.showFirstStageCompleteDialog();
  }

  // 顯示第一階段完成對話框
  showFirstStageCompleteDialog() {
    // 清除載入狀態
    this.hideLoadingState();

    // 創建確認對話框
    const dialog = document.createElement('div');
    dialog.id = 'ai-stage-dialog';
    dialog.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      padding: 24px;
      z-index: 1000001;
      max-width: 400px;
      font-family: "Microsoft JhengHei", Arial, sans-serif;
      border: 2px solid #0066cc;
    `;

    dialog.innerHTML = `
      <div style="text-align: center;">
        <div style="font-size: 20px; margin-bottom: 12px;">🎉</div>
        <h3 style="margin: 0 0 16px 0; color: #0066cc; font-size: 18px;">
          AI 精簡版處理完成！
        </h3>
        <p style="margin: 0 0 20px 0; color: #666; line-height: 1.5; font-size: 14px;">
          已完成精簡版本的處理和重點標記<br>
          是否要替換顯示精簡版本？
        </p>
        <div style="display: flex; gap: 12px; justify-content: center;">
          <button id="show-simplified" style="
            background: #0066cc;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
          ">顯示精簡版</button>
          <button id="continue-original" style="
            background: #28a745;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
          ">繼續處理原文版</button>
          <button id="keep-offline" style="
            background: #6c757d;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
          ">保持離線版</button>
        </div>
      </div>
    `;

    // 創建遮罩
    const overlay = document.createElement('div');
    overlay.id = 'ai-stage-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0,0,0,0.5);
      z-index: 1000000;
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(dialog);

    // 綁定事件
    document.getElementById('show-simplified').onclick = () => {
      this.applyFirstStageResult();
      this.removeDialog();
      this.startSecondStage();
    };

    document.getElementById('continue-original').onclick = () => {
      this.removeDialog();
      this.startSecondStage();
    };

    document.getElementById('keep-offline').onclick = () => {
      this.removeDialog();
      console.log('✅ 用戶選擇保持離線版本');
    };
  }

  // 移除對話框
  removeDialog() {
    const dialog = document.getElementById('ai-stage-dialog');
    const overlay = document.getElementById('ai-stage-overlay');
    if (dialog) dialog.remove();
    if (overlay) overlay.remove();
  }

  // 應用第一階段結果
  applyFirstStageResult() {
    console.log('🔄 切換到精簡版本');
    this.selectedContent = this.simplifiedContent;
    this.isSimplifiedVersion = true;
    this.isOfflineMode = false; // 退出離線模式

    // 更新顯示內容
    this.refreshContent();

    // 統一更新狀態
    this.updateAllStatusDisplays('AI 精簡版', '精簡版', '#d4edda', '#155724');
    this.updateAIProcessButtonState();
  }

  // 開始第二階段處理
  async startSecondStage() {
    console.log('⚡ 開始第二階段：原文版+重點處理');

    // 顯示第二階段處理狀態
    this.updateProcessingStatus('AI 原文版生成中...', '處理中');

    try {
      // 處理原文版本（含重點標記）
      const result = await this.processSingleModeWithHighlights(this.originalSelectedText, false);

      if (result && typeof result === 'object' && result.formatted && result.highlighted) {
        this.originalFormattedContent = result.formatted;
        this.originalHighlighted = result.highlighted;
        console.log('✅ 第二階段處理完成（含重點數據）');
        // 顯示第二階段完成狀態
        this.updateProcessingStatus('AI 原文版處理完成', '已完成', true);
      } else {
        // 舊版本相容性
        this.originalFormattedContent = result;
        console.log('✅ 第二階段處理完成（傳統模式）');
        // 顯示第二階段完成狀態
        this.updateProcessingStatus('AI 原文版處理完成', '已完成', true);
      }

      // 更新重點數據
      if (!this.highlightData) this.highlightData = {};
      if (this.originalHighlighted) {
        this.highlightData.original = this.originalHighlighted;
      }

      this.handleSecondStageComplete();

    } catch (error) {
      console.error('❌ 第二階段處理失敗:', error);
      this.updateProcessingStatus('AI 原文版處理失敗', '錯誤', true);
    }
  }

  // 處理第二階段完成
  handleSecondStageComplete() {
    console.log('🎯 第二階段完成，所有處理結束');

    // 顯示所有處理完成狀態
    this.updateProcessingStatus('✅ AI 處理完成', '已完成', true);

    // 延遲恢復正常狀態顯示
    setTimeout(() => {
      // 恢復正常狀態顯示
      this.restoreStatusDisplay();
      // 顯示最終完成通知（會自動消失）
      this.showStatusNotification('🎉 所有 AI 處理完成！可使用工具列切換「精簡版」和「原文版」');
    }, 3000);
  }

  // 恢復狀態顯示 - 使用統一函數
  restoreStatusDisplay() {
    // 直接使用統一的狀態更新函數，它會自動計算正確的狀態
    this.updateAllStatusDisplays();
  }

  // 優化的並行處理策略 - 改進版本
  async processBothModes(selectedText) {
    // 直接使用優化的並行策略（更穩定、更快）
    const promises = [];

    // 同時發送兩個請求（每個請求都會返回格式化版本和重點標記版本）
    promises.push(this.processSingleModeWithHighlights(selectedText, true).then(result => {
      if (result && typeof result === 'object' && result.formatted && result.highlighted) {
        this.simplifiedContent = result.formatted;
        this.simplifiedHighlighted = result.highlighted;
        console.log('✅ AI精簡版本處理完成（含重點數據）');
      } else {
        // 舊版本相容性
        this.simplifiedContent = result;
        console.log('✅ AI精簡版本處理完成（傳統模式）');
      }
    }));

    promises.push(this.processSingleModeWithHighlights(selectedText, false).then(result => {
      if (result && typeof result === 'object' && result.formatted && result.highlighted) {
        this.originalFormattedContent = result.formatted;
        this.originalHighlighted = result.highlighted;
        console.log('✅ 原文排版版本處理完成（含重點數據）');
      } else {
        // 舊版本相容性
        this.originalFormattedContent = result;
        console.log('✅ 原文排版版本處理完成（傳統模式）');
      }
    }));

    try {
      await Promise.all(promises);

      // 生成重點數據物件
      this.highlightData = {};
      if (this.simplifiedHighlighted) {
        this.highlightData.simplified = this.simplifiedHighlighted;
      }
      if (this.originalHighlighted) {
        this.highlightData.original = this.originalHighlighted;
      }

      console.log('🎉 兩種模式都處理完成（含重點數據）');
    } catch (error) {
      console.error('部分模式處理失敗:', error);

      // 如果AI處理失敗，使用備用方案
      if (!this.simplifiedContent) {
        this.updateLoadingState('AI精簡版處理失敗，生成備用版本...');
        this.simplifiedContent = this.processTextContent(selectedText);
      }

      if (!this.originalFormattedContent) {
        this.updateLoadingState('AI原文排版失敗，生成備用版本...');
        this.originalFormattedContent = this.processTextContent(selectedText);
      }
    }
  }

  // 處理單一模式（含重點標記）
  async processSingleModeWithHighlights(selectedText, isSimplified) {
    try {
      // 使用新的通用API處理方法（支援OpenAI和Gemini）
      const result = await this.processWithBestAPI(selectedText, isSimplified);

      if (result) {
        return result;
      } else {
        throw new Error('所有API提供商都無法處理');
      }
    } catch (error) {
      console.error(`處理${isSimplified ? '精簡' : '原文'}模式失敗:`, error);

      // 離線版已是正式降級路徑；AI 失敗不得將本機規則結果誤報為 AI 完成。
      throw error;
    }
  }

  // 處理單一模式
  async processSingleMode(selectedText, isSimplified) {
    try {
      const apiKey = await this.getGeminiAPIKey();
      if (!apiKey) {
        throw new Error('無API金鑰');
      }
      return await this.processWithGeminiAPIInternal(selectedText, apiKey, isSimplified);
    } catch (error) {
      console.error(`${isSimplified ? '精簡' : '原文'}模式處理失敗:`, error);

      // 備用方案
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const selectedElement = range.cloneContents();
        return this.processSelectedContent(selectedElement, selectedText);
      } else {
        return this.processTextContent(selectedText);
      }
    }
  }

  // 顯示載入狀態
  showLoadingState(message) {
    const container = document.getElementById('web-reader-container');
    if (!container) return;

    container.classList.remove('web-reader-hidden');
    container.classList.add('web-reader-active');

    const contentContainer = document.getElementById('reader-main-content');
    contentContainer.innerHTML = `
      <div class="reader-loading">
        <div class="loading-text">${message}</div>
        <div class="loading-progress">
          <div class="progress-dots">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
    `;

    document.body.classList.add('reader-mode');
    this.isActive = true;
  }

  // 隱藏載入狀態
  hideLoadingState() {
    const contentContainer = document.getElementById('reader-main-content');
    if (contentContainer && this.selectedContent) {
      // 恢復顯示實際內容
      contentContainer.innerHTML = '';
      if (this.selectedContent.innerHTML) {
        contentContainer.appendChild(this.selectedContent);
      } else {
        contentContainer.innerHTML = this.selectedContent;
      }
    }
  }

  // 更新狀態訊息（臨時顯示處理狀態）
  updateStatusMessage(message) {
    // 臨時更新格式模式狀態顯示處理訊息
    const formatModeStatus = document.getElementById('format-mode-status');
    if (formatModeStatus) {
      formatModeStatus.textContent = message;
      formatModeStatus.style.background = '#fff3cd';
      formatModeStatus.style.color = '#856404';
    }

    // 在右上角顯示通知
    this.showStatusNotification(message);
  }

  // 更新處理狀態（動態顯示處理進度）
  updateProcessingStatus(mainMessage, versionStatus, isComplete = false) {
    // 更新工具列狀態顯示
    const modeStatus = document.getElementById('mode-status');
    if (modeStatus) {
      // 清除之前的動畫效果
      modeStatus.style.animation = '';
      modeStatus.classList.remove('processing-animation');

      if (isComplete) {
        // 完成狀態顯示綠色
        modeStatus.textContent = versionStatus;
        modeStatus.style.background = '#d4edda';
        modeStatus.style.color = '#155724';
        modeStatus.style.borderLeft = '3px solid #28a745';
      } else {
        // 處理中狀態顯示黃色並添加脈動效果
        modeStatus.textContent = versionStatus;
        modeStatus.style.background = '#fff3cd';
        modeStatus.style.color = '#856404';
        modeStatus.style.borderLeft = '3px solid #ffc107';
        modeStatus.classList.add('processing-animation');
      }
    }

    // 顯示右上角狀態通知
    this.showStatusNotification(mainMessage);

    // 如果是完成狀態，延遲清除處理中通知
    if (isComplete) {
      setTimeout(() => {
        this.clearProcessingNotifications();
      }, 2000);
    }

    console.log(`🔄 處理狀態更新: ${mainMessage} | ${versionStatus} | 完成: ${isComplete}`);
  }

  // 專門清除處理中通知
  clearProcessingNotifications() {
    const notifications = document.querySelectorAll('#ai-status-notification');
    notifications.forEach(notification => {
      // 只清除包含"處理中"或"生成中"的通知
      if (notification.textContent.includes('處理中') || notification.textContent.includes('生成中')) {
        notification.style.opacity = '0';
        setTimeout(() => {
          if (notification.parentNode) {
            notification.remove();
          }
        }, 300);
      }
    });

    // 清除工具列的處理動畫
    const modeStatus = document.getElementById('mode-status');
    if (modeStatus) {
      modeStatus.style.animation = '';
      modeStatus.classList.remove('processing-animation');
    }
  }

  // 顯示狀態通知（支援不同類型的樣式）
  showStatusNotification(message, type = 'processing') {
    // 移除舊的通知
    const existingNotification = document.getElementById('ai-status-notification');
    if (existingNotification) {
      existingNotification.remove();
    }

    // 根據訊息類型決定樣式
    let bgColor, textColor, borderColor, icon;
    if (message.includes('生成中') || message.includes('處理中')) {
      // 處理中狀態 - 黃色
      bgColor = 'rgba(255, 243, 205, 0.95)';
      textColor = '#856404';
      borderColor = '#fdd835';
      icon = '⏳ ';
    } else if (message.includes('完成') || message.includes('✅')) {
      // 完成狀態 - 綠色
      bgColor = 'rgba(212, 237, 218, 0.95)';
      textColor = '#155724';
      borderColor = '#c3e6cb';
      icon = '✅ ';
    } else if (message.includes('失敗') || message.includes('錯誤')) {
      // 錯誤狀態 - 紅色
      bgColor = 'rgba(248, 215, 218, 0.95)';
      textColor = '#721c24';
      borderColor = '#f5c6cb';
      icon = '❌ ';
    } else {
      // 預設狀態 - 藍色
      bgColor = 'rgba(209, 236, 241, 0.95)';
      textColor = '#0c5460';
      borderColor = '#bee5eb';
      icon = 'ℹ️ ';
    }

    // 創建新通知
    const notification = document.createElement('div');
    notification.id = 'ai-status-notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${bgColor};
      color: ${textColor};
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      border: 1px solid ${borderColor};
      backdrop-filter: blur(10px);
      z-index: 1000001;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-family: "Microsoft JhengHei", Arial, sans-serif;
      transition: opacity 0.3s ease;
      max-width: 300px;
      word-wrap: break-word;
    `;

    // 添加圖示和訊息
    notification.textContent = icon + message;

    // 為處理中狀態添加動畫效果和特殊樣式
    const isProcessing = message.includes('生成中') || message.includes('處理中');
    const isComplete = message.includes('完成') || message.includes('✅');
    const isError = message.includes('失敗') || message.includes('錯誤');

    if (isProcessing) {
      // 添加處理中動畫樣式
      notification.classList.add('status-processing');
      notification.innerHTML = `<span class="loading-spinner">⏳</span>${message}`;
    } else if (isComplete) {
      // 完成狀態樣式
      notification.classList.add('status-complete');
      notification.textContent = icon + message;
    } else if (isError) {
      // 錯誤狀態樣式
      notification.classList.add('status-error');
      notification.textContent = icon + message;
    } else {
      // 預設狀態
      notification.textContent = icon + message;
    }

    document.body.appendChild(notification);

    // 只有非處理中狀態才自動消失
    if (!isProcessing) {
      // 完成、錯誤等狀態 5 秒後自動消失
      setTimeout(() => {
        if (notification.parentNode) {
          notification.style.opacity = '0';
          setTimeout(() => notification.remove(), 300);
        }
      }, 5000);
    }
    // 處理中狀態不會自動消失，需要手動清除
  }

  // 清除狀態通知
  clearStatusNotification() {
    const notification = document.getElementById('ai-status-notification');
    if (notification) {
      notification.style.opacity = '0';
      setTimeout(() => notification.remove(), 300);
    }
  }

  // 更新載入狀態訊息
  updateLoadingState(message) {
    const loadingText = document.querySelector('.loading-text');
    if (loadingText) {
      loadingText.textContent = message;
    }
  }


  processSelectedContent(selectedElement, fallbackText) {
    console.log('處理選取的DOM元素');

    const container = document.createElement('div');
    container.appendChild(selectedElement.cloneNode(true));

    // 清理不需要的元素
    const unwantedElements = container.querySelectorAll('script, style, button, input, form');
    unwantedElements.forEach(el => el.remove());

    // 如果處理後沒有實質內容，使用純文字
    if (container.textContent.trim().length < 10) {
      return this.processTextContent(fallbackText);
    }

    return this.restructureSelectedContent(container);
  }

  processTextContent(text) {
    console.log('🛠️ 處理純文字內容（增強版）');
    this.currentFormatMode = 'Manual'; // 設定為離線排版模式

    // 優化預處理：智能文字分割和清理
    const preprocessedText = this.preprocessTextForManualFormatting(text);

    // 智能段落分組
    const processedLines = this.smartParagraphGrouping(preprocessedText);
    const container = document.createElement('div');
    container.className = 'reader-restructured-content';

    processedLines.forEach(item => {
      if (item.type === 'paragraph_group') {
        // 處理段落組
        const paragraphDiv = document.createElement('div');
        paragraphDiv.className = 'reader-paragraph-group';

        item.lines.forEach(line => {
          const p = document.createElement('p');
          p.className = 'reader-paragraph';
          p.textContent = line;
          paragraphDiv.appendChild(p);
        });

        container.appendChild(paragraphDiv);
        return;
      }

      // 處理單行內容
      const line = item.content || item;
      const trimmed = line.trim();
      if (trimmed.length < 3) return;

      let element;

      // 智能識別內容類型並清理 Markdown 符號
      const isHeaderInProcessText = this.isHeader(trimmed);

      // 🔍 調試：記錄 processTextContent 中的判斷結果
      if (trimmed.match(/^[一二三四五六七八九十]/)) {
        console.log('⚙️ processTextContent 階段判斷:', trimmed.substring(0, 30) + '...', {
          isHeader: isHeaderInProcessText,
          length: trimmed.length,
          willCreateElement: isHeaderInProcessText ? 'H2' : 'P'
        });
      }

      if (isHeaderInProcessText) {
        element = document.createElement('h2');
        element.className = 'reader-header reader-h2';
        // 清理 Markdown 標題符號
        const cleanedTitle = trimmed.replace(/^###?\s*/, '').trim();
        element.textContent = cleanedTitle;
        container.appendChild(element);
        return;
      } else if (this.isSubHeader(trimmed)) {
        element = document.createElement('h3');
        element.className = 'reader-header reader-h3';
        // 清理 Markdown 標題符號
        const cleanedSubTitle = trimmed.replace(/^###?\s*/, '').trim();
        element.textContent = cleanedSubTitle;
        container.appendChild(element);
        return;
      } else if (this.isListItem(trimmed)) {
        element = document.createElement('li');
        element.className = 'reader-list-item';

        // 獲取層級和清理內容
        const level = this.getListItemLevel(line);
        const cleanContent = this.cleanListItemPrefix(trimmed);

        // 創建或找到適當的列表容器
        const lastChild = container.lastElementChild;
        let targetList = null;

        if (!lastChild || lastChild.tagName !== 'UL') {
          // 創建新的列表
          targetList = document.createElement('ul');
          targetList.className = `reader-list reader-list-level-${level}`;
          container.appendChild(targetList);
        } else {
          // 使用現有列表或創建嵌套列表
          const currentLevel = parseInt(lastChild.className.match(/level-(\d+)/)?.[1] || '1');

          if (level > currentLevel) {
            // 創建嵌套列表
            targetList = document.createElement('ul');
            targetList.className = `reader-list reader-list-level-${level}`;
            if (lastChild.lastElementChild) {
              lastChild.lastElementChild.appendChild(targetList);
            } else {
              container.appendChild(targetList);
            }
          } else {
            // 使用現有列表
            targetList = lastChild;
          }
        }

        element.textContent = cleanContent;
        targetList.appendChild(element);
        return;
      } else {
        element = document.createElement('p');
        element.className = 'reader-paragraph';
      }

      element.textContent = trimmed;
      container.appendChild(element);
    });

    return container;
  }

  // 新增：離線排版專用的文字預處理
  preprocessTextForManualFormatting(text) {
    console.log('📝 開始文字預處理，原始長度:', text.length);

    let processed = text;

    // 1. 統一換行符
    processed = processed.replace(/\r\n|\r/g, '\n');

    // 2. 修復時間標記問題 - 先保護時間標記，避免被錯誤換行
    const timeStamps = [];
    processed = processed.replace(/(\[[^\]]*\d{1,2}:\d{2}[^\]]*\])/g, (match, p1) => {
      const placeholder = `__TIME_STAMP_${timeStamps.length}__`;
      timeStamps.push(p1);
      return placeholder;
    });

    // 3. 在句號、驚嘆號、問號後增加潛在分段點（但避免破壞數字）
    processed = processed.replace(/([。！？])\s*(?=[^\d\s])/g, '$1\n');

    // ⚡ 重要：先保護中文序號標題，再執行拆分規則
    // 5. 改進編號列表識別 - 更精確的模式匹配
    // 識別中文序號（一、二、三等）- 先保護完整的中文序號行，避免被拆分
    const chineseNumberHeaders = [];
    processed = processed.replace(/(^|\n)([一二三四五六七八九十][、．].*?)(?=\n[一二三四五六七八九十][、．]|$)/gms, (match, prefix, content) => {
      const fullContent = prefix + content;
      console.log('🔒 保護中文序號標題:', fullContent.trim().substring(0, 50) + '...');
      const placeholder = `__CHINESE_HEADER_${chineseNumberHeaders.length}__`;
      chineseNumberHeaders.push(fullContent);
      return placeholder;
    });

    // 4. 在冒號後面如果跟著較長內容，增加分段（但不影響已保護的標題）
    processed = processed.replace(/([：:])\s*(.{20,})/g, '$1\n$2');

    // 4. 識別並分離明顯的標題模式（不使用 Markdown 符號）
    // 在特定關鍵詞前後增加分段（教學相關）
    const breakKeywords = ['教學目標', '教學重點', '教學活動', '學習目標', '課程內容', '評量方式', '教材準備', '教學流程', '認知方面', '技能方面', '情意方面'];
    breakKeywords.forEach(keyword => {
      const regex = new RegExp(`([^\\n])(${keyword})`, 'g');
      processed = processed.replace(regex, '$1\n\n$2'); // 移除 ### 符號
    });

    // 識別數字序號（1. 2. 3. 或 1、 2、 3、等）- 改進版
    processed = processed.replace(/(^|\n)(\d+[\.、]\d*\s*.{3,})/gm, '$1\n$2');

    // 識別小標題格式（如 2.1, 3.2 等）
    processed = processed.replace(/(^|\n)(\d+\.\d+\s+[^\s].{5,})/gm, '$1\n$2');

    // 識別條列符號（-、•、● 等）
    processed = processed.replace(/(^|\n)([-\u2022\u25cf\u25cb]\s+.{3,})/gm, '$1\n$2');

    // 6. 恢復時間標記到原始位置 - 避免被換行影響
    timeStamps.forEach((timestamp, index) => {
      processed = processed.replace(`__TIME_STAMP_${index}__`, timestamp);
    });

    // 6.5. 恢復中文序號標題到原始位置 - 保持完整性
    chineseNumberHeaders.forEach((header, index) => {
      const placeholder = `__CHINESE_HEADER_${index}__`;
      console.log('🔓 恢復中文序號標題:', {
        index: index,
        placeholder: placeholder,
        headerLength: header.length,
        headerPreview: header.trim().substring(0, 60) + '...',
        foundInText: processed.includes(placeholder)
      });
      processed = processed.replace(placeholder, header);
    });

    // 🔍 調試：恢復後檢查文本內容
    console.log('📄 恢復後文本預覽:', processed.substring(0, 200) + '...');

    // 7. 清理多餘的空行，但保留必要的段落分隔
    processed = processed.replace(/\n{4,}/g, '\n\n\n'); // 最多保留兩個空行
    processed = processed.replace(/^\n+/, ''); // 移除開頭空行
    processed = processed.replace(/\n+$/, ''); // 移除結尾空行

    // 8. 智能段落優化與換行改進
    const lines = processed.split('\n');
    const optimizedLines = [];

    lines.forEach(line => {
      const trimmed = line.trim();

      // 跳過空行和短行
      if (trimmed.length === 0) {
        optimizedLines.push('');
        return;
      }

      // 對長段落進行智能拆分（超過200字元且非特殊格式）
      if (trimmed.length > 200 && !this.isHeader(trimmed) && !this.isListItem(trimmed)) {
        // 尋找適當的分割點
        const breakPoints = [
          /([。！？])\s*(?=.{20,})/g, // 句號後還有長內容
          /([，；])\s*(?=.{30,})/g,   // 逗號後還有很長內容
          /(\s+)(?=.{50,})/g         // 空格後還有很長內容
        ];

        let splitResult = [trimmed];
        for (const breakPoint of breakPoints) {
          const newSplitResult = [];
          splitResult.forEach(part => {
            if (part.length > 200) {
              const matches = [...part.matchAll(breakPoint)];
              if (matches.length > 0) {
                let lastIndex = 0;
                matches.forEach((match, i) => {
                  if (i === 0 || match.index - lastIndex > 100) { // 確保分段有意義
                    newSplitResult.push(part.substring(lastIndex, match.index + match[0].length).trim());
                    lastIndex = match.index + match[0].length;
                  }
                });
                if (lastIndex < part.length) {
                  newSplitResult.push(part.substring(lastIndex).trim());
                }
              } else {
                newSplitResult.push(part);
              }
            } else {
              newSplitResult.push(part);
            }
          });
          splitResult = newSplitResult;
        }

        optimizedLines.push(...splitResult.filter(part => part.length > 0));
      } else {
        optimizedLines.push(line);
      }
    });

    processed = optimizedLines.join('\n');

    // 9. 針對特定內容的智能換行優化
    processed = this.improveContentSpecificLineBreaks(processed);

    console.log('✅ 文字預處理完成，處理後長度:', processed.length);
    console.log('📊 分割成', processed.split('\n').filter(line => line.trim().length > 0).length, '行');

    return processed;
  }

  // 針對特定內容類型的智能換行改進
  improveContentSpecificLineBreaks(text) {
    let improved = text;

    // 1. 會議記錄特殊格式處理
    // 在「資源配置與預算規劃」等主要項目前換行
    const meetingKeywords = [
      '資源配置與預算規劃', '2025年市場趨勢預測與競爭分析',
      '第一季產品開發優先順序排定', '風險評估與因應措施',
      '行動計劃與執行時程', '會議決議與後續追蹤'
    ];

    meetingKeywords.forEach(keyword => {
      const regex = new RegExp(`([^\\n])(${keyword})`, 'g');
      // ⚠️ 跳過中文序號標題，避免拆分完整標題
      improved = improved.replace(regex, (match, before, keywordMatch) => {
        // 檢查是否為中文序號標題的一部分
        const lineStart = improved.lastIndexOf('\n', improved.indexOf(match));
        const lineContent = improved.substring(lineStart + 1, improved.indexOf(match) + match.length);

        // 如果該行以中文序號開頭，不進行拆分
        if (lineContent.match(/^[一二三四五六七八九十][、．]/)) {
          console.log('🛡️ 跳過中文序號標題拆分:', keywordMatch);
          return match; // 不修改
        }

        return `${before}\n\n${keywordMatch}`;
      });
    });

    // 2. 改進標點符號後的換行判斷
    // 在關鍵連接詞前適當換行
    const breakBeforeWords = ['然而', '因此', '此外', '另外', '同時', '另一方面', '總結來說', '綜上所述'];
    breakBeforeWords.forEach(word => {
      const regex = new RegExp(`([^\\n\\s])([\\s]*${word})`, 'g');
      improved = improved.replace(regex, '$1\n$2');
    });

    // 3. 修復過度換行問題 - 某些情況下文字應該連接
    // 將被錯誤分行的數據項目重新連接
    improved = improved.replace(/([\u4e00-\u9fff])：\s*\n\s*(\d+[%$￥億萬千])/g, '$1：$2');
    improved = improved.replace(/(營收|成本|毛利|用戶|客戶)[^\n]{0,10}\s*\n\s*(達成率|滿意度|數量|轉換率)/g, '$1$2');

    // 4. 改進數據列表的格式
    // 確保「指標名稱：數值」格式在同一行
    improved = improved.replace(/([^\n]{1,20})：\s*\n\s*([0-9.%$￥]+)/g, '$1：$2');

    console.log('📝 內容特定換行優化完成');
    return improved;
  }

  // 新增：智能段落分組
  smartParagraphGrouping(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const result = [];
    let currentGroup = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 如果是標題、子標題或條列項目，結束當前段落組
      const isHeaderResult = this.isHeader(line);
      const isSubHeaderResult = this.isSubHeader(line);
      const isListItemResult = this.isListItem(line);

      // 🔍 調試：記錄分組階段的判斷結果
      if (line.match(/^[一二三四五六七八九十]/)) {
        console.log('📝 smartParagraphGrouping 階段判斷:', line.substring(0, 30) + '...', {
          isHeader: isHeaderResult,
          isSubHeader: isSubHeaderResult,
          isListItem: isListItemResult,
          length: line.length
        });
      }

      if (isHeaderResult || isSubHeaderResult || isListItemResult) {
        // 保存當前段落組
        if (currentGroup.length > 0) {
          if (currentGroup.length === 1) {
            result.push(currentGroup[0]);
          } else {
            result.push({
              type: 'paragraph_group',
              lines: [...currentGroup]
            });
          }
          currentGroup = [];
        }

        // 添加特殊項目
        result.push(line);
      } else {
        // 檢查是否應該開始新的段落組
        if (this.shouldStartNewParagraphGroup(line, currentGroup)) {
          // 保存當前組
          if (currentGroup.length > 0) {
            if (currentGroup.length === 1) {
              result.push(currentGroup[0]);
            } else {
              result.push({
                type: 'paragraph_group',
                lines: [...currentGroup]
              });
            }
          }
          currentGroup = [line];
        } else {
          currentGroup.push(line);
        }
      }
    }

    // 處理最後的段落組
    if (currentGroup.length > 0) {
      if (currentGroup.length === 1) {
        result.push(currentGroup[0]);
      } else {
        result.push({
          type: 'paragraph_group',
          lines: [...currentGroup]
        });
      }
    }

    return result;
  }

  // 新增：判斷是否應該開始新的段落組
  shouldStartNewParagraphGroup(line, currentGroup) {
    if (currentGroup.length === 0) return false;

    // 如果當前組已經很長，開始新組
    if (currentGroup.length >= 5) return true;

    // 如果當前行明顯是新主題的開始
    const topicStartPatterns = [
      /^(另外|此外|其次|最後|總之|綜上|因此|所以)/,
      /^(關於|針對|就|對於)/,
      /^(根據|依照|按照|遵照)/,
      /^(目前|現在|未來|將來)/,
    ];

    return topicStartPatterns.some(pattern => pattern.test(line));
  }

  restructureSelectedContent(container) {
    console.log('重新結構化選取內容');

    const restructured = document.createElement('div');
    restructured.className = 'reader-restructured-content';

    // 先處理表格
    this.processTablesInContainer(container, restructured);

    // 處理所有文字元素（排除已處理的表格內容）
    const textElements = container.querySelectorAll('h1, h2, h3, h4, h5, h6, p, div, span, li');

    // 過濾掉已經在表格中處理過的元素
    const filteredElements = Array.from(textElements).filter(element => {
      return !element.closest('table') || element.closest('[data-reader-processed]');
    });

    filteredElements.forEach(element => {
      const text = element.textContent.trim();
      if (text.length < 3) return;

      let newElement;
      const tagName = element.tagName.toLowerCase();

      if (tagName.startsWith('h')) {
        // 標題處理
        const level = Math.min(parseInt(tagName.charAt(1)), 3); // 限制最多到h3
        newElement = document.createElement(`h${level}`);
        newElement.className = `reader-header reader-h${level}`;
      } else if (tagName === 'li') {
        // 列表項目
        newElement = document.createElement('li');
        newElement.className = 'reader-list-item';

        const lastChild = restructured.lastElementChild;
        if (!lastChild || lastChild.tagName !== 'UL') {
          const ul = document.createElement('ul');
          ul.className = 'reader-list';
          restructured.appendChild(ul);
        }
        restructured.lastElementChild.appendChild(newElement);
        newElement.textContent = text;
        return;
      } else {
        // 一般段落
        newElement = document.createElement('p');
        newElement.className = 'reader-paragraph';
      }

      newElement.textContent = text;
      restructured.appendChild(newElement);
    });

    return restructured;
  }

  // 新增：處理表格
  processTablesInContainer(container, targetContainer) {
    const tables = container.querySelectorAll('table');

    tables.forEach(table => {
      const processedTable = this.processTable(table);
      if (processedTable) {
        targetContainer.appendChild(processedTable);
        table.setAttribute('data-reader-processed', 'true'); // 標記已處理
      }
    });
  }

  // 新增：處理單個表格
  processTable(table) {
    const rows = Array.from(table.rows || table.querySelectorAll('tr'));
    if (rows.length === 0) return null;

    console.log(`處理表格，包含 ${rows.length} 行`);

    const newTable = document.createElement('table');
    newTable.className = 'reader-table';

    const captionText = table.querySelector('caption')?.textContent.trim();
    if (captionText) {
      const caption = document.createElement('caption');
      caption.textContent = captionText;
      newTable.appendChild(caption);
    }

    // 檢測表頭
    const hasHeader = this.detectTableHeader(table);

    rows.forEach((row, rowIndex) => {
      const cells = row.querySelectorAll('td, th');
      if (cells.length === 0) return;

      const newRow = document.createElement('tr');
      newRow.className = 'reader-table-row';

      cells.forEach(cell => {
        const text = cell.textContent.trim();
        if (text.length === 0 && !cell.querySelector('img, a[href]')) return;

        let newCell;
        const isHeader = cell.tagName.toLowerCase() === 'th' || (hasHeader && rowIndex === 0);

        if (isHeader) {
          newCell = document.createElement('th');
          newCell.className = 'reader-table-header';
        } else {
          newCell = document.createElement('td');
          newCell.className = 'reader-table-cell';
        }

        if (cell.colSpan > 1) newCell.colSpan = cell.colSpan;
        if (cell.rowSpan > 1) newCell.rowSpan = cell.rowSpan;
        this.appendSanitizedInline(cell, newCell);
        newRow.appendChild(newCell);
      });

      // ESA 常用跨欄短列作為章節標題，保留成目錄錨點而不拆散表格。
      if (newRow.children.length === 1) {
        const onlyCell = newRow.firstElementChild;
        const rowText = onlyCell.textContent.replace(/\s+/g, ' ').trim();
        if (this.isConservativeOfflineHeader(rowText)) {
          onlyCell.classList.add('reader-header', 'reader-h2', 'reader-table-section');
        }
      }

      if (newRow.children.length > 0) {
        newTable.appendChild(newRow);
      }
    });

    return newTable.children.length > 0 ? newTable : null;
  }

  // 新增：檢測表格是否有表頭
  detectTableHeader(table) {
    const firstRow = table.querySelector('tr');
    if (!firstRow) return false;

    // 檢查第一行是否包含 th 元素
    const hasThElements = firstRow.querySelectorAll('th').length > 0;
    if (hasThElements) return true;

    // 檢查第一行的內容特徵
    const firstRowCells = firstRow.querySelectorAll('td, th');
    if (firstRowCells.length === 0) return false;

    // 如果第一行所有內容都較短且不包含數字，可能是表頭
    const allShortText = Array.from(firstRowCells).every(cell => {
      const text = cell.textContent.trim();
      return text.length <= 20 && !/\d{2,}/.test(text);
    });

    return allShortText;
  }

  // 【NEW】組合處理：單次 API 調用生成所有版本
  async processWithCombinedPrompt(text) {
    console.log('🚀 嘗試單次調用生成所有版本...');

    const apiKey = await this.getGeminiAPIKey();
    if (!apiKey) {
      throw new Error('未設定 API 金鑰');
    }

    const result = await this.makeCombinedAPICall(apiKey, text);
    if (!result) {
      throw new Error('API 調用失敗');
    }

    return this.parseCombinedResult(result);
  }

  // 組合 API 調用
  async makeCombinedAPICall(apiKey, text, modelName = 'gemini-1.5-flash') {
    console.log(`發送組合 API 請求... (模型: ${modelName})`);

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: this.createCombinedPrompt(text)
          }]
        }],
        generationConfig: {
          maxOutputTokens: 32000, // 增加輸出限制，因為要生成4個版本
          temperature: 0.1
        }
      })
    });

    console.log('組合 API 回應狀態:', response.status);

    if (!response.ok) {
      throw new Error(`API 請求失敗: ${response.status}`);
    }

    const data = await response.json();
    console.log('組合 API 回應結果:', data);

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error('API 回應格式錯誤');
    }

    const content = data.candidates[0].content.parts[0].text;
    console.log('組合 API 處理成功，輸出長度:', content.length);
    console.log('組合 API 實際輸出內容:', content.substring(0, 1000) + '...'); // 顯示前1000字符用於調試

    return content;
  }

  // 解析組合結果
  parseCombinedResult(content) {
    try {
      console.log('嘗試解析組合結果...');

      // 嘗試多種 JSON 提取方法
      let jsonData = null;

      // 方法1: 標準的 ```json``` 格式
      let jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        console.log('找到標準 JSON 格式');
        jsonData = JSON.parse(jsonMatch[1]);
      } else {
        // 方法2: 尋找任何 {} 包圍的 JSON
        jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          console.log('找到通用 JSON 格式');
          jsonData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('未找到 JSON 格式輸出');
        }
      }

      // 驗證結構
      if (!jsonData.simplified || !jsonData.original) {
        console.error('JSON 結構不完整，實際結構:', Object.keys(jsonData));
        throw new Error('JSON 結構不完整');
      }

      // 進一步驗證子結構
      if (!jsonData.simplified.formatted || !jsonData.simplified.highlighted ||
          !jsonData.original.formatted || !jsonData.original.highlighted) {
        console.error('JSON 子結構不完整');
        console.error('simplified keys:', Object.keys(jsonData.simplified || {}));
        console.error('original keys:', Object.keys(jsonData.original || {}));
        throw new Error('JSON 子結構不完整');
      }

      // 格式化每個版本
      const result = {
        simplified: {
          formatted: this.formatSingleGeminiResult(jsonData.simplified.formatted, false),
          highlighted: this.formatSingleGeminiResult(jsonData.simplified.highlighted, true)
        },
        original: {
          formatted: this.formatSingleGeminiResult(jsonData.original.formatted, false),
          highlighted: this.formatSingleGeminiResult(jsonData.original.highlighted, true)
        }
      };

      console.log('✅ 組合結果解析成功');
      return result;

    } catch (error) {
      console.error('組合結果解析失敗:', error.message);
      throw error;
    }
  }

  // 單個API呼叫函數
  async makeGeminiAPICall(apiKey, text, modelName = 'gemini-1.5-flash', isSimplified = true) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: this.createGeminiPrompt(text, isSimplified)
          }]
        }],
        generationConfig: {
          maxOutputTokens: 16000,  // 【修復】增加輸出限制，避免截斷
          temperature: 0.1,
          candidateCount: 1        // 【優化】確保只生成一個候選結果
        }
      })
    });

    console.log('API 回應狀態:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API 錯誤詳情:', errorText);

      // 解析錯誤訊息，提供更友善的提示
      let errorMessage = `Gemini API請求失敗: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error && errorJson.error.message) {
          errorMessage += ` - ${errorJson.error.message}`;
        }
      } catch (parseError) {
        errorMessage += ` - ${errorText}`;
      }

      // 針對常見錯誤提供友善提示
      if (response.status === 400) {
        console.error('可能的API金鑰格式錯誤或請求格式問題');
      } else if (response.status === 401 || response.status === 403) {
        console.error('API金鑰無效或權限不足，請檢查金鑰是否正確');
      } else if (response.status === 429) {
        console.error('API請求頻率超過限制，請稍後再試');
      } else if (response.status === 503) {
        console.error('API服務過載，請稍後重試');
      }

      // 檢查是否為模型過載錯誤，且使用的是 2.5 版本
      let shouldFallback = false;
      if (response.status === 503 || response.status === 429) {
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error && errorJson.error.message &&
              (errorJson.error.message.includes('overloaded') ||
               errorJson.error.message.includes('過載'))) {
            shouldFallback = true;
          }
        } catch (e) {
          if (errorText.includes('overloaded') || errorText.includes('過載')) {
            shouldFallback = true;
          }
        }
      }

      // 拋出包含狀態碼和降級標記的錯誤
      const error = new Error(errorMessage);
      error.status = response.status;
      error.shouldFallback = shouldFallback && modelName.includes('2.5');
      error.currentModel = modelName;
      throw error;
    }

    const result = await response.json();
    console.log('API 回應結果:', result);

    if (!result.candidates || result.candidates.length === 0) {
      console.error('無候選回應');
      throw new Error('Gemini API無返回候選結果');
    }

    if (!result.candidates[0].content || !result.candidates[0].content.parts || result.candidates[0].content.parts.length === 0) {
      console.error('回應格式錯誤:', result.candidates[0]);
      throw new Error('Gemini API回應格式錯誤');
    }

    const geminiOutput = result.candidates[0].content.parts[0].text;

    if (!geminiOutput || geminiOutput.trim().length === 0) {
      console.error('回應內容為空');
      throw new Error('Gemini API回應內容為空');
    }

    console.log('Gemini AI處理成功，輸出長度:', geminiOutput.length);

    // 檢查是否因為長度限制被截斷
    const finishReason = result.candidates[0].finishReason;
    console.log('API 完成原因:', finishReason);

    if (finishReason === 'MAX_TOKENS') {
      console.warn('⚠️ 回應內容因為長度限制被截斷！');

      // 拋出特殊錯誤，用於觸發分段處理
      const error = new Error('輸出被截斷');
      error.isTruncated = true;
      error.partialOutput = geminiOutput;
      throw error;
    } else if (finishReason === 'STOP') {
      console.log('✅ 回應內容完整');
    } else {
      console.log('🟡 其他完成原因:', finishReason);
    }

    return this.formatGeminiResult(geminiOutput);
  }

  // OpenAI API 相關方法
  async getOpenaiAPIKey() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['openaiAPIKey'], (result) => {
        resolve(result.openaiAPIKey || '');
      });
    });
  }

  async getOpenaiModel() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['openaiModel'], (result) => {
        resolve(result.openaiModel || 'gpt-4o-mini');
      });
    });
  }

  async processWithOpenAI(text) {
    const apiKey = await this.getOpenaiAPIKey();
    if (!apiKey) {
      console.log('未找到OpenAI API金鑰，跳過AI處理');
      return null;
    }

    console.log('使用OpenAI API處理內容，輸入長度:', text.length);

    try {
      return await this.processWithOpenAIInternal(text, apiKey, this.isSimplifiedVersion);
    } catch (error) {
      console.error('OpenAI API處理失敗:', error);
      throw error;
    }
  }

  async processWithOpenAIInternal(text, apiKey, isSimplified = true) {
    const maxInputLength = 25000; // 統一與 Gemini 相同的字數限制
    if (text.length > maxInputLength) {
      console.log(`輸入內容過長 (${text.length} 字符)，嘗試分段處理`);
      return await this.processWithOpenAIInChunks(text, apiKey, isSimplified);
    }

    const selectedModel = await this.getOpenaiModel();
    console.log('🤖 使用OpenAI模型:', selectedModel);

    let prompt;
    if (isSimplified) {
      prompt = `請將以下內容轉換為適合大螢幕簡報的格式：

1. 提取並重組關鍵信息，去除重複內容
2. 使用標準Markdown格式：
   - # 主標題
   - ## 次標題
   - ### 子標題
   - **重點文字** (粗體)
   - ==重要數據==、==關鍵日期==、==重要結論== (用於重點標記)
   - 條列使用 "- " 或數字編號
3. 內容要簡潔易讀，適合會議室展示
4. 保持邏輯順序和層次結構
5. 去除無關的網頁元素和雜訊
6. 用 ==文字== 標記關鍵資訊（限制在20%以內）

內容：
${text}`;
    } else {
      prompt = `請將以下內容轉換為適合大螢幕閱讀的格式，保留原文內容：

1. 保持原文完整性，僅優化格式
2. 使用標準Markdown格式：
   - # 主標題
   - ## 次標題
   - ### 子標題
   - **重點文字** (粗體)
   - ==重要數據==、==關鍵日期==、==重要結論== (用於重點標記)
   - 條列使用 "- " 或數字編號
3. 改善段落結構和可讀性
4. 保持原意和詳細信息
5. 用 ==文字== 標記關鍵資訊（限制在20%以內）

內容：
${text}`;
    }

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
            content: prompt
          }
        ],
        max_tokens: 8000,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI API 錯誤: ${response.status} - ${errorData.error?.message || '未知錯誤'}`);
    }

    const data = await response.json();
    const processedContent = data.choices[0]?.message?.content;

    if (!processedContent) {
      throw new Error('OpenAI API 回應格式錯誤');
    }

    console.log('✅ OpenAI處理完成，輸出長度:', processedContent.length);

    // 使用單一API回應生成兩個版本，避免重複調用
    const formattedContainer = this.formatOpenAIResult(processedContent, false);
    const highlightedContainer = this.formatOpenAIResult(processedContent, true);

    // 返回與 Gemini 相同的結構
    return {
      formatted: formattedContainer,
      highlighted: highlightedContainer
    };
  }

  // OpenAI 重點模式專用處理
  async processWithOpenAIHighlightMode(text, apiKey, isSimplified = true) {
    const maxInputLength = 25000; // 統一與 Gemini 相同的字數限制
    if (text.length > maxInputLength) {
      console.log(`重點模式內容過長 (${text.length} 字符)，嘗試分段處理`);
      return await this.processWithOpenAIHighlightInChunks(text, apiKey, isSimplified);
    }

    const selectedModel = await this.getOpenaiModel();
    console.log('🎯 使用OpenAI重點模式，模型:', selectedModel);

    let prompt;
    if (isSimplified) {
      prompt = `請將以下內容轉換為適合大螢幕簡報的格式，並重點標記關鍵資訊：

1. 提取並重組關鍵信息，去除重複內容
2. 使用標準Markdown格式：
   - # 主標題
   - ## 次標題
   - ### 子標題
   - **重點文字** (粗體)
   - 條列使用 "- " 或數字編號
3. 重點標記要求：
   - 用 ==文字== 標記最重要的資訊（日期、數字、結論、行動項目）
   - 重點標記應限制在內容的15-25%
   - 優先標記：具體日期、百分比、金額、期限、負責人、重要結論
4. 內容要簡潔易讀，適合會議室展示
5. 保持邏輯順序和層次結構

內容：
${text}`;
    } else {
      prompt = `請將以下內容轉換為適合大螢幕閱讀的格式，保留原文並重點標記：

1. 保持原文完整性，僅優化格式
2. 使用標準Markdown格式：
   - # 主標題
   - ## 次標題
   - ### 子標題
   - **重點文字** (粗體)
   - 條列使用 "- " 或數字編號
3. 重點標記要求：
   - 用 ==文字== 標記最重要的資訊（日期、數字、結論、行動項目）
   - 重點標記應限制在內容的15-25%
   - 優先標記：具體日期、百分比、金額、期限、負責人、重要結論
4. 改善段落結構和可讀性
5. 保持原意和詳細信息

內容：
${text}`;
    }

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
            content: prompt
          }
        ],
        max_tokens: 8000,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI API 錯誤: ${response.status} - ${errorData.error?.message || '未知錯誤'}`);
    }

    const data = await response.json();
    const processedContent = data.choices[0]?.message?.content;

    if (!processedContent) {
      throw new Error('OpenAI API 回應格式錯誤');
    }

    console.log('✅ OpenAI重點模式處理完成，輸出長度:', processedContent.length);
    return processedContent;
  }

  // 格式化 OpenAI 結果
  formatOpenAIResult(markdownContent, isHighlightMode = false) {
    console.log('格式化 OpenAI Markdown 結果', isHighlightMode ? '(重點模式)' : '(標準模式)');

    // 創建容器元素
    const container = document.createElement('div');
    container.className = 'web-reader-content';

    // 簡單的 Markdown 轉 HTML 處理
    const lines = markdownContent.split('\n');
    let currentElement = null;

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        // 空行，如果有當前元素則結束
        if (currentElement) {
          container.appendChild(currentElement);
          currentElement = null;
        }
        continue;
      }

      // 處理標題
      if (trimmedLine.startsWith('### ')) {
        if (currentElement) container.appendChild(currentElement);
        currentElement = document.createElement('h3');
        currentElement.className = 'reader-header reader-h3'; // 使用正確的類名
        currentElement.textContent = trimmedLine.substring(4);
      } else if (trimmedLine.startsWith('## ')) {
        if (currentElement) container.appendChild(currentElement);
        currentElement = document.createElement('h2');
        currentElement.className = 'reader-header reader-h2'; // 使用正確的類名
        currentElement.textContent = trimmedLine.substring(3);
      } else if (trimmedLine.startsWith('# ')) {
        if (currentElement) container.appendChild(currentElement);
        currentElement = document.createElement('h1');
        currentElement.className = 'reader-header reader-h1'; // 使用正確的類名
        currentElement.textContent = trimmedLine.substring(2);
      }
      // 處理列表項
      else if (trimmedLine.startsWith('- ') || trimmedLine.match(/^\d+\.\s/)) {
        if (!currentElement || currentElement.tagName !== 'UL') {
          if (currentElement) container.appendChild(currentElement);
          currentElement = document.createElement('ul');
          currentElement.className = 'web-reader-list';
        }
        const li = document.createElement('li');
        const content = trimmedLine.startsWith('- ')
          ? trimmedLine.substring(2)
          : trimmedLine.replace(/^\d+\.\s/, '');
        li.innerHTML = this.processInlineMarkdown(content, isHighlightMode);
        currentElement.appendChild(li);
      }
      // 處理普通段落
      else {
        if (!currentElement || currentElement.tagName !== 'P') {
          if (currentElement) container.appendChild(currentElement);
          currentElement = document.createElement('p');
          currentElement.className = 'web-reader-paragraph';
        } else {
          currentElement.appendChild(document.createTextNode(' '));
        }
        const span = document.createElement('span');
        span.innerHTML = this.processInlineMarkdown(trimmedLine, isHighlightMode);
        currentElement.appendChild(span);
      }
    }

    // 添加最後一個元素
    if (currentElement) {
      container.appendChild(currentElement);
    }

    console.log('✅ OpenAI Markdown 轉換完成，標題數量:', container.querySelectorAll('h1, h2, h3').length);
    return container;
  }

  // 處理行內 Markdown（粗體、斜體等）
  processInlineMarkdown(text, isHighlightMode = false) {
    let result = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>');

    // 在重點模式下，添加重點標記處理
    if (isHighlightMode) {
      // 首先處理手動標記的重點
      result = result.replace(/==(.*?)==/g, '<mark class="highlight">$1</mark>');

      // 為重點模式添加一些自動重點識別邏輯
      // 只有在沒有足夠手動標記時才進行自動標記
      const manualHighlights = (result.match(/<mark class="highlight">/g) || []).length;
      if (manualHighlights < 3) {
        // 標註關鍵資訊
        result = result.replace(/(\d{1,2}\/\d{1,2}(?:\(\w+\))?)/g, '<mark class="highlight">$1</mark>'); // 日期如 10/16(四)
        result = result.replace(/(\d+%)/g, '<mark class="highlight">$1</mark>'); // 百分比
        result = result.replace(/(週[一二三四五六日])/g, '<mark class="highlight">$1</mark>'); // 星期
        result = result.replace(/(負責人[：:][\s]*[\u4e00-\u9fff]+)/g, '<mark class="highlight">$1</mark>'); // 負責人
        result = result.replace(/(期限[：:][\s]*[\d\/\-\u4e00-\u9fff]+)/g, '<mark class="highlight">$1</mark>'); // 期限
        result = result.replace(/(\$?\d+(?:,\d{3})*(?:\.\d{2})?元?)/g, '<mark class="highlight">$1</mark>'); // 金額
      }
    }

    return result;
  }

  // OpenAI 分段處理功能
  async processWithOpenAIInChunks(text, apiKey, isSimplified = true) {
    console.log('📄 OpenAI 開始分段處理...');

    // 將文本分割成較小的段落（與 Gemini 相同的策略）
    const chunks = this.splitTextIntoChunks(text, 8000); // 每段約8000字符
    console.log(`OpenAI 分成 ${chunks.length} 段處理`);

    const processedChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      console.log(`OpenAI 處理第 ${i + 1}/${chunks.length} 段...`);

      try {
        // 直接調用完整處理（因為單段已在限制內）
        const selectedModel = await this.getOpenaiModel();
        const result = await this.callOpenAIAPI(chunks[i], apiKey, selectedModel, isSimplified);

        if (result) {
          const formattedResult = this.formatOpenAIResult(result, false);
          processedChunks.push(formattedResult);
        }
      } catch (error) {
        console.error(`OpenAI 第 ${i + 1} 段處理失敗:`, error);
        // 繼續處理下一段
      }

      // 段落間延遲，避免 API 頻率限制
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (processedChunks.length === 0) {
      console.error('OpenAI 所有段落處理都失敗');
      return null;
    }

    // 合併處理後的段落
    return this.mergeProcessedChunks(processedChunks);
  }

  // OpenAI 重點模式分段處理
  async processWithOpenAIHighlightInChunks(text, apiKey, isSimplified = true) {
    console.log('🎯 OpenAI 重點模式開始分段處理...');

    const chunks = this.splitTextIntoChunks(text, 8000);
    console.log(`OpenAI 重點模式分成 ${chunks.length} 段處理`);

    const processedChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      console.log(`OpenAI 重點模式處理第 ${i + 1}/${chunks.length} 段...`);

      try {
        const selectedModel = await this.getOpenaiModel();
        const result = await this.callOpenAIHighlightAPI(chunks[i], apiKey, selectedModel, isSimplified);

        if (result) {
          processedChunks.push(result);
        }
      } catch (error) {
        console.error(`OpenAI 重點模式第 ${i + 1} 段處理失敗:`, error);
      }

      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (processedChunks.length === 0) {
      console.error('OpenAI 重點模式所有段落處理都失敗');
      return null;
    }

    // 合併結果為字符串
    return processedChunks.join('\n\n');
  }

  // OpenAI API 核心調用方法（從現有邏輯提取）
  async callOpenAIAPI(text, apiKey, model, isSimplified) {
    const prompt = isSimplified
      ? `請將以下內容重新整理為簡潔的重點摘要格式，保持重要資訊，使用 Markdown 格式：\n\n${text}`
      : `請將以下內容重新排版為適合大螢幕閱讀的格式，保持完整內容，使用 Markdown 格式：\n\n${text}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: '你是一個專業的文件編輯助手，專門負責將內容格式化為適合大螢幕展示的格式。使用清晰的標題層級和條列式結構。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 8000,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`OpenAI API 錯誤: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  // OpenAI 重點模式 API 調用
  async callOpenAIHighlightAPI(text, apiKey, model, isSimplified) {
    const prompt = `請分析以下內容並標註重點資訊，使用 ==重點內容== 的格式標記重要資訊：\n\n${text}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: '你是一個專業的重點標記助手。請標記文件中的關鍵資訊，包括日期、金額、人名、重要事件等。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 8000,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`OpenAI 重點模式 API 錯誤: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }


  // 通用 API 處理方法 - 支援多個提供商
  async processWithBestAPI(text, isSimplified = true) {
    // 從 storage 讀取 AI 模型優先順序
    const modelPriority = await this.getModelPriority();
    console.log('🚀 使用模型優先順序:', modelPriority);

    // 定義所有可用的 API 提供商
    const allProviders = {
      'openai': {
        name: 'OpenAI',
        method: async () => {
          const apiKey = await this.getOpenaiAPIKey();
          if (!apiKey) return null;
          return await this.processWithOpenAIInternal(text, apiKey, isSimplified);
        }
      },
      'gemini': {
        name: 'Gemini',
        method: async () => {
          const apiKey = await this.getGeminiAPIKey();
          if (!apiKey) return null;
          return await this.processWithGeminiAPIInternal(text, apiKey, isSimplified);
        }
      },
      'manual': {
        name: '離線排版',
        method: async () => {
          return this.processTextContent(text);
        }
      }
    };

    // 按照用戶設定的優先順序嘗試各個提供商
    for (const modelKey of modelPriority) {
      // 離線版已在取得同意前完成，不可在 AI 流程中冒充成功供應商。
      if (modelKey === 'manual') {
        console.log('ℹ️ 略過離線排版；AI 失敗時維持現有離線版');
        continue;
      }

      const provider = allProviders[modelKey];
      if (!provider) {
        console.warn(`⚠️ 未知的模型類型: ${modelKey}`);
        continue;
      }

      try {
        console.log(`🔄 嘗試使用 ${provider.name} (${modelKey})...`);
        const result = await provider.method();
        if (result) {
          console.log(`✅ ${provider.name} 處理成功`);
          // 成功使用AI處理，設定為AI模式
          if (modelKey !== 'manual') {
            this.currentFormatMode = 'AI';
          }
          return result;
        }
      } catch (error) {
        console.warn(`⚠️ ${provider.name} 處理失敗:`, error.message);
        continue;
      }
    }

    console.log('❌ 所有配置的提供商都失敗');
    return null;
  }

  // 取得模型優先順序設定
  async getModelPriority() {
    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['modelPriority'], resolve);
      });

      const priority = result.modelPriority || ['gemini', 'openai', 'manual'];
      console.log('📋 讀取到的模型優先順序:', priority);
      return priority;
    } catch (error) {
      console.error('❌ 讀取模型優先順序失敗:', error);
      // 回傳預設順序
      return ['gemini', 'openai', 'manual'];
    }
  }

  // Gemini API處理 - 新增重試機制和分段處理
  async processWithGeminiAPI(text) {
    // 檢查是否有API金鑰
    const apiKey = await this.getGeminiAPIKey();
    if (!apiKey) {
      console.log('未找到Gemini API金鑰，跳過AI處理');
      return null;
    }

    console.log('使用Gemini AI處理內容，輸入長度:', text.length);

    // 先嘗試完整處理 (預設為精簡模式)
    try {
      return await this.processWithGeminiAPIInternal(text, apiKey, this.isSimplifiedVersion);
    } catch (error) {
      // 如果因為輸出截斷失敗，嘗試分段處理
      if (error.isTruncated) {
        console.log('🔄 檢測到輸出截斷，嘗試分段處理...');
        return await this.processWithGeminiAPIInChunks(text, apiKey, this.isSimplifiedVersion);
      }

      // 其他錯誤直接拋出
      throw error;
    }
  }

  // 內部處理函數（原本的邏輯）
  async processWithGeminiAPIInternal(text, apiKey, isSimplified = true) {
    // 檢查輸入內容長度，避免超過API限制
    const maxInputLength = 25000; // 約25K字符，保留安全範圍
    if (text.length > maxInputLength) {
      console.log(`輸入內容過長 (${text.length} 字符)，截取前 ${maxInputLength} 字符`);
      text = text.substring(0, maxInputLength) + '...';
    }

    // 從設定讀取使用者偏好的模型
    const userPreferredModel = await this.getUserPreferredModel();

    // 【優化】可用的模型列表（優先使用者選擇，然後降級到其他版本）
    const availableModels = this.getModelPriorityList(userPreferredModel);

    // 【優化】重試配置 - 減少等待時間
    const maxRetries = 2;      // 從3減少到2
    const retryDelay = 1000;   // 從2秒減少到1秒

    // 先嘗試主要模型
    for (let modelIndex = 0; modelIndex < availableModels.length; modelIndex++) {
      const currentModel = availableModels[modelIndex];
      console.log(`嘗試模型: ${currentModel}`);

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`發送 Gemini API 請求... (模型: ${currentModel}, 嘗試 ${attempt}/${maxRetries})`);
          return await this.makeGeminiAPICall(apiKey, text, currentModel, isSimplified);
        } catch (error) {
          console.error(`第 ${attempt} 次嘗試失敗 (模型: ${currentModel}):`, error.message);

          // 如果是 Gemini 2.5 過載錯誤，直接降級到 1.5 (不等待重試)
          if (error.shouldFallback && currentModel.includes('2.5')) {
            console.log(`🔄 Gemini 2.5 模型過載，直接降級到 1.5 版本`);
            break; // 跳出當前模型的重試循環，嘗試下一個模型
          }

          // 如果是服務過載(503)或請求過多(429)，並且還有重試機會，則等待後重試
          if ((error.status === 503 || error.status === 429) && attempt < maxRetries) {
            const delay = retryDelay * attempt; // 指數退避
            console.log(`等待 ${delay}ms 後重試...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }

          // 如果是模型不可用或過載，且不是最後一個模型，嘗試下一個模型
          if ((error.status === 503 || error.status === 404) && modelIndex < availableModels.length - 1) {
            console.log(`模型 ${currentModel} 不可用，嘗試下一個模型`);
            break; // 跳出當前模型的重試循環，嘗試下一個模型
          }

          // 最後一次嘗試失敗
          if (attempt === maxRetries && modelIndex === availableModels.length - 1) {
            console.error('所有模型和重試都失敗，使用備用處理方案');
            return null;
          }
        }
      }
    }

    return null;
  }

  // 分段處理函數
  async processWithGeminiAPIInChunks(text, apiKey, isSimplified = true) {
    console.log('📄 開始分段處理...');

    // 將文本分割成較小的段落
    const chunks = this.splitTextIntoChunks(text, 8000); // 每段約8000字符
    console.log(`分成 ${chunks.length} 段處理`);

    const processedChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      console.log(`處理第 ${i + 1}/${chunks.length} 段...`);

      try {
        const result = await this.processWithGeminiAPIInternal(chunks[i], apiKey, isSimplified);
        if (result) {
          processedChunks.push(result);
        }
      } catch (error) {
        console.error(`第 ${i + 1} 段處理失敗:`, error.message);
        // 如果某段失敗，繼續處理其他段
      }

      // 段落間稍作停頓，避免API請求過於頻繁
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (processedChunks.length === 0) {
      console.error('所有段落處理都失敗');
      return null;
    }

    // 合併處理結果
    return this.mergeProcessedChunks(processedChunks);
  }

  // 將文本分割成較小的塊
  splitTextIntoChunks(text, maxChunkSize) {
    const chunks = [];
    const paragraphs = text.split('\n\n'); // 以段落為單位分割

    let currentChunk = '';

    for (const paragraph of paragraphs) {
      // 如果加入這個段落會超過限制
      if (currentChunk.length + paragraph.length > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }

    // 加入最後一個塊
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  // 合併處理後的段落
  mergeProcessedChunks(chunks) {
    console.log('🔗 合併分段處理結果...');

    const container = document.createElement('div');
    container.className = 'reader-restructured-content';

    chunks.forEach((chunk, index) => {
      if (chunk && chunk.children) {
        // 添加段落分隔標記
        if (index > 0) {
          const separator = document.createElement('hr');
          separator.className = 'reader-section-separator';
          container.appendChild(separator);
        }

        // 添加這段的內容
        Array.from(chunk.children).forEach(child => {
          container.appendChild(child.cloneNode(true));
        });
      }
    });

    console.log('✅ 分段處理完成，合併結果包含', container.children.length, '個元素');
    return container;
  }

  // 獲取Gemini API金鑰
  async getGeminiAPIKey() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['geminiAPIKey'], (result) => {
        resolve(result.geminiAPIKey || null);
      });
    });
  }

  // 獲取使用者偏好的模型
  async getUserPreferredModel() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['geminiModel'], (result) => {
        const preferredModel = result.geminiModel || 'gemini-1.5-flash'; // 預設為 1.5 flash
        console.log('🎯 使用者偏好模型:', preferredModel);
        console.log('📦 原始 storage 資料:', result);
        resolve(preferredModel);
      });
    });
  }

  // 根據使用者偏好產生模型優先順序列表
  getModelPriorityList(preferredModel) {
    const allModels = [
      'gemini-1.5-flash',      // 推薦：效能較佳
      'gemini-2.5-flash',      // 次選：較新版本
      'gemini-1.5-flash-8b',   // 備用：輕量版本
      'gemini-1.0-pro'         // 最後選項
    ];

    // 將使用者偏好的模型移到第一位
    const priorityList = [preferredModel];

    // 加入其他模型作為備用
    allModels.forEach(model => {
      if (model !== preferredModel) {
        priorityList.push(model);
      }
    });

    console.log('模型優先順序:', priorityList);
    return priorityList;
  }

  // 【NEW】創建組合 prompt 一次生成所有版本（性能優化）
  createCombinedPrompt(text) {
    return `請對以下內容進行全面處理，一次性生成所有需要的版本：

${text}

要求：
1. 精簡版：精簡至60-80%，保留核心要點
2. 原文版：保持原文完整，僅格式化結構
3. 兩個版本都使用Markdown格式: #標題 -條列 **粗體**
4. 每個版本都需要格式化版本和重點標記版本

嚴格按照以下JSON格式輸出：

\`\`\`json
{
  "simplified": {
    "formatted": "[精簡版格式化Markdown內容]",
    "highlighted": "[精簡版內容+==重點==標記，限制20%]"
  },
  "original": {
    "formatted": "[原文版格式化Markdown內容]",
    "highlighted": "[原文版內容+==重點==標記，限制20%]"
  }
}
\`\`\`

注意：
- 嚴格遵循JSON格式，不要包含其他文字
- ==重點==標記用於標註關鍵數字/結論/概念
- 確保JSON格式正確，可以直接解析`;
  }

  // 創建Gemini專用prompt（同時生成格式化版本和重點標記版本）
  createGeminiPrompt(text, isSimplified = true) {
    if (isSimplified) {
      // AI 精簡模式：精簡內容 + 排版 + 重點標記（優化版）
      return `精簡並格式化以下內容，同時生成兩個版本：

${text}

要求：
1. 精簡至60-80%，保留核心要點
2. 使用Markdown: #標題 -條列 **粗體**
3. 適當分組段落

輸出格式：

## 格式化版本
[精簡後的Markdown內容]

## 重點標記版本
[相同內容+==重點==標記，標記關鍵數字/結論/概念，限制20%]`;
    } else {
      // 原文模式：保留完整內容 + 排版 + 重點標記（優化版）
      return `完整格式化以下內容（不刪減），同時生成兩個版本：

${text}

要求：
1. 保持原文完整，僅格式化結構
2. 使用Markdown: #標題 -條列 **粗體**
3. 適當分組段落

輸出格式：

## 格式化版本
[完整格式化後的Markdown內容]

## 重點標記版本
[相同內容+==重點==標記，標記關鍵數字/結論/概念，限制20%]`;
    }
  }

  // 格式化Gemini結果（處理雙版本輸出）
  formatGeminiResult(geminiOutput) {
    console.log('格式化Gemini AI結果（雙版本）');

    // 解析兩個版本
    const sections = this.parseGeminiDualOutput(geminiOutput);

    if (!sections.formatted || !sections.highlighted) {
      console.warn('未找到完整的雙版本輸出，使用傳統解析方式');
      return this.formatSingleGeminiResult(geminiOutput, false);
    }

    // 分別格式化兩個版本
    const formattedContainer = this.formatSingleGeminiResult(sections.formatted, false);
    const highlightedContainer = this.formatSingleGeminiResult(sections.highlighted, true);

    // 返回包含兩個版本的物件
    return {
      formatted: formattedContainer,
      highlighted: highlightedContainer
    };
  }

  // 解析 Gemini 雙版本輸出
  parseGeminiDualOutput(output) {
    const lines = output.split('\n');
    let currentSection = '';
    let formattedContent = [];
    let highlightedContent = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line === '## 格式化版本') {
        currentSection = 'formatted';
        continue;
      } else if (line === '## 重點標記版本') {
        currentSection = 'highlighted';
        continue;
      }

      // 跳過空行和說明文字
      if (!line || line.startsWith('[') || line.startsWith('⚠️')) {
        continue;
      }

      if (currentSection === 'formatted') {
        formattedContent.push(lines[i]);
      } else if (currentSection === 'highlighted') {
        highlightedContent.push(lines[i]);
      }
    }

    return {
      formatted: formattedContent.join('\n').trim(),
      highlighted: highlightedContent.join('\n').trim()
    };
  }

  // 格式化單個版本的結果
  formatSingleGeminiResult(content, isHighlighted = false) {
    const container = document.createElement('div');
    container.className = 'reader-restructured-content';

    if (!content) return container;

    // 分析Markdown格式
    const lines = content.split('\n');
    let currentListContainer = null;

    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;

      let element = null;

      // 處理標題
      if (trimmed.startsWith('###')) {
        element = document.createElement('h3');
        element.className = 'reader-header reader-h3';
        const headerText = trimmed.replace(/^###\s*/, '');
        element.innerHTML = isHighlighted ? this.processHighlightFormatting(headerText) : this.processInlineFormatting(headerText);
        currentListContainer = null;
      } else if (trimmed.startsWith('##')) {
        element = document.createElement('h2');
        element.className = 'reader-header reader-h2';
        const headerText = trimmed.replace(/^##\s*/, '');
        element.innerHTML = isHighlighted ? this.processHighlightFormatting(headerText) : this.processInlineFormatting(headerText);
        currentListContainer = null;
      } else if (trimmed.startsWith('#')) {
        element = document.createElement('h1');
        element.className = 'reader-header reader-h1';
        const headerText = trimmed.replace(/^#\s*/, '');
        element.innerHTML = isHighlighted ? this.processHighlightFormatting(headerText) : this.processInlineFormatting(headerText);
        currentListContainer = null;

      // 處理條列項目
      } else if (trimmed.startsWith('- ') || trimmed.match(/^\d+\.\s/)) {
        const listItem = document.createElement('li');
        listItem.className = 'reader-list-item';

        // 清理前綴並處理格式
        let content = trimmed.replace(/^[-\d+\.]\s*/, '');
        content = isHighlighted ? this.processHighlightFormatting(content) : this.processInlineFormatting(content);
        listItem.innerHTML = content;

        // 創建或使用現有列表容器
        if (!currentListContainer) {
          currentListContainer = document.createElement('ul');
          currentListContainer.className = 'reader-list';
          container.appendChild(currentListContainer);
        }
        currentListContainer.appendChild(listItem);
        return;

      // 處理一般段落
      } else {
        element = document.createElement('p');
        element.className = 'reader-paragraph';
        element.innerHTML = isHighlighted ? this.processHighlightFormatting(trimmed) : this.processInlineFormatting(trimmed);
        currentListContainer = null;
      }

      if (element) {
        container.appendChild(element);
      }
    });

    console.log(`內容格式化完成，創建了 ${container.children.length} 個元素 (${isHighlighted ? '重點版本' : '格式化版本'})`);
    return container;
  }

  // 新增：處理內聯格式（粗體等）
  processInlineFormatting(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')  // **粗體**
      .replace(/\*(.*?)\*/g, '<em>$1</em>');             // *斜體*
  }

  // 新增：處理畫重點的內聯格式
  processHighlightFormatting(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')  // **粗體**
      .replace(/\*(.*?)\*/g, '<em>$1</em>')              // *斜體*
      .replace(/==([^=]+)==/g, '<span class="reader-highlight">$1</span>'); // ==重點==
  }

  // 創建畫重點專用的 Gemini Prompt
  createHighlightPrompt(text, isSimplified = true) {
    const versionType = isSimplified ? '精簡版' : '原文版';

    return `請對以下${versionType}內容進行重點標記，使用 ==重點內容== 標記需要高亮的重要部分：

內容：
${text}

重點標記要求：
1. 識別關鍵概念、重要數據、核心觀點
2. 使用 ==重點內容== 語法標記需要高亮的部分
3. 重點部分應該是：
   - 關鍵數字和統計數據
   - 重要結論和觀點
   - 核心概念和術語
   - 關鍵時間、地點、人物
   - 重要的行動項目或決議
4. 保持原有的 Markdown 格式（標題、條列等）
5. 不要改變內容，只是添加 ==高亮標記==
6. 重點標記要適度，不要超過內容的 20-30%

請直接輸出標記後的內容，不要添加說明文字。`;
  }

  // AI 重點處理主函數
  async processHighlightsWithGeminiAPI() {
    console.log('開始 AI 畫重點處理');

    // 檢查是否有API金鑰
    const apiKey = await this.getGeminiAPIKey();
    if (!apiKey) {
      console.log('未找到Gemini API金鑰，無法進行AI重點處理');
      throw new Error('未設定 Gemini API 金鑰');
    }

    // 檢查是否有內容可以處理
    if (!this.simplifiedContent && !this.originalFormattedContent) {
      console.log('沒有可處理的內容');
      throw new Error('沒有可處理的內容');
    }

    try {
      // 並行處理精簡版和原文版的重點標記
      const promises = [];

      if (this.simplifiedContent) {
        promises.push(
          this.processHighlightForVersion(apiKey, this.simplifiedContent, true)
            .then(result => ({ type: 'simplified', content: result }))
        );
      }

      if (this.originalFormattedContent) {
        promises.push(
          this.processHighlightForVersion(apiKey, this.originalFormattedContent, false)
            .then(result => ({ type: 'original', content: result }))
        );
      }

      const results = await Promise.all(promises);

      // 整理結果
      const highlightData = {};
      results.forEach(result => {
        highlightData[result.type] = result.content;
      });

      this.highlightData = highlightData;
      console.log('✅ AI 重點處理完成');

      return highlightData;

    } catch (error) {
      console.error('AI 重點處理失敗:', error);
      throw error;
    }
  }

  // 為特定版本處理重點標記
  async processHighlightForVersion(apiKey, contentElement, isSimplified) {
    // 將 DOM 元素轉換為純文字 Markdown 格式
    const markdownText = this.convertDOMToMarkdown(contentElement);

    // 從設定讀取使用者偏好的模型
    const userPreferredModel = await this.getUserPreferredModel();

    // 可用的模型列表（按使用者偏好排序）
    const models = this.getModelPriorityList(userPreferredModel).slice(0, 2); // 只取前兩個最優先的

    for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
      const currentModel = models[modelIndex];

      try {
        console.log(`重點處理使用模型: ${currentModel}`);
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: this.createHighlightPrompt(markdownText, isSimplified)
              }]
            }],
            generationConfig: {
              maxOutputTokens: 16000,  // 【修復】增加輸出限制，避免截斷
              temperature: 0.1,
              candidateCount: 1        // 【優化】確保只生成一個候選結果
            }
          })
        });

        if (!response.ok) {
          const errorText = await response.text();

          // 檢查是否為 2.5 模型過載
          let shouldFallback = false;
          if ((response.status === 503 || response.status === 429) && currentModel.includes('2.5')) {
            if (errorText.includes('overloaded') || errorText.includes('過載')) {
              shouldFallback = true;
            }
          }

          if (shouldFallback && modelIndex < models.length - 1) {
            console.log(`🔄 ${currentModel} 過載，降級到下一個模型`);
            continue; // 嘗試下一個模型
          }

          throw new Error(`API 請求失敗: ${response.status} - ${errorText}`);
        }

        const result = await response.json();

        if (!result.candidates || !result.candidates[0] || !result.candidates[0].content) {
          throw new Error('API 回應格式錯誤');
        }

        const highlightedText = result.candidates[0].content.parts[0].text;

        // 格式化結果，使用專門的高亮處理函數
        return this.formatHighlightResult(highlightedText);

      } catch (error) {
        console.error(`使用 ${currentModel} 處理${isSimplified ? '精簡版' : '原文版'}重點標記失敗:`, error);

        // 如果是最後一個模型，拋出錯誤
        if (modelIndex === models.length - 1) {
          throw error;
        }

        // 否則嘗試下一個模型
        console.log(`嘗試下一個模型...`);
      }
    }

    throw new Error('所有模型都失敗');
  }

  // 將 DOM 元素轉換為 Markdown 文字
  convertDOMToMarkdown(element) {
    let markdown = '';

    Array.from(element.children).forEach(child => {
      if (child.classList.contains('reader-h1')) {
        markdown += `# ${child.textContent}\n\n`;
      } else if (child.classList.contains('reader-h2')) {
        markdown += `## ${child.textContent}\n\n`;
      } else if (child.classList.contains('reader-h3')) {
        markdown += `### ${child.textContent}\n\n`;
      } else if (child.classList.contains('reader-list')) {
        Array.from(child.children).forEach(li => {
          markdown += `- ${li.textContent}\n`;
        });
        markdown += '\n';
      } else if (child.classList.contains('reader-paragraph')) {
        markdown += `${child.textContent}\n\n`;
      }
    });

    return markdown.trim();
  }

  // 格式化重點標記結果
  formatHighlightResult(highlightedText) {
    console.log('格式化 AI 重點標記結果');

    const container = document.createElement('div');
    container.className = 'reader-restructured-content';

    // 分析包含重點標記的 Markdown 格式
    const lines = highlightedText.split('\n');
    let currentListContainer = null;

    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;

      let element = null;

      // 處理標題
      if (trimmed.startsWith('###')) {
        element = document.createElement('h3');
        element.className = 'reader-header reader-h3';
        element.innerHTML = this.processHighlightFormatting(trimmed.replace(/^###\s*/, ''));
        currentListContainer = null;
      } else if (trimmed.startsWith('##')) {
        element = document.createElement('h2');
        element.className = 'reader-header reader-h2';
        element.innerHTML = this.processHighlightFormatting(trimmed.replace(/^##\s*/, ''));
        currentListContainer = null;
      } else if (trimmed.startsWith('#')) {
        element = document.createElement('h1');
        element.className = 'reader-header reader-h1';
        element.innerHTML = this.processHighlightFormatting(trimmed.replace(/^#\s*/, ''));
        currentListContainer = null;

      // 處理條列項目
      } else if (trimmed.startsWith('- ') || trimmed.match(/^\d+\.\s/)) {
        const listItem = document.createElement('li');
        listItem.className = 'reader-list-item';

        // 清理前綴並處理重點標記
        let content = trimmed.replace(/^[-\d+\.]\s*/, '');
        content = this.processHighlightFormatting(content);
        listItem.innerHTML = content;

        // 創建或使用現有列表容器
        if (!currentListContainer) {
          currentListContainer = document.createElement('ul');
          currentListContainer.className = 'reader-list';
          container.appendChild(currentListContainer);
        }
        currentListContainer.appendChild(listItem);
        return;

      // 處理一般段落
      } else {
        element = document.createElement('p');
        element.className = 'reader-paragraph';
        element.innerHTML = this.processHighlightFormatting(trimmed);
        currentListContainer = null;
      }

      if (element) {
        container.appendChild(element);
      }
    });

    console.log(`重點標記格式化完成，創建了 ${container.children.length} 個元素`);
    return container;
  }

  isHeader(text) {
    // 增強標題識別邏輯（針對中文教學內容優化）
    const trimmed = text.trim();

    // 🔥 優先檢查強標題特徵，避免被長度和排除規則誤殺
    const strongHeaderPatterns = [
      /^第[一二三四五六七八九十\d]+章/,           // 第一章
      /^第[一二三四五六七八九十\d]+節/,           // 第一節
      /^第[一二三四五六七八九十\d]+課/,           // 第一課
      /^第[一二三四五六七八九十\d]+單元/,         // 第一單元
      /^[一二三四五六七八九十]+[、．]/,          // 一、二、
      /^\d+[\.、]/,                              // 1. 2.
      /^\([一二三四五六七八九十\d]+\)/,          // (一) (二)
      /^\(\d+\)/,                               // (1) (2)
      /^【.*?】(?![^【】]*【)/,                  // 【標題】
      /^「.*?」(?![^「」]*「)/,                  // 「標題」
    ];

    // 如果符合強標題特徵，直接返回 true，不受長度和其他規則影響
    if (strongHeaderPatterns.some(pattern => pattern.test(trimmed))) {
      console.log('✅ 強標題特徵匹配:', trimmed.substring(0, 30) + '...');
      return true;
    }

    // 🔍 調試：檢查中文序號為何不匹配
    const chineseNumberPattern = /^[一二三四五六七八九十]+[、．]/;
    if (trimmed.match(/^[一二三四五六七八九十]/)) {
      console.log('🔍 中文序號調試 - 完整文本:', {
        fullText: trimmed,
        firstChar: trimmed.charAt(0),
        charCode: trimmed.charAt(0).charCodeAt(0),
        patternMatch: chineseNumberPattern.test(trimmed),
        length: trimmed.length
      });
    }

    // 長度篩選：普通標題不會太長（強標題已經跳過此檢查）
    if (trimmed.length > 80 || trimmed.length < 2) return false;

    // ⚠️ 執行排除規則，避免誤判
    const excludePatterns = [
      /^\d{4}[\/\-]\d{2}[\/\-]\d{2}/,           // 日期
      /https?:\/\//,                            // URL
      /[。！？].*[。！？]/,                      // 多個句號的長句
      /^.{100,}/,                               // 太長的文字（100字以上）
      /^.{50,}[。！？]$/,                       // 超過50字且以句號結尾的長句
      /^\s*$/,                                  // 空白
      /分鐘|小時|節課|總計/,                     // 時間相關（通常不是標題）
      /已完成|已結束|將於|預計|預定|計劃/,        // 動作狀態相關的描述句
      /請.*參閱|請.*配合|請.*注意/,              // 請求式語句
      /送件至|報名|繳交|提交/,                   // 行政動作描述
      /比賽.*結束|競賽.*結束|活動.*結束/,         // 活動結束描述
      /不論.*均會|如有.*請/,                     // 條件句式
      /作業.*上午|作品.*退件/,                   // 作業和作品相關描述
    ];

    // 如果符合排除條件，直接返回 false
    const matchedExcludePattern = excludePatterns.find(pattern => pattern.test(trimmed));
    if (matchedExcludePattern) {
      // 🔍 調試：記錄被排除的原因
      if (trimmed.match(/^[一二三四五六七八九十]/)) {
        console.log('❌ 中文序號被排除規則誤殺:', {
          text: trimmed.substring(0, 30) + '...',
          excludePattern: matchedExcludePattern.toString(),
          length: trimmed.length
        });
      }
      return false;
    }

    // 其他標題特徵（結尾冒號）
    const colonHeaderPatterns = [
      /^[^。！？，；]{2,30}[：:]\s*$/,          // 結尾冒號（限制長度，排除長句）
    ];

    // 教學相關標題特徵
    const educationHeaderPatterns = [
      /^(教學目標|學習目標|課程目標)/,            // 教學目標相關
      /^(教學重點|學習重點|重點提示)/,            // 重點相關
      /^(教學活動|學習活動|課堂活動)/,            // 活動相關
      /^(教學流程|教學步驟|教學程序)/,            // 流程相關
      /^(教材準備|教具準備|材料準備)/,            // 準備相關
      /^(評量方式|評量標準|評量項目)/,            // 評量相關
      /(課程|單元|主題).*?(簡介|概述|說明)$/,      // 課程介紹
      /^[國小國中高中][一二三四五六年級]+.*?(課程|教學)/,  // 學制年級
    ];

    // 中等標題特徵
    const mediumHeaderPatterns = [
      /處$|室$|部$|科$|組$/,                     // 處室部科組結尾
      /報告$|事項$|議題$|提案$/,                 // 會議相關結尾
      /說明$|辦法$|規定$|要點$/,                 // 文件相關結尾
      /^(教務|學務|總務|輔導|人事|會計|主計)/,    // 處室開頭
      /問題|討論|決議|結論/,                     // 會議關鍵字
      /課程內容|教學內容|學習內容/,               // 內容相關
      /能力指標|學習指標|教學指標/,               // 指標相關
    ];

    // 檢查教學相關特徵
    if (educationHeaderPatterns.some(pattern => pattern.test(trimmed))) {
      return true;
    }

    // 檢查結尾冒號特徵
    if (colonHeaderPatterns.some(pattern => pattern.test(trimmed))) {
      return true;
    }

    // 檢查中等特徵 + 嚴格長度和內容限制
    if (trimmed.length <= 25 &&
        !trimmed.includes('已') &&
        !trimmed.includes('將') &&
        !trimmed.includes('請') &&
        mediumHeaderPatterns.some(pattern => pattern.test(trimmed))) {
      return true;
    }

    // 其他情況返回 false
    return false;
  }

  isSubHeader(text) {
    // 強化子標題識別
    const trimmed = text.trim();

    if (trimmed.length > 50 || trimmed.length < 2) return false;

    // 如果已經是主標題，不要重複判定
    if (this.isHeader(trimmed)) return false;

    // 子標題特徵模式
    const subHeaderPatterns = [
      /^\([一二三四五六七八九十\d]+\)/,          // (一) (1)
      /^[一二三四五六七八九十]+[、．]/,          // 一、二、（較短的）
      /^\d+\.\d+/,                              // 1.1 1.2
      /^[A-Za-z]\./,                            // A. B. C.
      /^[甲乙丙丁戊己庚辛壬癸][、．]/,          // 甲、乙、
      /^附件[一二三四五六七八九十\d]*[：:]/,     // 附件一：
      /^說明[一二三四五六七八九十\d]*[：:]/,     // 說明一：
    ];

    // 檢查是否符合子標題模式
    if (subHeaderPatterns.some(pattern => pattern.test(trimmed))) {
      return true;
    }

    // 特殊情況：短文字 + 冒號結尾
    if (trimmed.length <= 25 && trimmed.endsWith('：')) {
      return true;
    }

    return false;
  }

  isListItem(text) {
    // 增強條列項目識別（針對中文內容優化）
    const trimmed = text.trim();
    console.log('🔍 列表項目檢測:', trimmed.substring(0, 50) + '...');

    if (trimmed.length < 3) {
      console.log('❌ 列表項目太短:', trimmed.length);
      return false;
    }

    // 各種條列項目模式
    const listPatterns = [
      // 數字編號
      /^\d+[\.、]\s+/,                          // 1. 2、
      /^\d+\)\s+/,                              // 1) 2)
      /^\(\d+\)\s+/,                            // (1) (2)

      // 中文編號
      /^[一二三四五六七八九十]+[、．]\s+/,      // 一、二、
      /^\([一二三四五六七八九十]+\)\s+/,        // (一) (二)
      /^[甲乙丙丁戊己庚辛壬癸][、．]\s+/,      // 甲、乙、

      // 英文編號
      /^[A-Za-z][\.、]\s+/,                     // A. B、
      /^\([A-Za-z]\)\s+/,                       // (A) (B)

      // 符號編號（移除 - 符號避免誤判）
      /^[\*\•●○▪▫]\s+/,                       // * • ● ○（移除 - 避免誤判）
      /^[→←↑↓]\s+/,                           // 箭頭
      /^[◆◇■□▲△]\s+/,                       // 幾何符號

      // 層級編號（改進版，支援無標點符號的格式）
      /^\d+\.\d+[\.、]\s+/,                     // 1.1. 1.2、
      /^\d+\.\d+\s+/,                           // 2.1 核心產品線（簡化模式，只需空格）
      /^\d+\.\d+\.\d+[\.、]\s+/,               // 1.1.1.
      /^\d+\.\d+\.\d+\s+/,                     // 2.1.1 智慧家居（三層級無標點）

      // 教學專用編號
      /^步驟[一二三四五六七八九十\d]+[：:]/,    // 步驟一：
      /^活動[一二三四五六七八九十\d]+[：:]/,    // 活動一：
      /^第[一二三四五六七八九十\d]+階段/,       // 第一階段
    ];

    // 檢查是否符合條列模式
    let matchedPattern = -1;
    const isMatched = listPatterns.some((pattern, index) => {
      if (pattern.test(trimmed)) {
        matchedPattern = index;
        return true;
      }
      return false;
    });

    if (isMatched) {
      console.log('✅ 列表項目匹配模式', matchedPattern, ':', listPatterns[matchedPattern]);
      return true;
    } else {
      console.log('❌ 列表項目未匹配任何模式，前20字符:', JSON.stringify(trimmed.substring(0, 20)));
      // 測試關鍵的小數編號模式
      const testPattern = /^\d+\.\d+\s+[^\s]/;
      console.log('🔍 小數編號模式測試:', testPattern.test(trimmed), '- 模式:', testPattern);
    }

    // 教學內容特殊條列識別
    const educationListPatterns = [
      /^[能理解學習掌握].*[。！]$/,              // 以教學動詞開頭
      /^透過.*?[，,].*?[。！]$/,                 // 透過...，...。
      /^利用.*?進行.*?[。！]$/,                  // 利用...進行...。
      /^藉由.*?[，,].*?[。！]$/,                 // 藉由...，...。
    ];

    // 檢查教學條列模式（長度限制更嚴格）
    if (trimmed.length <= 100 && educationListPatterns.some(pattern => pattern.test(trimmed))) {
      return true;
    }

    // 特殊處理：如果前面有空白且符合簡單模式（縮排列表）
    if (/^\s{2,}/.test(text)) {
      const indentedPatterns = [
        /^\s+[-\*\•]\s+/,
        /^\s+\d+[\.、]\s+/,
        /^\s+[一二三四五六七八九十]+[、．]\s+/,
      ];
      return indentedPatterns.some(pattern => pattern.test(text));
    }

    // 簡化版條列識別：如果文字很短且包含常見條列關鍵字
    if (trimmed.length <= 50) {
      const simpleListKeywords = [
        /^提升.*?能力/,
        /^培養.*?態度/,
        /^增進.*?了解/,
        /^建立.*?觀念/,
        /^認識.*?[的概念特色]/,
      ];
      return simpleListKeywords.some(pattern => pattern.test(trimmed));
    }

    return false;
  }

  // 新增：提取條列項目的層級
  getListItemLevel(text) {
    const trimmed = text.trim();

    // 檢查縮排
    const indentMatch = text.match(/^(\s*)/);
    const indentLevel = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0;

    // 檢查編號層級
    if (/^\d+\.\d+\.\d+/.test(trimmed)) return Math.max(indentLevel, 3);
    if (/^\d+\.\d+/.test(trimmed)) return Math.max(indentLevel, 2);
    if (/^\d+/.test(trimmed)) return Math.max(indentLevel, 1);

    return Math.max(indentLevel, 1);
  }

  // 新增：清理條列項目前綴
  cleanListItemPrefix(text) {
    let cleaned = text.trim();

    // 清理 Markdown 預處理產生的重複符號（如 "- •"）
    cleaned = cleaned.replace(/^-\s*[-\*\•●○▪▫]\s+/, ''); // 清理重複的 "- •" 等

    // 清理各種條列符號
    cleaned = cleaned
      .replace(/^[-\*\•●○▪▫→←↑↓◆◇■□▲△]\s+/, '')
      .replace(/^\d+[\.、)]\s+/, '')
      .replace(/^\(\d+\)\s+/, '')
      .replace(/^[一二三四五六七八九十]+[、．]\s+/, '')
      .replace(/^\([一二三四五六七八九十]+\)\s+/, '')
      .replace(/^[甲乙丙丁戊己庚辛壬癸][、．]\s+/, '')
      .replace(/^[A-Za-z][\.、)]\s+/, '')
      .replace(/^\([A-Za-z]\)\s+/, '')
      .replace(/^\d+\.\d+[\.、]\s+/, '')
      .replace(/^\d+\.\d+\.\d+[\.、]\s+/, '')
      .trim();

    return cleaned;
  }

  toggleReader() {
    if (this.isActive) {
      this.deactivateReader();
    } else {
      // 檢查是否有選取內容
      const selection = window.getSelection();
      if (selection.toString().trim().length > 0) {
        this.startWithSelectedContent(selection.toString());
      } else if (!this.tryStartWithAutoDetectedContent()) {
        // 非支援頁面且沒有選取內容時顯示提示
        this.showNoSelectionMessage();
      }
    }
  }

  tryStartWithAutoDetectedContent() {
    const detected = this.detectEsaMeetingContent();
    if (!detected) return false;

    console.log('使用 ESA 會議頁自動擷取內容啟動簡報模式');
    this.startWithSelectedContent(
      detected.text,
      detected.fragment,
      detected.attachmentSources
    );
    return true;
  }

  detectEsaMeetingContent() {
    const isEsaHost = location.hostname.toLowerCase() === 'esa.ntpc.edu.tw';
    const isMeetingPrint = /\/web-meeting2\/templates\/MeetingPrint\.html$/i.test(location.pathname);
    if (!isEsaHost) return null;

    if (isMeetingPrint) {
      const tables = Array.from(document.querySelectorAll('table'))
        .filter(table => !table.closest('#web-reader-container'))
        .filter(table => this.isVisibleSourceElement(table))
        .filter(table => table.innerText.trim().length > 0);

      return this.buildEsaDetectedContent(tables, 'esa-meeting-print');
    }

    const isMeetingManagement = /\/web-module_list\/rest\/service\/main/i.test(location.pathname) &&
      (location.hash.includes('meeting/meetingContent') || !!document.querySelector('.meeting'));
    if (!isMeetingManagement) return null;

    const meetingRoot = document.querySelector('.meeting.ng-scope, .meeting');
    if (!meetingRoot) return null;

    const headerTitle = meetingRoot.querySelector(':scope > .meeting-header--title');
    const headerInfo = meetingRoot.querySelector(':scope > .meeting-header > .meeting-header--info');
    const reportCards = Array.from(
      meetingRoot.querySelectorAll('.meeting-card.meeting-card--yellow')
    ).filter(card => {
      if (!this.isVisibleSourceElement(card)) return false;
      return Array.from(card.querySelectorAll('.meeting-card-content')).some(content =>
        this.isVisibleSourceElement(content) && content.innerText.trim().length > 0
      );
    });

    // ESA 會議內容頁後半還有「編輯完成」「出席簽到」「人員簽收」與
    // 「公開閱覽」等管理卡；它們不是會議簡報內容，不得整塊擷取。
    const contentSections = [headerTitle, headerInfo, ...reportCards]
      .filter(Boolean)
      .filter(element => this.isVisibleSourceElement(element))
      .filter(element => !element.closest('#web-reader-container'))
      .filter(element => element.innerText.trim().length > 0);

    return this.buildEsaDetectedContent(contentSections, 'esa-meeting-management');
  }

  buildEsaDetectedContent(elements, sourceName) {
    if (!elements.length) return null;

    const staging = document.createElement('div');
    elements.forEach(element => staging.appendChild(element.cloneNode(true)));
    const attachmentSources = new Map();

    if (sourceName === 'esa-meeting-management') {
      const originalAttachmentItems = elements.flatMap(element =>
        Array.from(element.querySelectorAll('.meeting-card-content--file-items'))
      );
      const clonedAttachmentItems = Array.from(staging.querySelectorAll(
        '.meeting-card-content--file-items'
      ));

      const sourcesByKey = new Map();
      originalAttachmentItems.forEach(item => {
        const key = this.getEsaAttachmentStableKey(item);
        const source = item.querySelector('[ng-click*="attach_file"]');
        if (!key || !source) return;
        const sources = sourcesByKey.get(key) || [];
        sources.push(source);
        sourcesByKey.set(key, sources);
      });

      clonedAttachmentItems.forEach((item, index) => {
        const key = this.getEsaAttachmentStableKey(item);
        const sourceTrigger = sourcesByKey.get(key)?.shift();
        if (!sourceTrigger) return;
        const id = `esa-attachment-${index}`;
        item.dataset.readerAttachmentId = id;
        attachmentSources.set(id, { source: sourceTrigger, key });
      });
    }

    staging.querySelectorAll(
      'script, style, noscript, template, form, button, input, select, textarea, ' +
      '[hidden], [aria-hidden="true"], .ng-hide, .ng-cloak, .hidden, .hidden-print, .modal, ' +
      '[style*="display: none" i], [style*="display:none" i], ' +
      '[style*="visibility: hidden" i], [style*="visibility:hidden" i]'
    ).forEach(element => element.remove());

    if (sourceName === 'esa-meeting-management') {
      staging.querySelectorAll(
        '.select-button, .sort_btn, .meeting-header--total, ' +
        '.meeting-card--green, .meeting-card--teal, .meeting-card--blue, .meeting-card--purple'
      ).forEach(element => element.remove());

      // 各處室在 ESA 內部都可能將自己的第一項寫成「一、」；合併為整場
      // 會議簡報後必須重新連續編號，否則目錄與內文會全部顯示「一、」。
      Array.from(staging.querySelectorAll('.meeting-card-content--title')).forEach((title, index) => {
        const original = title.textContent.replace(/\s+/g, ' ').trim();
        const withoutNumber = original
          .replace(/^\s*(?:[一二三四五六七八九十百零]+|\d+)[、．.)）]\s*/, '')
          .trim();
        if (!withoutNumber) return;

        title.textContent = `${this.toChineseSectionNumber(index + 1)}、${withoutNumber}`;
        title.setAttribute('data-reader-esa-section-title', 'true');
      });
    }

    // AI 文字只包含會議正文；附件名稱、上傳者與內部路徑不自動送出。
    const aiTextSource = staging.cloneNode(true);
    aiTextSource.querySelectorAll('.meeting-card-content--file').forEach(element => element.remove());
    const text = Array.from(aiTextSource.children)
      .map(element => element.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n\n');
    if (text.length < 20) return null;

    const fragment = document.createDocumentFragment();
    while (staging.firstChild) fragment.appendChild(staging.firstChild);
    return { text, fragment, source: sourceName, attachmentSources };
  }

  toChineseSectionNumber(value) {
    const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (value < 10) return digits[value];
    if (value === 10) return '十';
    if (value < 20) return `十${digits[value - 10]}`;
    if (value < 100) {
      const tens = Math.floor(value / 10);
      const ones = value % 10;
      return `${digits[tens]}十${ones ? digits[ones] : ''}`;
    }
    return String(value);
  }

  isVisibleSourceElement(element) {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      element.getAttribute('aria-hidden') !== 'true';
  }

  showNoSelectionMessage() {
    this.originalSelectedText = null;
    this.originalSelectedFragment = null;
    this.offlineFormattedContent = null;
    const container = document.getElementById('web-reader-container');
    container.classList.remove('web-reader-hidden');
    container.classList.add('web-reader-active');

    const contentContainer = document.getElementById('reader-main-content');
    contentContainer.innerHTML = `
      <div class="reader-instruction">
        <h2>如何使用網頁簡報器</h2>
        <ol>
          <li>ESA 會議列印頁可直接點擊擴充功能啟動</li>
          <li>其他網頁請先選取要展示的內容</li>
          <li>再點擊擴充功能，或使用右鍵「啟動簡報模式」</li>
        </ol>
      </div>
    `;

    document.body.classList.add('reader-mode');
    this.isActive = true;
    this.updateAIProcessButtonState();
    this.saveSettings();
  }

  activateReader() {
    this.originalContent = document.body.innerHTML;

    const contentContainer = document.getElementById('reader-main-content');
    contentContainer.innerHTML = '<div class="reader-loading">正在格式化選取內容...</div>';

    const container = document.getElementById('web-reader-container');
    container.classList.remove('web-reader-hidden');
    container.classList.add('web-reader-active');

    // 使用選取的內容
    if (this.selectedContent) {
      contentContainer.innerHTML = '';
      contentContainer.appendChild(this.selectedContent);

      // 處理標題和建立目錄
      this.currentSection = 0;
      this.processHeaders(this.selectedContent);
      this.buildTableOfContents();
      this.updateProgress();
    }

    // 恢復側邊欄狀態
    if (this.isSidebarCollapsed) {
      container.classList.add('sidebar-collapsed');
      const toggleButton = document.getElementById('sidebar-toggle');
      if (toggleButton) {
        toggleButton.textContent = '▶';
        toggleButton.title = '展開目錄';
      }
    }

    // 初始化新按鈕狀態
    this.initializeButtonStates();

    // 更新工具列狀態顯示
    this.updateToolbarStatus();

    document.body.classList.add('reader-mode');
    this.isActive = true;
    this.saveSettings();
  }

  // 初始化按鈕狀態
  initializeButtonStates() {
    // 版本切換按鈕 - 使用統一的更新函數
    this.updateVersionButton();

    // 重點模式按鈕
    this.updateHighlightButtonState();
    this.updateAIProcessButtonState();

    // 更新狀態顯示
    this.updateStatusDisplay();
  }

  updateHighlightButtonState() {
    const highlightButton = document.getElementById('reader-highlight-mode');
    if (!highlightButton) return;

    highlightButton.classList.toggle('active', this.isHighlightMode);
    highlightButton.title = this.isHighlightMode
      ? '關閉畫重點模式'
      : (this.isOfflineMode ? '本機畫重點模式' : 'AI畫重點模式');
    highlightButton.textContent = '✨';
    highlightButton.disabled = false;
  }

  // 更新狀態顯示 - 重定向到統一函數
  updateStatusDisplay() {
    // 使用統一的狀態更新函數
    this.updateAllStatusDisplays();
  }

  deactivateReader() {
    this.removeAIConsentDialog();
    const container = document.getElementById('web-reader-container');
    container.classList.remove('web-reader-active');
    container.classList.add('web-reader-hidden');

    document.body.classList.remove('reader-mode');
    this.isActive = false;
    this.selectedContent = null;
    this.esaAttachmentSources.clear();
    this.saveSettings();
  }

  processHeaders(content) {
    const headers = content.querySelectorAll('.reader-header');
    this.tableOfContents = [];
    this.sections = [];

    headers.forEach((header, index) => {
      const level = this.getHeaderLevel(header);
      const text = header.textContent.trim();
      const id = `section-${index}`;

      header.id = id;

      this.tableOfContents.push({
        id,
        text,
        level,
        element: header
      });

      this.sections.push(header);
    });
  }

  getHeaderLevel(element) {
    const classList = element.className;
    if (classList.includes('reader-h1')) return 1;
    if (classList.includes('reader-h2')) return 2;
    if (classList.includes('reader-h3')) return 3;
    if (classList.includes('reader-h4')) return 4;
    if (classList.includes('reader-h5')) return 5;
    if (classList.includes('reader-h6')) return 6;
    return 2;
  }

  // 更新工具列狀態顯示 - 重定向到統一函數
  updateToolbarStatus() {
    // 使用統一的狀態更新函數
    this.updateAllStatusDisplays();

    // 更新按鈕狀態
    const versionToggleBtn = document.getElementById('reader-version-toggle');
    const highlightModeBtn = document.getElementById('reader-highlight-mode');

    // 更新版本切換按鈕
    if (versionToggleBtn) {
      versionToggleBtn.title = this.isSimplifiedVersion ? '當前：精簡版 (點擊切換到原文版)' : '當前：原文版 (點擊切換到精簡版)';
      versionToggleBtn.textContent = this.isSimplifiedVersion ? '📄' : '📋';
      versionToggleBtn.classList.toggle('active', !this.isSimplifiedVersion);
    }

    // 更新畫重點按鈕
    if (highlightModeBtn) {
      highlightModeBtn.classList.toggle('active', this.isHighlightMode);
      highlightModeBtn.title = this.isHighlightMode ? '關閉畫重點模式' : 'AI畫重點模式';
    }

    // 根據不同模式調整按鈕說明；離線版使用本機規則式標記。
    if (this.isOfflineMode) {
      if (versionToggleBtn) {
        versionToggleBtn.disabled = false;
      }
      if (highlightModeBtn) {
        highlightModeBtn.disabled = false;
        highlightModeBtn.title = this.isHighlightMode ? '關閉畫重點模式' : '本機畫重點模式';
      }
    } else {
      // AI模式下：所有功能都可用
      if (versionToggleBtn) {
        versionToggleBtn.disabled = false;
      }
      if (highlightModeBtn) {
        highlightModeBtn.disabled = false;
        highlightModeBtn.title = this.isHighlightMode ? '關閉畫重點模式' : 'AI畫重點模式';
      }
    }
  }

  buildTableOfContents() {
    const tocContainer = document.getElementById('table-of-contents');
    if (!tocContainer) return;

    tocContainer.innerHTML = '';

    if (this.tableOfContents.length === 0) {
      tocContainer.innerHTML = '<div class="toc-empty">未找到標題</div>';
      return;
    }

    this.tableOfContents.forEach((item, index) => {
      const tocItem = document.createElement('div');
      tocItem.className = `toc-item toc-level-${item.level}`;
      tocItem.innerHTML = `
        <a href="#${item.id}" data-section="${index}">
          ${item.text}
        </a>
      `;

      tocItem.onclick = (e) => {
        e.preventDefault();
        this.scrollToSection(index);
      };

      tocContainer.appendChild(tocItem);
    });
  }

  scrollToSection(index) {
    if (index >= 0 && index < this.sections.length) {
      this.currentSection = index;
      const scroller = document.getElementById('web-reader-content');
      const section = this.sections[index];
      if (scroller && section) {
        const targetTop = section.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top + scroller.scrollTop - 24;
        scroller.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
      }

      // 立即更新進度顯示（使用手動設定的 currentSection）
      this.updateProgress();

      // 等待滾動動畫完成後再次更新
      setTimeout(() => {
        this.updateProgress();
      }, 1000);
    }
  }

  adjustFontSize(delta) {
    this.fontSize = Math.max(16, Math.min(72, this.fontSize + delta));
    document.documentElement.style.setProperty('--reader-font-size', `${this.fontSize}px`);
    document.getElementById('reader-font-size').textContent = `${this.fontSize}px`;
    this.saveSettings();
  }

  toggleHighContrast() {
    this.isHighContrast = !this.isHighContrast;
    const container = document.getElementById('web-reader-container');
    container.classList.toggle('high-contrast', this.isHighContrast);
    this.saveSettings();
  }



  // 版本切換功能（離線版 ↔ AI精簡版 ↔ AI原文版）
  toggleVersion() {
    // 定義版本切換順序：離線版 → AI精簡版 → AI原文版 → 離線版
    if (this.isOfflineMode) {
      // 離線版 → AI精簡版（如果有快取）
      if (this.simplifiedContent) {
        this.isOfflineMode = false;
        this.isSimplifiedVersion = true;
        this.currentFormatMode = 'AI';
        console.log('🔄 切換到 AI 精簡版');
      } else {
        console.log('❌ 沒有 AI 精簡版快取，無法切換');
        return;
      }
    } else if (this.isSimplifiedVersion) {
      // AI精簡版 → AI原文版（如果有快取）
      if (this.originalFormattedContent) {
        this.isSimplifiedVersion = false;
        console.log('🔄 切換到 AI 原文版');
      } else {
        // 沒有原文版，切回離線版
        this.isOfflineMode = true;
        this.currentFormatMode = 'Manual';
        console.log('🔄 切換回離線版');
      }
    } else {
      // AI原文版 → 離線版
      this.isOfflineMode = true;
      this.currentFormatMode = 'Manual';
      console.log('🔄 切換回離線版');
    }

    // 更新按鈕狀態
    this.updateVersionButton();
    this.updateHighlightButtonState();
    this.updateAIProcessButtonState();

    // 更新內容顯示和狀態
    this.updateContentDisplay();
    this.updateAllStatusDisplays();
    this.saveSettings();
  }

  // 更新版本切換按鈕狀態
  updateVersionButton() {
    const versionButton = document.getElementById('reader-version-toggle');
    if (!versionButton) return;

    if (this.isOfflineMode) {
      versionButton.textContent = '📄';
      versionButton.title = '當前：離線版 (點擊切換到AI版本)';
      versionButton.classList.remove('active');
    } else if (this.isSimplifiedVersion) {
      versionButton.textContent = '📋';
      versionButton.title = '當前：AI精簡版 (點擊切換版本)';
      versionButton.classList.add('active');
    } else {
      versionButton.textContent = '📖';
      versionButton.title = '當前：AI原文版 (點擊切換版本)';
      versionButton.classList.add('active');
    }
  }

  // 重點模式切換功能（優化版：直接切換顯示）
  toggleHighlightMode() {
    // 檢查是否有重點數據可以顯示
    if (!this.isOfflineMode &&
        (!this.highlightData || Object.keys(this.highlightData).length === 0)) {
      console.log('❌ 沒有重點數據可以顯示，請先選取內容重新格式化');

      // 顯示提示訊息
      const highlightButton = document.getElementById('reader-highlight-mode');
      if (highlightButton) {
        const originalTitle = highlightButton.title;
        highlightButton.title = '沒有重點數據，請重新選取內容';
        highlightButton.textContent = '❓';

        setTimeout(() => {
          highlightButton.title = originalTitle;
          highlightButton.textContent = '✨';
        }, 2000);
      }
      return;
    }

    this.isHighlightMode = !this.isHighlightMode;

    // 更新按鈕狀態
    const highlightButton = document.getElementById('reader-highlight-mode');
    if (highlightButton) {
      highlightButton.classList.toggle('active', this.isHighlightMode);
      highlightButton.title = this.isHighlightMode
        ? '關閉畫重點模式'
        : (this.isOfflineMode ? '本機畫重點模式' : 'AI畫重點模式');
    }

    console.log('🔄 重點模式', this.isHighlightMode ? '開啟' : '關閉', '(即時切換)');

    // 立即更新內容顯示
    this.updateContentDisplay();
    this.updateStatusDisplay(); // 更新狀態顯示
    this.saveSettings();
  }

  // 更新內容顯示（根據當前版本和重點模式狀態）
  updateContentDisplay() {
    let contentToShow = null;

    if (this.isOfflineMode) {
      if (this.isHighlightMode) {
        contentToShow = this.getOfflineHighlightedContent();
        console.log('✨ 顯示離線版 + 本機重點');
      } else {
        contentToShow = this.offlineFormattedContent ||
          this.generateOfflineFormatting(this.originalSelectedText, this.originalSelectedFragment);
        console.log('📄 顯示離線版內容');
      }
    } else if (this.isHighlightMode && this.highlightData) {
      // 重點模式開啟且有重點數據（僅AI模式可用）
      if (this.isSimplifiedVersion) {
        contentToShow = this.highlightData.simplified || this.simplifiedContent;
        console.log('✨ 顯示 AI 精簡版 + 重點');
      } else {
        contentToShow = this.highlightData.original || this.originalFormattedContent;
        console.log('✨ 顯示 AI 原文版 + 重點');
      }
    } else {
      // 重點模式關閉，顯示普通AI版本
      if (this.isSimplifiedVersion) {
        contentToShow = this.simplifiedContent;
        console.log('📋 顯示 AI 精簡版');
      } else {
        contentToShow = this.originalFormattedContent;
        console.log('📖 顯示 AI 原文版');
      }
    }

    if (contentToShow) {
      this.selectedContent = contentToShow;
      this.refreshContent();
    }
  }

  getOfflineHighlightedContent() {
    if (this.offlineHighlightedContent) return this.offlineHighlightedContent;
    if (!this.offlineFormattedContent) return null;

    const highlighted = this.offlineFormattedContent.cloneNode(true);
    const walker = document.createTreeWalker(
      highlighted,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: node => {
          if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
          if (node.parentElement?.closest('script, style, .reader-highlight')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(node => this.highlightOfflineTextNode(node));

    this.offlineHighlightedContent = highlighted;
    return highlighted;
  }

  highlightOfflineTextNode(textNode) {
    const text = textNode.textContent;
    const pattern = /((?:民國)?\d{2,4}年\d{1,2}月\d{1,2}日|\d{2,4}[\/.-]\d{1,2}[\/.-]\d{1,2}|(?:[01]?\d|2[0-3])[:：][0-5]\d|決議|結論|主席裁示|承辦(?:單位|人)?|辦理期限|期限|截止|列管|應辦|請於|務必|完成|延期|取消|注意事項|附件)/g;
    let match;
    let cursor = 0;
    const fragment = document.createDocumentFragment();

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      }
      const mark = document.createElement('span');
      mark.className = 'reader-highlight reader-local-highlight';
      mark.textContent = match[0];
      fragment.appendChild(mark);
      cursor = match.index + match[0].length;
    }

    if (cursor === 0) return;
    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }
    textNode.replaceWith(fragment);
  }

  // 重新整理內容顯示
  refreshContent() {
    const contentContainer = document.getElementById('reader-main-content');
    if (!contentContainer || !this.selectedContent) return;

    contentContainer.innerHTML = '';
    contentContainer.appendChild(this.selectedContent);

    const scroller = document.getElementById('web-reader-content');
    if (scroller) scroller.scrollTop = 0;
    this.currentSection = 0;

    // 重新處理標題和建立目錄
    this.processHeaders(this.selectedContent);
    this.buildTableOfContents();
    this.updateProgress();
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  updateProgress() {
    const scroller = document.getElementById('web-reader-content');
    const scrollTop = scroller ? scroller.scrollTop : 0;
    const scrollHeight = scroller ? scroller.scrollHeight - scroller.clientHeight : 0;
    const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;

    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');

    if (progressFill) {
      progressFill.style.width = `${progress}%`;
    }

    if (progressText && this.sections.length > 0) {
      // 使用手動設定的 currentSection，如果沒有則計算當前位置
      let currentSection = this.currentSection;
      if (currentSection === undefined || currentSection < 0) {
        currentSection = this.getCurrentSection();
      }

      // 確保 currentSection 在有效範圍內
      currentSection = Math.max(0, Math.min(currentSection, this.sections.length - 1));
      progressText.textContent = `${currentSection + 1} / ${this.sections.length}`;
    } else if (progressText) {
      progressText.textContent = '0 / 0';
    }
  }

  getCurrentSection() {
    const scroller = document.getElementById('web-reader-content');
    if (!scroller) return 0;
    const remaining = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    if (remaining <= 4 && this.sections.length > 0) {
      return this.sections.length - 1;
    }
    const threshold = scroller.getBoundingClientRect().top + 120;

    for (let i = this.sections.length - 1; i >= 0; i--) {
      const section = this.sections[i];
      if (section.getBoundingClientRect().top <= threshold) {
        return i;
      }
    }
    return 0;
  }

  handleKeyboard(e) {
    switch(e.key) {
      case 'Escape':
        this.toggleReader();
        break;
      case 'F11':
        e.preventDefault();
        this.toggleFullscreen();
        break;
      case '=':
      case '+':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.adjustFontSize(4);
        }
        break;
      case '-':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.adjustFontSize(-4);
        }
        break;
      case 'ArrowUp':
        if (this.currentSection > 0) {
          this.scrollToSection(this.currentSection - 1);
        }
        break;
      case 'ArrowDown':
        if (this.currentSection < this.sections.length - 1) {
          this.scrollToSection(this.currentSection + 1);
        }
        break;
    }
  }

  toggleSidebar() {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
    const container = document.getElementById('web-reader-container');
    const toggleButton = document.getElementById('sidebar-toggle');

    if (this.isSidebarCollapsed) {
      container.classList.add('sidebar-collapsed');
      toggleButton.textContent = '▶';
      toggleButton.title = '展開目錄';
    } else {
      container.classList.remove('sidebar-collapsed');
      toggleButton.textContent = '◀';
      toggleButton.title = '收合目錄';
    }

    this.saveSettings();
  }

  saveSettings() {
    const settings = {
      fontSize: this.fontSize,
      isHighContrast: this.isHighContrast,
      isSidebarCollapsed: this.isSidebarCollapsed,
      isActive: this.isActive,
      isSimplifiedVersion: this.isSimplifiedVersion,
      isHighlightMode: this.isHighlightMode
    };

    chrome.storage.local.set({ webReaderSettings: settings });
  }

  loadSettings() {
    chrome.storage.local.get(['webReaderSettings'], (result) => {
      if (result.webReaderSettings) {
        const settings = result.webReaderSettings;
        this.fontSize = settings.fontSize || 32;
        this.isHighContrast = settings.isHighContrast || false;
        this.isSidebarCollapsed = settings.isSidebarCollapsed || false;
        this.isSimplifiedVersion = settings.isSimplifiedVersion !== undefined ? settings.isSimplifiedVersion : true;
        // 重點模式不恢復，因為重點數據不會被保存，每次都需要重新處理
        this.isHighlightMode = false;

        document.documentElement.style.setProperty('--reader-font-size', `${this.fontSize}px`);

        // 不自動恢復active狀態，需要手動啟動
        // 注意：不恢復 isHighlightMode 狀態，因為重點數據不會被保存
      }
    });
  }
}

// 監聽來自background script的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let handled = false;

  if (message.action === 'startWithSelection' && message.selectedText) {
    if (window.webReader) {
      window.webReader.startWithSelectedContent(message.selectedText);
      handled = true;
    }
  } else if (message.action === 'toggleReader') {
    if (window.webReader) {
      window.webReader.toggleReader();
      handled = true;
    }
  } else if (message.action === 'adjustFont') {
    if (window.webReader) {
      window.webReader.adjustFontSize(message.delta);
      handled = true;
    }
  } else if (message.action === 'toggleContrast') {
    if (window.webReader) {
      window.webReader.toggleHighContrast();
      handled = true;
    }
  }

  // 明確回覆 popup，避免動作已成功卻被 Chrome 判為 message port 提前關閉。
  sendResponse({ ok: handled });
});

// 初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.webReader = new WebReader();
  });
} else {
  window.webReader = new WebReader();
}
