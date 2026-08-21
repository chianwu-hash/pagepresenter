const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

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

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createReader() {
  return Object.create(WebReader.prototype);
}

class FakeClassList {
  constructor(classes = '') {
    this.classes = new Set(String(classes).split(/\s+/).filter(Boolean));
  }

  contains(name) {
    return this.classes.has(name);
  }
}

class FakeElement {
  constructor({
    tagName = 'div',
    className = '',
    textContent = '',
    children = [],
    dataset = {},
    attributes = {}
  } = {}) {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.classList = new FakeClassList(className);
    this.textContent = textContent;
    this.children = children;
    this.dataset = dataset;
    this.attributes = attributes;
  }

  matches(selector) {
    return selector.split(',').some(part => this.matchesSingle(part.trim()));
  }

  matchesSingle(selector) {
    if (!selector) return false;
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector === 'ul' || selector === 'ol' || selector === 'li' ||
      selector === 'table' || selector === 'tr' || selector === 'figure' ||
      selector === 'img' || selector === 'video' || selector === 'caption' ||
      selector === 'figcaption') {
      return this.tagName.toLowerCase() === selector;
    }
    if (/^h[1-6]$/.test(selector)) {
      return this.tagName.toLowerCase() === selector;
    }
    if (selector === '[data-reader-esa-section-title="true"]') {
      return this.dataset.readerEsaSectionTitle === 'true';
    }
    if (selector === '[data-reader-skip-ai-highlight="true"]') {
      return this.dataset.readerSkipAiHighlight === 'true';
    }
    if (selector === 'th:only-child') {
      return this.tagName === 'TH';
    }
    if (selector === 'td:only-child.reader-header') {
      return this.tagName === 'TD' && this.classList.contains('reader-header');
    }
    return false;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = node => {
      for (const child of node.children || []) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }
}

test('extractContentUnits uses rendered top-level DOM children as stable unit indexes', () => {
  const reader = createReader();
  const contentDom = new FakeElement({
    children: [
      new FakeElement({
        tagName: 'h2',
        className: 'reader-header reader-h2',
        textContent: '一、教務處',
        dataset: { readerEsaSectionTitle: 'true' }
      }),
      new FakeElement({
        className: 'reader-paragraph',
        textContent: '請各班於 9/30 前完成閱讀心得，本案列入期末檢核。'
      }),
      new FakeElement({
        className: 'reader-list',
        textContent: '第一項 第二項',
        children: [
          new FakeElement({ tagName: 'li', className: 'reader-list-item', textContent: '第一項' }),
          new FakeElement({ tagName: 'li', className: 'reader-list-item', textContent: '第二項' })
        ]
      })
    ]
  });

  const units = reader.extractContentUnits(contentDom);

  assert.deepEqual(plain(units.map(unit => unit.index)), [0, 1, 2]);
  assert.equal(units[0].kind, 'heading');
  assert.equal(units[0].level, 2);
  assert.equal(units[0].title, '一、教務處');
  assert.deepEqual(plain(units[0].flags), ['department']);
  assert.equal(units[1].kind, 'block');
  assert.equal(units[1].breakable, true);
  assert.equal(units[2].kind, 'block');
  assert.deepEqual(plain(units[2].flags), ['list']);
  assert.ok(units[2].cost > units[1].cost);
});

test('extractContentUnits marks tables and metadata as atomic units', () => {
  const reader = createReader();
  const contentDom = new FakeElement({
    children: [
      new FakeElement({
        className: 'reader-table-wrapper',
        textContent: '欄位 內容 第一列 第二列',
        children: [
          new FakeElement({
            tagName: 'table',
            children: [
              new FakeElement({ tagName: 'tr', className: 'reader-table-row', textContent: '欄位 內容' }),
              new FakeElement({ tagName: 'tr', className: 'reader-table-row', textContent: '第一列' }),
              new FakeElement({ tagName: 'tr', className: 'reader-table-row', textContent: '第二列' })
            ]
          })
        ]
      }),
      new FakeElement({
        className: 'reader-paragraph reader-esa-metadata',
        textContent: '(教務處 陳麗如 於 115-06-09 07:58 新增)'
      })
    ]
  });

  const units = reader.extractContentUnits(contentDom);

  assert.equal(units[0].kind, 'atomic');
  assert.deepEqual(plain(units[0].flags), ['table']);
  assert.equal(units[0].breakable, false);
  assert.ok(units[0].cost >= 240);
  assert.equal(units[1].kind, 'atomic');
  assert.deepEqual(plain(units[1].flags), ['metadata']);
  assert.equal(units[1].breakable, false);
});

test('content unit preview keeps both the beginning and the end of long text', () => {
  const reader = createReader();
  const longText = `開頭${'甲'.repeat(140)}中段${'乙'.repeat(90)}期限請於 9/30 前完成。`;
  const preview = reader.createContentUnitPreview(longText, 20, 18);

  assert.match(preview, /^開頭甲+/);
  assert.match(preview, /\.\.\./);
  assert.match(preview, /9\/30 前完成。$/);
  assert.ok(preview.length < longText.length);
});

test('slide quality metrics records cost distribution without changing slides', () => {
  const reader = createReader();
  const sourceRoot = new FakeElement({ textContent: '第一頁 第二頁' });
  const slides = [
    { title: '第一頁', content: new FakeElement({ textContent: '第一頁' }) },
    { title: '第二頁', content: new FakeElement({ textContent: '第二頁' }) }
  ];

  const returned = reader.finalizeHtmlSlides(slides, sourceRoot, 'test-plan');

  assert.equal(returned, slides);
  assert.equal(reader.lastHtmlSlideQualityMetrics.strategy, 'test-plan');
  assert.equal(reader.lastHtmlSlideQualityMetrics.slideCount, 2);
  assert.deepEqual(plain(reader.lastHtmlSlideQualityMetrics.slideTextLengths), [3, 3]);
  assert.equal(reader.lastHtmlSlideQualityMetrics.sourceTextLength, 7);
});

test('slide quality metrics accounts for duplicate headings removed from slide bodies', () => {
  const reader = createReader();
  const sourceRoot = new FakeElement({ textContent: '一、教務處 請完成資料補件' });
  const slides = [
    { title: '一、教務處', content: new FakeElement({ textContent: '請完成資料補件' }) }
  ];

  const metrics = reader.calculateHtmlSlideQualityMetrics(slides, sourceRoot, 'test-plan');

  assert.equal(metrics.sourceTextLength, 13);
  assert.equal(metrics.totalSlideTextLength, 7);
  assert.equal(metrics.matchedSlideTitleTextLength, 5);
  assert.equal(metrics.adjustedSlideTextLength, 12);
  assert.equal(metrics.possibleTextMismatch, false);
});

test('slide quality metrics includes unit and plan diagnostics for baseline comparison', () => {
  const reader = createReader();
  const sourceRoot = new FakeElement({ textContent: '一、教務處 請完成資料補件 表格資料' });
  const units = [
    { index: 0, kind: 'heading', title: '一、教務處', cost: 20, flags: ['department'] },
    { index: 1, kind: 'block', title: null, cost: 120, flags: [] },
    { index: 2, kind: 'atomic', title: null, cost: 260, flags: ['table'] }
  ];
  const plan = {
    strategy: 'heuristic-plan',
    targetCost: 650,
    maxCost: 900,
    slides: [
      { start: 0, end: 1, title: '一、教務處' },
      { start: 2, end: 2, title: '簡報內容' }
    ]
  };

  const metrics = reader.calculateHtmlSlideQualityMetrics([], sourceRoot, 'heuristic-plan', {
    units,
    plan
  });

  assert.equal(metrics.unitCount, 3);
  assert.deepEqual(plain(metrics.unitCosts), [20, 120, 260]);
  assert.equal(metrics.unitTotalCost, 400);
  assert.deepEqual(plain(metrics.unitKindCounts), {
    heading: 1,
    block: 1,
    atomic: 1
  });
  assert.deepEqual(plain(metrics.unitFlagCounts), {
    department: 1,
    table: 1
  });
  assert.equal(metrics.planSlideCount, 2);
  assert.equal(metrics.planTargetCost, 650);
  assert.equal(metrics.planMaxCost, 900);
  assert.equal(metrics.planMaxSlides, null);
});

test('heuristic planner splits before headings after enough content', () => {
  const reader = createReader();
  const units = [
    { index: 0, kind: 'heading', title: '一、背景', cost: 40 },
    { index: 1, kind: 'block', title: null, cost: 260 },
    { index: 2, kind: 'heading', title: '二、辦理事項', cost: 40 },
    { index: 3, kind: 'block', title: null, cost: 200 }
  ];

  const plan = reader.createHeuristicHtmlSlidePlan(units, {
    minCost: 160,
    maxCost: 900
  });

  assert.equal(plan.strategy, 'heuristic-plan');
  assert.deepEqual(plain(plan.slides), [
    { start: 0, end: 1, title: '一、背景' },
    { start: 2, end: 3, title: '二、辦理事項' }
  ]);
});

test('validator falls back when a plan has gaps or reorders units', () => {
  const reader = createReader();
  const units = [
    { index: 0, kind: 'block', title: null, cost: 100 },
    { index: 1, kind: 'block', title: null, cost: 100 },
    { index: 2, kind: 'block', title: null, cost: 100 }
  ];
  const invalidPlan = {
    strategy: 'ai-plan',
    slides: [
      { start: 0, end: 0, title: '第一頁' },
      { start: 2, end: 2, title: '第三頁' }
    ]
  };
  const fallbackPlan = reader.createSingleHtmlSlidePlan(units);

  const plan = reader.validateAndRepairHtmlSlidePlan(invalidPlan, units, fallbackPlan);

  assert.equal(plan.strategy, 'single-page-fallback-after-invalid-plan');
  // generatedTitle 標記系統自己取的標題，之後的合併只會吃掉這種。
  assert.deepEqual(plain(plan.slides), [
    { start: 0, end: 2, title: '簡報內容', generatedTitle: true }
  ]);
});

test('validator rejects non-contiguous unit indexes before rendering', () => {
  const reader = createReader();
  const units = [
    { index: 0, kind: 'block', title: null, cost: 100 },
    { index: 2, kind: 'block', title: null, cost: 100 }
  ];
  const rawPlan = {
    strategy: 'ai-plan',
    slides: [
      { start: 0, end: 2, title: '錯誤頁' }
    ]
  };

  assert.equal(reader.isStructurallyValidHtmlSlidePlan(rawPlan, units), false);
});

test('heuristic planner compacts adjacent slides when maxSlides is exceeded', () => {
  const reader = createReader();
  const units = [
    { index: 0, kind: 'heading', title: '一、第一', cost: 50 },
    { index: 1, kind: 'block', title: null, cost: 220 },
    { index: 2, kind: 'heading', title: '二、第二', cost: 50 },
    { index: 3, kind: 'block', title: null, cost: 230 },
    { index: 4, kind: 'heading', title: '三、第三', cost: 50 },
    { index: 5, kind: 'block', title: null, cost: 240 }
  ];

  const plan = reader.createHeuristicHtmlSlidePlan(units, {
    minCost: 100,
    maxCost: 900,
    maxSlides: 2
  });

  assert.equal(plan.maxSlides, 2);
  assert.deepEqual(plain(plan.slides), [
    { start: 0, end: 3, title: '一、第一' },
    { start: 4, end: 5, title: '三、第三' }
  ]);
});

test('validator compacts too many adjacent plan slides without reordering', () => {
  const reader = createReader();
  const units = [
    { index: 0, kind: 'block', title: null, cost: 100 },
    { index: 1, kind: 'block', title: null, cost: 100 },
    { index: 2, kind: 'block', title: null, cost: 100 }
  ];
  const rawPlan = {
    strategy: 'ai-plan',
    maxSlides: 2,
    slides: [
      { start: 0, end: 0, title: '第一頁' },
      { start: 1, end: 1, title: '第二頁' },
      { start: 2, end: 2, title: '第三頁' }
    ]
  };

  const plan = reader.validateAndRepairHtmlSlidePlan(rawPlan, units);

  assert.equal(plan.strategy, 'ai-plan-repaired');
  assert.deepEqual(plain(plan.slides), [
    { start: 0, end: 1, title: '第一頁' },
    { start: 2, end: 2, title: '第三頁' }
  ]);
});

test('validator repairs overlong multi-unit slides with heuristic slices', () => {
  const reader = createReader();
  const units = [
    { index: 0, kind: 'heading', title: '一、長文', cost: 40 },
    { index: 1, kind: 'block', title: null, cost: 500 },
    { index: 2, kind: 'block', title: null, cost: 500 },
    { index: 3, kind: 'block', title: null, cost: 150 }
  ];
  const rawPlan = {
    strategy: 'ai-plan',
    maxCost: 700,
    slides: [
      { start: 0, end: 3, title: '一、長文' }
    ]
  };

  const plan = reader.validateAndRepairHtmlSlidePlan(rawPlan, units);

  assert.equal(plan.strategy, 'ai-plan-repaired');
  // 被拆開的續頁沿用原標題加「（續）」，導覽才看得出歸屬。
  assert.deepEqual(plain(plan.slides), [
    { start: 0, end: 1, title: '一、長文' },
    { start: 2, end: 3, title: '一、長文（續）', generatedTitle: true }
  ]);
});
