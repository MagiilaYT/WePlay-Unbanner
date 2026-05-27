<!DOCTYPE html>
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
          result.innerHTML = `<div class="error">❌ ${text}</div>`;
          return;
        }

        if (!res.ok || !data.success) {
          result.innerHTML = `<div class="error">❌ ${data.error || "Signing failed."}</div>`;
          return;
        }

        result.innerHTML = `
          <div class="success">✅ WePlay signed successfully</div>
          <div class="links">
            <button class="btn" onclick="window.location.href='${data.install}'">📱 Install Directly</button>
            <button class="btn" onclick="copyLink('${data.install}')">📋 Copy Install Link</button>
            <a href="${data.ipa}" target="_blank">⬇️ Download Signed IPA</a>
            <a href="${data.plist}" target="_blank">📄 Open plist</a>
            <div class="small-link">${data.install}</div>
          </div>
        `;
      } catch (err) {
        result.innerHTML = `<div class="error">❌ An error occurred during signing.</div>`;
      } finally {
        btnText.textContent = "Sign & Generate Install Link";
        form.querySelector("button").disabled = false;
      }
    });
  </script>
</body>
</html>
