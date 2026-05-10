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
const DB_FILE    = path.join(__dirname, 'reports.json');

// ── Database ──────────────────────────────────────────────────────────────────
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { reports: [] }; }
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(session({ secret: SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false, maxAge: 8*60*60*1000 } }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20*1024*1024 } });

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.redirect('/login');
}

// ── Shared CSS ────────────────────────────────────────────────────────────────
const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--y:#FFE600;--blk:#111;--bdr:#E0E0E0;--grey:#777;--txt:#222;--light:#F8F8F8}
body{font-family:"Inter",sans-serif;background:#fff;color:var(--txt);min-height:100vh}
.topbar{background:var(--blk);border-bottom:3px solid var(--y);padding:0 28px;display:flex;align-items:center;justify-content:space-between;height:58px;position:sticky;top:0;z-index:100}
.logo{display:flex;align-items:center;gap:10px;text-decoration:none}
.hex{width:28px;height:28px;background:var(--y);clip-path:polygon(25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%);display:grid;place-items:center;font-family:"Barlow Condensed",sans-serif;font-weight:900;font-size:13px;color:var(--blk);flex-shrink:0}
.logo-txt{font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:#fff}
.logo-txt em{color:var(--y);font-style:normal}
.topnav{display:flex;align-items:center;gap:4px}
.tnav{color:#888;font-size:12px;font-weight:500;text-decoration:none;padding:6px 12px;border-radius:3px;transition:all .13s}
.tnav:hover{color:#fff;background:rgba(255,255,255,.08)}
.tnav.on{color:var(--y);background:rgba(255,230,0,.1)}
.logout{font-size:11px;font-weight:600;color:#555;text-decoration:none;text-transform:uppercase;letter-spacing:.06em;transition:color .13s}
.logout:hover{color:#fff}
.page{max-width:1000px;margin:0 auto;padding:36px 32px}
.page-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}
.page-title{font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:24px;text-transform:uppercase;letter-spacing:.04em}
.btn{display:inline-flex;align-items:center;gap:8px;font-family:"Barlow Condensed",sans-serif;font-weight:900;font-size:14px;letter-spacing:.1em;text-transform:uppercase;border:none;padding:10px 24px;cursor:pointer;border-radius:3px;text-decoration:none;transition:all .13s}
.btn-blk{background:var(--blk);color:#fff}.btn-blk:hover{background:#333}
.btn-y{background:var(--y);color:var(--blk)}.btn-y:hover{background:#FFF176}
.btn-sm{font-size:11px;padding:6px 14px}
.btn-ghost{background:transparent;color:var(--grey);border:1px solid var(--bdr)}.btn-ghost:hover{color:var(--txt);border-color:#aaa}
`;

function shell(title, activeNav, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Prime Time — ${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Barlow+Condensed:wght@700;900&display=swap" rel="stylesheet">
<style>${BASE_CSS}</style>
</head>
<body>
<div class="topbar">
  <a class="logo" href="/"><div class="hex">T</div><div class="logo-txt">Prime Time <em>Electricians</em></div></a>
  <div class="topnav">
    <a class="tnav ${activeNav==='dash'?'on':''}" href="/">Dashboard</a>
    <a class="tnav ${activeNav==='new'?'on':''}" href="/new">New Report</a>
    <a class="tnav ${activeNav==='upload'?'on':''}" href="/upload">Upload Tech Report</a>
  </div>
  <a class="logout" href="/logout">Sign Out</a>
</div>
<div class="page">${body}</div>
</body>
</html>`;
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Prime Time Login</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600&family=Barlow+Condensed:wght@700;900&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:"Barlow",sans-serif;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:6px;padding:48px 40px;width:100%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.logo{display:flex;align-items:center;gap:10px;margin-bottom:32px;justify-content:center}
.hex{width:34px;height:34px;background:#FFE600;clip-path:polygon(25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%);display:grid;place-items:center;font-family:"Barlow Condensed",sans-serif;font-weight:900;font-size:15px}
.lt{font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:17px;text-transform:uppercase;letter-spacing:.05em}
.lt em{color:#FFE600;font-style:normal}
h1{font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:18px;text-align:center;margin-bottom:24px;text-transform:uppercase;letter-spacing:.06em}
label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#888;display:block;margin-bottom:5px}
input{width:100%;background:#F8F8F8;border:1px solid #E0E0E0;border-radius:4px;font-family:"Barlow",sans-serif;font-size:14px;padding:10px 12px;outline:none;margin-bottom:16px;transition:border-color .14s}
input:focus{border-color:#111}
button{width:100%;background:#111;color:#fff;font-family:"Barlow Condensed",sans-serif;font-weight:900;font-size:15px;letter-spacing:.1em;text-transform:uppercase;border:none;padding:13px;cursor:pointer;border-radius:4px}
.err{color:#E53935;font-size:12px;text-align:center;margin-top:10px}
</style></head><body>
<div class="card">
  <div class="logo"><div class="hex">T</div><div class="lt">Prime Time <em>Electricians</em></div></div>
  <h1>Report Portal</h1>
  <form method="POST" action="/login">
    <label>Team Password</label>
    <input type="password" name="password" placeholder="Enter password" autofocus>
    <button type="submit">Sign In →</button>
    <div class="err">${req.query.err ? 'Incorrect password — try again' : ''}</div>
  </form>
</div></body></html>`));

app.post('/login', (req, res) => {
  req.body.password === PORTAL_PASSWORD
    ? (req.session.authenticated = true, res.redirect('/'))
    : res.redirect('/login?err=1');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
app.get('/', requireAuth, (req, res) => {
  const db = readDB();
  const reports = db.reports.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

  const badge = s => {
    const m = { pending:['#FFF8E1','#F59E0B','Pending'], approved:['#E8F5E9','#4CAF50','Approved'], sent:['#E3F2FD','#2196F3','Sent'] };
    const [bg,c,l] = m[s]||m.pending;
    return `<span style="background:${bg};color:${c};font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:2px">${l}</span>`;
  };

  const counts = {pending:0,approved:0,sent:0};
  reports.forEach(r => { if(counts[r.status]!==undefined) counts[r.status]++; });

  const rows = reports.length === 0
    ? `<tr><td colspan="6" style="text-align:center;padding:48px;color:#bbb;font-size:13px">No reports yet — create one or upload a tech report</td></tr>`
    : reports.map(r => `<tr style="border-bottom:1px solid #F5F5F5">
        <td style="padding:14px 12px;font-size:13px;font-weight:600;color:#111">${r.address||'—'}</td>
        <td style="padding:14px 12px;font-size:12px;color:#888">${r.inspDate||'—'}</td>
        <td style="padding:14px 12px;font-size:12px;color:#888">${r.tech||'—'}</td>
        <td style="padding:14px 12px;font-size:12px;color:#888">${r.item||'—'}</td>
        <td style="padding:14px 12px">${badge(r.status)}</td>
        <td style="padding:14px 12px">
          <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
            <a href="/edit/${r.id}" class="btn btn-ghost btn-sm">Edit</a>
            ${r.reportText ? `<a href="/download/${r.id}" class="btn btn-blk btn-sm">↓ PDF</a>` : ''}
            ${r.status==='pending' ? `<button onclick="setStatus('${r.id}','approved')" class="btn btn-sm" style="background:#4CAF50;color:#fff">✓ Approve</button>` : ''}
            ${r.status==='approved' ? `<button onclick="setStatus('${r.id}','sent')" class="btn btn-sm" style="background:#2196F3;color:#fff">Mark Sent</button>` : ''}
            <button onclick="deleteReport('${r.id}')" class="btn btn-ghost btn-sm" style="color:#E53935;border-color:#FFCDD2">✕</button>
          </div>
        </td>
      </tr>`).join('');

  res.send(shell('Dashboard', 'dash', `
    <div class="page-hd">
      <div class="page-title">Reports</div>
      <div style="display:flex;gap:8px">
        <a href="/upload" class="btn btn-ghost">↑ Upload Tech Report</a>
        <a href="/new" class="btn btn-y">+ New Report</a>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px">
      ${[['Pending','#F59E0B',counts.pending],['Approved','#4CAF50',counts.approved],['Sent','#2196F3',counts.sent]].map(([l,c,n])=>`
        <div style="background:#F8F8F8;border-radius:4px;padding:18px 22px;border-left:4px solid ${c}">
          <div style="font-size:30px;font-weight:700;font-family:'Barlow Condensed',sans-serif;color:${c}">${n}</div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#999;margin-top:4px">${l}</div>
        </div>`).join('')}
    </div>

    <div style="background:#fff;border:1px solid var(--bdr);border-radius:4px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#F8F8F8;border-bottom:3px solid #FFE600">
          <th style="padding:12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888">Address</th>
          <th style="padding:12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888">Date</th>
          <th style="padding:12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888">Technician</th>
          <th style="padding:12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888">Item</th>
          <th style="padding:12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888">Status</th>
          <th style="padding:12px;text-align:right;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888">Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <script>
    async function setStatus(id, status) {
      await fetch('/api/report/'+id+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});
      location.reload();
    }
    async function deleteReport(id) {
      if(!confirm('Delete this report?')) return;
      await fetch('/api/report/'+id,{method:'DELETE'});
      location.reload();
    }
    </script>
  `));
});

// ── UPLOAD PAGE ───────────────────────────────────────────────────────────────
app.get('/upload', requireAuth, (req, res) => {
  res.send(shell('Upload Tech Report', 'upload', `
    <div class="page-hd"><div class="page-title">Upload Tech Report</div></div>
    <div style="max-width:580px">
      <p style="font-size:13px;color:#666;margin-bottom:24px;line-height:1.75">
        Upload the field technician's PDF report. Claude will read it and automatically pre-fill the report editor with everything it can extract — you then review, adjust and generate the final report.
      </p>
      <div id="dz" style="border:2px dashed #DDD;border-radius:6px;padding:52px;text-align:center;cursor:pointer;transition:all .15s;background:#FAFAFA">
        <div style="font-size:36px;margin-bottom:12px">📄</div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:16px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Drop PDF here</div>
        <div style="font-size:12px;color:#aaa">or click to browse</div>
        <input type="file" id="pdfFile" accept=".pdf" style="display:none">
      </div>
      <div id="st" style="margin-top:14px;font-size:13px;color:#888;text-align:center;min-height:20px"></div>
      <div id="goBtn" style="display:none;margin-top:16px">
        <button onclick="extract()" class="btn btn-blk" style="width:100%;justify-content:center;font-size:15px;padding:14px">⚡ Extract & Open Editor</button>
      </div>
    </div>
    <script>
    const dz=document.getElementById('dz'),fi=document.getElementById('pdfFile'),st=document.getElementById('st'),go=document.getElementById('goBtn');
    let file=null;
    dz.onclick=()=>fi.click();
    fi.onchange=e=>pick(e.target.files[0]);
    dz.ondragover=e=>{e.preventDefault();dz.style.borderColor='#111';dz.style.background='#F0F0F0'};
    dz.ondragleave=()=>{dz.style.borderColor='#DDD';dz.style.background='#FAFAFA'};
    dz.ondrop=e=>{e.preventDefault();dz.style.borderColor='#DDD';dz.style.background='#FAFAFA';pick(e.dataTransfer.files[0])};
    function pick(f){ if(!f||!f.name.endsWith('.pdf')){st.innerHTML='<span style="color:#E53935">Please select a PDF file</span>';return;} file=f; dz.style.borderColor='#4CAF50'; st.innerHTML='<span style="color:#4CAF50;font-weight:600">✓ '+f.name+'</span>'; go.style.display='block'; }
    async function extract(){
      if(!file)return;
      st.innerHTML='<span style="color:#888">Reading iAudit report — extracting data and photos, takes ~20 seconds...</span>';
      go.style.display='none';
      const fd=new FormData();
      fd.append('pdf',file);
      try{
        const res=await fetch('/api/extract',{method:'POST',body:fd});
        const json=await res.json();
        if(!json.ok)throw new Error(json.error);
        // Clear any cached session data to ensure clean slate
        sessionStorage.clear();
        st.innerHTML='<span style="color:#4CAF50;font-weight:600">✓ Extracted '+json.photosFound+' photos — opening report editor...</span>';
        setTimeout(()=>window.location.href='/edit/'+json.reportId, 800);
      }catch(e){
        st.innerHTML='<span style="color:#E53935">✗ '+e.message+'</span>';
        go.style.display='block';
      }
    }
    </script>
  `));
});

// ── EDITOR (new + edit) ───────────────────────────────────────────────────────
const EDITOR_CSS = `
.layout2{display:grid;grid-template-columns:190px 1fr;gap:0}
.sidebar{background:#F8F8F8;border-right:1px solid var(--bdr);padding:10px 0;border-radius:4px 0 0 4px;position:sticky;top:58px;height:calc(100vh - 130px);overflow-y:auto}
.nav-a{display:flex;align-items:center;gap:7px;padding:8px 14px;color:#aaa;font-size:12px;font-weight:500;border-left:2px solid transparent;text-decoration:none;transition:all .12s}
.nav-a:hover{color:var(--txt);background:rgba(0,0,0,.04)}
.nav-a.on{color:var(--blk);border-left-color:var(--y);background:rgba(255,230,0,.08);font-weight:600}
.nav-grp{padding:8px 14px 2px;font-size:9px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#ccc;margin-top:6px}
.dot{width:4px;height:4px;border-radius:50%;background:currentColor;flex-shrink:0}
.editor{padding:0 0 0 28px}
.sec{margin-bottom:36px;scroll-margin-top:74px}
.sec-hd{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid var(--y)}
.sec-n{font-family:"Barlow Condensed",sans-serif;font-weight:900;font-size:11px;color:#ccc;letter-spacing:.08em}
.sec-t{font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:16px;text-transform:uppercase;letter-spacing:.04em}
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
.na-toggle{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#ddd;background:none;border:1px solid #EEE;border-radius:2px;padding:2px 6px;cursor:pointer;transition:all .13s;font-family:"Inter",sans-serif}
.na-toggle:hover{border-color:#aaa;color:#888}
.na-toggle.active{background:#F0F0F0;border-color:#bbb;color:#888}
.fld.na-field input[type=text],.fld.na-field textarea,.fld.na-field .pills{opacity:.3;pointer-events:none}
.photo-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.ph-wrap{display:flex;flex-direction:column;gap:4px}
.ph-slot{background:#F8F8F8;border:1px dashed #DDD;border-radius:3px;aspect-ratio:4/3;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;position:relative;overflow:hidden;transition:border-color .13s}
.ph-slot:hover{border-color:var(--blk)}.ph-slot.filled{border-style:solid;border-color:#DDD}
.ph-slot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ph-slot .ph-ov{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .18s;font-size:10px;font-weight:600;text-transform:uppercase;color:#fff}
.ph-slot:hover .ph-ov{opacity:1}
.ph-slot .ph-n{font-size:9px;font-weight:600;color:#ccc;text-transform:uppercase}.ph-slot .ph-pl{font-size:20px;color:#ccc}
.ph-slot.filled .ph-n,.ph-slot.filled .ph-pl{display:none}
.cap-in input{font-size:11px;padding:4px 8px;color:#aaa}
.gen-bar{position:sticky;bottom:0;background:linear-gradient(to top,#fff 65%,transparent);padding:16px 0 24px;margin-top:24px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rp{display:none;background:#F8F8F8;border:1px solid var(--bdr);border-radius:4px;padding:22px 26px;margin-top:16px;font-size:13px;color:var(--txt);line-height:1.8}
.rp.show{display:block}
.rp h2{font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--blk);margin:20px 0 6px;padding-bottom:4px;border-bottom:2px solid var(--y)}
.rp h2:first-child{margin-top:0}.rp p{margin:4px 0}
.st{font-size:12px;color:var(--grey);display:none}.st.on{display:inline}.st.ok{color:#4CAF50}.st.err{color:#E53935}
.hidden{display:none}
`;

const EDITOR_FORM = `
<div class="sec" id="site">
  <div class="sec-hd"><span class="sec-n">01</span><span class="sec-t">Site & Inspection Details</span></div>
  <div class="fg one"><div class="fld"><label>Property Address</label><input type="text" id="address" placeholder="e.g. 23 Little St, Karrinyup WA 6018"></div></div><br>
  <div class="fg">
    <div class="fld"><label>Inspection Date</label><input type="text" id="inspDate" placeholder="1 May 2026"></div>
    <div class="fld"><label>Inspection Time</label><input type="text" id="inspTime" placeholder="08:50 AWST"></div>
    <div class="fld"><label>Report Date</label><input type="text" id="rptDate" placeholder="04/05/2026"></div>
    <div class="fld"><label>Insured / Person Met</label><input type="text" id="insured" placeholder="Full name"></div>
    <div class="fld"><label>Attending Technician</label><input type="text" id="tech" placeholder="Tech name"></div>
    <div class="fld"><label>Tech Signature Date</label><input type="text" id="techSig" placeholder="1 May 2026 08:51 AWST"></div>
  </div>
</div>
<div class="sec" id="unit">
  <div class="sec-hd"><span class="sec-n">02</span><span class="sec-t">Unit Details</span></div>
  <div class="fg">
    <div class="fld" id="fld-item"><div class="fld-hd"><label>Item Inspected</label><button class="na-toggle" onclick="toggleNA('item')">N/A</button></div><input type="text" id="item" placeholder="e.g. Switchboard RCBOs"></div>
    <div class="fld" id="fld-model"><div class="fld-hd"><label>Make & Model</label><button class="na-toggle" onclick="toggleNA('model')">N/A</button></div><input type="text" id="model" placeholder="e.g. Clipsal"></div>
    <div class="fld" id="fld-age"><div class="fld-hd"><label>Approximate Age</label><button class="na-toggle" onclick="toggleNA('age')">N/A</button></div><input type="text" id="age" placeholder="e.g. 10 years"></div>
    <div class="fld" id="fld-fault"><div class="fld-hd"><label>Fault Code</label><button class="na-toggle" onclick="toggleNA('fault')">N/A</button></div><input type="text" id="fault" placeholder="e.g. E3"></div>
    <div class="fld" id="fld-cable"><div class="fld-hd"><label>Circuit Cable Size</label><button class="na-toggle" onclick="toggleNA('cable')">N/A</button></div><input type="text" id="cable" placeholder="e.g. 2.5mm"></div>
    <div class="fld" id="fld-pipe"><div class="fld-hd"><label>Pipe Run Length</label><button class="na-toggle" onclick="toggleNA('pipe')">N/A</button></div><input type="text" id="pipe" placeholder="e.g. 5 metres"></div>
    <div class="fld" id="fld-pipeSize"><div class="fld-hd"><label>Pipe Size</label><button class="na-toggle" onclick="toggleNA('pipeSize')">N/A</button></div><input type="text" id="pipeSize" placeholder="e.g. 1/4 x 1/2"></div>
    <div class="fld" id="fld-mount"><div class="fld-hd"><label>Outdoor Mounting</label><button class="na-toggle" onclick="toggleNA('mount')">N/A</button></div><input type="text" id="mount" placeholder="e.g. Wall Bracket"></div>
    <div class="fld" id="fld-ownerDate"><div class="fld-hd"><label>Owner Reported Damage Date</label><button class="na-toggle" onclick="toggleNA('ownerDate')">N/A</button></div><input type="text" id="ownerDate" placeholder="e.g. 17 April 2026"></div>
    <div class="fld" id="fld-dp"><div class="fld-hd"><label>Drain Pump</label><button class="na-toggle" onclick="toggleNA('dp')">N/A</button></div>
      <div class="pills"><input type="radio" name="dp" id="dpN" value="No" checked><label for="dpN">No</label><input type="radio" name="dp" id="dpY" value="Yes"><label for="dpY">Yes</label></div></div>
    <div class="fld" id="fld-wt"><div class="fld-hd"><label>Wear &amp; Tear (unrelated)</label><button class="na-toggle" onclick="toggleNA('wt')">N/A</button></div>
      <div class="pills"><input type="radio" name="wt" id="wtN" value="No signs observed" checked><label for="wtN">None</label><input type="radio" name="wt" id="wtY" value="Signs present"><label for="wtY">Present</label></div></div>
    <div class="fld" id="fld-ls"><div class="fld-hd"><label>Refrigerant Leak Signs</label><button class="na-toggle" onclick="toggleNA('ls')">N/A</button></div>
      <div class="pills"><input type="radio" name="ls" id="lsN" value="No" checked><label for="lsN">No</label><input type="radio" name="ls" id="lsY" value="Yes"><label for="lsY">Yes</label></div></div>
  </div>
</div>
<div class="sec" id="findings">
  <div class="sec-hd"><span class="sec-n">03</span><span class="sec-t">Inspection Findings</span></div>
  <div class="fg one"><div class="fld"><label>Findings Narrative</label><textarea id="findTxt" rows="5" placeholder="Describe what was found on site..."></textarea></div></div>
</div>
<div class="sec" id="damage">
  <div class="sec-hd"><span class="sec-n">04</span><span class="sec-t">Cause of Damage</span></div>
  <div class="fg">
    <div class="fld" id="fld-causeS"><div class="fld-hd"><label>Cause (Short)</label><button class="na-toggle" onclick="toggleNA('causeS')">N/A</button></div><input type="text" id="causeS" placeholder="e.g. Water ingress"></div>
    <div class="fld s2" id="fld-causeD"><div class="fld-hd"><label>Detailed Cause</label><button class="na-toggle" onclick="toggleNA('causeD')">N/A</button></div><textarea id="causeD" rows="3" placeholder="Describe in detail..."></textarea></div>
  </div>
</div>
<div class="sec" id="rec">
  <div class="sec-hd"><span class="sec-n">05</span><span class="sec-t">Repair Recommendation</span></div>
  <div class="fg one">
    <div class="fld"><label>Recommendation</label><textarea id="recTxt" rows="3" placeholder="Replacement recommended..."></textarea></div>
    <div class="fld"><label>Repair Detail</label><textarea id="repTxt" rows="3" placeholder="Replace unit due to..."></textarea></div>
  </div>
</div>
<div class="sec" id="summary">
  <div class="sec-hd"><span class="sec-n">06</span><span class="sec-t">Summary</span></div>
  <div class="fg one"><div class="fld"><label>Summary Statement</label><textarea id="sumTxt" rows="4" placeholder="Overall summary..."></textarea></div></div>
</div>
<div class="sec" id="photos">
  <div class="sec-hd"><span class="sec-n">07</span><span class="sec-t">Site Photographs</span></div>
  <div class="photo-grid" id="photoGrid"></div>
  <div id="fileInputs"></div>
</div>
<div class="rp" id="rp"></div>
<div class="gen-bar">
  <button class="btn btn-blk" id="genBtn">&#9889; Generate Report</button>
  <button class="btn btn-y" id="pdfBtn" style="display:none">&#8595; Export PDF</button>
  <button class="btn btn-ghost btn-sm" id="saveBtn">Save Draft</button>
  <span class="st" id="st"></span>
</div>
<textarea id="__init__" style="display:none"></textarea>
`;

const EDITOR_SCRIPT = `
const LABELS=['Indoor Head Unit','Indoor Unit Name Plate','Outdoor Unit','Outdoor Unit Name Plate','Pipe Run','Controller Screen','Remote Control','Circuit Breaker / RCD','Additional View'];
const photoData=new Array(9).fill(null);
const photoCaptions=[...LABELS];
const naState={};

function toggleNA(id){const fld=document.getElementById('fld-'+id);if(!fld)return;naState[id]=!naState[id];fld.classList.toggle('na-field',naState[id]);const btn=fld.querySelector('.na-toggle');if(btn)btn.classList.toggle('active',naState[id]);}

function buildPhotos(){
  const grid=document.getElementById('photoGrid'),fi=document.getElementById('fileInputs');
  grid.innerHTML='';fi.innerHTML='';
  LABELS.forEach((lbl,i)=>{
    const inp=document.createElement('input');inp.type='file';inp.accept='image/*';inp.className='hidden';inp.id='fi'+i;inp.onchange=e=>loadPh(e,i);fi.appendChild(inp);
    const wrap=document.createElement('div');wrap.className='ph-wrap';
    const slot=document.createElement('div');slot.className='ph-slot';slot.id='slot'+i;slot.onclick=()=>document.getElementById('fi'+i).click();
    slot.innerHTML='<div class="ph-pl">+</div><div class="ph-n">Photo '+(i+1)+'</div><div class="ph-ov">Change</div>';
    if(photoData[i]){
      slot.classList.add('filled');const img=document.createElement('img');img.src=photoData[i];slot.insertBefore(img,slot.firstChild);
      const del=document.createElement('button');del.textContent='x';del.style.cssText='position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:50%;width:22px;height:22px;font-size:11px;cursor:pointer;z-index:10';
      del.onclick=e=>{e.stopPropagation();photoData[i]=null;photoCaptions[i]=LABELS[i];buildPhotos();};slot.appendChild(del);
    }
    const cw=document.createElement('div');cw.className='cap-in';
    const ci=document.createElement('input');ci.type='text';ci.id='cap'+i;ci.value=photoCaptions[i]||lbl;ci.placeholder=lbl;
    cw.appendChild(ci);wrap.appendChild(slot);wrap.appendChild(cw);grid.appendChild(wrap);
  });
}

function loadPh(e,i){const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{photoData[i]=ev.target.result;buildPhotos();};r.readAsDataURL(f);}

function prefill(d){
  if(!d)return;
  document.querySelectorAll('input[type=text],textarea').forEach(el=>{if(el.id&&el.id!=='__init__')el.value='';});
  photoData.fill(null);photoCaptions.splice(0,9,...LABELS);
  const MAP={address:'address',inspDate:'inspDate',inspTime:'inspTime',rptDate:'rptDate',insured:'insured',tech:'tech',techSig:'techSig',item:'item',model:'model',age:'age',fault:'fault',cable:'cable',pipe:'pipe',pipeSize:'pipeSize',mount:'mount',ownerDate:'ownerDate',findings:'findTxt',causeS:'causeS',causeD:'causeD',rec:'recTxt',repair:'repTxt',summary:'sumTxt',wearTear:'wearTear'};
  Object.entries(MAP).forEach(([from,to])=>{const el=document.getElementById(to);if(el&&d[from]!==undefined&&d[from]!=='')el.value=d[from];});
  if(d.drainPump){const r=document.querySelector('input[name="dp"][value="'+d.drainPump+'"]');if(r)r.checked=true;}
  if(d.wearTear){const val=d.wearTear.toLowerCase().includes('no')?'No signs observed':'Signs present';const r=document.querySelector('input[name="wt"][value="'+val+'"]');if(r)r.checked=true;}
  if(d.photos&&Array.isArray(d.photos)){d.photos.forEach((p,i)=>{if(p){if(p.data)photoData[i]=p.data;if(p.caption)photoCaptions[i]=p.caption;}});}
  if(d.reportText)window._rt=d.reportText;
}

const SECS=['site','unit','findings','damage','rec','summary','photos'];
window.addEventListener('scroll',()=>{let c=SECS[0];SECS.forEach(id=>{const el=document.getElementById(id);if(el&&el.getBoundingClientRect().top<110)c=id;});document.querySelectorAll('.nav-a').forEach(a=>a.classList.toggle('on',a.getAttribute('href')==='#'+c));},{passive:true});

const g=id=>{const el=document.getElementById(id);if(!el)return'';const fld=el.closest('.fld');if(fld&&fld.classList.contains('na-field'))return'N/A';return el.value?.trim()||'';};
const radio=n=>{const c=document.querySelector('input[name="'+n+'"]:checked');if(!c)return'';const fld=c.closest('.fld');if(fld&&fld.classList.contains('na-field'))return'N/A';return c.value;};
function collect(){return{address:g('address'),inspDate:g('inspDate'),inspTime:g('inspTime'),rptDate:g('rptDate'),insured:g('insured'),tech:g('tech'),techSig:g('techSig'),item:g('item'),model:g('model'),age:g('age'),fault:g('fault'),cable:g('cable'),pipe:g('pipe'),pipeSize:g('pipeSize'),mount:g('mount'),ownerDate:g('ownerDate'),drainPump:radio('dp'),wearTear:radio('wt'),leakSigns:radio('ls'),findings:g('findTxt'),causeS:g('causeS'),causeD:g('causeD'),rec:g('recTxt'),repair:g('repTxt'),summary:g('sumTxt'),photos:photoData.map((d,i)=>({data:d,caption:document.getElementById('cap'+i)?.value||LABELS[i]}))};};

async function generate(){
  const d=collect(),btn=document.getElementById('genBtn'),st=document.getElementById('st'),rp=document.getElementById('rp'),pdfBtn=document.getElementById('pdfBtn');
  btn.classList.add('busy');btn.textContent='Generating...';st.className='st on';st.textContent='Claude is writing...';rp.className='rp';pdfBtn.style.display='none';window._rt='';
  try{
    const res=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
    const json=await res.json();if(!json.ok)throw new Error(json.error);
    window._rt=json.text;st.className='st on ok';st.textContent='Report ready - review then export PDF';
    rp.innerHTML=json.text.replace(/^## \\d+\\.\\s*(.+)$/gm,'<h2>$1</h2>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>').split('\\n\\n').map(b=>b.startsWith('<')?b:'<p>'+b.replace(/\\n/g,' ')+'</p>').join('');
    rp.className='rp show';pdfBtn.style.display='inline-flex';
    saveDraft(true);
  }catch(e){st.className='st on err';st.textContent='Error: '+e.message;}
  btn.classList.remove('busy');btn.textContent='Generate Report';
}

async function saveDraft(silent=false){
  const d=collect();d.reportText=window._rt||'';
  const url=EDIT_ID?'/api/report/'+EDIT_ID:'/api/report';
  await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
  if(!silent){const st=document.getElementById('st');st.className='st on ok';st.textContent='Saved';setTimeout(()=>st.className='st',2000);}
}

async function exportPDF(){
  if(!window._rt){alert('Generate the report first.');return;}
  const d=collect(),btn=document.getElementById('pdfBtn'),st=document.getElementById('st');
  btn.classList.add('busy');btn.textContent='Building PDF...';st.className='st on';st.textContent='Creating PDF...';
  try{
    const res=await fetch('/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reportText:window._rt,photos:d.photos,address:d.address})});
    if(!res.ok){const e=await res.json();throw new Error(e.error);}
    const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='Insurance_Report_'+(d.address||'Report').replace(/[^a-zA-Z0-9]+/g,'_')+'.pdf';a.click();URL.revokeObjectURL(url);
    st.className='st on ok';st.textContent='PDF downloaded';
  }catch(e){st.className='st on err';st.textContent='Error: '+e.message;}
  btn.classList.remove('busy');btn.textContent='Export PDF';
}

document.getElementById('genBtn').onclick=generate;
document.getElementById('pdfBtn').onclick=exportPDF;
document.getElementById('saveBtn').onclick=()=>saveDraft(false);
document.getElementById('sGen').onclick=e=>{e.preventDefault();generate();};
document.getElementById('sSave').onclick=e=>{e.preventDefault();saveDraft(false);};
document.getElementById('sPDF').onclick=e=>{e.preventDefault();exportPDF();};

(async()=>{
  if(EDIT_ID){
    try{const r=await fetch('/api/report/'+EDIT_ID);INIT=await r.json();}
    catch(e){console.error('Load failed',e);}
  }
  if(INIT)prefill(INIT);
  buildPhotos();
  if(window._rt)document.getElementById('pdfBtn').style.display='inline-flex';
})();
`;

function editorPage(report) {
  const reportId    = report ? report.id : '';
  const reportAddr  = report ? (report.address||'Report') : 'New Report';
  const pageTitle   = report ? 'Edit Report' : 'New Report';
  const navActive   = report ? 'dash' : 'new';
  const titleText   = report ? 'Edit — ' + reportAddr : 'New Report';
  const safeJSON    = Buffer.from(report ? JSON.stringify(report) : 'null').toString('base64');

  return shell(pageTitle, navActive,
    '<style>' + EDITOR_CSS + '</style>' +
    '<div class="page-hd">' +
    '<div class="page-title">' + titleText + '</div>' +
    '<a href="/" class="btn btn-ghost btn-sm">\u2190 Dashboard</a>' +
    '</div>' +
    '<div class="layout2">' +
    '<nav class="sidebar">' +
    '<div class="nav-grp">Sections</div>' +
    '<a class="nav-a on" href="#site"><div class="dot"></div>Site Details</a>' +
    '<a class="nav-a" href="#unit"><div class="dot"></div>Unit Details</a>' +
    '<a class="nav-a" href="#findings"><div class="dot"></div>Findings</a>' +
    '<a class="nav-a" href="#damage"><div class="dot"></div>Cause of Damage</a>' +
    '<a class="nav-a" href="#rec"><div class="dot"></div>Recommendation</a>' +
    '<a class="nav-a" href="#summary"><div class="dot"></div>Summary</a>' +
    '<a class="nav-a" href="#photos"><div class="dot"></div>Photos</a>' +
    '<div class="nav-grp" style="margin-top:12px">Actions</div>' +
    '<a class="nav-a" href="#" id="sGen"><div class="dot"></div>Generate</a>' +
    '<a class="nav-a" href="#" id="sSave"><div class="dot"></div>Save Draft</a>' +
    '<a class="nav-a" href="#" id="sPDF"><div class="dot"></div>Export PDF</a>' +
    '</nav>' +
    '<div class="editor">' + EDITOR_FORM + '</div>' +
    '</div>' +
    '<script>const EDIT_ID="' + reportId + '";let INIT=null;' + EDITOR_SCRIPT + '<\/script>'
  );
}

app.get('/new',      requireAuth, (req, res) => res.send(editorPage(null)));
app.get('/edit/:id', requireAuth, (req, res) => {
  const db = readDB();
  const r = db.reports.find(r => r.id === req.params.id);
  res.send(editorPage(r || null));
});

// ── API: Extract PDF ──────────────────────────────────────────────────────────
app.post('/api/extract', requireAuth, upload.single('pdf'), async (req, res) => {
  try {
    // ── 1. Extract text ───────────────────────────────────────────────────────
    const pdfData = await pdfParse(req.file.buffer);
    const pdfText = pdfData.text.substring(0, 8000);

    // ── 2. Extract embedded photos from PDF ───────────────────────────────────
    const pdfDoc = await PDFLib.load(req.file.buffer, { ignoreEncryption: true });
    const refs   = pdfDoc.context.enumerateIndirectObjects();

    const rawPhotos = [];
    for (const [ref, obj] of refs) {
      try {
        if (obj && obj.dict) {
          const subtype = obj.dict.get(pdfDoc.context.obj('Subtype'));
          if (subtype && subtype.toString() === '/Image') {
            const w = parseInt(obj.dict.get(pdfDoc.context.obj('Width'))?.toString()  || '0');
            const h = parseInt(obj.dict.get(pdfDoc.context.obj('Height'))?.toString() || '0');
            if (w < 150 || h < 150) continue;       // skip icons/logos
            const bytes = obj.contents;
            if (!bytes || bytes.length < 2000) continue;
            const filter  = obj.dict.get(pdfDoc.context.obj('Filter'))?.toString() || '';
            const isJpeg  = filter.includes('DCT');
            const mime    = isJpeg ? 'image/jpeg' : 'image/png';
            const b64data = `data:${mime};base64,` + Buffer.from(bytes).toString('base64');
            rawPhotos.push({ data: b64data, mime, w, h });
            if (rawPhotos.length >= 9) break;
          }
        }
      } catch(e) { /* skip bad objects */ }
    }

    // ── 3. Claude labels each photo using vision ──────────────────────────────
    let labelledPhotos = [];
    if (rawPhotos.length > 0) {
      // Build multi-image message — Claude looks at all photos and labels them
      const imageContent = rawPhotos.map((p, i) => ([
        {
          type: 'text',
          text: `Photo ${i + 1}:`
        },
        {
          type: 'image',
          source: { type: 'base64', media_type: p.mime, data: p.data.split(',')[1] }
        }
      ])).flat();

      imageContent.push({
        type: 'text',
        text: `You are looking at ${rawPhotos.length} site inspection photos from an electrical/HVAC job.
For each photo, write a short descriptive caption (3-6 words) describing exactly what is shown.
Be specific — e.g. "Indoor split system head unit", "Outdoor condenser unit on wall bracket", "Switchboard circuit breakers", "Pipe run on exterior wall", "Controller showing fault code E3", "Remote control unit", "Name plate label", etc.
Return ONLY a JSON array of caption strings, one per photo, in order. No other text.
Example: ["Indoor head unit on wall", "Outdoor condenser wall mounted", "Electrical switchboard"]`
      });

      try {
        const visionRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'x-api-key':ANTHROPIC_KEY, 'anthropic-version':'2023-06-01' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 400,
            messages: [{ role: 'user', content: imageContent }]
          })
        });
        const visionJson = await visionRes.json();
        const captionRaw = visionJson.content?.[0]?.text || '[]';
        const captions   = JSON.parse(captionRaw.replace(/```json|```/g,'').trim());
        labelledPhotos   = rawPhotos.map((p, i) => ({
          data:    p.data,
          caption: captions[i] || `Photo ${i + 1}`
        }));
      } catch(e) {
        // Vision failed — use generic captions
        labelledPhotos = rawPhotos.map((p, i) => ({ data: p.data, caption: `Photo ${i + 1}` }));
      }
    }

    // Pad to 9 slots
    const photos = Array.from({ length: 9 }, (_, i) =>
      labelledPhotos[i] || { data: null, caption: `Photo ${i + 1}` }
    );

    // ── 4. Parse iAudit text — positional parser ─────────────────────────────
    const cleanedText = pdfText.replace(/\n{3,}/g, '\n\n').trim();
    const lines = pdfText.split('\n').map(l => l.trim()).filter(Boolean);
    const li = (label) => lines.findIndex(l => l === label);
    const ln = (i, offset=1) => (i !== -1 && lines[i+offset]) ? lines[i+offset] : '';

    // PAGE 1 HEADER — iAudit puts values BEFORE their labels
    // Line order: Date(label) → 0 → datevalue → addr1 → addr2 → "Site Address"(label)
    const dateLabel = li('Date');
    const siteLabel = li('Site Address');
    const dateRaw   = dateLabel !== -1 ? ln(dateLabel, 2) : '';
    const dtMatch   = dateRaw.match(/(\d+\s+\w+\s+\d{4})\s+(\d+:\d+\s+\w+)/);
    const inspDate  = dtMatch ? dtMatch[1] : dateRaw;
    const inspTime  = dtMatch ? dtMatch[2] : '';

    // Address lines appear between date value and "Site Address" label
    const addr1 = siteLabel > 0 ? lines[siteLabel - 2] : '';
    const addr2 = siteLabel > 0 ? lines[siteLabel - 1] : '';
    const address = (addr2 && !addr2.includes('AWST') && addr2 !== '0')
      ? `${addr1} ${addr2}`.trim() : addr1;

    // Insured and tech — normal label then value
    const insuredLabel = li('Full Name of Person you met with');
    const insured = insuredLabel !== -1 ? ln(insuredLabel) : '';
    const techLabel = li('Tech Signature');
    let tech = '';
    if (techLabel !== -1) {
      for (let j = techLabel + 1; j < Math.min(techLabel + 5, lines.length); j++) {
        const v = lines[j];
        if (v && !/\d+\s+\w+\s+\d{4}/.test(v) && !v.startsWith('Private') && v !== '8') {
          tech = v; break;
        }
      }
    }

    // ITEM BLOCK — 4 labels in a row then 4 values in same order
    // Item Inspected, Item name, Date of loss, Make and Model → Other, name, date, model
    const itemInspIdx = li('Item Inspected');
    const itemName    = itemInspIdx !== -1 ? lines[itemInspIdx + 5] : ''; // skip 4 labels → value 2
    const itemModel   = itemInspIdx !== -1 ? lines[itemInspIdx + 7] : ''; // value 4
    const itemDate    = itemInspIdx !== -1 ? lines[itemInspIdx + 6] : ''; // value 3

    // SINGLE-VALUE fields — label then value on next line
    const getNext = (label) => {
      const i = li(label);
      if (i === -1) return '';
      const v = ln(i);
      return v && !v.startsWith('Photo') && !v.startsWith('Private') ? v : '';
    };

    // TRIPLE BLOCK — Circuit Cable Size, Wear&Tear, Damage → values follow
    const cableIdx = li('Circuit Cable Size');
    const cable    = cableIdx !== -1 ? lines[cableIdx + 3] : '';
    const wearTear = cableIdx !== -1 ? lines[cableIdx + 4] : '';
    const causeS   = cableIdx !== -1 ? lines[cableIdx + 5] : '';

    const parsedData = {
      address,
      inspDate,
      inspTime,
      rptDate:   inspDate,
      insured,
      tech,
      item:      itemName  || getNext('Item name'),
      model:     itemModel || getNext('Make and Model'),
      ownerDate: itemDate  || getNext('Date of loss / Incident'),
      age:       getNext('Approximate Age of Item'),
      voltage:   getNext('Voltage Reading from Circuit'),
      fault:     getNext('Fault Codes Shown on Controller').replace(/^N\/A$/i, ''),
      cutout:    getNext('Measurements of cut out'),
      cable:     cable    || getNext('Circuit Cable Size'),
      wearTear:  wearTear || '',
      causeS:    causeS   || getNext('Damage is the Caused By ?'),
      yearBuilt: getNext('What year was the property built ?'),
      roofType:  getNext('Roof type ?'),
      pipe:      getNext('Length of pipe run'),
      pipeSize:  getNext('Pipe size'),
      mount:     getNext('How is the outdoor unit mounted'),
      drainPump: getNext('Is there a drain pump?'),
    };    // Now ask Claude to write ALL narrative fields from the full report text
    const dataPrompt = `You are a senior electrical inspector writing a professional insurance inspection report for Prime Time Electricians.

Read the structured data and write a complete professional narrative. Return ONLY valid JSON — no markdown, no comments.

Structured data extracted from iAudit report:
- Address: ${parsedData.address}
- Date: ${parsedData.inspDate} ${parsedData.inspTime}
- Insured: ${parsedData.insured}
- Technician: ${parsedData.tech}
- Item inspected: ${parsedData.item}
- Make/Model: ${parsedData.model}
- Age: ${parsedData.age}
- Fault code: ${parsedData.fault || 'None'}
- Cable size: ${parsedData.cable}
- Voltage reading: ${parsedData.voltage || 'Not recorded'}
- Cutout measurements: ${parsedData.cutout || 'Not recorded'}
- Owner reported date: ${parsedData.ownerDate}
- Cause of damage: ${parsedData.causeS}
- Wear & tear unrelated: ${parsedData.wearTear}
- Property year built: ${parsedData.yearBuilt}
- Roof type: ${parsedData.roofType}

Write these narrative fields — be specific, mention the actual item, brand, measurements and property details:
- "findings": 3-4 sentences — describe the property, what was inspected, condition found, readings taken
- "causeD": 3-4 sentences — explain exactly how the damage occurred, what components were affected, why it needs attention
- "rec": 1-2 sentences — clear recommendation, repair or full replacement and why
- "summary": 3-4 sentences — standalone executive summary covering property, item, cause and outcome

Return this exact JSON:
{
  "address": "${parsedData.address}",
  "inspDate": "${parsedData.inspDate}",
  "inspTime": "${parsedData.inspTime}",
  "rptDate": "${parsedData.rptDate}",
  "insured": "${parsedData.insured}",
  "tech": "${parsedData.tech}",
  "item": "${parsedData.item}",
  "model": "${parsedData.model}",
  "age": "${parsedData.age}",
  "fault": "${parsedData.fault}",
  "cable": "${parsedData.cable}",
  "pipe": "${parsedData.pipe}",
  "pipeSize": "${parsedData.pipeSize}",
  "mount": "${parsedData.mount}",
  "ownerDate": "${parsedData.ownerDate}",
  "drainPump": "${parsedData.drainPump}",
  "wearTear": "${parsedData.wearTear}",
  "causeS": "${parsedData.causeS}",
  "findings": "WRITE HERE",
  "causeD": "WRITE HERE",
  "rec": "WRITE HERE",
  "summary": "WRITE HERE"
}`;

    const dataRes  = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key':ANTHROPIC_KEY, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:2000, messages:[{role:'user',content:dataPrompt}] })
    });
    const dataJson = await dataRes.json();
    const dataRaw  = dataJson.content?.[0]?.text || '{}';
    const data     = JSON.parse(dataRaw.replace(/```json|```/g,'').trim());

    // ── 5. Create pending report in DB ────────────────────────────────────────
    const db = readDB();
    const newReport = {
      id:        uuid(),
      createdAt: new Date().toISOString(),
      status:    'pending',
      ...data,
      photos,
      reportText: ''
    };
    db.reports.push(newReport);
    writeDB(db);

    res.json({ ok: true, reportId: newReport.id, photosFound: labelledPhotos.length });

  } catch(err) {
    console.error('Extract error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── API: Generate report text ─────────────────────────────────────────────────
const isNA = v => !v || ['','na','n/a','n.a.','-','none','nil'].includes(String(v).trim().toLowerCase());
const fieldLine = (l,v) => isNA(v) ? null : `${l}: ${v}`;

app.post('/api/generate', requireAuth, async (req, res) => {
  const d = req.body;
  const photoLines = (d.photos||[]).filter(p=>p.data).map((p,i)=>`Photo ${i+1}: ${p.caption}`).join('\n')||'No photos';
  const unitFields = [fieldLine('Item',d.item),fieldLine('Make & Model',d.model),fieldLine('Age',d.age),fieldLine('Fault code',d.fault),fieldLine('Cable',d.cable),fieldLine('Pipe run',d.pipe),fieldLine('Pipe size',d.pipeSize),fieldLine('Mounting',d.mount),fieldLine('Drain pump',d.drainPump),fieldLine('Owner reported date',d.ownerDate),fieldLine('Wear & tear',d.wearTear),fieldLine('Leak signs',d.leakSigns)].filter(Boolean).join('\n');
  const cause = (!isNA(d.causeS)||!isNA(d.causeD)) ? [d.causeS,d.causeD].filter(v=>!isNA(v)).join(' — ') : null;

  const prompt = `Write a professional insurance inspection report for Prime Time Electricians. Formal prose only — no checklists, no scores. Only include details that are provided. Use ## headings.

SITE: ${d.address} | ${d.inspDate}${!isNA(d.inspTime)?' at '+d.inspTime:''} | Report: ${d.rptDate}
${!isNA(d.insured)?'Insured: '+d.insured:''} | Technician: ${d.tech}
ITEM:\n${unitFields||'Not provided'}
FINDINGS: ${isNA(d.findings)?'Not provided':d.findings}
${cause?'CAUSE: '+cause:''}
RECOMMENDATION: ${[d.rec,d.repair].filter(v=>!isNA(v)).join(' ')||'Not provided'}
SUMMARY: ${isNA(d.summary)?'Not provided':d.summary}
PHOTOS: ${photoLines}

Sections (skip if no info): ## 1. Site & Inspection Details  ## 2. Item Inspected  ## 3. Inspection Findings  ## 4. Cause of Damage  ## 5. Repair Recommendation  ## 6. Summary  ## 7. Site Photographs`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:2000,messages:[{role:'user',content:prompt}]})});
    const json = await r.json(); if(!r.ok) throw new Error(json.error?.message);
    res.json({ ok:true, text:json.content?.[0]?.text||'' });
  } catch(err) { res.status(500).json({ok:false,error:err.message}); }
});

// ── API: Save / Update / Delete report ───────────────────────────────────────
app.get('/api/report/:id', requireAuth, (req, res) => {
  const db = readDB();
  const r = db.reports.find(r => r.id === req.params.id);
  if (!r) return res.status(404).json(null);
  res.json(r);
});

app.post('/api/report', requireAuth, (req, res) => {
  const db = readDB();
  const r = { id:uuid(), createdAt:new Date().toISOString(), status:'pending', ...req.body };
  db.reports.push(r); writeDB(db); res.json({ok:true,id:r.id});
});
app.post('/api/report/:id', requireAuth, (req, res) => {
  const db = readDB(); const i=db.reports.findIndex(r=>r.id===req.params.id);
  if(i===-1) return res.status(404).json({ok:false});
  db.reports[i]={...db.reports[i],...req.body,id:req.params.id}; writeDB(db); res.json({ok:true});
});
app.post('/api/report/:id/status', requireAuth, (req, res) => {
  const db = readDB(); const r=db.reports.find(r=>r.id===req.params.id);
  if(!r) return res.status(404).json({ok:false});
  r.status=req.body.status; writeDB(db); res.json({ok:true});
});
app.delete('/api/report/:id', requireAuth, (req, res) => {
  const db = readDB(); db.reports=db.reports.filter(r=>r.id!==req.params.id); writeDB(db); res.json({ok:true});
});

// ── Download PDF for saved report ─────────────────────────────────────────────
app.get('/download/:id', requireAuth, (req, res) => {
  const db = readDB(); const r=db.reports.find(r=>r.id===req.params.id);
  if(!r||!r.reportText) return res.status(404).send('Report not generated yet');
  req.body={reportText:r.reportText,photos:r.photos||[],address:r.address};
  generatePDF(req,res);
});

// ── PDF Generation ────────────────────────────────────────────────────────────
app.post('/api/pdf', requireAuth, generatePDF);

function generatePDF(req, res) {
  const {reportText,photos,address}=req.body;
  try {
    const doc=new PDFDocument({size:'A4',margins:{top:115,bottom:90,left:57,right:57},autoFirstPage:false});
    const chunks=[]; doc.on('data',c=>chunks.push(c));
    const BLACK='#111111',DGREY='#333333',MGREY='#888888';
    const hBuf=fs.readFileSync(HEADER_IMG),fBuf=fs.readFileSync(FOOTER_IMG);
    const pItems=(photos||[]).map(p=>({buf:p.data?Buffer.from(p.data.split(',')[1],'base64'):null,caption:p.caption}));

    function addPage(){
      doc.addPage(); const pw=doc.page.width;
      doc.image(hBuf,0,0,{width:pw,height:pw*(350/2068)});
      const fH=46,fW=fH*(792/438);
      doc.image(fBuf,57,doc.page.height-68,{width:fW,height:fH});
      doc.fontSize(7.5).fillColor(MGREY)
        .text('Confidential — Prepared for Insurance Purposes Only',0,doc.page.height-52,{align:'right',width:pw-57})
        .text(`Prime Time Electricians  |  ABN 88 151 349 012  |  EC 9142  |  Page ${doc.bufferedPageRange().count}`,0,doc.page.height-40,{align:'right',width:pw-57});
    }

    const sections=[]; let cur=null;
    for(const line of reportText.split('\n')){
      if(line.startsWith('## ')){if(cur)sections.push(cur);cur={title:line.replace(/^## \d+\.\s*/,'').replace('## ','').trim().toUpperCase(),paras:[]};}
      else if(line.trim()&&cur)cur.paras.push(line.trim());
    }
    if(cur)sections.push(cur);
    addPage();

    for(const sec of sections){
      if(doc.y>doc.page.height-doc.page.margins.bottom-80)addPage();
      doc.moveDown(0.6).fontSize(11).fillColor(BLACK).font('Helvetica-Bold').text(sec.title);
      doc.moveDown(0.3);
      for(const para of sec.paras){
        if(doc.y>doc.page.height-doc.page.margins.bottom-60)addPage();
        doc.fontSize(10).fillColor(DGREY).font('Helvetica').text(para,{lineGap:3}).moveDown(0.4);
      }
      if(sec.title==='SITE PHOTOGRAPHS'){
        const valid=pItems.filter(p=>p.buf); if(!valid.length)continue;
        doc.moveDown(0.4);
        const pw=doc.page.width-doc.page.margins.left-doc.page.margins.right,gap=8,cols=3;
        const imgW=(pw-gap*(cols-1))/cols,imgH=imgW*0.75,rowH=imgH+20+gap;
        let col=0,rowY=doc.y;
        for(const {buf,caption} of valid){
          if(rowY+rowH>doc.page.height-doc.page.margins.bottom){addPage();rowY=doc.y;}
          const x=doc.page.margins.left+col*(imgW+gap);
          try{doc.image(buf,x,rowY,{width:imgW,height:imgH,cover:[imgW,imgH]});}catch(e){}
          doc.fontSize(7.5).fillColor(MGREY).font('Helvetica').text(caption,x,rowY+imgH+3,{width:imgW,align:'center'});
          col++;if(col>=cols){col=0;rowY+=rowH;}
        }
      }
    }
    doc.end();
    doc.on('end',()=>{
      const fname=`Insurance_Report_${(address||'Report').replace(/[^a-zA-Z0-9]+/g,'_')}.pdf`;
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition',`attachment; filename="${fname}"`);
      res.send(Buffer.concat(chunks));
    });
  }catch(err){console.error('PDF:',err);res.status(500).json({ok:false,error:err.message});}
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT,()=>{
  console.log(`\n  Prime Time Report Portal`);
  console.log(`  http://localhost:${PORT}  |  Password: ${PORTAL_PASSWORD}\n`);
});

