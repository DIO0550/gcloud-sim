#!/usr/bin/env node
/**
 * 画面の見た目の差分（VRT）を撮って比べる道具。
 *
 * 3 つの仕事をする。
 * - capture: static export を配って headless Chrome で開き、画面ごとに PNG を撮る
 * - compare: 2 つのフォルダを突き合わせ、差分の PNG と summary.json を作る
 * - comment: summary.json から PR へ貼る Markdown を組む
 *
 * 依存を足していないのは、この検査のためにパッケージを増やしたくないため。
 * ブラウザは CDP（DevTools Protocol）を直に叩き、画素の比較もそのブラウザの canvas でやる。
 *
 * 撮る画面は visual-scenarios.mjs に置いてある。
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

import { FROZEN_TIME, SCENARIOS, VIEWPORTS } from "./visual-scenarios.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseArgs = () => {
  const [command, ...tokens] = process.argv.slice(2);
  const args = tokens.filter((token) => token !== "--");
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, "");
    const value = args[index + 1];
    if (!key || value === undefined)
      throw new Error(`引数が対になっていない: ${args[index] ?? ""}`);
    options[key] = value;
  }
  return { command, options };
};

// ---------------------------------------------------------------------------
// 静的配信（撮影対象と、比較する PNG の両方をここから配る）
// ---------------------------------------------------------------------------

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * 1 つのフォルダを配る。
 * stripPrefix を渡すと、その接頭辞を取り除いてから探す（アプリの basePath 用）。
 */
const serveStatic = async (root, stripPrefix = "") => {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const raw = decodeURIComponent(url.pathname);
    const decoded =
      stripPrefix && raw.startsWith(stripPrefix) ? raw.slice(stripPrefix.length) || "/" : raw;
    const candidates = decoded.endsWith("/")
      ? [join(root, decoded, "index.html")]
      : [join(root, decoded), join(root, `${decoded}.html`), join(root, decoded, "index.html")];
    const target = candidates.find(
      (path) => path.startsWith(root) && existsSync(path) && !isDirectory(path),
    );
    if (!target) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(target)] ?? "application/octet-stream",
      // 撮影と比較のたびに読み直させる（同じ名前で中身が変わる）。
      "cache-control": "no-store",
      // 比較は前と後を別々の口から配る。これが無いと canvas が汚染扱いになり、
      // 画素を読み出せない（getImageData が SecurityError になる）。
      "access-control-allow-origin": "*",
    });
    response.end(readFileSync(target));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("配信サーバを起動できなかった");
  return { server, origin: `http://127.0.0.1:${address.port}` };
};

const isDirectory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Chrome（CDP で直に操作する）
// ---------------------------------------------------------------------------

const findChrome = () => {
  const candidates = [
    process.env.CHROME_BIN,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    // Playwright が入れたブラウザ（開発コンテナにはこれがある）
    ...playwrightChromes(),
  ].filter(Boolean);
  const found = candidates.find(
    (candidate) => spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0,
  );
  if (!found) {
    throw new Error("Chrome が要る。google-chrome / chromium を入れるか CHROME_BIN を指定する。");
  }
  return found;
};

const playwrightChromes = () => {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.startsWith("chromium"))
    .map((name) => join(root, name, "chrome-linux", "chrome"))
    .filter((path) => existsSync(path));
};

const launchChrome = async (port) => {
  const userDataDir = mkdtempSync(join(tmpdir(), "visual-chrome-"));
  // Chrome 136 以降は remote debugging に既定以外の user-data-dir が要る。
  const chrome = spawn(
    findChrome(),
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  let exited = null;
  chrome.on("exit", (code, signal) => {
    exited = { code, signal };
  });

  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      return {
        version,
        close: async () => {
          chrome.kill("SIGTERM");
          await sleep(200);
          try {
            chrome.kill("SIGKILL");
          } catch {
            // すでに終わっている
          }
          rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        },
      };
    } catch {
      if (exited) break;
      await sleep(100);
    }
  }
  const state = exited
    ? `code=${exited.code} signal=${exited.signal} で終了`
    : "起動したまま応答しない";
  throw new Error(`Chrome の DevTools に繋がらない（${state}）\n--- stderr ---\n${stderr.trim()}`);
};

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${options?.method ?? "GET"} ${url} が ${response.status}`);
  return response.json();
};

const openCdp = async (wsUrl) => {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data.toString());
    if (!message.id) return;
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message));
    else callbacks.resolve(message.result ?? {});
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, { resolve, reject });
      socket.send(JSON.stringify({ id: messageId, method, params }));
    });
  return { send, close: () => socket.close() };
};

/** 新しいタブを開いて CDP を繋ぐ。閉じるところまで面倒を見る。 */
const openPage = async (port, url) => {
  const target = await fetchJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  const cdp = await openCdp(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  return {
    cdp,
    close: async () => {
      cdp.close();
      await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
    },
  };
};

/** ページの中で関数を動かして、戻り値を受け取る。引数は JSON にして渡す。 */
const run = async (cdp, fn, arg) => {
  const expression = `(${fn.toString()})(${JSON.stringify(arg ?? null)})`;
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) {
    const detail = exceptionDetails.exception?.description ?? exceptionDetails.text ?? "不明な例外";
    throw new Error(`ページ内の ${fn.name || "関数"} が失敗した: ${detail}`);
  }
  return result.value;
};

// ---------------------------------------------------------------------------
// ページの中で動かすもの（外の変数は見えない。引数で渡す）
// ---------------------------------------------------------------------------

/** 今の文書に印を付ける。開き直したかどうかを、この印の有無で見分ける。 */
const markDocument = (mark) => {
  window.__visualNav = mark;
  return true;
};

/**
 * 印が消えていて（＝新しい文書）、押せる状態になっているか。
 *
 * static export の HTML は先に出るので、`main` があるだけではまだ押せない。React が
 * つながる（hydration）前に押しても何も起きず、次の手順で「ボタンが無い」と落ちる。
 * React がつないだ DOM には `__react...` で始まる内部プロパティが付くので、それを見る。
 * 見るのは body（layout.tsx が描く）。ボタンの無い画面でも待てるようにするため。
 */
const pageReady = (mark) => {
  if (window.__visualNav === mark) return false;
  const body = document.body;
  if (!body) return false;
  return Object.keys(body).some((key) => key.startsWith("__react"));
};

/** 前の画面の記録を持ち越さないよう、毎回まっさらにしてから置く。 */
const resetStorage = (entries) => {
  window.localStorage.clear();
  for (const [key, value] of entries) window.localStorage.setItem(key, JSON.stringify(value));
  return true;
};

const clickByText = (text) => {
  const buttons = [...document.querySelectorAll("button")];
  const target = buttons.find(
    (button) =>
      (button.textContent ?? "").trim() === text || button.getAttribute("aria-label") === text,
  );
  if (!target) {
    return {
      ok: false,
      found: buttons.map((button) => (button.textContent ?? "").trim()).slice(0, 40),
    };
  }
  target.click();
  return { ok: true };
};

/** ラベルの付いた入力欄（`<label for>` で結んだもの）に値を入れる。React が拾うように native の setter を通す。 */
const fillByLabel = ([label, value]) => {
  const labels = [...document.querySelectorAll("label")];
  const target = labels.find((l) => (l.textContent ?? "").trim() === label);
  const input = target?.control;
  if (!input) {
    return { ok: false, found: labels.map((l) => (l.textContent ?? "").trim()).slice(0, 40) };
  }
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
};

const documentSize = () => ({
  width: document.documentElement.scrollWidth,
  height: document.documentElement.scrollHeight,
});

// 日本語フォントが無い環境では日本語が豆腐（□）で描かれる。豆腐は毎回同じ絵なので
// 差分として現れず、気づかないまま baseline に焼き付く。撮る前に落とす。
const japaneseGlyphs = () => {
  const draw = (text) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    context.font = "48px sans-serif";
    context.textBaseline = "top";
    context.fillText(text, 0, 0);
    return canvas.toDataURL();
  };
  return { japanese: draw("あ"), notdef: draw("\u{10FFFD}"), blank: draw(" ") };
};

const diffImages = async ({ expected, actual, tolerance }) => {
  const load = (src) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      // 別の口から配られた画像でも画素を読めるようにする（CORS 付きで取りに行く）。
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`読めない画像: ${src}`));
      image.src = src;
    });
  const [before, after] = await Promise.all([load(expected), load(actual)]);
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const pixels = (image) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, width, height).data;
  };
  const left = pixels(before);
  const right = pixels(after);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const out = context.createImageData(width, height);
  let changed = 0;
  for (let index = 0; index < left.length; index += 4) {
    const distance = Math.max(
      Math.abs(left[index] - right[index]),
      Math.abs(left[index + 1] - right[index + 1]),
      Math.abs(left[index + 2] - right[index + 2]),
      Math.abs(left[index + 3] - right[index + 3]),
    );
    if (distance > tolerance) {
      changed += 1;
      out.data[index] = 255;
      out.data[index + 1] = 0;
      out.data[index + 2] = 170;
      out.data[index + 3] = 255;
    } else {
      // 変わっていないところは薄く敷いて、差分の位置が分かるようにする。
      out.data[index] = 255 - (255 - right[index]) * 0.18;
      out.data[index + 1] = 255 - (255 - right[index + 1]) * 0.18;
      out.data[index + 2] = 255 - (255 - right[index + 2]) * 0.18;
      out.data[index + 3] = 255;
    }
  }
  context.putImageData(out, 0, 0);
  return {
    width,
    height,
    beforeSize: { width: before.width, height: before.height },
    afterSize: { width: after.width, height: after.height },
    changedPixels: changed,
    ratio: changed / (width * height),
    diff: canvas.toDataURL("image/png"),
  };
};

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

const shotName = (scenario, viewport) => `${scenario.name}__${viewport.name}`;

const capture = async (options) => {
  const site = options.site ?? "apps/web/out";
  const basePath = options["base-path"] ?? "/gcloud-sim/";
  const out = options.out ?? "visual-actual";
  const port = Number(options.port ?? 9333);
  const settleMs = Number(options["settle-ms"] ?? 400);
  const stableTimeoutMs = Number(options["stable-timeout-ms"] ?? 8000);

  if (!existsSync(site)) throw new Error(`撮る対象が無い: ${site}（先に pnpm build する）`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  // basePath 付きで配る（アプリは /gcloud-sim/... の URL で資材を取りに行く）。
  const root = join(process.cwd(), site);
  const prefix = basePath.replace(/\/$/, "");
  const { server, origin } = await serveStatic(root, prefix);
  const url = `${origin}${prefix}/`;

  const chrome = await launchChrome(port);
  const captured = [];
  try {
    const font = await withPage(port, "about:blank", (cdp) => run(cdp, japaneseGlyphs));
    if (font.japanese === font.notdef || font.japanese === font.blank) {
      throw new Error(
        "Chrome が日本語フォントを見つけられない（豆腐で撮れてしまう）。\n" +
          "fonts-noto-cjk を入れてから撮る: sudo apt-get install -y fonts-noto-cjk && fc-cache -f",
      );
    }

    for (const viewport of VIEWPORTS) {
      for (const scenario of SCENARIOS) {
        const name = shotName(scenario, viewport);
        const page = await openPage(port, "about:blank");
        try {
          await page.cdp.send("Emulation.setDeviceMetricsOverride", {
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await page.cdp.send("Emulation.setTimezoneOverride", { timezoneId: "Asia/Tokyo" });
          // 時刻を固定する。実時刻から作る表示が撮るたびに変わるのを止める。
          await page.cdp.send("Page.addScriptToEvaluateOnNewDocument", {
            source: `(() => {
              const fixed = ${FROZEN_TIME};
              const Original = Date;
              class Frozen extends Original {
                constructor(...args) {
                  if (args.length === 0) super(fixed);
                  else super(...args);
                }
                static now() { return fixed; }
              }
              globalThis.Date = Frozen;
              // アニメーションを止めて、撮るたびに絵が変わらないようにする。
              const style = document.createElement("style");
              style.textContent = "*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}";
              document.addEventListener("DOMContentLoaded", () => document.head.append(style));
            })();`,
          });

          // 1 回目は記録を置くためだけに開く。置いてから開き直したものを撮る
          // （同じブラウザを使い回すので、前の画面の記録が残っていると別の絵になる）。
          await navigate(page.cdp, url);
          await run(page.cdp, resetStorage, Object.entries(scenario.storage ?? {}));
          await navigate(page.cdp, url);

          for (const step of scenario.steps) {
            await applyStep(page.cdp, step, name);
            await sleep(120);
          }

          await sleep(settleMs);
          const size = await run(page.cdp, documentSize);
          const clip = {
            x: 0,
            y: 0,
            width: viewport.width,
            height: Math.min(size.height, viewport.maxHeight ?? size.height),
            scale: 1,
          };
          const screenshot = await stableScreenshot(page.cdp, stableTimeoutMs, clip);
          writeFileSync(join(out, `${name}.png`), Buffer.from(screenshot, "base64"));
          captured.push({ name, label: scenario.label, viewport: viewport.name, ...size });
          console.log(`撮った ${name} (${size.width}x${size.height})`);
        } finally {
          await page.close();
        }
      }
    }
    writeFileSync(join(out, "shots.json"), `${JSON.stringify(captured, null, 2)}\n`);
  } finally {
    await chrome.close();
    server.close();
  }
};

const withPage = async (port, url, body) => {
  const page = await openPage(port, url);
  try {
    return await body(page.cdp);
  } finally {
    await page.close();
  }
};

/**
 * 開き直して、新しい文書が描き終わるまで待つ。
 *
 * Page.navigate の戻りは「要求を受け付けた」だけで、しばらくは前の文書が残っている。
 * 印を付けてから開き、印が消えるまで待つことで、前の文書を操作してしまうのを防ぐ。
 */
const navigate = async (cdp, url) => {
  const mark = `nav-${Math.random().toString(36).slice(2)}`;
  await run(cdp, markDocument, mark).catch(() => {});
  await cdp.send("Page.navigate", { url });
  for (let attempt = 0; attempt < 150; attempt += 1) {
    await sleep(100);
    if (await run(cdp, pageReady, mark).catch(() => false)) return;
  }
  throw new Error(`ページが開かない: ${url}`);
};

/**
 * 手順を 1 つ実行する。画面に固有の操作（特定の部品を狙って押す・なぞる など）が要るときは、
 * ページの中で動かす関数を上に足し、ここで手順の種類に割り当てる。
 */
const applyStep = async (cdp, step, name) => {
  if (step.wait !== undefined) {
    await sleep(step.wait);
    return;
  }
  if (step.type !== undefined) {
    // xterm はフォーカスした textarea へ入力を流すので、キー入力として打つ。
    await run(cdp, () => document.querySelector(".xterm-helper-textarea")?.focus());
    await cdp.send("Input.insertText", { text: step.type });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      text: "\r",
    });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter" });
    await sleep(200);
    return;
  }
  const action = step.fill !== undefined ? fillByLabel : clickByText;
  const argument = step.fill ?? step.click;
  if (argument === undefined) throw new Error(`${name}: 知らない手順 ${JSON.stringify(step)}`);
  const result = await run(cdp, action, argument);
  if (!result.ok) {
    throw new Error(
      `${name}: ${JSON.stringify(step)} を実行できない。画面にあるもの: ${result.found.join(" / ")}`,
    );
  }
};

/**
 * 同じ絵が 2 回続くまで待ってから撮る。
 * 固定の待ち時間だけだと、描画が終わる前のフレームが焼き付くことがある。
 */
const stableScreenshot = async (cdp, timeoutMs, clip) => {
  const shoot = async () => {
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip,
    });
    return data;
  };
  let previous = await shoot();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(200);
    const next = await shoot();
    if (next === previous) return next;
    previous = next;
  }
  console.warn("警告: 絵が落ち着かないまま撮った");
  return previous;
};

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

const pngNames = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(".png"))
        .map((name) => name.replace(/\.png$/, ""))
    : [];

const labelsOf = (dir) => {
  const path = join(dir, "shots.json");
  if (!existsSync(path)) return new Map();
  return new Map(JSON.parse(readFileSync(path, "utf8")).map((shot) => [shot.name, shot]));
};

const compare = async (options) => {
  const expectedDir = options.expected ?? "visual-baseline";
  const actualDir = options.actual ?? "visual-actual";
  const out = options.out ?? "visual-report";
  const port = Number(options.port ?? 9334);
  const tolerance = Number(options.tolerance ?? 8);
  const maxDiffRatio = Number(options["max-diff-ratio"] ?? 0.0001);
  // 画像を残す上限。色を 1 つ変えると全画面が「変わった」になり、そのまま置くと
  // 数十 MB になる。差分の大きいものから残し、残りは件数だけ伝える。
  const maxImages = Number(options["max-images"] ?? 10);
  const version = options["report-version"] ?? "";
  const pr = options.pr ?? "";

  rmSync(out, { recursive: true, force: true });
  for (const sub of ["before", "after", "diff"]) mkdirSync(join(out, sub), { recursive: true });

  const labels = new Map([...labelsOf(expectedDir), ...labelsOf(actualDir)]);
  const names = [...new Set([...pngNames(expectedDir), ...pngNames(actualDir)])].sort();

  // 前と後をそれぞれ配る（フォルダは作業ディレクトリの外にも置けるようにする）。
  const before = await serveStatic(resolve(expectedDir));
  const after = await serveStatic(resolve(actualDir));
  const chrome = await launchChrome(port);
  const results = [];
  try {
    const page = await openPage(port, "about:blank");
    try {
      for (const name of names) {
        const expected = join(expectedDir, `${name}.png`);
        const actual = join(actualDir, `${name}.png`);
        const meta = labels.get(name);
        const entry = { name, label: meta?.label ?? name, viewport: meta?.viewport ?? "" };

        if (!existsSync(expected)) {
          copy(actual, join(out, "after", `${name}.png`));
          results.push({ ...entry, status: "new" });
          continue;
        }
        if (!existsSync(actual)) {
          copy(expected, join(out, "before", `${name}.png`));
          results.push({ ...entry, status: "deleted" });
          continue;
        }

        const diff = await run(page.cdp, diffImages, {
          expected: `${before.origin}/${name}.png`,
          actual: `${after.origin}/${name}.png`,
          tolerance,
        });
        const status = diff.ratio > maxDiffRatio ? "changed" : "passed";
        results.push({
          ...entry,
          status,
          ratio: Number(diff.ratio.toFixed(6)),
          changedPixels: diff.changedPixels,
          beforeSize: diff.beforeSize,
          afterSize: diff.afterSize,
          // 画像は後でまとめて書き出す（大きいものから上限まで）。
          images: status === "changed" ? { expected, actual, diff: diff.diff } : null,
        });
      }
    } finally {
      await page.close();
    }
  } finally {
    await chrome.close();
    before.server.close();
    after.server.close();
  }

  // 差分の大きい順に、上限まで画像を残す。
  const changed = results.filter((result) => result.status === "changed");
  changed.sort((left, right) => right.ratio - left.ratio);
  for (const [index, result] of changed.entries()) {
    const keep = index < maxImages;
    if (keep && result.images) {
      copy(result.images.expected, join(out, "before", `${result.name}.png`));
      copy(result.images.actual, join(out, "after", `${result.name}.png`));
      writeFileSync(
        join(out, "diff", `${result.name}.png`),
        Buffer.from(result.images.diff.replace(/^data:image\/png;base64,/, ""), "base64"),
      );
    }
    result.published = keep;
  }
  for (const result of results) {
    if (result.status === "new") result.published = true;
    delete result.images;
  }

  const count = (status) => results.filter((result) => result.status === status).length;
  const summary = {
    reportVersion: version,
    pr,
    changed: count("changed"),
    new: count("new"),
    deleted: count("deleted"),
    passed: count("passed"),
    maxImages,
    maxDiffRatio,
    tolerance,
    results,
  };
  writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(out, "index.html"), report(summary));

  for (const result of results) {
    if (result.status !== "passed") console.log(`${result.status}: ${result.name}`);
  }
  console.log(
    `変わった ${summary.changed} / 新規 ${summary.new} / 消えた ${summary.deleted} / 同じ ${summary.passed}`,
  );

  // 差分があることは失敗ではない（意図した変更かどうかは人が決める）。
  // ワークフロー側がこの終了コードを見て、チェックを赤にするかを決める。
  if (summary.changed > 0) process.exitCode = 1;
};

const copy = (from, to) => writeFileSync(to, readFileSync(from));

// ---------------------------------------------------------------------------
// レポート（GitHub Pages に置いて、ブラウザで見比べるページ）
// ---------------------------------------------------------------------------

const REPORT_STYLE = `
  :root { color-scheme: light; --line: #e3e6ec; --muted: #59606e; --ink: #16181d; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f5f7; color: var(--ink);
    font: 14px/1.7 system-ui, -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; }
  header { position: sticky; top: 0; z-index: 2; background: #fff; border-bottom: 1px solid var(--line); padding: 18px 24px; }
  h1 { margin: 0 0 6px; font-size: 17px; letter-spacing: .02em; }
  .meta { color: var(--muted); font-size: 12px; }
  .counts { display: flex; gap: 14px; margin: 12px 0 0; font-size: 12.5px; font-weight: 700; }
  .counts span { color: var(--muted); font-weight: 500; }
  .tools { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 12px; }
  input[type=search] { border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; font: inherit; font-size: 12.5px; min-width: 220px; }
  label { font-size: 12.5px; color: var(--muted); display: flex; gap: 6px; align-items: center; }
  main { padding: 20px 24px 60px; display: flex; flex-direction: column; gap: 18px; }
  section { background: #fff; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .head { display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; padding: 14px 18px; border-bottom: 1px solid #edeff3; }
  .name { font-weight: 700; }
  .viewport { font-size: 11.5px; color: var(--muted); }
  .badge { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 9px; }
  .changed { background: #fdf0ef; color: #b3392f; }
  .new { background: #eef3fb; color: #2f5fa8; }
  .deleted { background: #eef0f4; color: #4a515e; }
  .passed { background: #eef7f2; color: #1f6b52; }
  .ratio { margin-left: auto; font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .modes { display: flex; gap: 6px; padding: 12px 18px 0; }
  .modes button { cursor: pointer; border: 1px solid var(--line); background: #fff; border-radius: 7px; padding: 5px 11px; font: inherit; font-size: 11.5px; color: var(--muted); }
  .modes button[aria-pressed=true] { border-color: #2f5fa8; background: #eef3fb; color: #2f5fa8; font-weight: 700; }
  .view { padding: 12px 18px 18px; }
  .view img { max-width: 100%; border: 1px solid var(--line); border-radius: 8px; display: block; background: #fff; }
  .side { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .side figure { margin: 0; }
  figcaption { font-size: 11.5px; color: var(--muted); margin-bottom: 5px; }
  .wipe { position: relative; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; }
  .wipe img { border: 0; border-radius: 0; }
  .wipe .after { position: absolute; inset: 0; overflow: hidden; }
  .wipe .after img { max-width: none; }
  .wipe input { width: 100%; margin-top: 10px; }
  .empty { padding: 18px; color: var(--muted); font-size: 12.5px; }
`;

const REPORT_SCRIPT = `
  const STATUS = { changed: "変わった", new: "新規", deleted: "消えた", passed: "同じ" };
  const list = document.getElementById("list");
  const filter = document.getElementById("filter");
  const onlyChanged = document.getElementById("only-changed");

  const image = (kind, name) => \`<img loading="lazy" src="\${kind}/\${name}.png" alt="\${kind}">\`;

  const view = (result, mode) => {
    const { name, status } = result;
    if (status === "passed") return '<p class="empty">差分はありません。</p>';
    if (!result.published) {
      return '<p class="empty">画像は差分の大きいものから ' + DATA.maxImages +
        ' 件までしか残していないので、この画面の絵はありません。</p>';
    }
    if (status === "new") return image("after", name);
    if (status === "deleted") return image("before", name);
    if (mode === "diff") return image("diff", name);
    if (mode === "side") {
      return '<div class="side">' +
        '<figure><figcaption>前（main）</figcaption>' + image("before", name) + '</figure>' +
        '<figure><figcaption>後（この PR）</figcaption>' + image("after", name) + '</figure></div>';
    }
    return '<div class="wipe" data-wipe><div class="base">' + image("before", name) + '</div>' +
      '<div class="after" style="width:50%">' + image("after", name) + '</div></div>' +
      '<input type="range" min="0" max="100" value="50" aria-label="境目を動かす">';
  };

  const card = (result) => {
    const section = document.createElement("section");
    section.dataset.name = result.name + " " + result.label;
    section.dataset.status = result.status;
    const ratio = result.ratio === undefined ? "" :
      \`<span class="ratio">\${(result.ratio * 100).toFixed(3)}% / \${(result.changedPixels ?? 0).toLocaleString("ja-JP")}px</span>\`;
    const modes = result.status === "changed" && result.published
      ? '<div class="modes"><button aria-pressed="true" data-mode="diff">差分</button>' +
        '<button aria-pressed="false" data-mode="side">並べて</button>' +
        '<button aria-pressed="false" data-mode="wipe">重ねて</button></div>'
      : "";
    section.innerHTML =
      \`<div class="head"><span class="name">\${result.label}</span>\` +
      \`<span class="viewport">\${result.viewport}</span>\` +
      \`<span class="badge \${result.status}">\${STATUS[result.status]}</span>\${ratio}</div>\` +
      modes + '<div class="view"></div>';
    const body = section.querySelector(".view");
    const draw = (mode) => {
      body.innerHTML = view(result, mode);
      const wipe = body.querySelector("[data-wipe]");
      const range = body.querySelector("input[type=range]");
      if (wipe && range) {
        const apply = () => { wipe.querySelector(".after").style.width = range.value + "%"; };
        range.addEventListener("input", apply);
        apply();
      }
    };
    for (const button of section.querySelectorAll(".modes button")) {
      button.addEventListener("click", () => {
        for (const other of section.querySelectorAll(".modes button")) {
          other.setAttribute("aria-pressed", String(other === button));
        }
        draw(button.dataset.mode);
      });
    }
    draw("diff");
    return section;
  };

  const order = { changed: 0, new: 1, deleted: 2, passed: 3 };
  const sorted = [...DATA.results].sort((a, b) =>
    order[a.status] - order[b.status] || (b.ratio ?? 0) - (a.ratio ?? 0) || a.name.localeCompare(b.name));
  const cards = sorted.map((result) => [result, card(result)]);
  for (const [, node] of cards) list.append(node);

  const apply = () => {
    const word = filter.value.trim();
    for (const [result, node] of cards) {
      const hitWord = word === "" || node.dataset.name.includes(word);
      const hitStatus = !onlyChanged.checked || result.status !== "passed";
      node.hidden = !(hitWord && hitStatus);
    }
  };
  filter.addEventListener("input", apply);
  onlyChanged.addEventListener("change", apply);
  apply();
`;

/**
 * 見比べるためのページ。GitHub Pages に置いて開く前提で、外から何も読み込まない
 * （画像は同じフォルダの before/ after/ diff/ を相対パスで指す）。
 */
const report = (summary) => {
  const data = JSON.stringify(summary).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>見た目の差分${summary.pr ? ` — PR #${summary.pr}` : ""}</title>
<style>${REPORT_STYLE}</style>
<header>
  <h1>見た目の差分</h1>
  <p class="meta">${summary.pr ? `PR #${summary.pr} / ` : ""}コミット ${summary.reportVersion || "—"} / ${summary.results.length} 枚</p>
  <p class="counts">
    🔴 ${summary.changed} <span>変わった</span>
    ⚪ ${summary.new} <span>新規</span>
    ⚫ ${summary.deleted} <span>消えた</span>
    🔵 ${summary.passed} <span>同じ</span>
  </p>
  <div class="tools">
    <input id="filter" type="search" placeholder="画面名でしぼる">
    <label><input id="only-changed" type="checkbox" checked> 変わったものだけ出す</label>
  </div>
</header>
<main id="list"></main>
<script>
const DATA = ${data};
${REPORT_SCRIPT}
</script>
</html>
`;
};

// ---------------------------------------------------------------------------
// comment
// ---------------------------------------------------------------------------

const MARKER = "<!-- sticky-comment: visual-regression -->";

const comment = (options) => {
  const summary = JSON.parse(readFileSync(options.summary ?? "visual-report/summary.json", "utf8"));
  const imageBase = (options["image-base"] ?? "").replace(/\/$/, "");
  const runUrl = options["run-url"] ?? "";
  const reportUrl = options["report-url"] ?? "";
  const label = options.label ?? "visual-approved";
  const approved = options.approved === "true";

  const lines = [MARKER, "## 画面の見た目の差分", ""];
  if (summary.changed > 0) {
    lines.push(
      approved
        ? `差分がありますが、\`${label}\` ラベルで承認済みのためチェックは通しています。`
        : `差分が見つかりました。下の画像を見て、意図した変更なら \`${label}\` ラベルを付けてください（付けるとチェックが通ります）。意図しない変更ならコードを直してください。`,
    );
  } else if (summary.new > 0 && summary.passed === 0 && summary.changed === 0) {
    lines.push(
      "比べる相手（baseline）がまだありません。この PR が main に入ると baseline ができます。",
    );
  } else {
    lines.push("差分はありませんでした。");
  }
  lines.push(
    "",
    "| 🔴 変わった | ⚪ 新規 | ⚫ 消えた | 🔵 同じ |",
    "| ---: | ---: | ---: | ---: |",
    `| ${summary.changed} | ${summary.new} | ${summary.deleted} | ${summary.passed} |`,
    "",
  );
  if (reportUrl) {
    lines.push(
      `**[📊 全部まとめて見る（差分 / 並べて / 重ねて）](${reportUrl})**`,
      "",
      `> 下の画像は変化の大きいものだけ。撮った ${summary.results.length} 枚すべてと、重ねて境目を動かす見方はレポート側にある。`,
      "",
    );
  }

  // 画像は差分の大きい順。先頭だけ開いておき、残りは畳む（コメントが縦に伸びすぎないように）。
  const OPEN_COUNT = 3;
  const changed = summary.results
    .filter((result) => result.status === "changed")
    .sort((left, right) => right.ratio - left.ratio);
  const withImages = changed.filter((result) => result.published);
  const section = (result) => [
    `**${result.label}（${result.viewport}）** 変わった画素 ${result.changedPixels.toLocaleString("ja-JP")} 個（${(result.ratio * 100).toFixed(3)}%）`,
    "",
    "| 前（main） | 後（この PR） | 差分 |",
    "| --- | --- | --- |",
    `| <img src="${imageBase}/before/${result.name}.png" width="260"> | <img src="${imageBase}/after/${result.name}.png" width="260"> | <img src="${imageBase}/diff/${result.name}.png" width="260"> |`,
    "",
  ];

  for (const result of withImages.slice(0, OPEN_COUNT)) lines.push(...section(result));
  const folded = withImages.slice(OPEN_COUNT);
  if (folded.length > 0) {
    lines.push(`<details><summary>ほかの ${folded.length} 件</summary>`, "");
    for (const result of folded) lines.push(...section(result));
    lines.push("</details>", "");
  }
  const omitted = changed.filter((result) => !result.published);
  if (omitted.length > 0) {
    lines.push(
      `画像は差分の大きい ${withImages.length} 件だけ載せている。ほかに ${omitted.map((result) => `${result.label}（${result.viewport}）`).join(" / ")} も変わっている。`,
      "",
    );
  }

  const added = summary.results.filter((result) => result.status === "new");
  if (added.length > 0) {
    lines.push("<details><summary>新しく増えた画面</summary>", "");
    for (const result of added) {
      lines.push(
        `**${result.label}（${result.viewport}）**`,
        "",
        `<img src="${imageBase}/after/${result.name}.png" width="320">`,
        "",
      );
    }
    lines.push("</details>", "");
  }

  const removed = summary.results.filter((result) => result.status === "deleted");
  if (removed.length > 0) {
    lines.push(
      `消えた画面: ${removed.map((result) => `${result.label}（${result.viewport}）`).join(" / ")}`,
      "",
    );
  }

  if (reportUrl) lines.push(`- [レポート](${reportUrl})`);
  if (runUrl) lines.push(`- [Actions](${runUrl})`);
  return `${lines.join("\n")}\n`;
};

// ---------------------------------------------------------------------------

const main = async () => {
  const { command, options } = parseArgs();
  if (command === "capture") await capture(options);
  else if (command === "compare") await compare(options);
  else if (command === "comment") process.stdout.write(comment(options));
  else throw new Error(`使い方: visual-regression.mjs <capture|compare|comment> [--key value ...]`);
};

await main();
