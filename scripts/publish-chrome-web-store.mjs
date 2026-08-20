import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const action = process.argv[2] || "upload";

if (!["upload", "submit"].includes(action)) {
  throw new Error("Usage: node scripts/publish-chrome-web-store.mjs upload|submit");
}

const {
  CWS_CLIENT_ID,
  CWS_CLIENT_SECRET,
  CWS_REFRESH_TOKEN,
  CWS_PUBLISHER_ID,
  CWS_EXTENSION_ID,
  CWS_ZIP_FILE,
} = process.env;

const missing = Object.entries({
  CWS_CLIENT_ID,
  CWS_CLIENT_SECRET,
  CWS_REFRESH_TOKEN,
  CWS_PUBLISHER_ID,
  CWS_EXTENSION_ID,
})
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length) {
  throw new Error(`Missing environment variables: ${missing.join(", ")}`);
}

const manifest = JSON.parse(readFileSync(join(rootDir, "manifest.json"), "utf8"));
const zipFile = CWS_ZIP_FILE || join(rootDir, "dist", `pagepresenter-${manifest.version}.zip`);

if (!existsSync(zipFile)) {
  throw new Error(`Zip file not found: ${zipFile}. Run npm run build:extension first.`);
}

async function getAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CWS_CLIENT_ID,
      client_secret: CWS_CLIENT_SECRET,
      refresh_token: CWS_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Failed to get access token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function uploadZip(accessToken) {
  const zipBytes = readFileSync(zipFile);
  const response = await fetch(
    `https://chromewebstore.googleapis.com/upload/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}:upload`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/zip",
      },
      body: zipBytes,
    },
  );

  const data = await response.json();
  if (!response.ok || data.uploadState === "FAILURE") {
    throw new Error(`Upload failed: ${JSON.stringify(data)}`);
  }
  return data;
}

async function submitForReview(accessToken) {
  const response = await fetch(
    `https://chromewebstore.googleapis.com/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}:publish`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  const data = await response.json();
  if (!response.ok || data.status?.some((status) => status.includes("FAILED"))) {
    throw new Error(`Submit failed: ${JSON.stringify(data)}`);
  }
  return data;
}

const accessToken = await getAccessToken();
const uploadResult = await uploadZip(accessToken);
console.log(`Uploaded ${basename(zipFile)}: ${JSON.stringify(uploadResult)}`);

if (action === "submit") {
  const submitResult = await submitForReview(accessToken);
  console.log(`Submitted for review: ${JSON.stringify(submitResult)}`);
} else {
  console.log("Draft uploaded. Submit manually in the Chrome Web Store Developer Dashboard when ready.");
}
