const express = require("express");
const multer = require("multer");
const AdmZip = require("adm-zip");
const fs = require("fs-extra");
const path = require("path");
const { exec } = require("child_process");
const util = require("util");

const execAsync = util.promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

// ─── Config ───
const BASE_DIR   = __dirname;
const UPLOAD_DIR = path.join(BASE_DIR, "uploads");
const CACHE_DIR  = path.join(BASE_DIR, "cache");
const SIGNED_DIR = path.join(BASE_DIR, "signed");
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// REPLACE with your own direct IPA download link
const APP_SOURCES = {
  weplay: "https://1007.filemail.com/api/file/get?filekey=EeXa8eOmh3xZDBJcAQZnxsA07c3xTqPK9IwI1j-rmIQtun9tsvuHRehXy95kOkEyTqrcfEp1wCWxP-VL0dF1oPP3gCSEe0Fw-w"
};

// ─── Setup ───
fs.ensureDirSync(UPLOAD_DIR);
fs.ensureDirSync(CACHE_DIR);
fs.ensureDirSync(SIGNED_DIR);

app.use("/signed", express.static(SIGNED_DIR));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    path.extname(file.originalname).toLowerCase() === ".zip"
      ? cb(null, true)
      : cb(new Error("Only .zip files are allowed"));
  }
});

// ─── Helpers ───

async function extractCerts(zipPath, extractTo) {
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(extractTo, true);
  const files = await fs.readdir(extractTo);
  const p12 = files.find(f => f.endsWith(".p12"));
  const mp  = files.find(f => f.endsWith(".mobileprovision"));
  if (!p12 || !mp) throw new Error("ZIP must contain .p12 and .mobileprovision");
  return { p12: path.join(extractTo, p12), mp: path.join(extractTo, mp) };
}

async function getAppIPA(appName) {
  const cached = path.join(CACHE_DIR, `${appName}.ipa`);
  if (await fs.pathExists(cached)) {
    console.log(`[Cache] Using cached ${appName}.ipa`);
    return cached;
  }
  const url = APP_SOURCES[appName];
  if (!url) throw new Error("Unknown app");

  console.log(`[Download] Fetching ${appName}...`);
  await execAsync(
    `curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" -o "${cached}" "${url}"`,
    { timeout: 600000 }
  );

  if (!(await fs.pathExists(cached))) throw new Error("Download failed — server returned empty file");
  const stats = await fs.stat(cached);
  if (stats.size < 1000000) throw new Error("Downloaded file is too small — likely an HTML page, not an IPA");

  console.log(`[Download] Saved ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
  return cached;
}

async function signIPA(input, output, p12, mp, pass) {
  const cmd = `zsign -k "${p12}" -p "${pass}" -m "${mp}" -o "${output}" -z 9 "${input}"`;
  console.log(`[Sign] Running zsign...`);
  const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 });
  if (stderr && stderr.toLowerCase().includes("error")) throw new Error(stderr);
  console.log(`[Sign] Done`);
  return output;
}

function generatePlist(title, ipaUrl, bundleId = "com.wejoy.weplay.us") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<<plist version="1.0">
<<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key><string>software-package</string>
          <key>url</key><string>${ipaUrl}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key><string>${bundleId}</string>
        <key>kind</key><string>software</string>
        <key>title</key><string>${title}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`;
}

// ─── Sign Endpoint ───
app.post("/sign", upload.single("certzip"), async (req, res) => {
  const workDir = path.join(UPLOAD_DIR, `${Date.now()}`);
  try {
    const { app, p12pass } = req.body;
    if (!app || !p12pass || !req.file) {
      return res.status(400).json({ success: false, error: "Missing app, password, or ZIP" });
    }

    await fs.ensureDir(workDir);
    const certs = await extractCerts(req.file.path, workDir);
    const originalIPA = await getAppIPA(app);

    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const outDir = path.join(SIGNED_DIR, jobId);
    await fs.ensureDir(outDir);

    const signedIPA = path.join(outDir, `weplay-signed.ipa`);
    await signIPA(originalIPA, signedIPA, certs.p12, certs.mp, p12pass);

    const ipaUrl = `${PUBLIC_URL}/signed/${jobId}/weplay-signed.ipa`;
    const plist = generatePlist("WePlay", ipaUrl);
    const plistPath = path.join(outDir, "install.plist");
    await fs.writeFile(plistPath, plist);

    const plistUrl = `${PUBLIC_URL}/signed/${jobId}/install.plist`;
    const installUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(plistUrl)}`;

    await fs.remove(workDir);
    await fs.remove(req.file.path);

    res.json({ success: true, app: "WePlay", ipa: ipaUrl, plist: plistUrl, install: installUrl });

  } catch (err) {
    await fs.remove(workDir).catch(() => {});
    if (req.file) await fs.remove(req.file.path).catch(() => {});
    console.error("[Error]", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Root: Serve HTML inline (no external file needed) ───
app.get("/", (req, res) => {
  res.set("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Web Sign IPA — WePlay</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #fff;
      min-height: 100vh;
      padding: 24px;
    }
    .wrap {
      max-width: 560px;
      margin: 40px auto;
      background: rgba(17, 24, 39, 0.95);
      border-radius: 20px;
      padding: 32px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      border: 1px solid rgba(255,255,255,0.05);
    }
    h1 {
      font-size: 32px;
      margin-bottom: 8px;
      background: linear-gradient(90deg, #60a5fa, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      color: #94a3b8;
      font-size: 15px;
      margin-bottom: 24px;
    }
    label {
      display: block;
      margin: 20px 0 8px;
      font-weight: 600;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #cbd5e1;
    }
    .app-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 16px;
      border-radius: 14px;
      border: 2px solid #2563eb;
      background: rgba(37, 99, 235, 0.1);
      color: #fff;
      font-weight: 700;
      font-size: 18px;
      margin-top: 8px;
    }
    input[type="file"],
    input[type="password"] {
      width: 100%;
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid #334155;
      background: #0b1220;
      color: #fff;
      font-size: 15px;
      transition: border-color 0.2s;
    }
    input[type="file"]:focus,
    input[type="password"]:focus {
      outline: none;
      border-color: #2563eb;
    }
    input[type="file"]::file-selector-button {
      background: #2563eb;
      color: #fff;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      margin-right: 12px;
      cursor: pointer;
    }
    button, .btn {
      width: 100%;
      padding: 16px;
      border: 0;
      border-radius: 12px;
      background: linear-gradient(90deg, #2563eb, #4f46e5);
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 24px;
      transition: transform 0.1s, box-shadow 0.2s;
    }
    button:hover, .btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 10px 30px rgba(37, 99, 235, 0.3);
    }
    button:active {
      transform: translateY(0);
    }
    .muted {
      color: #64748b;
      font-size: 13px;
      margin-top: 20px;
      line-height: 1.6;
      padding: 16px;
      background: rgba(255,255,255,0.02);
      border-radius: 10px;
      border-left: 3px solid #2563eb;
    }
    .result {
      margin-top: 24px;
      padding: 20px;
      border-radius: 14px;
      background: #0b1220;
      border: 1px solid #1e293b;
      word-break: break-word;
      display: none;
    }
    .error { color: #fca5a5; }
    .success { color: #86efac; font-weight: 600; margin-bottom: 16px; }
    .links a {
      color: #93c5fd;
      display: block;
      margin-top: 12px;
      text-decoration: none;
    }
    .links a:hover { text-decoration: underline; }
    .small-link {
      margin-top: 16px;
      font-size: 12px;
      color: #475569;
      word-break: break-all;
      font-family: monospace;
      background: rgba(255,255,255,0.03);
      padding: 10px;
      border-radius: 8px;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 1s ease-in-out infinite;
      margin-right: 8px;
      vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Web Sign IPA</h1>
    <p class="subtitle">Upload your certificate ZIP and enter your p12 password to sign <b>WePlay</b>.</p>

    <form id="signForm">
      <label>App</label>
      <div class="app-badge">🎮 WePlay</div>
      <input type="hidden" name="app" value="weplay">

      <label>Certificate ZIP File</label>
      <input type="file" name="certzip" accept=".zip" required>

      <label>p12 Password</label>
      <input type="password" name="p12pass" placeholder="Enter your p12 password" required>

      <button type="submit">
        <span id="btnText">Sign &amp; Generate Install Link</span>
      </button>
    </form>

    <p class="muted">
      <b>Required:</b> ZIP must contain <b>.p12</b> and <b>.mobileprovision</b>.<<br>
      After signing, open the install link in <b>Safari on your iPhone</b>.
    </p>

    <div id="result" class="result"></div>
  </div>

  <script>
    const form = document.getElementById("signForm");
    const result = document.getElementById("result");
    const btnText = document.getElementById("btnText");

    function copyLink(link) {
      navigator.clipboard.writeText(link).then(() => {
        alert("Install link copied to clipboard!");
      }).catch(() => {
        prompt("Copy this link:", link);
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      result.style.display = "block";
      result.innerHTML = '<span class="spinner"></span> Checking cache, downloading WePlay if missing, then signing...';
      btnText.textContent = "Signing...";
      form.querySelector("button").disabled = true;

      try {
        const formData = new FormData(form);
        const res = await fetch("/sign", { method: "POST", body: formData });
        const text = await res.text();

        let data;
        try {
          data = JSON.parse(text);
        } catch {
          result.innerHTML = '<div class="error">❌ ' + text + '</div>';
          return;
        }

        if (!res.ok || !data.success) {
          result.innerHTML = '<div class="error">❌ ' + (data.error || "Signing failed.") + '</div>';
          return;
        }

        result.innerHTML =
          '<div class="success">✅ WePlay signed successfully</div>' +
          '<div class="links">' +
            '<button class="btn" onclick="window.location.href=\\'' + data.install + '\\'">📱 Install Directly</button>' +
            '<button class="btn" onclick="copyLink(\\'' + data.install + '\\')">📋 Copy Install Link</button>' +
            '<a href="' + data.ipa + '" target="_blank">⬇️ Download Signed IPA</a>' +
            '<a href="' + data.plist + '" target="_blank">📄 Open plist</a>' +
            '<div class="small-link">' + data.install + '</div>' +
          '</div>';
      } catch (err) {
        result.innerHTML = '<div class="error">❌ An error occurred during signing.</div>';
      } finally {
        btnText.textContent = "Sign & Generate Install Link";
        form.querySelector("button").disabled = false;
      }
    });
  </script>
</body>
</html>`);
});

// ─── Health check ───
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ─── Catch-all ───
app.use((req, res) => {
  res.status(404).send("Cannot GET " + req.path + ' — <a href="/">Go home</a>');
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at ${PUBLIC_URL}`);
  console.log(`🔧 Health check: ${PUBLIC_URL}/health`);
});
