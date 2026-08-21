const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { FakeElement, createFakeDocument } = require('./helpers/fake-dom.cjs');

function loadWebReader() {
  const filename = path.resolve(__dirname, '../content.js');
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
    // 沒有 window，版面度量會落到校準過的預設值，期望值才是可決定的。
    document: createFakeDocument()
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

// ---------------------------------------------------------------------------
// ESA：把表格內的區段標題列提到頂層，讓區段邊界能用 children 索引定址
// ---------------------------------------------------------------------------

function sectionRow(title) {
  const cell = new FakeElement({
    tagName: 'td',
    className: 'reader-table-cell reader-header reader-h2 reader-table-section',
    text: title
  });
  return new FakeElement({ tagName: 'tr', className: 'reader-table-row', children: [cell] });
}

function caseRow(index) {
  return tableRow([
    tableCell('td', `案由 ${index}`),
    tableCell('td', '承辦單位'),
    tableCell('td', '請於期限內完成並回報辦理情形')
  ]);
}

function createEsaTableWrapper(departments, leadingRows = []) {
  const rows = [...leadingRows];
  departments.forEach(name => {
    rows.push(sectionRow(name));
    for (let index = 1; index <= 2; index++) rows.push(caseRow(index));
  });
  return new FakeElement({
    tagName: 'div',
    className: 'reader-table-wrapper',
    children: [new FakeElement({ tagName: 'table', className: 'reader-table', children: rows })]
  });
}

test('表格內的區段標題列被提成頂層 <h2> + 續表，順序不變', () => {
  const reader = createReader();
  const wrapper = createEsaTableWrapper(['一、教務處', '二、學務處', '三、總務處']);
  const root = new FakeElement({ tagName: 'div', children: [wrapper] });

  reader.splitTableAtSectionRows(wrapper);

  const shape = root.children.map(child => ({
    tag: child.tagName,
    text: child.tagName === 'H2'
      ? child.textContent
      : child.textContent.replace(/\s+/g, ' ').trim().slice(0, 4)
  }));
  assert.deepEqual(plain(shape), [
    { tag: 'H2', text: '一、教務處' },
    { tag: 'DIV', text: '案由 1' },
    { tag: 'H2', text: '二、學務處' },
    { tag: 'DIV', text: '案由 1' },
    { tag: 'H2', text: '三、總務處' },
    { tag: 'DIV', text: '案由 1' }
  ]);

  // 區段標題只能出現一次：搬到 <h2> 之後，原本那一列要消失。
  assert.equal(root.textContent.split('一、教務處').length - 1, 1);

  // 提出來的標題是真的 heading 單元，續表不再夾帶別的區段。
  const units = reader.extractContentUnits(root);
  assert.deepEqual(plain(units.map(unit => unit.kind)),
    ['heading', 'atomic', 'heading', 'atomic', 'heading', 'atomic']);
  assert.deepEqual(plain(units.filter(unit => unit.kind === 'heading').map(unit => unit.title)),
    ['一、教務處', '二、學務處', '三、總務處']);
});

test('第一個區段標題之前的列留在原本的表格裡', () => {
  const reader = createReader();
  const leading = [caseRow(97), caseRow(98)];
  const wrapper = createEsaTableWrapper(['一、教務處'], leading);
  const root = new FakeElement({ tagName: 'div', children: [wrapper] });

  reader.splitTableAtSectionRows(wrapper);

  assert.equal(root.children[0], wrapper, '原表格保留在原位');
  assert.equal(wrapper.querySelector('table').rows.length, 2, '只留下區段標題前的列');
  assert.match(wrapper.textContent, /案由 97/);
  assert.equal(root.children[1].tagName, 'H2');
  assert.equal(root.children[1].textContent, '一、教務處');
});

test('沒有區段標題列的表格完全不動', () => {
  const reader = createReader();
  const wrapper = new FakeElement({
    tagName: 'div',
    className: 'reader-table-wrapper',
    children: [new FakeElement({
      tagName: 'table',
      className: 'reader-table',
      children: [caseRow(1), caseRow(2), caseRow(3)]
    })]
  });
  const root = new FakeElement({ tagName: 'div', children: [wrapper] });

  assert.equal(reader.splitTableAtSectionRows(wrapper), 0);
  assert.equal(root.children.length, 1);
  assert.equal(wrapper.querySelector('table').rows.length, 3);
});

test('含 rowspan 的表格不做區段切分，維持原子單元', () => {
  const reader = createReader();
  const wrapper = createEsaTableWrapper(['一、教務處', '二、學務處']);
  const spanned = wrapper.querySelector('table').rows[1].cells[0];
  spanned.setAttribute('rowspan', '2');
  const root = new FakeElement({ tagName: 'div', children: [wrapper] });

  assert.equal(reader.splitTableAtSectionRows(wrapper), 0);
  assert.equal(root.children.length, 1);
});

test('區段切分讓規劃器切在處室邊界，而不是切在列數預算上', () => {
  const reader = createReader();
  const departments = ['一、教務處', '二、學務處', '三、總務處'];
  const mainContent = createReaderMainContent([createEsaTableWrapper(departments)]);

  const contentRoot = reader.createHtmlSlidePlanningRoot(mainContent);
  const units = reader.extractContentUnits(contentRoot);
  const plan = reader.validateAndRepairHtmlSlidePlan(
    reader.createHeuristicHtmlSlidePlan(units),
    units,
    reader.createSingleHtmlSlidePlan(units)
  );

  assert.ok(reader.isStructurallyValidHtmlSlidePlan(plan, units));
  // 每一張投影片最多只能碰到一個處室，內容不可以掛到別的處室標題底下。
  plan.slides.forEach(slide => {
    const text = reader.getHtmlSlideUnitsInRange(units, slide.start, slide.end)
      .map(unit => `${unit.title || ''} ${unit.preview || ''}`)
      .join(' ');
    const touched = departments.filter(name => text.includes(name));
    assert.ok(touched.length <= 1, `一張投影片碰到多個處室: ${touched.join(', ')}`);
  });
  assert.deepEqual(
    plain(plan.slides.map(slide => slide.title)),
    plain(departments),
    '每個處室各自成頁，標題與內容一致'
  );
});

test('處室標題優先當頁名，前面的泛用標題不會把它從導覽中擠掉', () => {
  const reader = createReader();
  const withDepartment = [
    { index: 0, kind: 'heading', title: '會議事項', cost: 104, flags: [] },
    { index: 1, kind: 'heading', title: '一、教務處', cost: 104, flags: ['department'] },
    { index: 2, kind: 'atomic', title: null, cost: 506, flags: ['table'] }
  ];
  const withoutDepartment = [
    { index: 0, kind: 'heading', title: '會議事項', cost: 104, flags: [] },
    { index: 1, kind: 'heading', title: '背景說明', cost: 104, flags: [] }
  ];

  assert.equal(reader.getHtmlSlidePlanTitle(withDepartment), '一、教務處');
  assert.equal(reader.getHtmlSlidePlanTitle(withoutDepartment), '會議事項');
});

// ---------------------------------------------------------------------------
// TOC 邊界改走 plan 路徑，表達不了時退回 Range 路徑
// ---------------------------------------------------------------------------

function tocEntry(text, sectionIndex) {
  return { item: { text, level: 2 }, sectionIndex };
}

test('createTocHtmlSlidePlan 把 TOC 項目對回頂層標題，並覆蓋所有單元', () => {
  const reader = createReader();
  const units = [
    { index: 0, kind: 'heading', title: '會議事項', cost: 104, flags: [] },
    { index: 1, kind: 'heading', title: '一、教務處', cost: 104, flags: ['department'] },
    { index: 2, kind: 'atomic', title: null, cost: 506, flags: ['table'] },
    { index: 3, kind: 'heading', title: '二、學務處', cost: 104, flags: ['department'] },
    { index: 4, kind: 'atomic', title: null, cost: 506, flags: ['table'] }
  ];
  const entries = [tocEntry('一、教務處', 1), tocEntry('二、學務處', 3)];

  const plan = reader.createTocHtmlSlidePlan(entries, units);

  assert.equal(plan.strategy, 'toc-plan');
  assert.deepEqual(plain(plan.slides), [
    { start: 0, end: 0, title: '會議資訊' },
    { start: 1, end: 2, title: '一、教務處' },
    { start: 3, end: 4, title: '二、學務處' }
  ]);
  assert.ok(reader.isStructurallyValidHtmlSlidePlan(plan, units));
});

test('TOC 項目在頂層找不到對應標題時回傳 null，讓呼叫端退回 Range 路徑', () => {
  const reader = createReader();
  // 區段標題還埋在表格裡（例如含 rowspan 沒被提出來），頂層只有一個原子單元。
  const units = [
    { index: 0, kind: 'heading', title: '會議事項', cost: 104, flags: [] },
    { index: 1, kind: 'atomic', title: null, cost: 1500, flags: ['table'] }
  ];
  const entries = [tocEntry('一、教務處', 1), tocEntry('二、學務處', 2)];

  assert.equal(reader.createTocHtmlSlidePlan(entries, units), null);
});

test('TOC 項目順序對不上頂層標題順序時也退回 Range 路徑', () => {
  const reader = createReader();
  const units = [
    { index: 0, kind: 'heading', title: '一、教務處', cost: 104, flags: ['department'] },
    { index: 1, kind: 'atomic', title: null, cost: 506, flags: ['table'] },
    { index: 2, kind: 'heading', title: '二、學務處', cost: 104, flags: ['department'] },
    { index: 3, kind: 'atomic', title: null, cost: 506, flags: ['table'] }
  ];
  const reversed = [tocEntry('二、學務處', 2), tocEntry('一、教務處', 0)];

  assert.equal(reader.createTocHtmlSlidePlan(reversed, units), null);
});

test('第一個 TOC 項目就是第一個單元時不另外產生前言頁', () => {
  const reader = createReader();
  const units = [
    { index: 0, kind: 'heading', title: '一、教務處', cost: 104, flags: ['department'] },
    { index: 1, kind: 'atomic', title: null, cost: 506, flags: ['table'] }
  ];

  const plan = reader.createTocHtmlSlidePlan([tocEntry('一、教務處', 0)], units);

  assert.deepEqual(plain(plan.slides), [{ start: 0, end: 1, title: '一、教務處' }]);
});

test('過長的 TOC 段落被拆開，續頁沿用原標題並編號', () => {
  const reader = createReader();
  const units = [
    { index: 0, kind: 'heading', title: '一、教務處', cost: 104, flags: ['department'] },
    { index: 1, kind: 'atomic', title: null, cost: 900, flags: ['table'] },
    { index: 2, kind: 'atomic', title: null, cost: 900, flags: ['table'] },
    { index: 3, kind: 'atomic', title: null, cost: 900, flags: ['table'] }
  ];
  const tocPlan = reader.createTocHtmlSlidePlan([tocEntry('一、教務處', 0)], units);

  const plan = reader.validateAndRepairHtmlSlidePlan(tocPlan, units, null, { maxCost: 1080 });

  assert.equal(plan.strategy, 'toc-plan-repaired');
  assert.deepEqual(plain(plan.slides.map(slide => slide.title)), [
    '一、教務處',
    '一、教務處（續 1）',
    '一、教務處（續 2）'
  ]);
  assert.ok(reader.isStructurallyValidHtmlSlidePlan(plan, units));
});

test('只有一個續頁時不加編號', () => {
  const reader = createReader();
  assert.equal(reader.getContinuedHtmlSlideTitle('一、教務處', 1, 1), '一、教務處（續）');
  assert.equal(reader.getContinuedHtmlSlideTitle('一、教務處', 2, 3), '一、教務處（續 2）');
  assert.equal(reader.getContinuedHtmlSlideTitle(null, 1, 1), null);
});

// ---------------------------------------------------------------------------
// 真實 ESA 頁面量測後補上的兩個成本規則
// ---------------------------------------------------------------------------

test('標題比同字數的內文貴，metadata 比較便宜（字級不同）', () => {
  const reader = createReader();
  const text = '甲'.repeat(30);
  const heading = new FakeElement({ tagName: 'h2', className: 'reader-header reader-h2', text });
  const subheading = new FakeElement({ tagName: 'h3', className: 'reader-h3 reader-esa-subheading', text });
  const paragraph = new FakeElement({ tagName: 'p', className: 'reader-paragraph', text });
  const metadata = new FakeElement({
    tagName: 'p',
    className: 'reader-paragraph reader-esa-metadata',
    text
  });

  const headingCost = reader.estimateHtmlContentCost(heading);
  const subheadingCost = reader.estimateHtmlContentCost(subheading);
  const paragraphCost = reader.estimateHtmlContentCost(paragraph);
  const metadataCost = reader.estimateHtmlContentCost(metadata);

  assert.ok(headingCost > subheadingCost, `${headingCost} > ${subheadingCost}`);
  assert.ok(subheadingCost > paragraphCost, `${subheadingCost} > ${paragraphCost}`);
  assert.ok(metadataCost < paragraphCost, `${metadataCost} < ${paragraphCost}`);
  // 34px 標題：每行放得下的字變少、行高變高，再加上標題自己的邊界。
  assert.equal(headingCost, 135);
  assert.equal(metadataCost, 81);
});

test('大字級標題換行更早，長標題會多算一行', () => {
  const reader = createReader();
  const layout = reader.getHtmlSlideLayoutMetrics();
  const headingCharsPerLine = Math.floor(layout.charsPerLine / layout.headingScale);
  const text = '甲'.repeat(headingCharsPerLine + 1);

  const heading = new FakeElement({ tagName: 'h2', className: 'reader-header reader-h2', text });
  const paragraph = new FakeElement({ tagName: 'p', className: 'reader-paragraph', text });

  // 同一段文字，內文只要一行，標題已經要兩行。
  assert.equal(reader.estimateHtmlContentCost(paragraph), layout.lineCost + layout.blockCost);
  assert.equal(
    reader.estimateHtmlContentCost(heading),
    Math.round(2 * layout.lineCost * layout.headingScale) + layout.headingCost
  );
});

test('附件區塊依卡片數與格線欄數估算，不是照字數', () => {
  const reader = createReader();
  const layout = reader.getHtmlSlideLayoutMetrics();
  const createAttachments = cardCount => new FakeElement({
    tagName: 'section',
    className: 'reader-attachments',
    children: [
      new FakeElement({ tagName: 'div', className: 'reader-attachments-heading', text: '附件' }),
      new FakeElement({
        tagName: 'div',
        className: 'reader-attachments-list',
        children: Array.from({ length: cardCount }, (_, index) => new FakeElement({
          tagName: 'button',
          className: 'reader-attachment-card',
          text: `附件檔案 ${index + 1}`
        }))
      })
    ]
  });

  const columns = Math.max(1, Math.floor((layout.bodyWidth - 40) / 360));
  const expected = cardCount => {
    const rows = Math.ceil(cardCount / columns);
    return Math.round((100 + 47 + rows * 92 + Math.max(0, rows - 1) * 14) * layout.costPerPixel);
  };

  assert.equal(reader.estimateHtmlContentCost(createAttachments(1)), expected(1));
  assert.equal(reader.estimateHtmlContentCost(createAttachments(columns + 1)), expected(columns + 1));
  assert.ok(
    reader.estimateHtmlContentCost(createAttachments(columns + 1)) >
    reader.estimateHtmlContentCost(createAttachments(1)),
    '多一列卡片就要多算一列高度'
  );
  // 短檔名的一張卡片，照字數只會算一行；實測是 92px 的卡片。
  assert.ok(reader.estimateHtmlContentCost(createAttachments(1)) > 400);
});

test('沒有附件卡片的區塊退回文字估算', () => {
  const reader = createReader();
  const empty = new FakeElement({
    tagName: 'section',
    className: 'reader-attachments',
    text: '本案無附件'
  });

  assert.equal(reader.estimateHtmlContentCost(empty), 104);
});
