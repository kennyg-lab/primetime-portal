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

// ── Database (in-memory + file backup) ───────────────────────────────────────
const DB = { reports: [] };

function readDB() {
  try {
    const data = JSON.parse(fs.readFileSync('/tmp/pt_reports.json', 'utf8'));
    DB.reports = data.reports || [];
  } catch(e) {}
  return DB;
}

function writeDB() {
  try { fs.writeFileSync('/tmp/pt_reports.json', JSON.stringify(DB, null, 2)); } catch(e) {}
}

readDB(); // load on startup

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 }
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.redirect('/login');
}

// ── Anthropic API call ────────────────────────────────────────────────────────
async function callClaude(messages, maxTokens = 1500) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || 'API error');
  return json.content?.[0]?.text || '';
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--y:#FFE600;--blk:#111;--bdr:#E0E0E0;--grey:#777;--txt:#222;--light:#F8F8F8}
body{font-family:"Inter",sans-serif;background:#fff;color:var(--txt);min-height:100vh}
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Barlow+Condensed:wght@700;900&display=swap');
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

function page(title, nav, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prime Time — ${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Barlow+Condensed:wght@700;900&display=swap" rel="stylesheet">
<style>${BASE_CSS}</style>
</head>
<body>
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
h1{font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:18px;text-align:center;margin-bottom:24px;text-transform:uppercase}
label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#888;display:block;margin-bottom:5px}
input{width:100%;background:#F8F8F8;border:1px solid #E0E0E0;border-radius:4px;font-size:14px;padding:10px 12px;outline:none;margin-bottom:16px}
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
    <button type="submit">Sign In</button>
    <div class="err">${req.query.err ? 'Incorrect password' : ''}</div>
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
  readDB();
  const reports = [...DB.reports].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

  const badge = s => {
    const m = { pending:['#FFF8E1','#F59E0B','Pending'], approved:['#E8F5E9','#4CAF50','Approved'], sent:['#E3F2FD','#2196F3','Sent'] };
    const [bg,c,l] = m[s] || m.pending;
    return `<span style="background:${bg};color:${c};font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:2px">${l}</span>`;
  };

  const counts = { pending:0, approved:0, sent:0 };
  reports.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

  const rows = reports.length === 0
    ? `<tr><td colspan="6" style="text-align:center;padding:48px;color:#bbb;font-size:13px">No reports yet — upload an iAudit report or create a new one</td></tr>`
    : reports.map(r => `<tr style="border-bottom:1px solid #F5F5F5">
        <td style="padding:13px 12px;font-size:13px;font-weight:600">${r.address||'—'}</td>
        <td style="padding:13px 12px;font-size:12px;color:#888">${r.inspDate||'—'}</td>
        <td style="padding:13px 12px;font-size:12px;color:#888">${r.tech||'—'}</td>
        <td style="padding:13px 12px;font-size:12px;color:#888">${r.item||'—'}</td>
        <td style="padding:13px 12px">${badge(r.status)}</td>
        <td style="padding:13px 12px"><div style="display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap">
          <a href="/edit/${r.id}" class="btn btn-ghost btn-sm">Edit</a>
          ${r.reportText ? `<a href="/download/${r.id}" class="btn btn-blk btn-sm">&#8595; PDF</a>` : ''}
          ${r.status==='pending' ? `<button onclick="setStatus('${r.id}','approved')" class="btn btn-sm btn-grn">&#10003; Approve</button>` : ''}
          ${r.status==='approved' ? `<button onclick="setStatus('${r.id}','sent')" class="btn btn-sm btn-blu">Mark Sent</button>` : ''}
          <button onclick="del('${r.id}')" class="btn btn-sm btn-red">&#10005;</button>
        </div></td>
      </tr>`).join('');

  res.send(page('Dashboard', 'dash', `
    <div class="page-hd">
      <div class="page-title">Reports</div>
      <div style="display:flex;gap:8px">
        <a href="/upload" class="btn btn-ghost">&#8593; Upload iAudit</a>
        <a href="/new" class="btn btn-y">+ New Report</a>
      </div>
    </div>
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
          <th style="padding:11px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888">Address</th>
          <th style="padding:11px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888">Date</th>
          <th style="padding:11px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888">Technician</th>
          <th style="padding:11px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888">Item</th>
          <th style="padding:11px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888">Status</th>
          <th style="padding:11px 12px;text-align:right;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888">Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <script>
    async function setStatus(id,status){await fetch('/api/status/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});location.reload();}
    async function del(id){if(!confirm('Delete this report?'))return;await fetch('/api/report/'+id,{method:'DELETE'});location.reload();}
    </script>
  `));
});

// ── UPLOAD PAGE ───────────────────────────────────────────────────────────────
app.get('/upload', requireAuth, (req, res) => {
  res.send(page('Upload iAudit', 'upload', `
    <div class="page-hd"><div class="page-title">Upload iAudit Report</div></div>
    <div style="max-width:560px">
      <p style="font-size:13px;color:#666;margin-bottom:22px;line-height:1.75">
        Upload the field technician's iAudit PDF. The portal will extract all site details, unit information and photos, then use AI to write the inspection findings, cause of damage, repair recommendation and summary — all ready for your review.
      </p>
      <div id="dz" style="border:2px dashed #DDD;border-radius:6px;padding:52px;text-align:center;cursor:pointer;background:#FAFAFA;transition:all .15s">
        <div style="font-size:36px;margin-bottom:12px">&#128196;</div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:16px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Drop iAudit PDF here</div>
        <div style="font-size:12px;color:#aaa">or click to browse</div>
        <input type="file" id="pdfFile" accept=".pdf" style="display:none">
      </div>
      <div id="st" style="margin-top:14px;font-size:13px;color:#888;text-align:center;min-height:20px"></div>
      <div id="goBtn" style="display:none;margin-top:16px">
        <button onclick="extract()" class="btn btn-blk" style="width:100%;justify-content:center;font-size:15px;padding:14px">&#9889; Extract &amp; Open Editor</button>
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
    function pick(f){if(!f||!f.name.endsWith('.pdf')){st.innerHTML='<span style="color:#E53935">Please select a PDF file</span>';return;}file=f;dz.style.borderColor='#4CAF50';st.innerHTML='<span style="color:#4CAF50;font-weight:600">&#10003; '+f.name+'</span>';go.style.display='block';}
    async function extract(){
      if(!file)return;
      st.innerHTML='<span style="color:#888">Reading iAudit report and writing inspection narrative... this takes 20-30 seconds</span>';
      go.style.display='none';
      const fd=new FormData();fd.append('pdf',file);
      try{
        const res=await fetch('/api/extract',{method:'POST',body:fd});
        const json=await res.json();
        if(!json.ok)throw new Error(json.error);
        // Store report data in sessionStorage so editor can load it even if DB resets
        if(json.report){
          try{ sessionStorage.setItem('report_'+json.reportId, JSON.stringify(json.report)); }catch(e){}
        }
        st.innerHTML='<span style="color:#4CAF50;font-weight:600">&#10003; Done! '+json.photosFound+' photos extracted — opening editor...</span>';
        setTimeout(()=>window.location.href='/edit/'+json.reportId,800);
      }catch(e){st.innerHTML='<span style="color:#E53935">&#10005; '+e.message+'</span>';go.style.display='block';}
    }
    </script>
  `));
});

// ── EDITOR ────────────────────────────────────────────────────────────────────
const EDITOR_CSS = `
.layout{display:grid;grid-template-columns:190px 1fr;gap:0;min-height:calc(100vh - 120px)}
.sidebar{background:#F8F8F8;border-right:1px solid var(--bdr);padding:10px 0;border-radius:4px 0 0 4px}
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
.na-btn:hover{border-color:#aaa;color:#888}
.na-btn.on{background:#F0F0F0;border-color:#bbb;color:#888}
.fld.na input[type=text],.fld.na textarea,.fld.na .pills{opacity:.3;pointer-events:none}
.photo-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.ph-wrap{display:flex;flex-direction:column;gap:4px}
.ph-slot{background:#F8F8F8;border:1px dashed #DDD;border-radius:3px;aspect-ratio:4/3;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;position:relative;overflow:hidden;transition:border-color .13s}
.ph-slot:hover{border-color:var(--blk)}.ph-slot.filled{border-style:solid;border-color:#DDD}
.ph-slot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ph-ov{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .18s;font-size:10px;font-weight:600;text-transform:uppercase;color:#fff}
.ph-slot:hover .ph-ov{opacity:1}
.ph-n{font-size:9px;font-weight:600;color:#ccc;text-transform:uppercase}.ph-pl{font-size:20px;color:#ccc}
.ph-slot.filled .ph-n,.ph-slot.filled .ph-pl{display:none}
.cap-in input{font-size:11px;padding:4px 8px;color:#aaa}
.gen-bar{position:sticky;bottom:0;background:linear-gradient(to top,#fff 65%,transparent);padding:16px 0 24px;margin-top:24px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rp{display:none;background:#F8F8F8;border:1px solid var(--bdr);border-radius:4px;padding:22px 26px;margin-top:16px;font-size:13px;color:var(--txt);line-height:1.8}
.rp.show{display:block}
.rp h2{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--blk);margin:20px 0 6px;padding-bottom:4px;border-bottom:2px solid var(--y)}
.rp h2:first-child{margin-top:0}.rp p{margin:4px 0}
.st{font-size:12px;color:var(--grey);display:none}.st.on{display:inline}.st.ok{color:#4CAF50}.st.err{color:#E53935}
.hidden{display:none}
`;

function editorPage(reportId) {
  const safeId = JSON.stringify(reportId || null);

  return page(
    reportId ? 'Edit Report' : 'New Report',
    reportId ? 'dash' : 'new',
    [
      '<style>' + EDITOR_CSS + '</style>',
      '<div class="page-hd">',
      '<div class="page-title">' + (reportId ? 'Edit Report' : 'New Report') + '</div>',
      '<a href="/" class="btn btn-ghost btn-sm">\u2190 Dashboard</a>',
      '</div>',
      '<div class="layout">',
      '<nav class="sidebar">',
      '<div class="nav-grp">Sections</div>',
      '<a class="nav-a" href="#site"><div class="dot"></div>Site Details</a>',
      '<a class="nav-a" href="#unit"><div class="dot"></div>Unit Details</a>',
      '<a class="nav-a" href="#findings"><div class="dot"></div>Findings</a>',
      '<a class="nav-a" href="#damage"><div class="dot"></div>Cause of Damage</a>',
      '<a class="nav-a" href="#rec"><div class="dot"></div>Recommendation</a>',
      '<a class="nav-a" href="#summary"><div class="dot"></div>Summary</a>',
      '<a class="nav-a" href="#photos"><div class="dot"></div>Photos</a>',
      '<div class="nav-grp" style="margin-top:12px">Actions</div>',
      '<a class="nav-a" href="#" id="sGen"><div class="dot"></div>Generate Report</a>',
      '<a class="nav-a" href="#" id="sSave"><div class="dot"></div>Save Draft</a>',
      '<a class="nav-a" href="#" id="sPDF"><div class="dot"></div>Export PDF</a>',
      '</nav>',
      '<div class="editor">',

      // SECTION 1
      '<div class="sec" id="site">',
      '<div class="sec-hd"><span class="sec-n">01</span><span class="sec-t">Site &amp; Inspection Details</span></div>',
      '<div class="fg one"><div class="fld"><label>Property Address</label><input type="text" id="address" placeholder="43 Camberwarra Dr, Craigie WA 6025"></div></div><br>',
      '<div class="fg">',
      '<div class="fld"><label>Inspection Date</label><input type="text" id="inspDate"></div>',
      '<div class="fld"><label>Inspection Time</label><input type="text" id="inspTime"></div>',
      '<div class="fld"><label>Report Date</label><input type="text" id="rptDate"></div>',
      '<div class="fld"><label>Insured / Person Met</label><input type="text" id="insured"></div>',
      '<div class="fld"><label>Attending Technician</label><input type="text" id="tech"></div>',
      '<div class="fld"><label>Tech Signature Date</label><input type="text" id="techSig"></div>',
      '</div></div>',

      // SECTION 2
      '<div class="sec" id="unit">',
      '<div class="sec-hd"><span class="sec-n">02</span><span class="sec-t">Unit Details</span></div>',
      '<div class="fg">',
      '<div class="fld" id="fld-item"><div class="fld-hd"><label>Item Inspected</label><button class="na-btn" onclick="na(\'item\')">N/A</button></div><input type="text" id="item"></div>',
      '<div class="fld" id="fld-model"><div class="fld-hd"><label>Make &amp; Model</label><button class="na-btn" onclick="na(\'model\')">N/A</button></div><input type="text" id="model"></div>',
      '<div class="fld" id="fld-age"><div class="fld-hd"><label>Approximate Age</label><button class="na-btn" onclick="na(\'age\')">N/A</button></div><input type="text" id="age"></div>',
      '<div class="fld" id="fld-fault"><div class="fld-hd"><label>Fault Code</label><button class="na-btn" onclick="na(\'fault\')">N/A</button></div><input type="text" id="fault"></div>',
      '<div class="fld" id="fld-cable"><div class="fld-hd"><label>Circuit Cable Size</label><button class="na-btn" onclick="na(\'cable\')">N/A</button></div><input type="text" id="cable"></div>',
      '<div class="fld" id="fld-pipe"><div class="fld-hd"><label>Pipe Run Length</label><button class="na-btn" onclick="na(\'pipe\')">N/A</button></div><input type="text" id="pipe"></div>',
      '<div class="fld" id="fld-pipeSize"><div class="fld-hd"><label>Pipe Size</label><button class="na-btn" onclick="na(\'pipeSize\')">N/A</button></div><input type="text" id="pipeSize"></div>',
      '<div class="fld" id="fld-mount"><div class="fld-hd"><label>Outdoor Mounting</label><button class="na-btn" onclick="na(\'mount\')">N/A</button></div><input type="text" id="mount"></div>',
      '<div class="fld" id="fld-ownerDate"><div class="fld-hd"><label>Owner Reported Date</label><button class="na-btn" onclick="na(\'ownerDate\')">N/A</button></div><input type="text" id="ownerDate"></div>',
      '<div class="fld" id="fld-dp"><div class="fld-hd"><label>Drain Pump</label><button class="na-btn" onclick="na(\'dp\')">N/A</button></div>',
      '<div class="pills"><input type="radio" name="dp" id="dpN" value="No" checked><label for="dpN">No</label><input type="radio" name="dp" id="dpY" value="Yes"><label for="dpY">Yes</label></div></div>',
      '<div class="fld" id="fld-wt"><div class="fld-hd"><label>Wear &amp; Tear (unrelated)</label><button class="na-btn" onclick="na(\'wt\')">N/A</button></div>',
      '<div class="pills"><input type="radio" name="wt" id="wtN" value="No signs observed" checked><label for="wtN">None</label><input type="radio" name="wt" id="wtY" value="Signs present"><label for="wtY">Present</label></div></div>',
      '</div></div>',

      // SECTION 3
      '<div class="sec" id="findings">',
      '<div class="sec-hd"><span class="sec-n">03</span><span class="sec-t">Inspection Findings</span></div>',
      '<div class="fg one"><div class="fld"><label>Findings Narrative</label><textarea id="findTxt" rows="6" placeholder="Inspection findings will be written here from the iAudit report..."></textarea></div></div>',
      '</div>',

      // SECTION 4
      '<div class="sec" id="damage">',
      '<div class="sec-hd"><span class="sec-n">04</span><span class="sec-t">Cause of Damage</span></div>',
      '<div class="fg">',
      '<div class="fld"><label>Cause (Short)</label><input type="text" id="causeS" placeholder="e.g. Water ingress"></div>',
      '<div class="fld s2"><label>Detailed Cause</label><textarea id="causeD" rows="4" placeholder="Detailed cause will be written here from the iAudit report..."></textarea></div>',
      '</div></div>',

      // SECTION 5
      '<div class="sec" id="rec">',
      '<div class="sec-hd"><span class="sec-n">05</span><span class="sec-t">Repair Recommendation</span></div>',
      '<div class="fg one">',
      '<div class="fld"><label>Recommendation</label><textarea id="recTxt" rows="3" placeholder="Recommendation will be written here from the iAudit report..."></textarea></div>',
      '<div class="fld"><label>Repair Detail</label><textarea id="repTxt" rows="3" placeholder="Repair detail will be written here from the iAudit report..."></textarea></div>',
      '</div></div>',

      // SECTION 6
      '<div class="sec" id="summary">',
      '<div class="sec-hd"><span class="sec-n">06</span><span class="sec-t">Summary</span></div>',
      '<div class="fg one"><div class="fld"><label>Summary Statement</label><textarea id="sumTxt" rows="5" placeholder="Summary will be written here from the iAudit report..."></textarea></div></div>',
      '</div>',

      // SECTION 7
      '<div class="sec" id="photos">',
      '<div class="sec-hd"><span class="sec-n">07</span><span class="sec-t">Site Photographs</span></div>',
      '<div class="photo-grid" id="photoGrid"></div>',
      '<div id="fileInputs"></div>',
      '</div>',

      '<div class="rp" id="rp"></div>',

      '<div class="gen-bar">',
      '<button class="btn btn-blk" id="genBtn">&#9889; Generate Report</button>',
      '<button class="btn btn-y" id="pdfBtn" style="display:none">&#8595; Export PDF</button>',
      '<button class="btn btn-ghost btn-sm" id="saveBtn">Save Draft</button>',
      '<span class="st" id="st"></span>',
      '</div>',

      '</div></div>',

      // SCRIPT
      '<script>',
      'const REPORT_ID=' + safeId + ';',
      'let INIT=null;',
      'const LABELS=["Indoor Head Unit","Indoor Unit Name Plate","Outdoor Unit","Outdoor Unit Name Plate","Pipe Run","Controller Screen","Remote Control","Circuit Breaker / RCD","Additional View"];',
      'const photoData=new Array(9).fill(null);',
      'const photoCaptions=[...LABELS];',
      'const photoRotation=new Array(9).fill(0);',
      'const naState={};',

      'function na(id){',
      '  const fld=document.getElementById("fld-"+id);if(!fld)return;',
      '  naState[id]=!naState[id];',
      '  fld.classList.toggle("na",naState[id]);',
      '  const btn=fld.querySelector(".na-btn");if(btn)btn.classList.toggle("on",naState[id]);',
      '}',

      'function rotatePh(i,e){',
      '  e.stopPropagation();',
      '  photoRotation[i]=(photoRotation[i]+90)%360;',
      '  // Redraw the image with new rotation by re-rendering to canvas',
      '  const img=new Image();',
      '  img.onload=function(){',
      '    const canvas=document.createElement("canvas");',
      '    const r=photoRotation[i];',
      '    const swap=r===90||r===270;',
      '    canvas.width=swap?img.height:img.width;',
      '    canvas.height=swap?img.width:img.height;',
      '    const ctx=canvas.getContext("2d");',
      '    ctx.translate(canvas.width/2,canvas.height/2);',
      '    ctx.rotate(r*Math.PI/180);',
      '    ctx.drawImage(img,-img.width/2,-img.height/2);',
      '    photoData[i]=canvas.toDataURL("image/jpeg",0.92);',
      '    buildPhotos();',
      '  };',
      '  img.src=photoData[i];',
      '}',

      'function buildPhotos(){',
      '  const grid=document.getElementById("photoGrid"),fi=document.getElementById("fileInputs");',
      '  grid.innerHTML="";fi.innerHTML="";',
      '  LABELS.forEach((lbl,i)=>{',
      '    const inp=document.createElement("input");inp.type="file";inp.accept="image/*";inp.className="hidden";inp.id="fi"+i;',
      '    inp.onchange=e=>loadPh(e,i);fi.appendChild(inp);',
      '    const wrap=document.createElement("div");wrap.className="ph-wrap";',
      '    const slot=document.createElement("div");slot.className="ph-slot";slot.id="slot"+i;',
      '    slot.onclick=()=>document.getElementById("fi"+i).click();',
      '    slot.innerHTML=\'<div class="ph-pl">+</div><div class="ph-n">Photo \'+(i+1)+\'</div><div class="ph-ov">Change</div>\';',
      '    if(photoData[i]){',
      '      slot.classList.add("filled");',
      '      const img=document.createElement("img");img.src=photoData[i];slot.insertBefore(img,slot.firstChild);',
      '      // Delete button',
      '      const del=document.createElement("button");del.textContent="\u2715";',
      '      del.style.cssText="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:50%;width:22px;height:22px;font-size:11px;cursor:pointer;z-index:10";',
      '      del.onclick=e=>{e.stopPropagation();photoData[i]=null;photoRotation[i]=0;photoCaptions[i]=LABELS[i];buildPhotos();};',
      '      slot.appendChild(del);',
      '      // Rotate button',
      '      const rot=document.createElement("button");rot.textContent="\u21bb";',
      '      rot.title="Rotate 90\u00b0";',
      '      rot.style.cssText="position:absolute;top:4px;left:4px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:50%;width:22px;height:22px;font-size:13px;cursor:pointer;z-index:10;line-height:1";',
      '      rot.onclick=e=>rotatePh(i,e);',
      '      slot.appendChild(rot);',
      '    }',
      '    const cw=document.createElement("div");cw.className="cap-in";',
      '    const ci=document.createElement("input");ci.type="text";ci.id="cap"+i;ci.value=photoCaptions[i]||lbl;ci.placeholder=lbl;',
      '    cw.appendChild(ci);wrap.appendChild(slot);wrap.appendChild(cw);grid.appendChild(wrap);',
      '  });',
      '}',

      'function loadPh(e,i){const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{photoData[i]=ev.target.result;buildPhotos();};r.readAsDataURL(f);}',

      'function prefill(d){',
      '  if(!d)return;',
      '  // Clear NA states',
      '  document.querySelectorAll(".fld.na").forEach(f=>{f.classList.remove("na");const b=f.querySelector(".na-btn");if(b)b.classList.remove("on");});',
      '  Object.keys(naState).forEach(k=>delete naState[k]);',
      '  // Fill text fields',
      '  const MAP={address:"address",inspDate:"inspDate",inspTime:"inspTime",rptDate:"rptDate",insured:"insured",tech:"tech",techSig:"techSig",item:"item",model:"model",age:"age",fault:"fault",cable:"cable",pipe:"pipe",pipeSize:"pipeSize",mount:"mount",ownerDate:"ownerDate",findings:"findTxt",causeS:"causeS",causeD:"causeD",rec:"recTxt",repair:"repTxt",summary:"sumTxt"};',
      '  Object.entries(MAP).forEach(([from,to])=>{const el=document.getElementById(to);if(el&&d[from])el.value=d[from];});',
      '  // Radios',
      '  if(d.drainPump){const r=document.querySelector(\'input[name="dp"][value="\'+d.drainPump+\'"]\');if(r)r.checked=true;}',
      '  if(d.wearTear){const v=d.wearTear.toLowerCase().includes("no")?"No signs observed":"Signs present";const r=document.querySelector(\'input[name="wt"][value="\'+v+\'"]\');if(r)r.checked=true;}',
      '  // Photos',
      '  if(d.photos&&Array.isArray(d.photos)){d.photos.forEach((p,i)=>{if(p){if(p.data)photoData[i]=p.data;if(p.caption)photoCaptions[i]=p.caption;if(p.rotation)photoRotation[i]=p.rotation||0;}});}',
      '  if(d.reportText)window._rt=d.reportText;',
      '}',

      'const g=id=>{const el=document.getElementById(id);if(!el)return"";const f=el.closest(".fld");if(f&&f.classList.contains("na"))return"N/A";return el.value?.trim()||"";};',
      'const radio=n=>{const c=document.querySelector(\'input[name="\'+n+\'"]:checked\');if(!c)return"";const f=c.closest(".fld");if(f&&f.classList.contains("na"))return"N/A";return c.value;};',
      'function collect(){return{address:g("address"),inspDate:g("inspDate"),inspTime:g("inspTime"),rptDate:g("rptDate"),insured:g("insured"),tech:g("tech"),techSig:g("techSig"),item:g("item"),model:g("model"),age:g("age"),fault:g("fault"),cable:g("cable"),pipe:g("pipe"),pipeSize:g("pipeSize"),mount:g("mount"),ownerDate:g("ownerDate"),drainPump:radio("dp"),wearTear:radio("wt"),findings:g("findTxt"),causeS:g("causeS"),causeD:g("causeD"),rec:g("recTxt"),repair:g("repTxt"),summary:g("sumTxt"),photos:photoData.map((d,i)=>({data:d,caption:document.getElementById("cap"+i)?.value||LABELS[i],rotation:photoRotation[i]||0}))};};',

      'async function generate(){',
      '  const d=collect(),btn=document.getElementById("genBtn"),st=document.getElementById("st"),rp=document.getElementById("rp"),pdf=document.getElementById("pdfBtn");',
      '  btn.classList.add("busy");btn.textContent="Generating...";st.className="st on";st.textContent="Claude is writing the report...";rp.className="rp";pdf.style.display="none";window._rt="";',
      '  try{',
      '    const res=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});',
      '    const json=await res.json();if(!json.ok)throw new Error(json.error);',
      '    window._rt=json.text;st.className="st on ok";st.textContent="Report ready — review below then export PDF";',
      '    rp.innerHTML=json.text.replace(/^## \\d+\\.\\s*(.+)$/gm,"<h2>$1</h2>").replace(/^## (.+)$/gm,"<h2>$1</h2>").replace(/\\*\\*(.+?)\\*\\*/g,"<strong>$1</strong>").split("\\n\\n").map(b=>b.startsWith("<")?b:"<p>"+b.replace(/\\n/g," ")+"</p>").join("");',
      '    rp.className="rp show";pdf.style.display="inline-flex";',
      '    saveDraft(true);',
      '  }catch(e){st.className="st on err";st.textContent="Error: "+e.message;}',
      '  btn.classList.remove("busy");btn.textContent="Generate Report";',
      '}',

      'async function saveDraft(silent=false){',
      '  const d=collect();d.reportText=window._rt||"";',
      '  const url=REPORT_ID?"/api/report/"+REPORT_ID:"/api/report";',
      '  await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});',
      '  if(!silent){const st=document.getElementById("st");st.className="st on ok";st.textContent="Saved";setTimeout(()=>st.className="st",2000);}',
      '}',

      'async function exportPDF(){',
      '  if(!window._rt){alert("Generate the report first.");return;}',
      '  const d=collect(),btn=document.getElementById("pdfBtn"),st=document.getElementById("st");',
      '  btn.classList.add("busy");btn.textContent="Building PDF...";',
      '  try{',
      '    const res=await fetch("/api/pdf",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reportText:window._rt,photos:d.photos,address:d.address})});',
      '    if(!res.ok)throw new Error("PDF failed");',
      '    const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");',
      '    a.href=url;a.download="Insurance_Report_"+(d.address||"Report").replace(/[^a-zA-Z0-9]+/g,"_")+".pdf";a.click();URL.revokeObjectURL(url);',
      '    st.className="st on ok";st.textContent="PDF downloaded";',
      '  }catch(e){st.className="st on err";st.textContent="Error: "+e.message;}',
      '  btn.classList.remove("busy");btn.textContent="Export PDF";',
      '}',

      'const SECS=["site","unit","findings","damage","rec","summary","photos"];',
      'window.addEventListener("scroll",()=>{let c=SECS[0];SECS.forEach(id=>{const el=document.getElementById(id);if(el&&el.getBoundingClientRect().top<110)c=id;});document.querySelectorAll(".nav-a").forEach(a=>a.classList.toggle("on",a.getAttribute("href")==="#"+c));},{passive:true});',

      'document.addEventListener("DOMContentLoaded",async function(){',
      'try{document.getElementById("genBtn").onclick=generate;}catch(e){}',
      'try{document.getElementById("pdfBtn").onclick=exportPDF;}catch(e){}',
      'try{document.getElementById("saveBtn").onclick=()=>saveDraft(false);}catch(e){}',
      'try{document.getElementById("sGen").onclick=e=>{e.preventDefault();generate();};}catch(e){}',
      'try{document.getElementById("sSave").onclick=e=>{e.preventDefault();saveDraft(false);};}catch(e){}',
      'try{document.getElementById("sPDF").onclick=e=>{e.preventDefault();exportPDF();};}catch(e){}',
      'console.log("Script started, REPORT_ID="+REPORT_ID);',
      'let data=null;',
      'if(REPORT_ID){',
      '  try{',
      '    try{const s=sessionStorage.getItem("report_"+REPORT_ID);if(s){data=JSON.parse(s);console.log("Loaded from sessionStorage");}}catch(e){console.log("sessionStorage err:",e);}',
      '    if(!data){',
      '      console.log("Fetching from API...");',
      '      const r=await fetch("/api/report/"+REPORT_ID);',
      '      if(r.ok){data=await r.json();console.log("Loaded from API");}',
      '      else console.log("API returned:",r.status);',
      '    }',
      '    if(data){',
      '      console.log("findings:",data.findings?data.findings.substring(0,80):"MISSING");',
      '      console.log("causeD:",data.causeD?data.causeD.substring(0,80):"MISSING");',
      '      prefill(data);',
      '    } else {console.log("No data found");}',
      '  }catch(e){console.error("Load failed:",e);}',
      '}',
      'buildPhotos();',
      'if(window._rt)document.getElementById("pdfBtn").style.display="inline-flex";',
      '});',
      '</script>'
    ].join('\n')
  );
}

app.get('/new',      requireAuth, (req, res) => res.send(editorPage(null)));
app.get('/edit/:id', requireAuth, (req, res) => res.send(editorPage(req.params.id)));

// ── EXTRACT iAudit PDF ────────────────────────────────────────────────────────
app.post('/api/extract', requireAuth, upload.single('pdf'), async (req, res) => {
  try {
    // 1. Extract text
    const pdfData = await pdfParse(req.file.buffer);

    // 2. Send full PDF text to Claude to extract ALL fields AND write narrative
    const fullText = pdfData.text.substring(0, 12000);

    const extractPrompt = `You are processing an iAudit insurance inspection report for Prime Time Electricians.

Read the full PDF text below and do two things:
1. Extract all the structured data fields
2. Write professional narrative sections using ALL available information — especially the "Details of damage" field which contains the technician's notes

Return ONLY valid JSON, no markdown, no explanation.

RAW PDF TEXT:
${fullText}

Return this exact JSON — use the technician's damage details notes to write rich, specific narrative:
{
  "address": "full site address or empty if not shown",
  "inspDate": "inspection date formatted as 8 May 2026",
  "inspTime": "inspection time e.g. 11:09 AWST",
  "rptDate": "same as inspection date",
  "insured": "full name of person met with",
  "tech": "technician name from Tech Signature",
  "item": "item name",
  "model": "make and model or empty",
  "age": "approximate age or empty",
  "fault": "fault codes or empty",
  "cable": "circuit cable size or empty",
  "voltage": "voltage reading",
  "cutout": "measurements of cut out",
  "ownerDate": "date of loss or incident",
  "causeS": "cause of damage short phrase",
  "wearTear": "Yes or No or N/A",
  "yearBuilt": "year property built",
  "roofType": "roof type",
  "findings": "3-4 professional sentences: describe the property, what was inspected, condition found, voltage readings and any other measurements. Use specific details from the report.",
  "causeD": "3-4 professional sentences: use the technician's Details of damage notes to explain exactly how and why the damage occurred, what was non-compliant, what faults were found and what interim work has been done.",
  "rec": "1-2 sentences: state clearly whether full replacement is recommended and why repair is not viable.",
  "repair": "1 sentence: state specifically what work must be carried out including any measurements or scope.",
  "summary": "3-4 sentences: standalone executive summary covering property, item, cause, current situation and recommended outcome."
}`;

    let extracted = {};
    try {
      const extractText = await callClaude([{ role: 'user', content: extractPrompt }], 2000);
      console.log('Extract response (first 300):', extractText.substring(0, 300));
      const jsonMatch = extractText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[0]);
        console.log('Extracted OK — address:', extracted.address, '| findings length:', extracted.findings?.length);
      }
    } catch(e) {
      console.error('Extraction failed:', e.message);
    }

    const structured = extracted;

    // 3. Extract photos
    const pdfDoc    = await PDFLib.load(req.file.buffer, { ignoreEncryption: true });
    const refs      = pdfDoc.context.enumerateIndirectObjects();
    const rawPhotos = [];

    for (const [ref, obj] of refs) {
      try {
        if (obj?.dict) {
          const subtype = obj.dict.get(pdfDoc.context.obj('Subtype'));
          if (subtype?.toString() === '/Image') {
            const w = parseInt(obj.dict.get(pdfDoc.context.obj('Width'))?.toString() || '0');
            const h = parseInt(obj.dict.get(pdfDoc.context.obj('Height'))?.toString() || '0');
            if (w < 150 || h < 150) continue;
            const bytes = obj.contents;
            if (!bytes || bytes.length < 2000) continue;
            const isJpeg = obj.dict.get(pdfDoc.context.obj('Filter'))?.toString().includes('DCT');
            const mime   = isJpeg ? 'image/jpeg' : 'image/png';
            rawPhotos.push({ data: `data:${mime};base64,` + Buffer.from(bytes).toString('base64'), mime });
            if (rawPhotos.length >= 16) break;
          }
        }
      } catch(e) {}
    }

    // 4. Vision-label photos
    let labelledPhotos = [];
    if (rawPhotos.length > 0) {
      try {
        const imgContent = rawPhotos.slice(0, 9).map((p, i) => ([
          { type: 'text', text: `Photo ${i+1}:` },
          { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data.split(',')[1] } }
        ])).flat();

        imgContent.push({ type: 'text', text: `Label each photo with a short 3-5 word description of what is shown. Return only a JSON array of strings, one per photo. Example: ["Front of house","Switchboard overview","RCBO close-up"]` });

        const captionText = await callClaude([{ role: 'user', content: imgContent }], 300);
        const captions    = JSON.parse(captionText.match(/\[[\s\S]*\]/)?.[0] || '[]');
        labelledPhotos    = rawPhotos.map((p, i) => ({ data: p.data, caption: captions[i] || `Photo ${i+1}` }));
      } catch(e) {
        labelledPhotos = rawPhotos.map((p, i) => ({ data: p.data, caption: `Photo ${i+1}` }));
      }
    }

    const photos = Array.from({ length: 9 }, (_, i) =>
      labelledPhotos[i] || { data: null, caption: `Photo ${i+1}` }
    );

    // narrative already included in extracted object above
    const narrative = {
      findings: extracted.findings || '',
      causeD:   extracted.causeD   || '',
      rec:      extracted.rec      || '',
      repair:   extracted.repair   || '',
      summary:  extracted.summary  || '',
    };

    // 6. Save report
    const report = {
      id:          uuid(),
      createdAt:   new Date().toISOString(),
      status:      'pending',
      ...structured,
      ...narrative,
      photos,
      reportText:  ''
    };

    readDB();
    DB.reports.push(report);
    writeDB();
    req.session.lastReport = report;
    req.session.save();

    // Return the full report so the frontend can store it and prefill immediately
    res.json({ ok: true, reportId: report.id, photosFound: labelledPhotos.length, report });

  } catch(err) {
    console.error('Extract error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── REPORT CRUD ───────────────────────────────────────────────────────────────
app.get('/api/report/:id', requireAuth, (req, res) => {
  readDB();
  let r = DB.reports.find(r => r.id === req.params.id);
  if (!r && req.session.lastReport?.id === req.params.id) r = req.session.lastReport;
  if (!r) return res.status(404).json(null);
  // Log narrative fields to confirm they exist
  console.log('GET report fields:', {
    findings: r.findings ? r.findings.substring(0,50)+'...' : 'MISSING',
    causeD:   r.causeD   ? r.causeD.substring(0,50)+'...'   : 'MISSING',
    rec:      r.rec      ? r.rec.substring(0,50)+'...'      : 'MISSING',
    repair:   r.repair   ? r.repair.substring(0,50)+'...'   : 'MISSING',
    summary:  r.summary  ? r.summary.substring(0,50)+'...'  : 'MISSING',
  });
  res.json(r);
});

app.post('/api/report', requireAuth, (req, res) => {
  readDB();
  const r = { id: uuid(), createdAt: new Date().toISOString(), status: 'pending', ...req.body };
  DB.reports.push(r);
  writeDB();
  res.json({ ok: true, id: r.id });
});

app.post('/api/report/:id', requireAuth, (req, res) => {
  readDB();
  const i = DB.reports.findIndex(r => r.id === req.params.id);
  if (i === -1) {
    // Not in DB (session only) — add it
    const r = { id: req.params.id, createdAt: new Date().toISOString(), status: 'pending', ...req.body };
    DB.reports.push(r);
  } else {
    DB.reports[i] = { ...DB.reports[i], ...req.body, id: req.params.id };
  }
  writeDB();
  res.json({ ok: true });
});

app.post('/api/status/:id', requireAuth, (req, res) => {
  readDB();
  const r = DB.reports.find(r => r.id === req.params.id);
  if (r) { r.status = req.body.status; writeDB(); }
  res.json({ ok: true });
});

app.delete('/api/report/:id', requireAuth, (req, res) => {
  readDB();
  DB.reports = DB.reports.filter(r => r.id !== req.params.id);
  writeDB();
  res.json({ ok: true });
});

// ── GENERATE REPORT TEXT ──────────────────────────────────────────────────────
const isNA = v => !v || ['','na','n/a','n.a.','-','none','nil'].includes(String(v).trim().toLowerCase());
const fl   = (l, v) => isNA(v) ? null : `${l}: ${v}`;

app.post('/api/generate', requireAuth, async (req, res) => {
  const d = req.body;
  const photoLines = (d.photos||[]).filter(p=>p.data).map((p,i)=>`Photo ${i+1}: ${p.caption}`).join('\n') || 'No photos';
  const unitFields = [fl('Item',d.item),fl('Model',d.model),fl('Age',d.age),fl('Fault code',d.fault),fl('Cable',d.cable),fl('Pipe run',d.pipe),fl('Pipe size',d.pipeSize),fl('Mounting',d.mount),fl('Drain pump',d.drainPump),fl('Owner reported',d.ownerDate),fl('Wear & tear',d.wearTear)].filter(Boolean).join('\n');
  const cause = (!isNA(d.causeS)||!isNA(d.causeD)) ? [d.causeS,d.causeD].filter(v=>!isNA(v)).join(' — ') : null;

  const prompt = `Write a professional insurance inspection report for Prime Time Electricians. Formal prose — no checklists, no scores. Use ## for section headings. Only include sections where information is provided.

SITE: ${d.address} | ${d.inspDate}${!isNA(d.inspTime)?' at '+d.inspTime:''} | Report: ${d.rptDate}
${!isNA(d.insured)?'Insured: '+d.insured:''} | Technician: ${d.tech}
ITEM:
${unitFields||'Not provided'}
FINDINGS: ${isNA(d.findings)?'Not provided':d.findings}
${cause?'CAUSE: '+cause:''}
RECOMMENDATION: ${[d.rec,d.repair].filter(v=>!isNA(v)).join(' ')||'Not provided'}
SUMMARY: ${isNA(d.summary)?'Not provided':d.summary}
PHOTOS: ${photoLines}

Sections: ## 1. Site & Inspection Details  ## 2. Item Inspected  ## 3. Inspection Findings  ## 4. Cause of Damage  ## 5. Repair Recommendation  ## 6. Summary  ## 7. Site Photographs`;

  try {
    const text = await callClaude([{ role: 'user', content: prompt }], 2000);
    res.json({ ok: true, text });
  } catch(err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PDF GENERATION ────────────────────────────────────────────────────────────
app.get('/download/:id', requireAuth, async (req, res) => {
  readDB();
  const r = DB.reports.find(r => r.id === req.params.id)
    || (req.session.lastReport?.id === req.params.id ? req.session.lastReport : null);
  if (!r?.reportText) return res.status(404).send('Report not generated yet');
  generatePDF({ body: { reportText: r.reportText, photos: r.photos||[], address: r.address } }, res);
});

app.post('/api/pdf', requireAuth, (req, res) => generatePDF(req, res));

function generatePDF(req, res) {
  const { reportText, photos, address } = req.body;
  try {
    const doc    = new PDFDocument({ size:'A4', margins:{top:115,bottom:90,left:57,right:57}, autoFirstPage:false });
    const chunks = [];
    doc.on('data', c => chunks.push(c));

    const hBuf = fs.readFileSync(HEADER_IMG);
    const fBuf = fs.readFileSync(FOOTER_IMG);
    const pItems = (photos||[]).map(p => ({
      buf: p.data ? Buffer.from(p.data.split(',')[1], 'base64') : null,
      caption: p.caption
    }));

    function addPage() {
      doc.addPage();
      const pw = doc.page.width;
      doc.image(hBuf, 0, 0, { width: pw, height: pw*(350/2068) });
      const fH=46, fW=fH*(792/438);
      doc.image(fBuf, 57, doc.page.height-68, { width: fW, height: fH });
      doc.fontSize(7.5).fillColor('#888888')
        .text('Confidential — Prepared for Insurance Purposes Only', 0, doc.page.height-52, { align:'right', width:pw-57 })
        .text(`Prime Time Electricians  |  ABN 88 151 349 012  |  EC 9142  |  Page ${doc.bufferedPageRange().count}`, 0, doc.page.height-40, { align:'right', width:pw-57 });
    }

    const sections = [];
    let cur = null;
    for (const line of reportText.split('\n')) {
      if (line.startsWith('## ')) {
        if (cur) sections.push(cur);
        cur = { title: line.replace(/^## \d+\.\s*/,'').replace('## ','').trim().toUpperCase(), paras: [] };
      } else if (line.trim() && cur) {
        cur.paras.push(line.trim());
      }
    }
    if (cur) sections.push(cur);

    addPage();
    for (const sec of sections) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 80) addPage();
      doc.moveDown(0.6).fontSize(11).fillColor('#111111').font('Helvetica-Bold').text(sec.title);
      doc.moveDown(0.3);
      for (const para of sec.paras) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 60) addPage();
        doc.fontSize(10).fillColor('#333333').font('Helvetica').text(para, { lineGap:3 }).moveDown(0.4);
      }
      if (sec.title === 'SITE PHOTOGRAPHS') {
        const valid = pItems.filter(p => p.buf);
        if (!valid.length) continue;
        doc.moveDown(0.4);
        const pw = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const cols=3, gap=8, imgW=(pw-gap*(cols-1))/cols, imgH=imgW*0.75, rowH=imgH+20+gap;
        let col=0, rowY=doc.y;
        for (const {buf, caption} of valid) {
          if (rowY+rowH > doc.page.height-doc.page.margins.bottom) { addPage(); rowY=doc.y; }
          const x = doc.page.margins.left + col*(imgW+gap);
          try { doc.image(buf, x, rowY, { width:imgW, height:imgH, cover:[imgW,imgH] }); } catch(e) {}
          doc.fontSize(7.5).fillColor('#888888').font('Helvetica').text(caption, x, rowY+imgH+3, { width:imgW, align:'center' });
          col++;
          if (col >= cols) { col=0; rowY+=rowH; }
        }
      }
    }

    doc.end();
    doc.on('end', () => {
      const fname = `Insurance_Report_${(address||'Report').replace(/[^a-zA-Z0-9]+/g,'_')}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
      res.send(Buffer.concat(chunks));
    });
  } catch(err) {
    console.error('PDF error:', err);
    res.status(500).json({ ok:false, error:err.message });
  }
}

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Prime Time Report Portal`);
  console.log(`  http://localhost:${PORT}\n`);
});

