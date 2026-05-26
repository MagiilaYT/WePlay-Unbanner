<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Web Sign IPA — WePlay</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #0f172a;
      color: #fff;
      padding: 24px;
    }
    .wrap {
      max-width: 560px;
      margin: 40px auto;
      background: #111827;
      border-radius: 18px;
      padding: 24px;
      box-shadow: 0 10px 30px rgba(0,0,0,.35);
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
    }
    p {
      color: #cbd5e1;
      line-height: 1.5;
    }
    label {
      display: block;
      margin: 16px 0 8px;
      font-weight: 700;
    }
    .app-badge {
      display: block;
      width: 100%;
      padding: 14px;
      border-radius: 14px;
      border: 1px solid #2563eb;
      background: #0b1220;
      color: #fff;
      text-align: center;
      font-weight: 700;
      font-size: 16px;
      margin-top: 10px;
    }
    input[type="file"],
    input[type="password"] {
      width: 100%;
      padding: 12px;
      border-radius: 12px;
      border: 1px solid #334155;
      background: #0b1220;
      color: #fff;
    }
    button, .btn {
      width: 100%;
      padding: 14px;
      border: 0;
      border-radius: 12px;
      background: #2563eb;
      color: #fff;
      font-size: 16px;
      cursor: pointer;
      margin-top: 18px;
      text-align: center;
    }
    button:hover, .btn:hover {
      background: #1d4ed8;
    }
    .muted {
      color: #94a3b8;
      font-size: 14px;
    }
    .result {
      margin-top: 20px;
      padding: 16px;
      border-radius: 12px;
      background: #0b1220;
      border: 1px solid #1e293b;
      word-break: break-word;
    }
    .error { color: #fca5a5; }
    .success { color: #86efac; }
    .links a {
      color: #93c5fd;
      display: block;
      margin-top: 10px;
    }
    .small-link {
      margin-top: 12px;
      font-size: 13px;
      color: #94a3b8;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Web Sign IPA</h1>
    <p>Upload your certificate ZIP and enter your p12 password to sign <b>WePlay</b>.</p>

    <form id="signForm">
      <label>App</label>
      <div class="app-badge">WePlay</div>
      <input type="hidden" name="app" value="weplay">

      <label>Certificate ZIP File</label>
      <input type="file" name="certzip" accept=".zip" required>

      <label>p12 Password</label>
      <input type="password" name="p12pass" placeholder="Enter your p12 password" required>

      <button type="submit">Sign &amp; Generate Install Link</button>
    </form>

    <p class="muted">
      The ZIP only needs to contain <b>.p12</b> and <b>.mobileprovision</b>.<<br>
      After signing, open the install link in <b>Safari on your iPhone</b>.
    </p>

    <div id="result" class="result" style="display:none;"></div>
  </div>

  <script>
    const form = document.getElementById("signForm");
    const result = document.getElementById("result");

    function copyLink(link) {
      navigator.clipboard.writeText(link).then(() => {
        alert("Install link copied!");
      }).catch(() => {
        prompt("Copy this link:", link);
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      result.style.display = "block";
      result.innerHTML = "Checking cache, downloading WePlay if missing, then signing...";

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
            <button class="btn" onclick="window.location.href='${data.install}'">Install Directly</button>
            <button class="btn" onclick="copyLink('${data.install}')">📋 Copy Install Link</button>
            <a href="${data.ipa}" target="_blank">Download Signed IPA</a>
            <a href="${data.plist}" target="_blank">Open plist</a>
            <div class="small-link">${data.install}</div>
          </div>
        `;
      } catch (err) {
        result.innerHTML = `<div class="error">❌ An error occurred during signing.</div>`;
      }
    });
  </script>
</body>
</html>