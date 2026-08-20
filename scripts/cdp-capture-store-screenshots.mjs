import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const outDir = join(rootDir, "store-assets");
mkdirSync(outDir, { recursive: true });

const cdpUrl = process.env.CDP_URL || "http://127.0.0.1:9232";
const demoUrl = "http://127.0.0.1:8765/store-assets/demo-meeting.html";

let nextId = 1;

async function getJson(path) {
  const response = await fetch(new URL(path, cdpUrl));
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${path}`);
  return response.json();
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result || {});
    } else if (message.method) {
      events.push(message);
    }
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveSend, rejectSend) => {
            pending.set(id, { resolve: resolveSend, reject: rejectSend });
          });
        },
        events,
        close() {
          ws.close();
        },
      });
    });
    ws.addEventListener("error", reject);
  });
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExpression(client, expression, timeoutMs = 10000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await client.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (last.result?.value) return last.result.value;
    await wait(250);
  }
  throw new Error(`Timed out waiting for expression: ${expression}; last=${JSON.stringify(last)}`);
}

async function capture(client, filename) {
  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const fullPath = join(outDir, filename);
  writeFileSync(fullPath, Buffer.from(screenshot.data, "base64"));
  return fullPath;
}

const version = await getJson("/json/version");
const browser = await connect(version.webSocketDebuggerUrl);
const target = await browser.send("Target.createTarget", {
  url: "about:blank",
});
browser.close();

const targets = await getJson("/json/list");
const pageTarget = targets.find((item) => item.id === target.targetId);
if (!pageTarget?.webSocketDebuggerUrl) {
  throw new Error("Created target not found");
}

const page = await connect(pageTarget.webSocketDebuggerUrl);
await page.send("Page.enable");
await page.send("Runtime.enable");
await page.send("Emulation.setDeviceMetricsOverride", {
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,
  mobile: false,
});
await page.send("Page.navigate", { url: demoUrl });
await waitForExpression(page, "document.readyState === 'complete'", 15000);
await wait(1000);

const initial = await page.send("Runtime.evaluate", {
  expression: `({
    title: document.title,
    url: location.href,
    hasReaderContainer: !!document.querySelector('#web-reader-container'),
    hasChromeRuntime: typeof chrome !== 'undefined' && !!chrome.runtime,
    bodyText: document.body.innerText.slice(0, 200)
  })`,
  returnByValue: true,
});
console.log(JSON.stringify(initial.result.value, null, 2));

await capture(page, "screenshot-demo-page-1280x800.png");

await page.send("Runtime.evaluate", {
  expression: `(() => {
    const paragraph = Array.from(document.querySelectorAll('p'))
      .find((item) => item.textContent.includes('學生學習成果獎勵'));
    if (!paragraph) return 'paragraph-not-found';
    const phrase = '114學年度學生學習成果獎勵';
    paragraph.innerHTML = paragraph.innerHTML.replace(
      phrase,
      '<span id="demo-selected-text" style="background:#2f6fdf;color:#fff;border-radius:4px;padding:2px 6px;">' + phrase + '</span>',
    );
    const selected = document.getElementById('demo-selected-text');
    const rect = selected.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'demo-context-menu';
    menu.style.cssText = [
      'position:fixed',
      'left:' + Math.min(rect.left + 170, window.innerWidth - 360) + 'px',
      'top:' + Math.min(rect.bottom + 26, window.innerHeight - 230) + 'px',
      'width:330px',
      'background:#ffffff',
      'border:1px solid #d6dbe3',
      'border-radius:14px',
      'box-shadow:0 20px 50px rgba(15,23,42,.22)',
      'z-index:999999',
      'font-family:"Microsoft JhengHei",system-ui,sans-serif',
      'font-size:18px',
      'color:#111827',
      'overflow:hidden'
    ].join(';');
    menu.innerHTML = [
      '<div style="padding:13px 18px;border-bottom:1px solid #eef2f7;color:#6b7280;font-size:15px;">選取文字後按右鍵</div>',
      '<div style="padding:14px 18px;">複製</div>',
      '<div style="padding:14px 18px;">搜尋所選文字</div>',
      '<div style="padding:14px 18px;background:#eaf5ff;color:#075ba8;font-weight:700;">啟動簡報模式</div>'
    ].join('');
    document.body.appendChild(menu);
    return 'selection-menu-added';
  })()`,
  returnByValue: true,
});
await wait(500);
await capture(page, "screenshot-selection-right-click-1280x800.png");

const hasReader = initial.result.value.hasReaderContainer;
if (hasReader) {
  const contexts = page.events
    .filter((event) => event.method === "Runtime.executionContextCreated")
    .map((event) => event.params.context);
  console.log(JSON.stringify({
    contexts: contexts.map((context) => ({
      id: context.id,
      name: context.name,
      origin: context.origin,
      auxData: context.auxData,
    })),
  }, null, 2));
  const extensionContext = contexts.find((context) =>
    context.origin?.startsWith("chrome-extension://") ||
    context.name?.includes("chrome-extension://") ||
    context.auxData?.type === "isolated",
  );
  const toggled = await page.send("Runtime.evaluate", {
    expression: `new Promise((resolve) => {
      try {
        if (window.webReader?.startWithSelectedContent) {
          const selectedText = document.body.innerText;
          window.webReader.startWithSelectedContent(selectedText);
          resolve({ ok: true, via: 'window.webReader.startWithSelectedContent', length: selectedText.length });
        } else if (chrome?.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ action: 'startWithSelection', selectedText: document.body.innerText }, (response) => {
            resolve({ ok: true, via: 'chrome.runtime.sendMessage', response, error: chrome.runtime.lastError?.message || null });
          });
        } else {
          resolve({ ok: false, error: 'No webReader or chrome.runtime in this execution context' });
        }
      } catch (error) {
        resolve({ ok: false, error: error.message });
      }
    })`,
    awaitPromise: true,
    returnByValue: true,
    ...(extensionContext ? { contextId: extensionContext.id } : {}),
  });
  console.log(JSON.stringify({ toggleReader: toggled.result.value }, null, 2));
  await wait(2000);
  const visible = await page.send("Runtime.evaluate", {
    expression: `!!document.querySelector('#web-reader-container.web-reader-active')`,
    returnByValue: true,
  });
  console.log(JSON.stringify({ readerVisible: visible.result.value }, null, 2));
  if (visible.result.value) {
    await page.send("Runtime.evaluate", {
      expression: `(() => {
        const stay = document.getElementById('ai-consent-stay');
        if (stay) {
          stay.click();
          return 'clicked-stay-offline';
        }
        const modal = document.querySelector('.ai-consent-modal, #ai-consent-title')?.closest('div');
        if (modal) {
          modal.remove();
          return 'removed-modal';
        }
        return 'no-modal';
      })()`,
      returnByValue: true,
      ...(extensionContext ? { contextId: extensionContext.id } : {}),
    });
    await wait(5000);
    await page.send("Runtime.evaluate", {
      expression: `document.getElementById('ai-status-notification')?.remove(); 'notification-cleared'`,
      returnByValue: true,
      ...(extensionContext ? { contextId: extensionContext.id } : {}),
    });
    await wait(500);
    await capture(page, "screenshot-reader-1280x800.png");
  }
}

page.close();
