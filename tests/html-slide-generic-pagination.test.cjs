const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { FakeElement } = require('./helpers/fake-dom.cjs');

function loadWebReader() {
  const filename = path.resolve(__dirname, '../content.js');
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout
  };

  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  return sandbox.module.exports.WebReader;
}

const WebReader = loadWebReader();

function createReader() {
  return Object.create(WebReader.prototype);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function paragraph(index) {
  return new FakeElement({
    tagName: 'p',
    className: 'reader-paragraph',
    text: `第 ${index} 段本案依教育局來文辦理請各處室依權責於期限內完成並將辦理情形回報承辦人彙整`
  });
}

function listItem(index) {
  return new FakeElement({
    tagName: 'li',
    className: 'reader-list-item',
    text: `第 ${index} 項待辦事項請承辦人於期限內完成並回報辦理情形以利彙整`
  });
}

function tableCell(tagName, text) {
  return new FakeElement({
    tagName,
    className: tagName === 'th' ? 'reader-table-header' : 'reader-table-cell',
    text
  });
}

function tableRow(cells) {
  return new FakeElement({ tagName: 'tr', className: 'reader-table-row', children: cells });
}

// 讀者模式實際上是 #reader-main-content > div.reader-restructured-content > 內容元素，
// 因此所有 fixture 都刻意保留這層外殼。
function createReaderMainContent(children, wrapperClassName = 'reader-restructured-content') {
  return new FakeElement({
    tagName: 'div',
    attributes: { id: 'reader-main-content' },
    children: [new FakeElement({ tagName: 'div', className: wrapperClassName, children })]
  });
}

test('resolveHtmlSlideContentRoot 穿過單一外層容器找到真正的內容根節點', () => {
  const reader = createReader();
  const mainContent = createReaderMainContent([paragraph(1), paragraph(2), paragraph(3)]);

  const contentRoot = reader.resolveHtmlSlideContentRoot(mainContent);

  assert.notEqual(contentRoot, mainContent);
  assert.equal(contentRoot.className, 'reader-restructured-content');
  assert.equal(contentRoot.children.length, 3);
});

test('resolveHtmlSlideContentRoot 遇到多個子節點或非容器子節點就停住', () => {
  const reader = createReader();

  const multiChildRoot = new FakeElement({
    tagName: 'div',
    children: [paragraph(1), paragraph(2)]
  });
  assert.equal(reader.resolveHtmlSlideContentRoot(multiChildRoot), multiChildRoot);

  // 單一子節點是清單／表格容器時不可再往下鑽，否則單元會變成 li 或 tr。
  const listRoot = new FakeElement({
    tagName: 'div',
    children: [new FakeElement({
      tagName: 'ul',
      className: 'reader-list',
      children: [listItem(1), listItem(2)]
    })]
  });
  assert.equal(reader.resolveHtmlSlideContentRoot(listRoot), listRoot);

  const tableRoot = new FakeElement({
    tagName: 'div',
    children: [new FakeElement({
      tagName: 'div',
      className: 'reader-table-wrapper',
      children: [new FakeElement({ tagName: 'table', children: [tableRow([tableCell('td', '內容')])] })]
    })]
  });
  assert.equal(reader.resolveHtmlSlideContentRoot(tableRoot), tableRoot);
});

test('沒有 TOC 的長文會被切成多個單元，而不是整頁一個單元', () => {
  const reader = createReader();
  const mainContent = createReaderMainContent(
    Array.from({ length: 24 }, (_, index) => paragraph(index + 1))
  );

  const shallowUnits = reader.extractContentUnits(mainContent);
  assert.equal(shallowUnits.length, 1, '直接對 #reader-main-content 取單元只會得到外殼');

  const contentRoot = reader.createHtmlSlidePlanningRoot(mainContent);
  const units = reader.extractContentUnits(contentRoot);
  const plan = reader.createHeuristicHtmlSlidePlan(units);

  assert.equal(units.length, 24);
  assert.ok(plan.slides.length > 1, '長文應被切成多張投影片');
  assert.ok(reader.isStructurallyValidHtmlSlidePlan(plan, units));
});

test('createHtmlSlidePlanningRoot 只改離線副本，不動讀者畫面的 DOM', () => {
  const reader = createReader();
  const mainContent = createReaderMainContent([
    new FakeElement({
      tagName: 'ul',
      className: 'reader-list',
      children: Array.from({ length: 40 }, (_, index) => listItem(index + 1))
    })
  ]);
  const liveRoot = mainContent.children[0];

  const contentRoot = reader.createHtmlSlidePlanningRoot(mainContent);

  assert.notEqual(contentRoot, liveRoot);
  assert.equal(liveRoot.children.length, 1, '原始 DOM 仍只有一個清單');
  assert.equal(liveRoot.children[0].children.length, 40);
  assert.ok(contentRoot.children.length > 1, '副本上的過長清單被拆成相鄰兄弟節點');
});

test('過長清單被拆成相鄰清單，項目順序與總數不變', () => {
  const reader = createReader();
  const list = new FakeElement({
    tagName: 'ul',
    className: 'reader-list',
    children: Array.from({ length: 40 }, (_, index) => listItem(index + 1))
  });
  const root = new FakeElement({ tagName: 'div', children: [list] });

  const addedCount = reader.splitOversizedContentGroup(list, 900);

  assert.ok(addedCount >= 1);
  assert.equal(root.children.length, addedCount + 1);
  root.children.forEach(part => {
    assert.equal(part.tagName, 'UL');
    assert.ok(reader.estimateHtmlContentCost(part) <= 900);
  });

  const flattened = root.children.flatMap(part => part.children.map(item => item.textContent));
  assert.equal(flattened.length, 40);
  assert.deepEqual(
    plain(flattened),
    plain(Array.from({ length: 40 }, (_, index) => listItem(index + 1).textContent)),
    '拆分只能相鄰切開，不可重排或漏項'
  );
});

test('過長有序清單的續段沿用原本的編號', () => {
  const reader = createReader();
  const list = new FakeElement({
    tagName: 'ol',
    className: 'reader-list',
    children: Array.from({ length: 40 }, (_, index) => listItem(index + 1))
  });
  const root = new FakeElement({ tagName: 'div', children: [list] });

  reader.splitOversizedContentGroup(list, 900);

  assert.equal(root.children[0].getAttribute('start'), null);
  let expectedStart = 1 + root.children[0].children.length;
  root.children.slice(1).forEach(part => {
    assert.equal(part.getAttribute('start'), String(expectedStart));
    expectedStart += part.children.length;
  });
});

test('未達上限的清單不會被拆開', () => {
  const reader = createReader();
  const list = new FakeElement({
    tagName: 'ul',
    className: 'reader-list',
    children: [listItem(1), listItem(2)]
  });
  const root = new FakeElement({ tagName: 'div', children: [list] });

  assert.equal(reader.splitOversizedContentGroup(list, 900), 0);
  assert.equal(root.children.length, 1);
});

test('過長表格被切成續表，每段都重複表頭且列序不變', () => {
  const reader = createReader();
  const headerRow = tableRow([tableCell('th', '項次'), tableCell('th', '單位'), tableCell('th', '期限')]);
  const bodyRows = Array.from({ length: 30 }, (_, index) =>
    tableRow([
      tableCell('td', `第 ${index + 1} 列`),
      tableCell('td', '教務處負責辦理'),
      tableCell('td', '115-09-30')
    ])
  );
  const wrapper = new FakeElement({
    tagName: 'div',
    className: 'reader-table-wrapper',
    children: [new FakeElement({
      tagName: 'table',
      className: 'reader-table',
      children: [headerRow, ...bodyRows]
    })]
  });
  const root = new FakeElement({ tagName: 'div', children: [wrapper] });

  const addedCount = reader.splitOversizedTableUnit(wrapper, 900);

  assert.ok(addedCount >= 1);
  assert.equal(root.children.length, addedCount + 1);

  const bodyTexts = [];
  root.children.forEach(part => {
    assert.equal(part.className, 'reader-table-wrapper');
    const rows = part.querySelector('table').rows;
    assert.equal(rows[0].textContent, headerRow.textContent, '每段續表都要重複表頭');
    rows.slice(1).forEach(row => bodyTexts.push(row.textContent));
  });

  assert.equal(bodyTexts.length, 30);
  assert.deepEqual(plain(bodyTexts), plain(bodyRows.map(row => row.textContent)));
});

test('含 rowspan 的表格維持原子單元，不會被拆壞', () => {
  const reader = createReader();
  const headerRow = tableRow([tableCell('th', '項次'), tableCell('th', '說明')]);
  const spanCell = tableCell('td', '合併儲存格');
  spanCell.setAttribute('rowspan', '3');
  const bodyRows = Array.from({ length: 30 }, (_, index) =>
    tableRow([tableCell('td', `第 ${index + 1} 列教務處負責辦理`), tableCell('td', '115-09-30 前完成')])
  );
  bodyRows[0].appendChild(spanCell);

  const wrapper = new FakeElement({
    tagName: 'div',
    className: 'reader-table-wrapper',
    children: [new FakeElement({
      tagName: 'table',
      className: 'reader-table',
      children: [headerRow, ...bodyRows]
    })]
  });
  const root = new FakeElement({ tagName: 'div', children: [wrapper] });

  assert.equal(reader.splitOversizedTableUnit(wrapper, 900), 0);
  assert.equal(root.children.length, 1);
});

test('規劃器不會產生只有標題、沒有內容的投影片', () => {
  const reader = createReader();
  const units = [
    { index: 0, kind: 'heading', title: '出席與簽到', cost: 20 },
    { index: 1, kind: 'atomic', title: null, cost: 890, flags: ['table'] },
    { index: 2, kind: 'atomic', title: null, cost: 890, flags: ['table'] }
  ];

  const plan = reader.createHeuristicHtmlSlidePlan(units, { maxCost: 900 });

  assert.deepEqual(plain(plan.slides), [
    { start: 0, end: 1, title: '出席與簽到' },
    { start: 2, end: 2, title: null }
  ]);
});

test('連續標題會跟著後面的內容走，不會各自成頁', () => {
  const reader = createReader();
  const units = [
    { index: 0, kind: 'heading', title: '一、大標', cost: 200 },
    { index: 1, kind: 'heading', title: '(一) 小標', cost: 200 },
    { index: 2, kind: 'block', title: null, cost: 300 }
  ];

  const plan = reader.createHeuristicHtmlSlidePlan(units, { minCost: 160, maxCost: 900 });

  assert.deepEqual(plain(plan.slides), [
    { start: 0, end: 2, title: '一、大標' }
  ]);
});

test('零成本單元不會被當成整頁份量而誤切', () => {
  const reader = createReader();
  const units = [
    { index: 0, kind: 'block', title: null, cost: 300 },
    { index: 1, kind: 'block', title: null, cost: 0 },
    { index: 2, kind: 'block', title: null, cost: 300 }
  ];

  const plan = reader.createHeuristicHtmlSlidePlan(units, { maxCost: 900 });

  assert.deepEqual(plain(plan.slides), [
    { start: 0, end: 2, title: null }
  ]);
});

test('沒有標題的投影片標題留空，讓燈箱顯示「第 N 頁」而不是一排相同標題', () => {
  const reader = createReader();
  const units = Array.from({ length: 6 }, (_, index) => ({
    index,
    kind: 'block',
    title: null,
    cost: 400
  }));

  const plan = reader.createHeuristicHtmlSlidePlan(units, { maxCost: 900 });

  assert.ok(plan.slides.length > 1);
  plan.slides.forEach(slide => assert.equal(slide.title, null));
});

// ---------------------------------------------------------------------------
// 版面成本模型（以渲染行數為單位）
// 常數由 1536x739 的 Chrome 實測校準；沒有 window 時會落到同一組預設值，
// 所以下面的期望值是可決定的。
// ---------------------------------------------------------------------------

test('沒有 window 時版面度量落在校準過的預設值上', () => {
  const reader = createReader();
  const layout = reader.getHtmlSlideLayoutMetrics();

  assert.equal(layout.lineCost, 80);
  assert.equal(layout.charsPerLine, 47);
  assert.equal(layout.contentHeight, 605);
  assert.equal(layout.blockCost, 24);
  assert.equal(layout.listItemCost, 15);
  assert.equal(layout.tableRowCost, 38);
  assert.equal(layout.tableCost, 34);
});

test('分頁預算由可視內容高度換算，不是寫死的常數', () => {
  const reader = createReader();
  const layout = reader.getHtmlSlideLayoutMetrics();
  const budget = reader.getHtmlSlidePlanBudget();

  assert.equal(budget.maxCost, Math.round(layout.contentHeight * layout.costPerPixel * 0.95));
  assert.equal(budget.targetCost, Math.round(budget.maxCost * 0.75));
  assert.ok(budget.maxCost > 1000 && budget.maxCost < 1200);
  // 呼叫端仍可覆寫。
  assert.equal(reader.getHtmlSlidePlanBudget({ maxCost: 400 }).maxCost, 400);
});

test('成本以渲染行數計算：兩個短段落比一個等長的長段落貴', () => {
  const reader = createReader();
  const shortText = '甲'.repeat(30);
  const twoShortBlocks = new FakeElement({
    tagName: 'div',
    children: [
      new FakeElement({ tagName: 'p', className: 'reader-paragraph', text: shortText }),
      new FakeElement({ tagName: 'p', className: 'reader-paragraph', text: shortText })
    ]
  });
  const oneLongBlock = new FakeElement({
    tagName: 'div',
    children: [
      new FakeElement({ tagName: 'p', className: 'reader-paragraph', text: '甲'.repeat(60) })
    ]
  });

  // 每段 30 字 -> 各佔 1 行：2 * (80 + 24) = 208
  assert.equal(reader.estimateHtmlContentCost(twoShortBlocks), 208);
  // 一段 60 字 -> 佔 2 行：160 + 24 = 184
  assert.equal(reader.estimateHtmlContentCost(oneLongBlock), 184);
  assert.ok(
    reader.estimateHtmlContentCost(twoShortBlocks) > reader.estimateHtmlContentCost(oneLongBlock),
    '字數相同但區塊較多時，實際佔用的高度較高'
  );
});

test('清單項目的邊界成本低於段落', () => {
  const reader = createReader();
  const text = '甲'.repeat(30);
  const item = new FakeElement({ tagName: 'li', className: 'reader-list-item', text });
  const block = new FakeElement({ tagName: 'p', className: 'reader-paragraph', text });

  assert.equal(reader.estimateHtmlContentCost(item), 95);
  assert.equal(reader.estimateHtmlContentCost(block), 104);
});

test('表格成本 = 表格邊界 + 每列（文字行 + 儲存格內距）', () => {
  const reader = createReader();
  const row = () => tableRow([tableCell('td', '短內容'), tableCell('td', '教務處'), tableCell('td', '115-09-30')]);
  const wrapper = new FakeElement({
    tagName: 'div',
    className: 'reader-table-wrapper',
    children: [new FakeElement({
      tagName: 'table',
      className: 'reader-table',
      children: [row(), row(), row()]
    })]
  });

  // 34 (表格邊界) + 3 * (80 + 38)
  assert.equal(reader.estimateHtmlContentCost(wrapper), 388);
});

test('表格列會依欄位分到的寬度換行', () => {
  const reader = createReader();
  const narrow = tableRow([tableCell('td', '甲'.repeat(40)), tableCell('td', '短')]);
  const wide = tableRow([tableCell('td', '甲'.repeat(40))]);

  // 兩欄時每格只分到約 23 字寬，40 字要 2 行；單欄時 47 字寬，1 行就夠。
  assert.equal(reader.estimateTableRowLayoutCost(narrow), 2 * 80 + 38);
  assert.equal(reader.estimateTableRowLayoutCost(wide), 80 + 38);
});

test('仍留在內文裡的標題不會被當成已移除而誤補償', () => {
  const reader = createReader();
  const sourceRoot = new FakeElement({ tagName: 'div', text: '示意圖 1 說明文字' });

  const removed = reader.getMatchedHtmlSlideTitleTextLength(
    [{ title: '示意圖 1', content: new FakeElement({ tagName: 'div', text: '說明文字' }) }],
    '示意圖 1 說明文字'
  );
  const stillPresent = reader.getMatchedHtmlSlideTitleTextLength(
    [{ title: '示意圖 1', content: new FakeElement({ tagName: 'div', text: '示意圖 1 說明文字' }) }],
    '示意圖 1 說明文字'
  );

  assert.equal(removed, '示意圖 1'.length);
  assert.equal(stillPresent, 0);

  const metrics = reader.calculateHtmlSlideQualityMetrics(
    [{ title: '示意圖 1', content: new FakeElement({ tagName: 'div', text: '示意圖 1 說明文字' }) }],
    sourceRoot,
    'test-plan'
  );
  assert.equal(metrics.possibleTextMismatch, false);
});

// ---------------------------------------------------------------------------
// 媒體成本：依原始比例估算，並套用 .reader-image 的 max-height: 70vh 上限
// ---------------------------------------------------------------------------

function createFigure(width, height, captionText = null) {
  const image = new FakeElement({ tagName: 'img', className: 'reader-image' });
  if (width) image.naturalWidth = width;
  if (height) image.naturalHeight = height;
  const children = [image];
  if (captionText) {
    children.push(new FakeElement({ tagName: 'figcaption', text: captionText }));
  }
  return new FakeElement({ tagName: 'figure', className: 'reader-media', children });
}

test('圖片成本依原始比例估算，而不是固定值', () => {
  const reader = createReader();
  const layout = reader.getHtmlSlideLayoutMetrics();

  // 1600x400：寬度被 bodyWidth 壓到 1416，高度等比縮成 354，沒碰到 70vh 上限。
  const wide = createFigure(1600, 400);
  const expectedWide = Math.round(400 * (layout.bodyWidth / 1600) * layout.costPerPixel) +
    layout.mediaMarginCost;
  assert.equal(reader.estimateHtmlContentCost(wide), expectedWide);

  // 同樣的高度換成更窄的圖，成本應該更高（縮放比例不同）。
  const narrow = createFigure(400, 400);
  assert.ok(reader.estimateHtmlContentCost(narrow) > reader.estimateHtmlContentCost(wide));
});

test('高圖成本被 max-height: 70vh 夾住，不會照原始比例無限長高', () => {
  const reader = createReader();
  const layout = reader.getHtmlSlideLayoutMetrics();
  const tall = createFigure(800, 1000);
  const taller = createFigure(800, 4000);

  const capped = Math.round(layout.maxMediaHeight * layout.costPerPixel) + layout.mediaMarginCost;
  assert.equal(reader.estimateHtmlContentCost(tall), capped);
  assert.equal(reader.estimateHtmlContentCost(taller), capped, '更高的圖不會更貴，因為被上限夾住');
});

test('圖說文字算在媒體成本裡', () => {
  const reader = createReader();
  const withCaption = reader.estimateHtmlContentCost(createFigure(960, 540, '示意圖 1'));
  const withoutCaption = reader.estimateHtmlContentCost(createFigure(960, 540));

  assert.equal(withCaption - withoutCaption, 104, '一行圖說 = lineCost + blockCost');
});

test('讀不到圖片尺寸時退回保底的媒體成本', () => {
  const reader = createReader();
  const layout = reader.getHtmlSlideLayoutMetrics();
  const unknown = createFigure(null, null);

  assert.equal(reader.estimateHtmlContentCost(unknown), layout.mediaCost);
});

test('copyRenderedMediaSizes 把畫面上已載入的圖片尺寸抄到離線副本', () => {
  const reader = createReader();
  const liveRoot = new FakeElement({
    tagName: 'div',
    children: [createFigure(960, 540), createFigure(800, 1000)]
  });
  const workingRoot = liveRoot.cloneNode(true);

  // 副本的 <img> 還沒解碼，讀不到原始尺寸，只能拿到保底值。
  const beforeCost = reader.estimateHtmlContentCost(workingRoot.children[0]);
  assert.equal(beforeCost, reader.getHtmlSlideLayoutMetrics().mediaCost);

  reader.copyRenderedMediaSizes(liveRoot, workingRoot);

  assert.equal(workingRoot.querySelectorAll('img')[0].dataset.readerMediaWidth, '960');
  assert.equal(workingRoot.querySelectorAll('img')[1].dataset.readerMediaHeight, '1000');
  assert.equal(
    reader.estimateHtmlContentCost(workingRoot.children[0]),
    reader.estimateHtmlContentCost(liveRoot.children[0])
  );
});

test('圖說只有在整張投影片就是那張圖時才拿來當標題', () => {
  const reader = createReader();
  const figureUnit = { index: 1, kind: 'atomic', title: '示意圖 1', cost: 1166, flags: ['media'] };
  const paragraphUnit = { index: 0, kind: 'block', title: null, cost: 184 };
  const headingUnit = { index: 0, kind: 'heading', title: '一、說明', cost: 40 };

  assert.equal(reader.getHtmlSlidePlanTitle([figureUnit]), '示意圖 1');
  assert.equal(reader.getHtmlSlidePlanTitle([paragraphUnit, figureUnit]), null);
  assert.equal(reader.getHtmlSlidePlanTitle([headingUnit, figureUnit]), '一、說明');
});
