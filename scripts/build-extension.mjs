import archiver from "archiver";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const manifestPath = join(rootDir, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const version = manifest.version;
const outDir = join(rootDir, "dist");
const outFile = join(outDir, `pagepresenter-${version}.zip`);

const files = [
  "manifest.json",
  "background.js",
  "content.js",
  "popup.html",
  "popup.js",
  "styles.css",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

for (const file of files) {
  const fullPath = join(rootDir, file);
  if (!existsSync(fullPath)) {
    throw new Error(`Missing required extension file: ${file}`);
  }
}

mkdirSync(outDir, { recursive: true });
if (existsSync(outFile)) {
  rmSync(outFile);
}

const output = createWriteStream(outFile);
const archive = archiver("zip", { zlib: { level: 9 } });

const done = new Promise((resolve, reject) => {
  output.on("close", resolve);
  archive.on("warning", reject);
  archive.on("error", reject);
});

archive.pipe(output);
for (const file of files) {
  archive.file(join(rootDir, file), { name: file.replaceAll("\\", "/") });
}
await archive.finalize();
await done;

console.log(outFile);

