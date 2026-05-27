const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

// ─── Config ───
const BASE_DIR     = __dirname;
const UPLOAD_DIR   = path.join(BASE_DIR, 'uploads');
const CACHE_DIR    = path.join(BASE_DIR, 'cache');
const SIGNED_DIR   = path.join(BASE_DIR, 'signed');
const INDEX_FILE   = path.join(BASE_DIR, 'index.php');
const PUBLIC_URL   = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// REPLACE with your own direct IPA link
const APP_SOURCES = {
  weplay: 'https://1007.filemail.com/api/file/get?filekey=EeXa8eOmh3xZDBJcAQZnxsA07c3xTqPK9IwI1j-rmIQtun9tsvuHRehXy95kOkEyTqrcfEp1wCWxP-VL0dF1oPP3gCSEe0Fw-w'
};

// ─── Setup ───
fs.ensureDirSync(UPLOAD_DIR);
fs.ensureDirSync(CACHE_DIR);
fs.ensureDirSync(SIGNED_DIR);

// Serve signed output files
app.use('/signed', express.static(SIGNED_DIR));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    path.extname(file.originalname).toLowerCase() === '.zip'
      ? cb(null, true)
      : cb(new Error('Only .zip files are allowed'));
  }
});

// ─── Helpers ───

async function extractCerts(zipPath, extractTo) {
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(extractTo, true);
  const files = await fs.readdir(extractTo);
  const p12 = files.find(f => f.endsWith('.p12'));
  const mp  = files.find(f => f.endsWith('.mobileprovision'));
  if (!p12 || !mp) throw new Error('ZIP must contain .p12 and .mobileprovision');
  return { p12: path.join(extractTo, p12), mp: path.join(extractTo, mp) };
}

async function getAppIPA(appName) {
  const cached = path.join(CACHE_DIR, `${appName}.ipa`);
  if (await fs.pathExists(cached)) {
    console.log(`[Cache] Using cached ${appName}.ipa`);
    return cached;
  }
  const url = APP_SOURCES[appName];
  if (!url) throw new Error('Unknown app');
  
  console.log(`[Download] Fetching ${appName}...`);
  await execAsync(
    `curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" -o "${cached}" "${url}"`,
    { timeout: 600000 }
  );
  
  if (!(await fs.pathExists(cached))) throw new Error('Download failed — server returned empty file');
  const stats = await fs.stat(cached);
  if (stats.size < 1000000) throw new Error('Downloaded file is too small — likely an HTML page, not an IPA');
  
  console.log(`[Download] Saved ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
  return cached;
}

async function signIPA(input, output, p12, mp, pass) {
  const cmd = `zsign -k "${p12}" -p "${pass}" -m "${mp}" -o "${output}" -z 9 "${input}"`;
  console.log(`[Sign] Running zsign...`);
  const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 });
  if (stderr && stderr.toLowerCase().includes('error')) throw new Error(stderr);
  console.log(`[Sign] Done`);
  return output;
}

function generatePlist(title, ipaUrl, bundleId = 'com.wejoy.weplay.us') {
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

// ─── Routes ───

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', index_exists: fs.existsSync(INDEX_FILE) });
});

// Sign endpoint
app.post('/sign', upload.single('certzip'), async (req, res) => {
  const workDir = path.join(UPLOAD_DIR, `${Date.now()}`);
  try {
    const { app, p12pass } = req.body;
    if (!app || !p12pass || !req.file) {
      return res.status(400).json({ success: false, error: 'Missing app, password, or ZIP' });
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
    const plist = generatePlist('WePlay', ipaUrl);
    const plistPath = path.join(outDir, 'install.plist');
    await fs.writeFile(plistPath, plist);

    const plistUrl = `${PUBLIC_URL}/signed/${jobId}/install.plist`;
    const installUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(plistUrl)}`;

    await fs.remove(workDir);
    await fs.remove(req.file.path);

    res.json({ success: true, app: 'WePlay', ipa: ipaUrl, plist: plistUrl, install: installUrl });

  } catch (err) {
    await fs.remove(workDir).catch(() => {});
    if (req.file) await fs.remove(req.file.path).catch(() => {});
    console.error('[Error]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ROOT: Serve index.php from SAME folder ───
app.get('/', (req, res) => {
  if (fs.existsSync(INDEX_FILE)) {
    return res.sendFile(INDEX_FILE);
  }
  res.status(404).send('index.php not found in server folder. Please place it next to node.js');
});

// Catch-all
app.use((req, res) => {
  res.status(404).send(`Cannot GET ${req.path} — <a href="/">Go home</a>`);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at ${PUBLIC_URL}`);
  console.log(`📁 Looking for index.php at: ${INDEX_FILE}`);
  console.log(`🔧 Health check: ${PUBLIC_URL}/health`);
});
