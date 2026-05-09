'use strict';

const express      = require('express');
const session      = require('express-session');
const multer       = require('multer');
const fetch        = require('node-fetch');
const PDFDocument  = require('pdfkit');
const fs           = require('fs');
const path         = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Config (set these as environment variables in Railway) ────────────────────
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD || 'primetime2026';
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY || '';
const SESSION_SECRET  = process.env.SESSION_SECRET  || 'pt-secret-change-me';

// ── Assets ────────────────────────────────────────────────────────────────────
const ASSETS       = path.join(__dirname, 'assets');
const HEADER_IMG   = path.join(ASSETS, 'pt_header_strip.jpg');
const FOOTER_IMG   = path.join(ASSETS, 'lh_footer.png');

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));

// Photo upload (memory storage — base64 sent in JSON)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/login');
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Login page
app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Prime Time — Login</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600&family=Barlow+Condensed:wght@700;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Barlow',sans-serif;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:6px;padding:48px 40px;width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
.logo{display:flex;align-items:center;gap:10px;margin-bottom:32px;justify-content:center}
.hex{width:36px;height:36px;background:#FFE600;clip-path:polygon(25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%);display:grid;place-items:center;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:16px}
.logo-txt{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:18px;text-transform:uppercase;letter-spacing:.05em}
.logo-txt em{color:#FFE600;font-style:normal}
h1{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:20px;text-align:center;margin-bottom:24px;text-transform:uppercase;letter-spacing:.06em}
label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#888;display:block;margin-bottom:5px}
input{width:100%;background:#F8F8F8;border:1px solid #E0E0E0;border-radius:4px;font-family:'Barlow',sans-serif;font-size:14px;padding:10px 12px;outline:none;transition:border-color .14s;margin-bottom:18px}
input:focus{border-color:#111}
button{width:100%;background:#111;color:#fff;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:16px;letter-spacing:.1em;text-transform:uppercase;border:none;padding:13px;cursor:pointer;border-radius:4px;transition:background .14s}
button:hover{background:#333}
.err{color:#E53935;font-size:12px;text-align:center;margin-top:12px;min-height:18px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="hex">T</div>
    <div class="logo-txt">Prime Time <em>Electricians</em></div>
  </div>
  <h1>Report Portal</h1>
  <form method="POST" action="/login">
    <label>Password</label>
    <input type="password" name="password" placeholder="Enter team password" autofocus>
    <button type="submit">Sign In</button>
    <div class="err">${req.query.err ? 'Incorrect password — try again' : ''}</div>
  </form>
</div>
</body>
</html>`);
});

app.post('/login', (req, res) => {
  if (req.body.password === PORTAL_PASSWORD) {
    req.session.authenticated = true;
    res.redirect('/');
  } else {
    res.redirect('/login?err=1');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Main editor — serve static file
app.use('/', requireAuth, express.static(path.join(__dirname, 'public')));

// ── API: Generate report text via Claude ──────────────────────────────────────
app.post('/api/generate', requireAuth, async (req, res) => {
  const d = req.body;

  const photoLines = (d.photos || [])
    .filter(p => p.data)
    .map((p, i) => `Photo ${i + 1}: ${p.caption}`)
    .join('\n') || 'No photos uploaded';

  const prompt = `Write a professional insurance inspection report for Prime Time Electricians. Formal prose only — no bullet checklists, no scores. Use ## headings for each section.

Address: ${d.address}
Inspection date: ${d.inspDate} at ${d.inspTime} | Report date: ${d.rptDate}
Insured: ${d.insured} | Technician: ${d.tech}

Item: ${d.item} | Model: ${d.model} | Age: ${d.age} | Fault code: ${d.fault}
Cable: ${d.cable} | Pipe run: ${d.pipe} | Pipe size: ${d.pipeSize} | Mounting: ${d.mount}
Drain pump: ${d.drainPump} | Owner reported damage: ${d.ownerDate}
Wear & tear (unrelated): ${d.wearTear} | Refrigerant leak signs: ${d.leakSigns}

Findings: ${d.findings}
Cause: ${d.causeS} — ${d.causeD}
Recommendation: ${d.rec} ${d.repair}
Summary: ${d.summary}

Photos on site:
${photoLines}

Sections to write:
## 1. Site & Inspection Details
## 2. Item Inspected
## 3. Inspection Findings
## 4. Cause of Damage
## 5. Repair Recommendation
## 6. Summary
## 7. Site Photographs`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const json = await response.json();
    if (!response.ok) throw new Error(json.error?.message || 'API error');
    const text = json.content?.[0]?.text || '';
    res.json({ ok: true, text });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API: Generate PDF ──────────────────────────────────────────────────────────
app.post('/api/pdf', requireAuth, async (req, res) => {
  const { reportText, photos, address, rptDate, tech } = req.body;

  try {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 115, bottom: 90, left: 57, right: 57 },
      autoFirstPage: false
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    // Colours
    const BLACK  = '#111111';
    const DGREY  = '#333333';
    const MGREY  = '#888888';
    const YELLOW = '#FFE600';

    // Image buffers
    const headerBuf = fs.readFileSync(HEADER_IMG);
    const footerBuf = fs.readFileSync(FOOTER_IMG);

    // Photo buffers from base64
    const photoItems = (photos || []).map(p => ({
      buf: p.data ? Buffer.from(p.data.split(',')[1], 'base64') : null,
      caption: p.caption
    }));

    function addPage() {
      doc.addPage();
      const pw = doc.page.width;

      // Header image — full width
      const hRatio = 350 / 2068;
      const hH = pw * hRatio;
      doc.image(headerBuf, 0, 0, { width: pw, height: hH });

      // Footer accreditation image
      const fH = 46;
      const fW = fH * (792 / 438);
      doc.image(footerBuf, 57, doc.page.height - 68, { width: fW, height: fH });

      // Footer text
      doc.fontSize(7.5).fillColor(MGREY)
        .text('Confidential — Prepared for Insurance Purposes Only',
              0, doc.page.height - 52, { align: 'right', width: pw - 57 })
        .text(`Prime Time Electricians  |  ABN 88 151 349 012  |  EC 9142  |  Page ${doc.bufferedPageRange().count}`,
              0, doc.page.height - 40, { align: 'right', width: pw - 57 });
    }

    // Parse report text into sections
    const sections = [];
    let current = null;
    for (const line of reportText.split('\n')) {
      if (line.startsWith('## ')) {
        if (current) sections.push(current);
        const title = line.replace(/^## \d+\.\s*/, '').replace('## ', '').trim();
        current = { title: title.toUpperCase(), paras: [] };
      } else if (line.trim() && current) {
        current.paras.push(line.trim());
      }
    }
    if (current) sections.push(current);

    // Build content
    addPage();

    for (const sec of sections) {
      // Check space — if less than 80pt left, new page
      if (doc.y > doc.page.height - doc.page.margins.bottom - 80) {
        addPage();
      }

      // Section heading
      doc.moveDown(0.6)
         .fontSize(11)
         .fillColor(BLACK)
         .font('Helvetica-Bold')
         .text(sec.title, { continued: false });

      doc.moveDown(0.3);

      // Body paragraphs
      for (const para of sec.paras) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 60) {
          addPage();
        }
        doc.fontSize(10)
           .fillColor(DGREY)
           .font('Helvetica')
           .text(para, { lineGap: 3 })
           .moveDown(0.4);
      }

      // Photos section
      if (sec.title === 'SITE PHOTOGRAPHS') {
        const valid = photoItems.filter(p => p.buf);
        if (valid.length > 0) {
          doc.moveDown(0.4);
          const pw     = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          const gap    = 8;
          const cols   = 3;
          const imgW   = (pw - gap * (cols - 1)) / cols;
          const imgH   = imgW * 0.75;
          const capH   = 20;
          const rowH   = imgH + capH + gap;

          let col = 0;
          let rowStartY = doc.y;

          for (let i = 0; i < valid.length; i++) {
            const { buf, caption } = valid[i];
            const x = doc.page.margins.left + col * (imgW + gap);
            const y = rowStartY;

            // New page if needed
            if (y + rowH > doc.page.height - doc.page.margins.bottom) {
              addPage();
              rowStartY = doc.y;
            }

            // Draw photo
            try {
              doc.image(buf, x, rowStartY, { width: imgW, height: imgH, cover: [imgW, imgH] });
            } catch(e) { /* skip bad image */ }

            // Caption
            doc.fontSize(7.5).fillColor(MGREY).font('Helvetica')
               .text(caption, x, rowStartY + imgH + 3, { width: imgW, align: 'center' });

            col++;
            if (col >= cols) {
              col = 0;
              rowStartY += rowH;
            }
          }
        }
      }
    }

    doc.end();

    await new Promise(resolve => doc.on('end', resolve));

    const pdfBuffer = Buffer.concat(chunks);
    const filename  = `Insurance_Report_${(address || 'Report').replace(/[^a-zA-Z0-9]+/g, '_')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);

  } catch (err) {
    console.error('PDF error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Prime Time Report Portal`);
  console.log(`  Running on http://localhost:${PORT}`);
  console.log(`  Password: ${PORTAL_PASSWORD}\n`);
});
