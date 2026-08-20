const assert = require('node:assert/strict');
const test = require('node:test');

const { WebReader } = require('../content.js');

function createParser() {
  return Object.create(WebReader.prototype);
}

test('parses the requested Gemini dual-output headings', () => {
  const parser = createParser();
  const result = parser.parseGeminiDualOutput([
    '## 格式化版本',
    '# 會議標題',
    '- 請完成交接',
    '',
    '## 重點標記版本',
    '# 會議標題',
    '- ==請完成交接=='
  ].join('\n'));

  assert.equal(result.formatted, '# 會議標題\n- 請完成交接');
  assert.equal(result.highlighted, '# 會議標題\n- ==請完成交接==');
});

test('accepts Gemini heading variants without leaking them into meeting content', () => {
  const parser = createParser();
  const result = parser.parseGeminiDualOutput([
    '```markdown',
    '## 完整格式化版本',
    '# 0623主任會議',
    '- 6/25 辦理會議',
    '',
    '**重點版本：**',
    '# 0623主任會議',
    '- ==6/25 辦理會議==',
    '```',
    ''
  ].join('\n'));

  assert.equal(result.formatted, '# 0623主任會議\n- 6/25 辦理會議');
  assert.equal(result.highlighted, '# 0623主任會議\n- ==6/25 辦理會議==');
  assert.doesNotMatch(result.formatted, /完整格式化版本/);
  assert.doesNotMatch(result.highlighted, /重點版本/);
});

test('keeps product uncertainty language out of model highlight prompts', () => {
  const reader = createParser();
  const prompts = [
    reader.createGeminiPrompt('會議內容', true),
    reader.createGeminiPrompt('會議內容', false),
    reader.createHighlightPrompt('會議內容', true),
    reader.createHighlightPrompt('會議內容', false),
    reader.createCategorizedHighlightPrompt('會議內容')
  ];

  for (const prompt of prompts) {
    assert.doesNotMatch(prompt, /不是唯一答案|沒有唯一的標準重點|保守判斷|採保守標示|寧可少標/);
  }
});

test('classified highlight prompt keeps AI original markings source-only', () => {
  const reader = createParser();
  const prompt = reader.createCategorizedHighlightPrompt('請至學務處進行導護交接會議');

  assert.match(prompt, /\[\[topic:主題短語\]\]/);
  assert.match(prompt, /不得刪除、增加、改寫、重排或更正任何文字/);
  assert.match(prompt, /編號項目、條列項目、換行分隔的事項/);
  assert.match(prompt, /每個獨立段落最多標示 1 個主題/);
  assert.match(prompt, /導護交接/);
  assert.match(prompt, /全校大掃除/);
  assert.match(prompt, /資源回收/);
  assert.match(prompt, /休業式/);
  assert.doesNotMatch(prompt, /topicLabel|主題：/);
});

test('extracts classified highlight markers with one topic per paragraph', () => {
  const reader = createParser();
  const annotations = reader.extractClassifiedHighlightSegments([
    '請[[time:第十九週(1/3-01/09)]]值勤老師，於[[time:114/1/2(四)10:20]]至[[location:學務處]]進行[[topic:導護交接]]會議，並再次[[topic:導護交接]]。',
    '',
    '請至[[地點:正門]]辦理[[主題:交通管制]]，時間為[[時間:放學時間]]。'
  ].join('\n'));

  assert.deepEqual(annotations, [
    { type: 'time', segment: '第十九週(1/3-01/09)' },
    { type: 'time', segment: '114/1/2(四)10:20' },
    { type: 'location', segment: '學務處' },
    { type: 'topic', segment: '導護交接' },
    { type: 'location', segment: '正門' },
    { type: 'topic', segment: '交通管制' },
    { type: 'time', segment: '放學時間' }
  ]);
});

test('extracts one topic from each line-separated meeting item', () => {
  const reader = createParser();
  const annotations = reader.extractClassifiedHighlightSegments([
    '[[time:本週四]][[topic:兒童週會]]，要頒發感謝獎狀。',
    '[[time:本週四]][[topic:全校大掃除]]，時間：[[time:9:30-10:10]]。',
    '[[time:本週五]][[topic:資源回收]]是學期最後一次。',
    '[[time:下週二]][[topic:休業式]]重點頒發學期前茅獎。'
  ].join('\n'));

  assert.deepEqual(
    annotations.filter(item => item.type === 'topic').map(item => item.segment),
    ['兒童週會', '全校大掃除', '資源回收', '休業式']
  );
});

test('renders classified inline highlight markers with distinct classes', () => {
  const reader = createParser();
  reader.escapeHtml = text => String(text);
  const html = reader.processHighlightFormatting(
    '於[[time:114/1/2(四)10:20]]至[[location:學務處]]進行[[topic:導護交接]]會議'
  );

  assert.match(html, /reader-highlight-topic/);
  assert.match(html, /reader-highlight-time/);
  assert.match(html, /reader-highlight-location/);
  assert.doesNotMatch(html, /\[\[/);
});

test('maps text index at node boundary to the following text node', () => {
  const reader = createParser();
  const first = { nodeValue: '本週四' };
  const second = { nodeValue: '兒童週會' };

  const position = reader.findDomPositionForTextIndex([first, second], first.nodeValue.length);

  assert.equal(position.node, second);
  assert.equal(position.offset, 0);
});

test('detects ESA edit metadata lines for muted display and AI exclusion', () => {
  const reader = createParser();

  assert.equal(
    reader.isEsaMetadataText('(教務處 陳麗如 於 115-06-09 07:58 新增 / 115-06-09 08:19 修改)'),
    true
  );
  assert.equal(reader.isEsaMetadataText('1.114學年度王延生女士獎助學金'), false);
});

test('AI processing cache helpers keep stable hashes and prune old entries', () => {
  const reader = createParser();
  reader.aiCacheVersion = 1;
  reader.aiCachePromptVersion = 'test-prompt';

  assert.equal(reader.hashString('同一份內容'), reader.hashString('同一份內容'));
  assert.notEqual(reader.hashString('同一份內容'), reader.hashString('另一份內容'));

  const pruned = reader.pruneAIProcessingCacheStore({
    a: { createdAt: '2026-08-20T00:00:00.000Z' },
    b: { createdAt: '2026-08-20T00:00:02.000Z' },
    c: { createdAt: '2026-08-20T00:00:01.000Z' }
  }, 2);

  assert.deepEqual(Object.keys(pruned), ['b', 'c']);
  assert.equal(reader.isValidAIProcessingCacheEntry({
    cacheKey: 'key',
    cacheVersion: 1,
    promptVersion: 'test-prompt',
    simplifiedContentHtml: '<div></div>',
    originalContentHtml: '<div></div>'
  }, 'key'), true);
});

test('normalizes duplicated markdown heading markers from AI output', () => {
  const reader = createParser();
  const heading = reader.parseMarkdownHeadingLine('### # 1.1 教務處工作報告');

  assert.deepEqual(heading, {
    level: 3,
    text: '1.1 教務處工作報告'
  });
});

test('infers ESA heading hierarchy for AI generated table of contents', () => {
  const reader = createParser();

  assert.equal(reader.parseMarkdownHeadingLine('### 一、教務主任').level, 2);
  assert.equal(reader.parseMarkdownHeadingLine('### 2.1 學務處報告').level, 3);
  assert.equal(reader.parseMarkdownHeadingLine('# 0623主任會議').level, 1);
});

test('transfers highlight markers back onto the accepted formatted text', () => {
  const reader = createParser();
  const formatted = [
    '# 0623主任會議',
    '- 請於 6/25 辦理獎助學金感恩餐會。',
    '- 學務處報告維持原字。'
  ].join('\n');
  const highlighted = [
    '# 0623主任會議',
    '- ==請於 6/25 辦理獎助學金感恩餐會==。',
    '- 学務處報告維持原字。'
  ].join('\n');

  const result = reader.transferHighlightMarkers(formatted, highlighted);

  assert.match(result, /==請於 6\/25 辦理獎助學金感恩餐會==/);
  assert.equal(reader.normalizeAIComparableText(result), reader.normalizeAIComparableText(formatted));
});

test('extracts original ESA headings for AI original heading repair', () => {
  const reader = createParser();
  const sourceText = [
    '0623主任會議 (主任會議)',
    '',
    '一、教務主任 1.1 教務處工作報告 (教務處 陳麗如 於 115-06-26 10:14 新增 / 115-06-26 10:15 修改) 1.本週進行代理教師甄試。',
    '',
    '二、學務主任 2.1 學務處報告 (學務處 巫靜雯 於 115-06-22 17:16 新增 / 115-06-22 17:17 修改) 本週四兒童週會。'
  ].join('\n');

  assert.deepEqual(reader.extractOriginalHeadings(sourceText), [
    { level: 1, text: '0623主任會議 (主任會議)' },
    { level: 2, text: '一、教務主任' },
    { level: 2, text: '二、學務主任' },
    { level: 3, text: '1.1 教務處工作報告 (教務處 陳麗如 於 115-06-26 10:14 新增 / 115-06-26 10:15 修改)' },
    { level: 3, text: '2.1 學務處報告 (學務處 巫靜雯 於 115-06-22 17:16 新增 / 115-06-22 17:17 修改)' }
  ]);
});

test('shows only department headings in AI original table of contents', () => {
  const reader = createParser();
  reader.isOfflineMode = false;
  reader.currentFormatMode = 'AI';
  reader.isSimplifiedVersion = false;
  reader.tableOfContents = [
    { level: 1, text: '0623主任會議 (主任會議)' },
    { level: 2, text: '一、教務主任' },
    { level: 3, text: '1.1 教務處工作報告' },
    { level: 2, text: '二、學務主任' },
    { level: 3, text: '2.1 學務處報告' }
  ];

  assert.deepEqual(reader.getTableOfContentsDisplayItems().map(entry => entry.item.text), [
    '一、教務主任',
    '二、學務主任'
  ]);
  assert.deepEqual(reader.getTableOfContentsDisplayItems().map(entry => entry.sectionIndex), [1, 3]);
});

test('keeps full table of contents outside AI original mode', () => {
  const reader = createParser();
  reader.isOfflineMode = true;
  reader.currentFormatMode = 'Manual';
  reader.isSimplifiedVersion = false;
  reader.tableOfContents = [
    { level: 1, text: '0623主任會議 (主任會議)' },
    { level: 2, text: '一、教務主任' },
    { level: 3, text: '1.1 教務處工作報告' }
  ];

  assert.deepEqual(reader.getTableOfContentsDisplayItems().map(entry => entry.item.text), [
    '0623主任會議 (主任會議)',
    '一、教務主任',
    '1.1 教務處工作報告'
  ]);
});

test('uses stored offline toc skeleton only for AI original mode', () => {
  const reader = createParser();
  reader.isOfflineMode = false;
  reader.currentFormatMode = 'AI';
  reader.offlineTocSkeleton = [{ text: '一、教務主任', level: 2 }];

  reader.isSimplifiedVersion = false;
  assert.equal(reader.shouldUseStoredTocSkeleton(), true);

  reader.isSimplifiedVersion = true;
  assert.equal(reader.shouldUseStoredTocSkeleton(), false);
});

test('rejects long paragraph-like headings as AI original department toc items', () => {
  const reader = createParser();

  assert.equal(reader.isDepartmentTocText('一、教務處'), true);
  assert.equal(reader.isDepartmentTocText('二、學務主任'), true);
  assert.equal(
    reader.isDepartmentTocText('一、本週6/12(五)六年級畢業，校園環境要大家共同維護'),
    false
  );
});

test('maps offline department headings to numeric AI subsection anchors', () => {
  const reader = createParser();

  assert.equal(reader.getDepartmentNumberFromHeading('四、輔導處'), 4);
  assert.equal(reader.getDepartmentNumberFromHeading('十、幼兒園'), 10);
  assert.equal(reader.getDepartmentNumberFromHeading('十二、補充事項'), 12);
  assert.equal(reader.getLeadingNumericSectionNumber('4.1 輔導組'), 4);
  assert.equal(reader.getLeadingNumericSectionNumber('5.1 人事室報告'), 5);
});

test('best API routes Gemini through truncation recovery wrapper', async () => {
  const reader = createParser();
  reader.getModelPriority = async () => ['gemini'];

  let received = null;
  reader.processWithGeminiAPI = async (text, isSimplified) => {
    received = { text, isSimplified };
    return { ok: true };
  };

  const result = await reader.processWithBestAPI('教師週會內容', false);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(received, {
    text: '教師週會內容',
    isSimplified: false
  });
  assert.equal(reader.currentFormatMode, 'AI');
});

test('Gemini truncation retries with a larger output token budget', async () => {
  const reader = createParser();
  reader.getUserPreferredModel = async () => 'gemini-3.5-flash';
  reader.getModelPriorityList = () => ['gemini-3.5-flash'];

  const outputBudgets = [];
  reader.makeGeminiAPICall = async (_apiKey, _text, _modelName, _isSimplified, maxOutputTokens) => {
    outputBudgets.push(maxOutputTokens);

    if (maxOutputTokens === 16000) {
      const error = new Error('輸出被截斷');
      error.isTruncated = true;
      throw error;
    }

    return { ok: true };
  };

  const result = await reader.processWithGeminiAPIInternal('教師週會內容', null, true);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(outputBudgets, [16000, 32000]);
});

test('Gemini wrapper falls back to smaller chunks after truncation', async () => {
  const reader = createParser();
  reader.isSimplifiedVersion = true;
  reader.processWithGeminiAPIInternal = async () => {
    const error = new Error('輸出被截斷');
    error.isTruncated = true;
    throw error;
  };

  let chunkArgs = null;
  reader.processWithGeminiAPIInChunks = async (text, apiKey, isSimplified, maxChunkSize) => {
    chunkArgs = { text, apiKey, isSimplified, maxChunkSize };
    return { ok: true };
  };

  const result = await reader.processWithGeminiAPI('教師週會內容', false);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(chunkArgs, {
    text: '教師週會內容',
    apiKey: null,
    isSimplified: false,
    maxChunkSize: 4000
  });
});

test('AI original stage reuses offline content and only requests highlights', async () => {
  const reader = createParser();
  const baseContent = { kind: 'offline-clone' };
  const highlightedContent = { kind: 'highlighted-offline-clone' };
  let highlightCall = null;
  let completed = false;

  reader.updateAIProcessButtonState = () => {};
  reader.updateProcessingStatus = () => {};
  reader.createAIOriginalBaseContent = () => baseContent;
  reader.processSingleModeWithHighlights = async () => {
    throw new Error('AI original reformatting should not be called');
  };
  reader.processHighlightForVersion = async (apiKey, contentElement, isSimplified, options) => {
    highlightCall = { apiKey, contentElement, isSimplified, options };
    return highlightedContent;
  };
  reader.handleSecondStageComplete = () => {
    completed = true;
  };

  await reader.startSecondStage();

  assert.equal(reader.originalFormattedContent, baseContent);
  assert.equal(reader.originalHighlighted, highlightedContent);
  assert.equal(reader.highlightData.original, highlightedContent);
  assert.equal(reader.isAIProcessing, false);
  assert.equal(completed, true);
  assert.deepEqual(highlightCall, {
    apiKey: null,
    contentElement: baseContent,
    isSimplified: false,
    options: {
      preserveSourceDom: true,
      maxOutputTokens: 32000
    }
  });
});
