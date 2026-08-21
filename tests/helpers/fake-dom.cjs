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
    this.parentNode = null;
    this.children = [];
    this._text = text;
    children.forEach(child => this.appendChild(child));
  }

  get classList() {
    return new FakeClassList(this);
  }

  get textContent() {
    return this.children.length
      ? this.children.map(child => child.textContent).join('')
      : this._text;
  }

  set textContent(value) {
    this.children.forEach(child => { child.parentNode = null; });
    this.children = [];
    this._text = String(value);
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.children.indexOf(this);
    return this.parentNode.children[index + 1] || null;
  }

  get previousElementSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.children.indexOf(this);
    return index > 0 ? this.parentNode.children[index - 1] : null;
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
    this.children.push(node);
    return node;
  }

  insertBefore(node, reference) {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
    return node;
  }

  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  cloneNode(deep = false) {
    const clone = new FakeElement({
      tagName: this.tagName,
      className: this.className,
      text: this._text,
      dataset: this.dataset,
      attributes: this.attributes
    });
    if (deep) this.children.forEach(child => clone.appendChild(child.cloneNode(true)));
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

module.exports = { FakeElement, element, textElement };

// content.js 產生區段標題時會呼叫 document.createElement，
// vm sandbox 沒有 document，這裡給一個最小替身。
function createFakeDocument() {
  return {
    createElement: tagName => new FakeElement({ tagName })
  };
}

module.exports.createFakeDocument = createFakeDocument;
