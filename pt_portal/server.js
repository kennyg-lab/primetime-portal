'use strict';

const express     = require('express');
const session     = require('express-session');
const multer      = require('multer');
const fetch       = require('node-fetch');
const PDFDocument = require('pdfkit');
const pdfParse    = require('pdf-parse');
const { PDFDocument: PDFLib } = require('pdf-lib');
const { v4: uuid }= require('uuid');
const fs          = require('fs');
const path        = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD || 'primetime2026';
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY || '';
const SESSION_SECRET  = process.env.SESSION_SECRET   || 'pt-secret-change-me';

const ASSETS     = path.join(__dirname, 'assets');
const HEADER_IMG = path.join(ASSETS, 'pt_header_strip.jpg');
const FOOTER_IMG = path.join(ASSETS, 'lh_footer.png');

// ── Database ──────────────────────────────────────────────────────────────────
const DB = { reports: [] };
function readDB() {
  try { const d = JSON.parse(fs.readFileSync('/tmp/pt_reports.json','utf8')); DB.reports = d.reports||[]; } catch(e) {}
  return DB;
}
function writeDB() {
  try { fs.writeFileSync('/tmp/pt_reports.json', JSON.stringify(DB,null,2)); } catch(e) {}
}
readDB();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false, maxAge: 8*60*60*1000 } }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25*1024*1024 } });

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.redirect('/login');
}

// ── Claude API ────────────────────────────────────────────────────────────────
async function callClaude(messages, maxTokens=1500) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'x-api-key':ANTHROPIC_KEY, 'anthropic-version':'2023-06-01' },
    body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:maxTokens, messages })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message||'API error');
  return json.content?.[0]?.text||'';
}

// ── Styles ────────────────────────────────────────────────────────────────────
const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--y:#FFE600;--blk:#111;--bdr:#E0E0E0;--grey:#777;--txt:#222}
body{font-family:"Inter",sans-serif;background:#fff;color:var(--txt);min-height:100vh}
.topbar{background:var(--blk);border-bottom:3px solid var(--y);padding:0 28px;display:flex;align-items:center;justify-content:space-between;height:58px;position:sticky;top:0;z-index:100}
.logo{display:flex;align-items:center;gap:10px;text-decoration:none}
.hex{width:28px;height:28px;background:var(--y);clip-path:polygon(25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%);display:grid;place-items:center;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:13px;color:var(--blk)}
.logo-txt{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:#fff}
.logo-txt em{color:var(--y);font-style:normal}
.topnav{display:flex;align-items:center;gap:4px}
.tnav{color:#888;font-size:12px;font-weight:500;text-decoration:none;padding:6px 12px;border-radius:3px;transition:all .13s}
.tnav:hover{color:#fff;background:rgba(255,255,255,.08)}
.tnav.on{color:var(--y);background:rgba(255,230,0,.1)}
.logout{font-size:11px;font-weight:600;color:#555;text-decoration:none;text-transform:uppercase;letter-spacing:.06em}
.logout:hover{color:#fff}
.page{max-width:1000px;margin:0 auto;padding:32px 28px}
.page-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
.page-title{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:22px;text-transform:uppercase;letter-spacing:.04em}
.btn{display:inline-flex;align-items:center;gap:7px;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:13px;letter-spacing:.1em;text-transform:uppercase;border:none;padding:9px 22px;cursor:pointer;border-radius:3px;text-decoration:none;transition:all .13s}
.btn-blk{background:var(--blk);color:#fff}.btn-blk:hover{background:#333}
.btn-y{background:var(--y);color:var(--blk)}.btn-y:hover{background:#FFF176}
.btn-sm{font-size:11px;padding:6px 13px}
.btn-ghost{background:transparent;color:var(--grey);border:1px solid var(--bdr)}.btn-ghost:hover{color:var(--txt);border-color:#aaa}
.btn-grn{background:#4CAF50;color:#fff}.btn-blu{background:#2196F3;color:#fff}.btn-red{background:transparent;color:#E53935;border:1px solid #FFCDD2}
`;

function shell(title, nav, body) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prime Time — ${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Barlow+Condensed:wght@700;900&display=swap" rel="stylesheet">
<style>${BASE_CSS}</style></head><body>
<div class="topbar">
  <a class="logo" href="/"><div class="hex">T</div><div class="logo-txt">Prime Time <em>Electricians</em></div></a>
  <div class="topnav">
    <a class="tnav ${nav==='dash'?'on':''}" href="/">Dashboard</a>
    <a class="tnav ${nav==='new'?'on':''}" href="/new">New Report</a>
    <a class="tnav ${nav==='upload'?'on':''}" href="/upload">Upload iAudit</a>
  </div>
  <a class="logout" href="/logout">Sign Out</a>
</div>
<div class="page">${body}</div>
</body></html>`;
}

// ── Login ─────────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Prime Time Login</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;900&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:6px;padding:48px 40px;width:100%;max-width:360px}
.logo{display:flex;align-items:center;gap:10px;margin-bottom:32px;justify-content:center}
.hex{width:34px;height:34px;background:#FFE600;clip-path:polygon(25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%);display:grid;place-items:center;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:15px}
.lt{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:17px;text-transform:uppercase;letter-spacing:.05em}
.lt em{color:#FFE600;font-style:normal}
h1{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:18px;text-align:center;margin-bottom:24px;text-transform:uppercase}
label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#888;display:block;margin-bottom:5px}
input{width:100%;background:#F8F8F8;border:1px solid #E0E0E0;border-radius:4px;font-size:14px;padding:10px 12px;outline:none;margin-bottom:16px}
button{width:100%;background:#111;color:#fff;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:15px;letter-spacing:.1em;text-transform:uppercase;border:none;padding:13px;cursor:pointer;border-radius:4px}
.err{color:#E53935;font-size:12px;text-align:center;margin-top:10px}
</style></head><body><div class="card">
<div class="logo"><div class="hex">T</div><div class="lt">Prime Time <em>Electricians</em></div></div>
<h1>Report Portal</h1>
<form method="POST" action="/login">
<label>Team Password</label>
<input type="password" name="password" placeholder="Enter password" autofocus>
<button type="submit">Sign In</button>
<div class="err">${req.query.err?'Incorrect password':''}</div>
</form></div></body></html>`));

app.post('/login', (req, res) => {
  req.body.password === PORTAL_PASSWORD
    ? (req.session.authenticated=true, res.redirect('/'))
    : res.redirect('/login?err=1');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/', requireAuth, (req, res) => {
  readDB();
  const reports = [...DB.reports].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const badge = s => {
    const m={pending:['#FFF8E1','#F59E0B','Pending'],approved:['#E8F5E9','#4CAF50','Approved'],sent:['#E3F2FD','#2196F3','Sent']};
    const [bg,c,l]=m[s]||m.pending;
    return `<span style="background:${bg};color:${c};font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:2px">${l}</span>`;
  };
  const counts={pending:0,approved:0,sent:0};
  reports.forEach(r=>{if(counts[r.status]!==undefined)counts[r.status]++;});
  const rows = reports.length===0
    ? `<tr><td colspan="6" style="text-align:center;padding:48px;color:#bbb;font-size:13px">No reports yet</td></tr>`
    : reports.map(r=>`<tr style="border-bottom:1px solid #F5F5F5">
        <td style="padding:13px 12px;font-size:13px;font-weight:600">${r.address||'—'}</td>
        <td style="padding:13px 12px;font-size:12px;color:#888">${r.inspDate||'—'}</td>
        <td style="padding:13px 12px;font-size:12px;color:#888">${r.tech||'—'}</td>
        <td style="padding:13px 12px;font-size:12px;color:#888">${r.item||'—'}</td>
        <td style="padding:13px 12px">${badge(r.status)}</td>
        <td style="padding:13px 12px"><div style="display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap">
          <a href="/edit/${r.id}" class="btn btn-ghost btn-sm">Edit</a>
          ${r.reportText?`<a href="/download/${r.id}" class="btn btn-blk btn-sm">&#8595; PDF</a>`:''}
          ${r.status==='pending'?`<button onclick="setStatus('${r.id}','approved')" class="btn btn-sm btn-grn">&#10003; Approve</button>`:''}
          ${r.status==='approved'?`<button onclick="setStatus('${r.id}','sent')" class="btn btn-sm btn-blu">Mark Sent</button>`:''}
          <button onclick="del('${r.id}')" class="btn btn-sm btn-red">&#10005;</button>
        </div></td></tr>`).join('');

  res.send(shell('Dashboard','dash',`
    <div class="page-hd"><div class="page-title">Reports</div>
      <div style="display:flex;gap:8px">
        <a href="/upload" class="btn btn-ghost">&#8593; Upload iAudit</a>
        <a href="/new" class="btn btn-y">+ New Report</a>
      </div></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:24px">
      ${[['Pending','#F59E0B',counts.pending],['Approved','#4CAF50',counts.approved],['Sent','#2196F3',counts.sent]].map(([l,c,n])=>
        `<div style="background:#F8F8F8;border-radius:4px;padding:18px 22px;border-left:4px solid ${c}">
          <div style="font-size:28px;font-weight:700;font-family:'Barlow Condensed',sans-serif;color:${c}">${n}</div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#999;margin-top:4px">${l}</div>
        </div>`).join('')}
    </div>
    <div style="border:1px solid var(--bdr);border-radius:4px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#F8F8F8;border-bottom:3px solid #FFE600">
          ${['Address','Date','Technician','Item','Status','Actions'].map((h,i)=>`<th style="padding:11px 12px;text-align:${i===5?'right':'left'};font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888">${h}</th>`).join('')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    <script>
    async function setStatus(id,s){await fetch('/api/status/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:s})});location.reload();}
    async function del(id){if(!confirm('Delete?'))return;await fetch('/api/report/'+id,{method:'DELETE'});location.reload();}
    </script>`));
});

// ── Upload ────────────────────────────────────────────────────────────────────
app.get('/upload', requireAuth, (req, res) => {
  res.send(shell('Upload iAudit','upload',`
    <div class="page-hd"><div class="page-title">Upload iAudit Report</div></div>
    <div style="max-width:560px">
      <p style="font-size:13px;color:#666;margin-bottom:22px;line-height:1.75">Upload the iAudit PDF. The portal will read all details and write the inspection findings, cause of damage, recommendation and summary — ready for your review.</p>
      <div id="dz" style="border:2px dashed #DDD;border-radius:6px;padding:52px;text-align:center;cursor:pointer;background:#FAFAFA">
        <div style="font-size:36px;margin-bottom:12px">&#128196;</div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:16px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Drop iAudit PDF here</div>
        <div style="font-size:12px;color:#aaa">or click to browse</div>
        <input type="file" id="pdfFile" accept=".pdf" style="display:none">
      </div>
      <div id="st" style="margin-top:14px;font-size:13px;color:#888;text-align:center;min-height:20px"></div>
      <div id="goBtn" style="display:none;margin-top:16px">
        <button onclick="go()" class="btn btn-blk" style="width:100%;justify-content:center;font-size:15px;padding:14px">&#9889; Extract &amp; Open Editor</button>
      </div>
    </div>
    <script>
    const dz=document.getElementById('dz'),fi=document.getElementById('pdfFile'),st=document.getElementById('st'),gb=document.getElementById('goBtn');
    let file=null;
    dz.onclick=()=>fi.click();
    fi.onchange=e=>pick(e.target.files[0]);
    dz.ondragover=e=>{e.preventDefault();dz.style.borderColor='#111'};
    dz.ondragleave=()=>{dz.style.borderColor='#DDD'};
    dz.ondrop=e=>{e.preventDefault();dz.style.borderColor='#DDD';pick(e.dataTransfer.files[0])};
    function pick(f){if(!f||!f.name.endsWith('.pdf')){st.innerHTML='<span style="color:#E53935">Please select a PDF</span>';return;}
      file=f;dz.style.borderColor='#4CAF50';st.innerHTML='<span style="color:#4CAF50;font-weight:600">&#10003; '+f.name+'</span>';gb.style.display='block';}
    async function go(){
      if(!file)return;
      st.innerHTML='<span style="color:#888">Reading PDF and writing report sections... this takes 20-30 seconds</span>';
      gb.style.display='none';
      const fd=new FormData();fd.append('pdf',file);
      try{
        const res=await fetch('/api/extract',{method:'POST',body:fd});
        const json=await res.json();
        if(!json.ok)throw new Error(json.error);
        st.innerHTML='<span style="color:#4CAF50;font-weight:600">&#10003; Done! '+json.photosFound+' photos extracted — preparing report...</span>';
        setTimeout(()=>window.location.href='/review/'+json.reportId,800);
      }catch(e){st.innerHTML='<span style="color:#E53935">&#10005; '+e.message+'</span>';gb.style.display='block';}
    }
    </script>`));
});

// ── Review Page — full written report after upload ────────────────────────────
app.get('/review/:id', requireAuth, (req,res) => {
  readDB();
  const r = DB.reports.find(r=>r.id===req.params.id)
    || (req.session.lastReport?.id===req.params.id ? req.session.lastReport : null);
  if (!r) return res.redirect('/');

  const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  res.send(shell('Report Review', 'dash', `
    <style>
    .review-wrap{display:grid;grid-template-columns:1fr 240px;gap:24px;align-items:start}
    .review-body{background:#fff;border:1px solid var(--bdr);border-radius:4px;overflow:hidden}
    .review-hd{background:#111;padding:22px 28px;border-bottom:3px solid #FFE600}
    .review-hd h1{font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:20px;text-transform:uppercase;letter-spacing:.06em;color:#fff;margin-bottom:4px}
    .review-hd p{font-size:12px;color:#888}
    .review-section{padding:20px 28px;border-bottom:1px solid #F0F0F0}
    .review-section:last-child{border-bottom:none}
    .review-section h2{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#FFE600;background:#111;display:inline-block;padding:3px 10px;border-radius:2px;margin-bottom:10px}
    .review-section p{font-size:13px;line-height:1.85;color:#333;margin-bottom:6px}
    .review-section .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px}
    .review-section .meta-item{font-size:12px;color:#555}
    .review-section .meta-item strong{color:#111;font-weight:600;display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#999;margin-bottom:1px}
    .side-panel{position:sticky;top:80px;display:flex;flex-direction:column;gap:10px}
    .side-card{background:#F8F8F8;border:1px solid var(--bdr);border-radius:4px;padding:16px}
    .side-card h3{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:10px}
    .notice{background:#FFF8E1;border:1px solid #FFE082;border-radius:4px;padding:12px 14px;font-size:12px;color:#795548;line-height:1.6}
    </style>
    <div class="page-hd">
      <div class="page-title">Report Review</div>
      <div style="display:flex;gap:8px">
        <a href="/edit/${r.id}" class="btn btn-y">&#9998; Edit Report</a>
        <a href="/download/${r.id}" class="btn btn-ghost btn-sm" style="opacity:.4;pointer-events:none">&#8595; PDF (generate first)</a>
      </div>
    </div>
    <div class="notice" style="margin-bottom:18px">&#128065; This is the AI-generated draft. Review each section below, then click <strong>Edit Report</strong> to make changes before generating the final PDF.</div>
    <div class="review-wrap">
      <div class="review-body">
        <div class="review-hd">
          <h1>Insurance Inspection Report</h1>
          <p>Prime Time Electricians &nbsp;|&nbsp; Draft for Review</p>
        </div>

        <div class="review-section">
          <h2>01 — Site &amp; Inspection Details</h2>
          <div class="meta-grid">
            <div class="meta-item"><strong>Property Address</strong>${esc(r.address)||'—'}</div>
            <div class="meta-item"><strong>Inspection Date</strong>${esc(r.inspDate)||'—'}</div>
            <div class="meta-item"><strong>Inspection Time</strong>${esc(r.inspTime)||'—'}</div>
            <div class="meta-item"><strong>Insured</strong>${esc(r.insured)||'—'}</div>
            <div class="meta-item"><strong>Technician</strong>${esc(r.tech)||'—'}</div>
            <div class="meta-item"><strong>Year Built</strong>${esc(r.yearBuilt)||'—'}</div>
            <div class="meta-item"><strong>Roof Type</strong>${esc(r.roofType)||'—'}</div>
            <div class="meta-item"><strong>Date of Loss</strong>${esc(r.ownerDate)||'—'}</div>
          </div>
        </div>

        <div class="review-section">
          <h2>02 — Item Inspected</h2>
          <div class="meta-grid">
            <div class="meta-item"><strong>Item</strong>${esc(r.item)||'—'}</div>
            <div class="meta-item"><strong>Make &amp; Model</strong>${esc(r.model)||'—'}</div>
            <div class="meta-item"><strong>Approximate Age</strong>${esc(r.age)||'—'}</div>
            <div class="meta-item"><strong>Cable Size</strong>${esc(r.cable)||'—'}</div>
            <div class="meta-item"><strong>Voltage</strong>${esc(r.voltage)||'—'}</div>
            <div class="meta-item"><strong>Cutout</strong>${esc(r.cutout)||'—'}</div>
            <div class="meta-item"><strong>Cause of Damage</strong>${esc(r.causeS)||'—'}</div>
            <div class="meta-item"><strong>Wear &amp; Tear</strong>${esc(r.wearTear)||'—'}</div>
          </div>
        </div>

        <div class="review-section">
          <h2>03 — Inspection Findings</h2>
          <p>${esc(r.findings)||'<em style="color:#bbb">Not yet written — click Edit Report then Write Sections</em>'}</p>
        </div>

        <div class="review-section">
          <h2>04 — Cause of Damage</h2>
          <p>${esc(r.causeD)||'<em style="color:#bbb">Not yet written — click Edit Report then Write Sections</em>'}</p>
        </div>

        <div class="review-section">
          <h2>05 — Repair Recommendation</h2>
          <p>${esc(r.rec)||'<em style="color:#bbb">Not yet written</em>'}</p>
          ${r.repair ? `<p>${esc(r.repair)}</p>` : ''}
        </div>

        <div class="review-section">
          <h2>06 — Summary</h2>
          <p>${esc(r.summary)||'<em style="color:#bbb">Not yet written</em>'}</p>
        </div>

        <div class="review-section">
          <h2>07 — Site Photographs</h2>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:4px">
            ${(r.photos||[]).filter(p=>p.data).slice(0,9).map(p=>`
              <div style="border-radius:3px;overflow:hidden;aspect-ratio:4/3;background:#F8F8F8">
                <img src="${p.data}" style="width:100%;height:100%;object-fit:cover">
                <div style="font-size:10px;color:#888;padding:3px 6px;text-align:center">${esc(p.caption)}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="side-panel">
        <div class="side-card">
          <h3>Status</h3>
          <span style="background:#FFF8E1;color:#F59E0B;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:4px 10px;border-radius:2px">Draft</span>
        </div>
        <div class="side-card">
          <h3>Next Steps</h3>
          <a href="/edit/${r.id}" class="btn btn-y btn-sm" style="width:100%;justify-content:center;margin-bottom:8px">&#9998; Edit Report</a>
          <a href="/" class="btn btn-ghost btn-sm" style="width:100%;justify-content:center">&#8592; Dashboard</a>
        </div>
        <div class="side-card" style="font-size:12px;color:#888;line-height:1.65">
          <h3>About this draft</h3>
          Review the AI-written sections above. Click <strong>Edit Report</strong> to refine the wording, add details or adjust any section before generating the final PDF.
        </div>
      </div>
    </div>
  `));
});

// ── Editor ────────────────────────────────────────────────────────────────────
const EDITOR_CSS = `
.layout{display:grid;grid-template-columns:190px 1fr;gap:0;min-height:calc(100vh - 120px)}
.sidebar{background:#F8F8F8;border-right:1px solid var(--bdr);padding:10px 0}
.nav-a{display:flex;align-items:center;gap:7px;padding:8px 14px;color:#aaa;font-size:12px;font-weight:500;border-left:2px solid transparent;text-decoration:none;transition:all .12s}
.nav-a:hover{color:var(--txt);background:rgba(0,0,0,.04)}
.nav-a.on{color:var(--blk);border-left-color:var(--y);background:rgba(255,230,0,.08);font-weight:600}
.nav-grp{padding:8px 14px 2px;font-size:9px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#ccc;margin-top:6px}
.dot{width:4px;height:4px;border-radius:50%;background:currentColor;flex-shrink:0}
.editor{padding:0 0 0 28px}
.sec{margin-bottom:36px;scroll-margin-top:74px}
.sec-hd{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid var(--y)}
.sec-n{font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:11px;color:#ccc;letter-spacing:.08em}
.sec-t{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:16px;text-transform:uppercase;letter-spacing:.04em}
.fg{display:grid;grid-template-columns:1fr 1fr;gap:12px}.fg.one{grid-template-columns:1fr}
.fld{display:flex;flex-direction:column;gap:4px}.fld.s2{grid-column:span 2}
.fld-hd{display:flex;align-items:center;justify-content:space-between}
label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--grey)}
input[type=text],textarea{background:#fff;border:1px solid var(--bdr);border-radius:3px;color:var(--txt);font-family:"Inter",sans-serif;font-size:13px;padding:8px 10px;width:100%;outline:none;transition:border-color .13s}
input[type=text]:focus,textarea:focus{border-color:var(--blk)}
input::placeholder,textarea::placeholder{color:#ccc}
textarea{resize:vertical;min-height:80px;line-height:1.65}
.pills{display:flex;gap:5px}
.pills input[type=radio]{display:none}
.pills label{display:inline-flex;align-items:center;padding:5px 12px;background:#fff;border:1px solid var(--bdr);border-radius:3px;cursor:pointer;font-size:10px;font-weight:600;color:#aaa;letter-spacing:.08em;text-transform:uppercase;transition:all .13s}
.pills input:checked+label{background:var(--blk);border-color:var(--blk);color:#fff}
.na-btn{font-size:9px;font-weight:700;color:#ddd;background:none;border:1px solid #EEE;border-radius:2px;padding:2px 6px;cursor:pointer;font-family:"Inter",sans-serif;text-transform:uppercase;letter-spacing:.08em}
.na-btn.on{background:#F0F0F0;border-color:#bbb;color:#888}
.fld.na input[type=text],.fld.na textarea,.fld.na .pills{opacity:.3;pointer-events:none}
.photo-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.ph-wrap{display:flex;flex-direction:column;gap:4px}
.ph-slot{background:#F8F8F8;border:1px dashed #DDD;border-radius:3px;aspect-ratio:4/3;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;position:relative;overflow:hidden}
.ph-slot:hover{border-color:var(--blk)}.ph-slot.filled{border-style:solid;border-color:#DDD}
.ph-slot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ph-ov{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .18s;font-size:10px;font-weight:600;text-transform:uppercase;color:#fff}
.ph-slot:hover .ph-ov{opacity:1}
.ph-n{font-size:9px;font-weight:600;color:#ccc;text-transform:uppercase}.ph-pl{font-size:20px;color:#ccc}
.ph-slot.filled .ph-n,.ph-slot.filled .ph-pl{display:none}
.cap-in input{font-size:11px;padding:4px 8px;color:#aaa}
.gen-bar{position:sticky;bottom:0;background:linear-gradient(to top,#fff 65%,transparent);padding:16px 0 24px;margin-top:24px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rp{display:none;background:#F8F8F8;border:1px solid var(--bdr);border-radius:4px;padding:22px 26px;margin-top:16px;font-size:13px;line-height:1.8}
.rp.show{display:block}
.rp h2{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:.06em;margin:20px 0 6px;padding-bottom:4px;border-bottom:2px solid var(--y)}
.rp h2:first-child{margin-top:0}.rp p{margin:4px 0}
.st{font-size:12px;color:var(--grey);display:none}.st.on{display:inline}.st.ok{color:#4CAF50}.st.err{color:#E53935}
.hidden{display:none}
`;

app.get('/new', requireAuth, (req,res) => res.send(buildEditor(null, {})));
app.get('/edit/:id', requireAuth, (req,res) => {
  readDB();
  let r = DB.reports.find(r=>r.id===req.params.id);
  if (!r && req.session.lastReport?.id===req.params.id) r=req.session.lastReport;
  console.log('Edit page — id:', req.params.id, '| found:', !!r, '| findings:', r?.findings?.substring(0,50)||'NONE');
  res.send(buildEditor(req.params.id, r||{}));
});

function buildEditor(reportId, data) {
  // Safely encode all text fields as JSON strings for embedding in HTML
  const sf = k => JSON.stringify(data[k]||'');
  const photos = JSON.stringify((data.photos||[]).map(p=>({data:p.data||null,caption:p.caption||'',rotation:p.rotation||0})));
  // Embed metadata for writeSections (no photos - too large)
  const meta = JSON.stringify({
    address:data.address||'', inspDate:data.inspDate||'', inspTime:data.inspTime||'',
    insured:data.insured||'', tech:data.tech||'', item:data.item||'', model:data.model||'',
    age:data.age||'', cable:data.cable||'', voltage:data.voltage||'', cutout:data.cutout||'',
    causeS:data.causeS||'', wearTear:data.wearTear||'', ownerDate:data.ownerDate||'',
    yearBuilt:data.yearBuilt||'', roofType:data.roofType||'', damageDetails:data.damageDetails||''
  });

  return shell(reportId?'Edit Report':'New Report', reportId?'dash':'new', `
    <style>${EDITOR_CSS}</style>
    <div class="page-hd">
      <div class="page-title">${reportId?'Edit Report':'New Report'}</div>
      <a href="/" class="btn btn-ghost btn-sm">&larr; Dashboard</a>
    </div>
    <div class="layout">
      <nav class="sidebar">
        <div class="nav-grp">Sections</div>
        <a class="nav-a" href="#site"><div class="dot"></div>Site Details</a>
        <a class="nav-a" href="#unit"><div class="dot"></div>Unit Details</a>
        <a class="nav-a" href="#findings"><div class="dot"></div>Findings</a>
        <a class="nav-a" href="#damage"><div class="dot"></div>Cause of Damage</a>
        <a class="nav-a" href="#rec"><div class="dot"></div>Recommendation</a>
        <a class="nav-a" href="#summary"><div class="dot"></div>Summary</a>
        <a class="nav-a" href="#photos"><div class="dot"></div>Photos</a>
        <div class="nav-grp" style="margin-top:12px">Actions</div>
        <a class="nav-a" href="#" id="sGen"><div class="dot"></div>Generate Report</a>
        <a class="nav-a" href="#" id="sSave"><div class="dot"></div>Save Draft</a>
        <a class="nav-a" href="#" id="sPDF"><div class="dot"></div>Export PDF</a>
      </nav>
      <div class="editor">
        <div class="sec" id="site">
          <div class="sec-hd"><span class="sec-n">01</span><span class="sec-t">Site &amp; Inspection Details</span></div>
          <div class="fg one"><div class="fld"><label>Property Address</label><input type="text" id="address" value=${sf('address')}></div></div><br>
          <div class="fg">
            <div class="fld"><label>Inspection Date</label><input type="text" id="inspDate" value=${sf('inspDate')}></div>
            <div class="fld"><label>Inspection Time</label><input type="text" id="inspTime" value=${sf('inspTime')}></div>
            <div class="fld"><label>Report Date</label><input type="text" id="rptDate" value=${sf('rptDate')}></div>
            <div class="fld"><label>Insured / Person Met</label><input type="text" id="insured" value=${sf('insured')}></div>
            <div class="fld"><label>Attending Technician</label><input type="text" id="tech" value=${sf('tech')}></div>
            <div class="fld"><label>Tech Signature Date</label><input type="text" id="techSig" value=${sf('techSig')}></div>
          </div>
        </div>
        <div class="sec" id="unit">
          <div class="sec-hd"><span class="sec-n">02</span><span class="sec-t">Unit Details</span></div>
          <div class="fg">
            <div class="fld" id="fld-item"><div class="fld-hd"><label>Item Inspected</label><button class="na-btn" onclick="na('item')">N/A</button></div><input type="text" id="item" value=${sf('item')}></div>
            <div class="fld" id="fld-model"><div class="fld-hd"><label>Make &amp; Model</label><button class="na-btn" onclick="na('model')">N/A</button></div><input type="text" id="model" value=${sf('model')}></div>
            <div class="fld" id="fld-age"><div class="fld-hd"><label>Approximate Age</label><button class="na-btn" onclick="na('age')">N/A</button></div><input type="text" id="age" value=${sf('age')}></div>
            <div class="fld" id="fld-fault"><div class="fld-hd"><label>Fault Code</label><button class="na-btn" onclick="na('fault')">N/A</button></div><input type="text" id="fault" value=${sf('fault')}></div>
            <div class="fld" id="fld-cable"><div class="fld-hd"><label>Circuit Cable Size</label><button class="na-btn" onclick="na('cable')">N/A</button></div><input type="text" id="cable" value=${sf('cable')}></div>
            <div class="fld" id="fld-ownerDate"><div class="fld-hd"><label>Owner Reported Date</label><button class="na-btn" onclick="na('ownerDate')">N/A</button></div><input type="text" id="ownerDate" value=${sf('ownerDate')}></div>
            <div class="fld" id="fld-wt"><div class="fld-hd"><label>Wear &amp; Tear (unrelated)</label><button class="na-btn" onclick="na('wt')">N/A</button></div>
              <div class="pills"><input type="radio" name="wt" id="wtN" value="No" ${(data.wearTear||'').toLowerCase().includes('no')||!data.wearTear?'checked':''}><label for="wtN">None</label><input type="radio" name="wt" id="wtY" value="Yes" ${(data.wearTear||'').toLowerCase().includes('yes')?'checked':''}><label for="wtY">Present</label></div></div>
          </div>
        </div>
        <div class="sec" id="findings">
          <div class="sec-hd"><span class="sec-n">03</span><span class="sec-t">Inspection Findings</span></div>
          <div class="fg one"><div class="fld"><label>Findings Narrative</label><textarea id="findTxt" rows="6">${data.findings||''}</textarea></div></div>
        </div>
        <div class="sec" id="damage">
          <div class="sec-hd"><span class="sec-n">04</span><span class="sec-t">Cause of Damage</span></div>
          <div class="fg">
            <div class="fld"><label>Cause (Short)</label><input type="text" id="causeS" value=${sf('causeS')}></div>
            <div class="fld s2"><label>Detailed Cause</label><textarea id="causeD" rows="4">${data.causeD||''}</textarea></div>
          </div>
        </div>
        <div class="sec" id="rec">
          <div class="sec-hd"><span class="sec-n">05</span><span class="sec-t">Repair Recommendation</span></div>
          <div class="fg one">
            <div class="fld"><label>Recommendation</label><textarea id="recTxt" rows="3">${data.rec||''}</textarea></div>
            <div class="fld"><label>Repair Detail</label><textarea id="repTxt" rows="3">${data.repair||''}</textarea></div>
          </div>
        </div>
        <div class="sec" id="summary">
          <div class="sec-hd"><span class="sec-n">06</span><span class="sec-t">Summary</span></div>
          <div class="fg one"><div class="fld"><label>Summary Statement</label><textarea id="sumTxt" rows="5">${data.summary||''}</textarea></div></div>
        </div>
        <div class="sec" id="photos">
          <div class="sec-hd"><span class="sec-n">07</span><span class="sec-t">Site Photographs</span></div>
          <div class="photo-grid" id="photoGrid"></div>
          <div id="fileInputs"></div>
        </div>
        <div class="rp" id="rp"></div>
        <div class="gen-bar">
          <button class="btn btn-y" id="writeBtn">&#9998; Write Sections</button>
          <button class="btn btn-blk" id="genBtn">&#9889; Generate Report</button>
          <button class="btn btn-y" id="pdfBtn" style="display:none">&#8595; Export PDF</button>
          <button class="btn btn-ghost btn-sm" id="saveBtn">Save Draft</button>
          <span class="st" id="st"></span>
        </div>
      </div>
    </div>
    <script>
    const REPORT_ID=${JSON.stringify(reportId||null)};
    const META=${meta};
    const LABELS=["Front of House","Overview Angle 1","Overview Angle 2","Failed Area","Item Overview","Brand/Model Plate","Close Up 1","Close Up 2","Services"];
    const photoData=${photos}.map(p=>p.data?p.data:null);
    const photoCaptions=${photos}.map((p,i)=>p.caption||LABELS[i]||'Photo '+(i+1));
    const photoRotation=${photos}.map(p=>p.rotation||0);
    const naState={};
    window._rt='';

    function na(id){
      const fld=document.getElementById('fld-'+id);if(!fld)return;
      naState[id]=!naState[id];
      fld.classList.toggle('na',naState[id]);
      const btn=fld.querySelector('.na-btn');if(btn)btn.classList.toggle('on',naState[id]);
    }

    function rotatePh(i,e){
      e.stopPropagation();
      photoRotation[i]=(photoRotation[i]+90)%360;
      const img=new Image();
      img.onload=function(){
        const c=document.createElement('canvas'),r=photoRotation[i],sw=r===90||r===270;
        c.width=sw?img.height:img.width;c.height=sw?img.width:img.height;
        const ctx=c.getContext('2d');
        ctx.translate(c.width/2,c.height/2);ctx.rotate(r*Math.PI/180);
        ctx.drawImage(img,-img.width/2,-img.height/2);
        photoData[i]=c.toDataURL('image/jpeg',0.92);buildPhotos();
      };img.src=photoData[i];
    }

    function buildPhotos(){
      const grid=document.getElementById('photoGrid'),fi=document.getElementById('fileInputs');
      grid.innerHTML='';fi.innerHTML='';
      LABELS.forEach((lbl,i)=>{
        const inp=document.createElement('input');inp.type='file';inp.accept='image/*';inp.className='hidden';inp.id='fi'+i;
        inp.onchange=e=>loadPh(e,i);fi.appendChild(inp);
        const wrap=document.createElement('div');wrap.className='ph-wrap';
        const slot=document.createElement('div');slot.className='ph-slot';
        slot.onclick=()=>document.getElementById('fi'+i).click();
        slot.innerHTML='<div class="ph-pl">+</div><div class="ph-n">Photo '+(i+1)+'</div><div class="ph-ov">Change</div>';
        if(photoData[i]){
          slot.classList.add('filled');
          const img=document.createElement('img');img.src=photoData[i];slot.insertBefore(img,slot.firstChild);
          const del=document.createElement('button');del.textContent='x';
          del.style.cssText='position:absolute;top:4px;right:4px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:50%;width:22px;height:22px;font-size:11px;cursor:pointer;z-index:10';
          del.onclick=e=>{e.stopPropagation();photoData[i]=null;photoCaptions[i]=LABELS[i]||'Photo '+(i+1);photoRotation[i]=0;buildPhotos();};
          slot.appendChild(del);
          const rot=document.createElement('button');rot.textContent='\u21bb';rot.title='Rotate';
          rot.style.cssText='position:absolute;top:4px;left:4px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:50%;width:22px;height:22px;font-size:13px;cursor:pointer;z-index:10;line-height:1';
          rot.onclick=e=>rotatePh(i,e);slot.appendChild(rot);
        }
        const cw=document.createElement('div');cw.className='cap-in';
        const ci=document.createElement('input');ci.type='text';ci.id='cap'+i;ci.value=photoCaptions[i];ci.placeholder=lbl;
        cw.appendChild(ci);wrap.appendChild(slot);wrap.appendChild(cw);grid.appendChild(wrap);
      });
    }

    function loadPh(e,i){const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{photoData[i]=ev.target.result;buildPhotos();};r.readAsDataURL(f);}

    const g=id=>{const el=document.getElementById(id);if(!el)return'';const f=el.closest('.fld');if(f&&f.classList.contains('na'))return'N/A';return el.value?.trim()||'';};
    const radio=n=>{const c=document.querySelector('input[name="'+n+'"]:checked');return c?c.value:'';};
    function collect(){return{address:g('address'),inspDate:g('inspDate'),inspTime:g('inspTime'),rptDate:g('rptDate'),insured:g('insured'),tech:g('tech'),techSig:g('techSig'),item:g('item'),model:g('model'),age:g('age'),fault:g('fault'),cable:g('cable'),ownerDate:g('ownerDate'),wearTear:radio('wt'),findings:g('findTxt'),causeS:g('causeS'),causeD:g('causeD'),rec:g('recTxt'),repair:g('repTxt'),summary:g('sumTxt'),photos:photoData.map((d,i)=>({data:d,caption:document.getElementById('cap'+i)?.value||LABELS[i],rotation:photoRotation[i]||0}))};}

    async function generate(){
      const d=collect(),btn=document.getElementById('genBtn'),st=document.getElementById('st'),rp=document.getElementById('rp'),pdf=document.getElementById('pdfBtn');
      btn.textContent='Generating...';st.className='st on';st.textContent='Writing report...';rp.className='rp';pdf.style.display='none';window._rt='';
      try{
        const res=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
        const json=await res.json();if(!json.ok)throw new Error(json.error);
        window._rt=json.text;
        // Save then redirect to draft report page
        await saveDraft(true);
        window.location.href='/draft/'+REPORT_ID;
      }catch(e){st.className='st on err';st.textContent='Error: '+e.message;}
      btn.textContent='Generate Report';
    }

    async function saveDraft(silent){
      const d=collect();d.reportText=window._rt||'';
      const url=REPORT_ID?'/api/report/'+REPORT_ID:'/api/report';
      await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
      if(!silent){const st=document.getElementById('st');st.className='st on ok';st.textContent='Saved';setTimeout(()=>st.className='st',2000);}
    }

    async function exportPDF(){
      if(!window._rt){alert('Generate the report first.');return;}
      const d=collect(),btn=document.getElementById('pdfBtn'),st=document.getElementById('st');
      btn.textContent='Building PDF...';
      try{
        const res=await fetch('/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reportText:window._rt,photos:d.photos,address:d.address})});
        if(!res.ok)throw new Error('PDF failed');
        const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=url;a.download='Report_'+(d.address||'Report').replace(/[^a-zA-Z0-9]+/g,'_')+'.pdf';a.click();URL.revokeObjectURL(url);
        st.className='st on ok';st.textContent='PDF downloaded';
      }catch(e){st.className='st on err';st.textContent='Error: '+e.message;}
      btn.textContent='Export PDF';
    }

    async function writeSections(){
      const d=collect(),btn=document.getElementById('writeBtn'),st=document.getElementById('st');
      btn.textContent='Writing...';st.className='st on';st.textContent='Claude is writing the report sections — please wait...';
      try{
        // Merge META (extracted fields) with current form values
        const fullData={...META,...d};
        const res=await fetch('/api/write-sections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fullData)});
        const json=await res.json();
        if(!json.ok)throw new Error(json.error);
        if(json.findings){document.getElementById('findTxt').value=json.findings;}
        if(json.causeD){document.getElementById('causeD').value=json.causeD;}
        if(json.rec){document.getElementById('recTxt').value=json.rec;}
        if(json.repair){document.getElementById('repTxt').value=json.repair;}
        if(json.summary){document.getElementById('sumTxt').value=json.summary;}
        st.className='st on ok';st.textContent='Done — review each section then click Generate Report';
        saveDraft(true);
      }catch(e){st.className='st on err';st.textContent='Error: '+e.message;}
      btn.textContent='\u9998 Write Sections';
    }

    document.getElementById('writeBtn').onclick=writeSections;
    document.getElementById('pdfBtn').onclick=exportPDF;
    document.getElementById('saveBtn').onclick=()=>saveDraft(false);
    document.getElementById('sGen').onclick=e=>{e.preventDefault();generate();};
    document.getElementById('sSave').onclick=e=>{e.preventDefault();saveDraft(false);};
    document.getElementById('sPDF').onclick=e=>{e.preventDefault();exportPDF();};

    buildPhotos();
    </script>`);
}

// ── Extract PDF ───────────────────────────────────────────────────────────────
app.post('/api/extract', requireAuth, upload.single('pdf'), async (req, res) => {
  try {
    const pdfBase64 = req.file.buffer.toString('base64');

    // Send PDF directly to Claude to read natively
    let data = {};
    try {
      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 3000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
              },
              {
                type: 'text',
                text: `You are processing an iAudit insurance inspection report for Prime Time Electricians. Read this PDF carefully and return ONLY valid JSON — no markdown, no explanation.

{
  "address": "full site address",
  "inspDate": "inspection date e.g. 8 May 2026",
  "inspTime": "inspection time e.g. 10:59 AWST",
  "rptDate": "same as inspDate",
  "insured": "full name of person met with",
  "tech": "technician name from Tech Signature",
  "item": "item name inspected",
  "model": "make and model",
  "age": "approximate age",
  "fault": "fault codes or empty string",
  "cable": "circuit cable size",
  "voltage": "voltage reading",
  "cutout": "measurements of cut out",
  "ownerDate": "date of loss or incident",
  "causeS": "cause of damage short phrase",
  "wearTear": "No or Yes or N/A",
  "yearBuilt": "year property built",
  "roofType": "roof type",
  "damageDetails": "verbatim text from Details of damage field",
  "findings": "Write 3-4 professional sentences: property description, what was inspected, condition found, measurements taken",
  "causeD": "Write 3-4 professional sentences: exactly how damage occurred using the Details of damage notes, what failed, why unsafe",
  "rec": "Write 1-2 sentences: recommend full replacement or repair and why",
  "repair": "Write 1 sentence: specifically what work must be carried out",
  "summary": "Write 3-4 sentences: standalone executive summary of property, item, cause and outcome"
}`
              }
            ]
          }]
        })
      });
      const apiJson = await apiRes.json();
      const text = apiJson.content?.[0]?.text || '';
      console.log('Claude PDF read (400):', text.substring(0, 400));
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        data = JSON.parse(m[0]);
        console.log('Extracted OK — address:', data.address, '| findings length:', data.findings?.length);
      } else {
        console.error('No JSON in response');
      }
    } catch(e) {
      console.error('PDF read failed:', e.message);
    }

    // Extract photos
    const pdfDoc = await PDFLib.load(req.file.buffer, {ignoreEncryption:true});
    const rawPhotos = [];
    for (const [ref, obj] of pdfDoc.context.enumerateIndirectObjects()) {
      try {
        if (obj?.dict) {
          const sub = obj.dict.get(pdfDoc.context.obj('Subtype'));
          if (sub?.toString()==='/Image') {
            const w=parseInt(obj.dict.get(pdfDoc.context.obj('Width'))?.toString()||'0');
            const h=parseInt(obj.dict.get(pdfDoc.context.obj('Height'))?.toString()||'0');
            if (w<150||h<150) continue;
            const bytes=obj.contents;
            if (!bytes||bytes.length<2000) continue;
            const isJpeg=obj.dict.get(pdfDoc.context.obj('Filter'))?.toString().includes('DCT');
            rawPhotos.push({data:`data:${isJpeg?'image/jpeg':'image/png'};base64,`+Buffer.from(bytes).toString('base64'),mime:isJpeg?'image/jpeg':'image/png'});
            if (rawPhotos.length>=9) break;
          }
        }
      } catch(e) {}
    }

    // Label photos
    let photos = rawPhotos.map((p,i)=>({data:p.data,caption:'Photo '+(i+1),rotation:0}));
    if (rawPhotos.length>0) {
      try {
        const imgContent = rawPhotos.slice(0,9).flatMap((p,i)=>[
          {type:'text',text:`Photo ${i+1}:`},
          {type:'image',source:{type:'base64',media_type:p.mime,data:p.data.split(',')[1]}}
        ]);
        imgContent.push({type:'text',text:'Label each photo 3-5 words. Return only a JSON array e.g. ["Front of house","Switchboard"]'});
        const captionText = await callClaude([{role:'user',content:imgContent}], 300);
        const captions = JSON.parse(captionText.match(/\[[\s\S]*\]/)?.[0]||'[]');
        photos = rawPhotos.map((p,i)=>({data:p.data,caption:captions[i]||'Photo '+(i+1),rotation:0}));
      } catch(e) {}
    }
    // Pad to 9
    while (photos.length<9) photos.push({data:null,caption:'Photo '+(photos.length+1),rotation:0});

    const report = {
      id: uuid(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      ...data,
      photos,
      reportText: ''
    };

    readDB();
    DB.reports.push(report);
    writeDB();
    req.session.lastReport = report;
    await new Promise(resolve => req.session.save(resolve));
    console.log('Report saved — id:', report.id, '| findings:', report.findings?.substring(0,60)||'NONE');

    res.json({ok:true, reportId:report.id, photosFound:rawPhotos.length});

  } catch(err) {
    console.error('Extract error:', err);
    res.status(500).json({ok:false, error:err.message});
  }
});

// ── CRUD ──────────────────────────────────────────────────────────────────────
app.get('/api/report/:id', requireAuth, (req,res) => {
  readDB();
  let r = DB.reports.find(r=>r.id===req.params.id);
  if (!r && req.session.lastReport?.id===req.params.id) r=req.session.lastReport;
  if (!r) return res.status(404).json(null);
  res.json(r);
});

app.post('/api/report', requireAuth, (req,res) => {
  readDB();
  const r={id:uuid(),createdAt:new Date().toISOString(),status:'pending',...req.body};
  DB.reports.push(r);writeDB();
  res.json({ok:true,id:r.id});
});

app.post('/api/report/:id', requireAuth, (req,res) => {
  readDB();
  const i=DB.reports.findIndex(r=>r.id===req.params.id);
  if (i===-1) DB.reports.push({id:req.params.id,createdAt:new Date().toISOString(),status:'pending',...req.body});
  else DB.reports[i]={...DB.reports[i],...req.body,id:req.params.id};
  writeDB();res.json({ok:true});
});

app.post('/api/status/:id', requireAuth, (req,res) => {
  readDB();
  const r=DB.reports.find(r=>r.id===req.params.id);
  if (r){r.status=req.body.status;writeDB();}
  res.json({ok:true});
});

app.delete('/api/report/:id', requireAuth, (req,res) => {
  readDB();
  DB.reports=DB.reports.filter(r=>r.id!==req.params.id);
  writeDB();res.json({ok:true});
});

// ── Generate ──────────────────────────────────────────────────────────────────
const isNA=v=>!v||['','na','n/a','-','none','nil'].includes(String(v).trim().toLowerCase());
const fl=(l,v)=>isNA(v)?null:`${l}: ${v}`;

app.post('/api/generate', requireAuth, async (req,res) => {
  const d=req.body;
  const cause=[d.causeS,d.causeD].filter(v=>!isNA(v)).join(' — ');
  const prompt=`Write a professional insurance inspection report for Prime Time Electricians. Formal prose, ## headings only.

SITE: ${d.address} | ${d.inspDate} ${d.inspTime||''} | Insured: ${d.insured||''} | Tech: ${d.tech||''}
ITEM: ${[fl('Item',d.item),fl('Model',d.model),fl('Age',d.age),fl('Cable',d.cable),fl('Fault',d.fault)].filter(Boolean).join(', ')||'Not provided'}
FINDINGS: ${d.findings||'Not provided'}
CAUSE: ${cause||'Not provided'}
RECOMMENDATION: ${[d.rec,d.repair].filter(v=>!isNA(v)).join(' ')||'Not provided'}
SUMMARY: ${d.summary||'Not provided'}

Sections: ## 1. Site & Inspection Details  ## 2. Item Inspected  ## 3. Inspection Findings  ## 4. Cause of Damage  ## 5. Repair Recommendation  ## 6. Summary`;
  try {
    const text=await callClaude([{role:'user',content:prompt}],2000);
    res.json({ok:true,text});
  } catch(e) {
    res.status(500).json({ok:false,error:e.message});
  }
});

// ── Draft Report Page ─────────────────────────────────────────────────────────
app.get('/draft/:id', requireAuth, (req,res) => {
  readDB();
  const r = DB.reports.find(r=>r.id===req.params.id)
    || (req.session.lastReport?.id===req.params.id ? req.session.lastReport : null);
  if (!r) return res.redirect('/');

  const reportHtml = (r.reportText||'No report generated yet.')
    .replace(/^## \d+\.\s*(.+)$/gm, '<h2>$1</h2>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .split('\n\n')
    .map(b => b.startsWith('<') ? b : '<p>' + b.replace(/\n/g,' ') + '</p>')
    .join('\n');

  res.send(shell('Draft Report', 'dash', `
    <style>
    .draft-wrap{display:grid;grid-template-columns:1fr 260px;gap:28px;align-items:start}
    .draft-body{background:#fff;border:1px solid var(--bdr);border-radius:4px;padding:36px 40px}
    .draft-body h2{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--blk);margin:24px 0 8px;padding-bottom:6px;border-bottom:2px solid #FFE600}
    .draft-body h2:first-child{margin-top:0}
    .draft-body p{font-size:13px;line-height:1.8;color:#333;margin:4px 0}
    .draft-body strong{font-weight:600;color:#111}
    .side-panel{position:sticky;top:80px;display:flex;flex-direction:column;gap:10px}
    .side-card{background:#F8F8F8;border:1px solid var(--bdr);border-radius:4px;padding:18px}
    .side-card h3{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:12px}
    .meta-row{font-size:12px;color:#555;margin-bottom:6px;display:flex;justify-content:space-between}
    .meta-row strong{color:#111;font-weight:600}
    .status-badge{display:inline-block;background:#FFF8E1;color:#F59E0B;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:4px 10px;border-radius:2px}
    </style>
    <div class="page-hd">
      <div class="page-title">Draft Report</div>
      <div style="display:flex;gap:8px">
        <a href="/edit/${r.id}" class="btn btn-ghost btn-sm">&larr; Back to Editor</a>
        <a href="/download/${r.id}" class="btn btn-blk">&#8595; Export PDF</a>
        <button onclick="approve('${r.id}')" class="btn btn-grn">&#10003; Approve</button>
      </div>
    </div>
    <div class="draft-wrap">
      <div class="draft-body">
        ${reportHtml}
      </div>
      <div class="side-panel">
        <div class="side-card">
          <h3>Job Details</h3>
          <div class="meta-row"><span>Address</span><strong>${r.address||'—'}</strong></div>
          <div class="meta-row"><span>Date</span><strong>${r.inspDate||'—'}</strong></div>
          <div class="meta-row"><span>Insured</span><strong>${r.insured||'—'}</strong></div>
          <div class="meta-row"><span>Tech</span><strong>${r.tech||'—'}</strong></div>
          <div class="meta-row"><span>Item</span><strong>${r.item||'—'}</strong></div>
          <div class="meta-row"><span>Cause</span><strong>${r.causeS||'—'}</strong></div>
        </div>
        <div class="side-card">
          <h3>Status</h3>
          <div class="status-badge">${r.status||'pending'}</div>
        </div>
        <div class="side-card">
          <h3>Actions</h3>
          <a href="/edit/${r.id}" class="btn btn-ghost btn-sm" style="width:100%;justify-content:center;margin-bottom:8px">Edit Sections</a>
          <a href="/download/${r.id}" class="btn btn-blk btn-sm" style="width:100%;justify-content:center;margin-bottom:8px">&#8595; Export PDF</a>
          <button onclick="approve('${r.id}')" class="btn btn-grn btn-sm" style="width:100%;justify-content:center">&#10003; Approve Report</button>
        </div>
      </div>
    </div>
    <script>
    async function approve(id){
      await fetch('/api/status/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'approved'})});
      document.querySelector('.status-badge').textContent='approved';
      document.querySelector('.status-badge').style.background='#E8F5E9';
      document.querySelector('.status-badge').style.color='#4CAF50';
    }
    </script>
  `));
});

// ── Write Sections ────────────────────────────────────────────────────────────
app.post('/api/write-sections', requireAuth, async (req,res) => {
  const d = req.body;
  const prompt = `You are writing a professional insurance inspection report for Prime Time Electricians.

Using the job data below, write five narrative sections. Be specific — use the actual property address, item names, measurements, cause and technician notes.

JOB DATA:
- Property: ${d.address||'not recorded'} (built ${d.yearBuilt||'unknown'}, ${d.roofType||'unknown'} roof)
- Inspection: ${d.inspDate||''} at ${d.inspTime||''}
- Insured: ${d.insured||'not recorded'}
- Technician: ${d.tech||'not recorded'}
- Item: ${d.item||'not recorded'} (${d.model||'unknown make'}, approx ${d.age||'unknown'} age)
- Cable size: ${d.cable||'not recorded'}
- Voltage: ${d.voltage||'not recorded'}
- Cutout: ${d.cutout||'not recorded'}
- Cause of damage: ${d.causeS||'not recorded'}
- Wear and tear unrelated: ${d.wearTear||'No'}
- Owner reported date: ${d.ownerDate||'not recorded'}
- Technician damage notes: ${d.damageDetails||'none provided'}

Return ONLY this JSON — no markdown, no preamble:
{
  "findings": "3-4 sentences: describe the property, what was inspected, condition found and all measurements taken on site. Use specific details.",
  "causeD": "3-4 sentences: explain exactly how the damage occurred using all available notes, what components failed and why the item is unsafe to continue operating.",
  "rec": "1-2 sentences: clearly recommend full replacement or repair and state why.",
  "repair": "1 sentence: state specifically what work must be carried out.",
  "summary": "3-4 sentences: standalone executive summary covering property, item inspected, cause of damage and recommended outcome."
}`;

  try {
    const text = await callClaude([{role:'user',content:prompt}], 2000);
    console.log('Write sections response:', text.substring(0,300));
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON in response');
    const sections = JSON.parse(m[0]);
    res.json({ok:true, ...sections});
  } catch(e) {
    console.error('Write sections failed:', e.message);
    res.status(500).json({ok:false, error:e.message});
  }
});

// ── PDF ───────────────────────────────────────────────────────────────────────
app.get('/download/:id', requireAuth, async (req,res) => {
  readDB();
  const r=DB.reports.find(r=>r.id===req.params.id)||(req.session.lastReport?.id===req.params.id?req.session.lastReport:null);
  if (!r?.reportText) return res.status(404).send('Not generated yet');
  buildPDF({body:{reportText:r.reportText,photos:r.photos||[],address:r.address}},res);
});

app.post('/api/pdf', requireAuth, (req,res) => buildPDF(req,res));

function buildPDF(req,res) {
  const {reportText,photos,address}=req.body;
  try {
    const doc=new PDFDocument({size:'A4',margins:{top:115,bottom:90,left:57,right:57},autoFirstPage:false});
    const chunks=[];
    doc.on('data',c=>chunks.push(c));
    const hBuf=fs.readFileSync(HEADER_IMG);
    const fBuf=fs.readFileSync(FOOTER_IMG);
    const pItems=(photos||[]).map(p=>({buf:p.data?Buffer.from(p.data.split(',')[1],'base64'):null,caption:p.caption}));
    function addPage(){
      doc.addPage();const pw=doc.page.width;
      doc.image(hBuf,0,0,{width:pw,height:pw*(350/2068)});
      const fH=46,fW=fH*(792/438);
      doc.image(fBuf,57,doc.page.height-68,{width:fW,height:fH});
      doc.fontSize(7.5).fillColor('#888888')
        .text('Confidential — Prepared for Insurance Purposes Only',0,doc.page.height-52,{align:'right',width:pw-57})
        .text('Prime Time Electricians  |  ABN 88 151 349 012  |  EC 9142  |  Page '+doc.bufferedPageRange().count,0,doc.page.height-40,{align:'right',width:pw-57});
    }
    const sections=[];let cur=null;
    for (const line of reportText.split('\n')) {
      if (line.startsWith('## ')) {if(cur)sections.push(cur);cur={title:line.replace(/^## \d+\.\s*/,'').replace('## ','').trim().toUpperCase(),paras:[]};}
      else if (line.trim()&&cur) cur.paras.push(line.trim());
    }
    if (cur) sections.push(cur);
    addPage();
    for (const sec of sections) {
      if (doc.y>doc.page.height-doc.page.margins.bottom-80) addPage();
      doc.moveDown(0.6).fontSize(11).fillColor('#111').font('Helvetica-Bold').text(sec.title);
      doc.moveDown(0.3);
      for (const para of sec.paras) {
        if (doc.y>doc.page.height-doc.page.margins.bottom-60) addPage();
        doc.fontSize(10).fillColor('#333').font('Helvetica').text(para,{lineGap:3}).moveDown(0.4);
      }
      if (sec.title==='SITE PHOTOGRAPHS') {
        const valid=pItems.filter(p=>p.buf);if(!valid.length)continue;
        doc.moveDown(0.4);
        const pw=doc.page.width-doc.page.margins.left-doc.page.margins.right;
        const cols=3,gap=8,imgW=(pw-gap*(cols-1))/cols,imgH=imgW*0.75,rowH=imgH+20+gap;
        let col=0,rowY=doc.y;
        for (const {buf,caption} of valid) {
          if (rowY+rowH>doc.page.height-doc.page.margins.bottom){addPage();rowY=doc.y;}
          const x=doc.page.margins.left+col*(imgW+gap);
          try{doc.image(buf,x,rowY,{width:imgW,height:imgH,cover:[imgW,imgH]});}catch(e){}
          doc.fontSize(7.5).fillColor('#888').font('Helvetica').text(caption,x,rowY+imgH+3,{width:imgW,align:'center'});
          col++;if(col>=cols){col=0;rowY+=rowH;}
        }
      }
    }
    doc.end();
    doc.on('end',()=>{
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition','attachment; filename="Report_'+(address||'Report').replace(/[^a-zA-Z0-9]+/g,'_')+'.pdf"');
      res.send(Buffer.concat(chunks));
    });
  } catch(e) {
    console.error('PDF error:',e);
    res.status(500).json({ok:false,error:e.message});
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT,()=>console.log('Prime Time Portal running on port '+PORT));

