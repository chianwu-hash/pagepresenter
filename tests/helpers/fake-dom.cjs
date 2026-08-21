// 最小可變動 fake DOM，只支援 HTML 簡報分頁流程用到的 API。
// 目的是在沒有 jsdom 的情況下，能對 content.js 的 DOM 正規化流程做回歸測試。

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  get set() {
    return new Set(String(this.owner.className || '').split(/\s+/).filter(Boolean));
  }

  contains(name) {
    return this.set.has(name);
  }

  add(...names) {
    const next = this.set;
    names.forEach(name => next.add(name));
    this.owner.className = Array.from(next).join(' ');
  }
}

class FakeText {
  constructor(value = '') {
    this.nodeType = 3;
    this.nodeValue = String(value);
    this.parentNode = null;
  }

  get textContent() {
    return this.nodeValue;
  }

  cloneNode() {
    return new FakeText(this.nodeValue);
  }
}

class FakeElement {
  constructor({
    tagName = 'div',
    className = '',
    text = '',
    children = [],
    dataset = {},
    attributes = {}
  } = {}) {
    this.tagName = String(tagName).toUpperCase();
    this.className = className;
    this.dataset = { ...dataset };
    this.attributes = { ...attributes };
    this.nodeType = 1;
    this.parentNode = null;
    this._nodes = [];
    this._text = text;
    // text 便利參數要變成真正的文字節點，否則 childNodes 走訪會看不到它。
    if (text) this.appendChild(new FakeText(text));
    children.forEach(child => this.appendChild(child));
  }

  get classList() {
    return new FakeClassList(this);
  }

  // children 只含元素，childNodes 含文字節點，跟真實 DOM 一致。
  get children() {
    return this._nodes.filter(node => node.nodeType === 1);
  }

  get childNodes() {
    return this._nodes.slice();
  }

  get firstChild() {
    return this._nodes[0] || null;
  }

  get textContent() {
    return this._nodes.length
      ? this._nodes.map(child => child.textContent).join('')
      : this._text;
  }

  set textContent(value) {
    this._nodes.forEach(child => { child.parentNode = null; });
    this._nodes = [];
    this._text = String(value);
    if (this._text) this.appendChild(new FakeText(this._text));
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode._nodes.indexOf(this);
    return this.parentNode._nodes[index + 1] || null;
  }

  get previousElementSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    const index = siblings.indexOf(this);
    return index > 0 ? siblings[index - 1] : null;
  }

  // HTMLTableElement.rows / HTMLTableRowElement.cells 的最小替身。
  get rows() {
    return this.tagName === 'TABLE' ? this.querySelectorAll('tr') : [];
  }

  get cells() {
    return this.tagName === 'TR'
      ? this.children.filter(child => child.tagName === 'TD' || child.tagName === 'TH')
      : [];
  }

  get rowSpan() {
    return Number(this.attributes.rowspan || 1) || 1;
  }

  appendChild(node) {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    this._nodes.push(node);
    return node;
  }

  insertBefore(node, reference) {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    const index = reference ? this._nodes.indexOf(reference) : -1;
    if (index < 0) this._nodes.push(node);
    else this._nodes.splice(index, 0, node);
    return node;
  }

  removeChild(node) {
    const index = this._nodes.indexOf(node);
    if (index >= 0) this._nodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  cloneNode(deep = false) {
    // 淺拷貝不帶文字，跟真實 DOM 一致；文字是子節點，只有 deep 才複製。
    const clone = new FakeElement({
      tagName: this.tagName,
      className: this.className,
      dataset: this.dataset,
      attributes: this.attributes
    });
    if (deep) this._nodes.forEach(child => clone.appendChild(child.cloneNode(true)));
    return clone;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  matches(selector) {
    return String(selector).split(',').some(part => this.matchesSingle(part.trim()));
  }

  matchesSingle(selector) {
    if (!selector) return false;

    const attributeMatch = selector.match(/^\[([\w-]+)="([^"]*)"\]$/);
    if (attributeMatch) {
      const [, name, value] = attributeMatch;
      const datasetKey = name.replace(/^data-/, '').replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
      return this.dataset[datasetKey] === value || this.attributes[name] === value;
    }

    // 支援 "td:only-child.reader-header" 這種組合選擇器。
    const parts = selector.split(/(?=[.#:])/);
    return parts.every(part => {
      if (part.startsWith(':')) {
        if (part === ':only-child') return this.parentNode?.children.length === 1;
        return false;
      }
      if (part.startsWith('.')) return this.classList.contains(part.slice(1));
      return this.tagName === part.toUpperCase();
    });
  }

  querySelectorAll(selector) {
    const matched = [];
    const visit = node => {
      node.children.forEach(child => {
        if (child.matches(selector)) matched.push(child);
        visit(child);
      });
    };
    visit(this);
    return matched;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function element(tagName, options = {}) {
  return new FakeElement({ tagName, ...options });
}

function textElement(tagName, className, text) {
  return new FakeElement({ tagName, className, text });
}

function text(value) {
  return new FakeText(value);
}

module.exports = { FakeElement, FakeText, element, textElement, text };

// content.js 產生區段標題時會呼叫 document.createElement，
// vm sandbox 沒有 document，這裡給一個最小替身。
function createFakeDocument() {
  return {
    createElement: tagName => new FakeElement({ tagName })
  };
}

module.exports.createFakeDocument = createFakeDocument;
