'use strict';

const express     = require('express');
const session     = require('express-session');
const multer      = require('multer');
const fetch       = require('node-fetch');
const PDFDocument = require('pdfkit');
const pdfParse    = require('pdf-parse');
const { PDFDocument: PDFLib } = require('pdf-lib');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ImageRun, BorderStyle } = require('docx');
const { v4: uuid } = require('uuid');
const fs   = require('fs');
const path = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD || 'primetime2026';
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY || '';
const SESSION_SECRET  = process.env.SESSION_SECRET || 'pt-secret';

const ASSETS     = path.join(__dirname, 'assets');
const HEADER_IMG = path.join(ASSETS, 'pt_header_strip.jpg');
const FOOTER_IMG = path.join(ASSETS, 'lh_footer.png');

// ── In-memory store (survives within a deployment) ────────────────────────────
const REPORTS = {};  // id -> report object

function saveReport(r) {
  REPORTS[r.id] = r;
  try { fs.writeFileSync('/tmp/reports.json', JSON.stringify(REPORTS)); } catch(e) {}
}

function loadReports() {
  try {
    const d = JSON.parse(fs.readFileSync('/tmp/reports.json','utf8'));
    Object.assign(REPORTS, d);
  } catch(e) {}
}

loadReports();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: true,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

function requireAuth(req, res, next) {
  if (req.session.auth) return next();
  res.redirect('/login');
}

// ── Claude ────────────────────────────────────────────────────────────────────
async function claude(messages, maxTokens = 2000) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'x-api-key':ANTHROPIC_KEY, 'anthropic-version':'2023-06-01' },
    body: JSON.stringify({ model:'claude-sonnet-4-5', max_tokens:maxTokens, messages })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'API error');
  return j.content?.[0]?.text || '';
}

// ── Shell ─────────────────────────────────────────────────────────────────────
const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--y:#FFE600;--blk:#111;--bdr:#E0E0E0;--grey:#777;--txt:#222}
body{font-family:"Inter",sans-serif;background:#fff;color:var(--txt);min-height:100vh}
.bar{background:#111;border-bottom:3px solid #FFE600;padding:0 28px;display:flex;align-items:center;justify-content:space-between;height:56px;position:sticky;top:0;z-index:100}
.logo{display:flex;align-items:center;gap:9px;text-decoration:none}
.hex{width:26px;height:26px;background:#FFE600;clip-path:polygon(25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%);display:grid;place-items:center;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:12px;color:#111}
.lt{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#fff}
.lt em{color:#FFE600;font-style:normal}
.nav{display:flex;gap:4px}
.na{color:#888;font-size:12px;font-weight:500;text-decoration:none;padding:5px 11px;border-radius:3px}
.na:hover{color:#fff;background:rgba(255,255,255,.08)}
.na.on{color:#FFE600;background:rgba(255,230,0,.1)}
.out{font-size:11px;font-weight:600;color:#555;text-decoration:none;text-transform:uppercase;letter-spacing:.06em}
.out:hover{color:#fff}
.pg{max-width:1000px;margin:0 auto;padding:28px}
.ph{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}
.pt{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:20px;text-transform:uppercase;letter-spacing:.04em}
.btn{display:inline-flex;align-items:center;gap:6px;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:12px;letter-spacing:.1em;text-transform:uppercase;border:none;padding:8px 18px;cursor:pointer;border-radius:3px;text-decoration:none;transition:background .12s}
.bb{background:#111;color:#fff}.bb:hover{background:#333}
.by{background:#FFE600;color:#111}.by:hover{background:#FFF176}
.bs{font-size:10px;padding:5px 11px}
.bg{background:transparent;color:var(--grey);border:1px solid var(--bdr)}.bg:hover{color:var(--txt)}
.bgn{background:#4CAF50;color:#fff}.bbl{background:#2196F3;color:#fff}.br{background:transparent;color:#E53935;border:1px solid #FFCDD2}
`;

function shell(title, nav, body) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PT — ${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Barlow+Condensed:wght@700;900&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<div class="bar">
  <a class="logo" href="/"><div class="hex">T</div><div class="lt">Prime Time <em>Electricians</em></div></a>
  <div class="nav">
    <a class="na ${nav==='dash'?'on':''}" href="/">Dashboard</a>
    <a class="na ${nav==='upload'?'on':''}" href="/upload">Upload iAudit</a>
  </div>
  <a class="out" href="/logout">Sign Out</a>
</div>
<div class="pg">${body}</div>
</body></html>`;
}

// ── Login ─────────────────────────────────────────────────────────────────────
app.get('/login', (req,res) => res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PT Login</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;900&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh}
.c{background:#fff;border-radius:6px;padding:44px 38px;width:340px}
.logo{display:flex;align-items:center;gap:9px;margin-bottom:28px;justify-content:center}
.hex{width:32px;height:32px;background:#FFE600;clip-path:polygon(25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%);display:grid;place-items:center;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:14px}
.lt{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:16px;text-transform:uppercase;letter-spacing:.05em}
.lt em{color:#FFE600;font-style:normal}
h1{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:17px;text-align:center;margin-bottom:22px;text-transform:uppercase}
label{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px}
input{width:100%;background:#F8F8F8;border:1px solid #E0E0E0;border-radius:4px;font-size:13px;padding:9px 11px;outline:none;margin-bottom:14px}
button{width:100%;background:#111;color:#fff;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:14px;letter-spacing:.1em;text-transform:uppercase;border:none;padding:12px;cursor:pointer;border-radius:4px}
.err{color:#E53935;font-size:12px;text-align:center;margin-top:8px}
</style></head><body><div class="c">
<div class="logo"><div class="hex">T</div><div class="lt">Prime Time <em>Electricians</em></div></div>
<h1>Report Portal</h1>
<form method="POST" action="/login">
<label>Password</label><input type="password" name="password" autofocus>
<button type="submit">Sign In</button>
<div class="err">${req.query.err?'Incorrect password':''}</div>
</form></div></body></html>`));

app.post('/login', (req,res) => {
  if (req.body.password === PORTAL_PASSWORD) { req.session.auth=true; res.redirect('/'); }
  else res.redirect('/login?err=1');
});
app.get('/logout', (req,res) => { req.session.destroy(); res.redirect('/login'); });

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/', requireAuth, (req,res) => {
  const all = Object.values(REPORTS).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const badge = s => { const m={pending:'#F59E0B',approved:'#4CAF50',sent:'#2196F3'}; return `<span style="background:${m[s]||m.pending}22;color:${m[s]||m.pending};font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:2px">${s||'pending'}</span>`; };
  const rows = all.length===0
    ? `<tr><td colspan="6" style="text-align:center;padding:40px;color:#bbb;font-size:13px">No reports yet — upload an iAudit PDF to get started</td></tr>`
    : all.map(r=>`<tr style="border-bottom:1px solid #F5F5F5">
        <td style="padding:12px;font-size:13px;font-weight:600">${r.address||'—'}</td>
        <td style="padding:12px;font-size:12px;color:#888">${r.inspDate||'—'}</td>
        <td style="padding:12px;font-size:12px;color:#888">${r.tech||'—'}</td>
        <td style="padding:12px;font-size:12px;color:#888">${r.item||'—'}</td>
        <td style="padding:12px">${badge(r.status)}</td>
        <td style="padding:12px"><div style="display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap">
          <a href="/edit/${r.id}" class="btn bg bs">Edit</a>
          ${r.reportText?`<a href="/draft/${r.id}" class="btn bb bs">Draft</a>`:''}
          ${r.status==='pending'?`<button onclick="setStatus('${r.id}','approved')" class="btn bgn bs">✓ Approve</button>`:''}
          ${r.status==='approved'?`<button onclick="setStatus('${r.id}','sent')" class="btn bbl bs">Sent</button>`:''}
          <button onclick="del('${r.id}')" class="btn br bs">✕</button>
        </div></td></tr>`).join('');
  res.send(shell('Dashboard','dash',`
    <div class="ph"><div class="pt">Reports</div>
      <a href="/upload" class="btn by">+ Upload iAudit</a></div>
    <div style="border:1px solid #E0E0E0;border-radius:4px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#F8F8F8;border-bottom:3px solid #FFE600">
          ${['Address','Date','Tech','Item','Status','Actions'].map((h,i)=>`<th style="padding:10px 12px;text-align:${i===5?'right':'left'};font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888">${h}</th>`).join('')}
        </tr></thead><tbody>${rows}</tbody>
      </table></div>
    <script>
    async function setStatus(id,s){await fetch('/api/status/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:s})});location.reload();}
    async function del(id){if(!confirm('Delete this report?'))return;await fetch('/api/report/'+id,{method:'DELETE'});location.reload();}
    </script>`));
});

// ── Upload ────────────────────────────────────────────────────────────────────
app.get('/upload', requireAuth, (req,res) => res.send(shell('Upload','upload',`
  <div class="ph"><div class="pt">Upload iAudit PDF</div></div>
  <div style="max-width:520px">
    <p style="font-size:13px;color:#666;margin-bottom:20px;line-height:1.7">Upload the iAudit PDF. The portal will read all details, write the inspection findings, cause of damage, recommendation and summary — ready for your review.</p>
    <div id="dz" style="border:2px dashed #DDD;border-radius:6px;padding:48px;text-align:center;cursor:pointer;background:#FAFAFA">
      <div style="font-size:32px;margin-bottom:10px">📄</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Drop PDF here</div>
      <div style="font-size:12px;color:#aaa">or click to browse</div>
      <input type="file" id="fi" accept=".pdf" style="display:none">
    </div>
    <div id="st" style="margin-top:12px;font-size:13px;color:#888;text-align:center;min-height:18px"></div>
    <div id="gb" style="display:none;margin-top:14px">
      <button onclick="go()" class="btn bb" style="width:100%;justify-content:center;font-size:14px;padding:13px">⚡ Extract &amp; Open Editor</button>
    </div>
  </div>
  <script>
  const dz=document.getElementById('dz'),fi=document.getElementById('fi'),st=document.getElementById('st'),gb=document.getElementById('gb');
  let file=null;
  dz.onclick=()=>fi.click();
  fi.onchange=e=>pick(e.target.files[0]);
  dz.ondragover=e=>{e.preventDefault();dz.style.borderColor='#111'};
  dz.ondragleave=()=>{dz.style.borderColor='#DDD'};
  dz.ondrop=e=>{e.preventDefault();dz.style.borderColor='#DDD';pick(e.dataTransfer.files[0])};
  function pick(f){if(!f||!f.name.endsWith('.pdf')){st.innerHTML='<span style="color:#E53935">Please select a PDF</span>';return;}
    file=f;dz.style.borderColor='#4CAF50';st.innerHTML='<span style="color:#4CAF50;font-weight:600">✓ '+f.name+'</span>';gb.style.display='block';}
  async function go(){
    if(!file)return;
    st.innerHTML='<span style="color:#888">Reading PDF and writing report... 20-30 seconds</span>';gb.style.display='none';
    const fd=new FormData();fd.append('pdf',file);
    try{
      const res=await fetch('/api/extract',{method:'POST',body:fd});
      const j=await res.json();
      if(!j.ok)throw new Error(j.error);
      st.innerHTML='<span style="color:#4CAF50;font-weight:600">✓ Done! '+j.photosFound+' photos — opening editor...</span>';
      setTimeout(()=>location.href='/edit/'+j.id,600);
    }catch(e){st.innerHTML='<span style="color:#E53935">✕ '+e.message+'</span>';gb.style.display='block';}
  }
  </script>`)));

// ── Editor ────────────────────────────────────────────────────────────────────
const ECSS = `
.layout{display:grid;grid-template-columns:180px 1fr;gap:0;min-height:calc(100vh - 100px)}
.sb{background:#F8F8F8;border-right:1px solid #E0E0E0;padding:8px 0}
.sna{display:flex;align-items:center;gap:6px;padding:7px 13px;color:#aaa;font-size:12px;border-left:2px solid transparent;text-decoration:none}
.sna:hover{color:#222;background:rgba(0,0,0,.04)}
.sna.on{color:#111;border-left-color:#FFE600;background:rgba(255,230,0,.08);font-weight:600}
.sg{padding:7px 13px 2px;font-size:9px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#ccc;margin-top:6px}
.dot{width:4px;height:4px;border-radius:50%;background:currentColor;flex-shrink:0}
.ed{padding:0 0 0 26px}
.sec{margin-bottom:32px;scroll-margin-top:70px}
.sh{display:flex;align-items:center;gap:9px;margin-bottom:14px;padding-bottom:7px;border-bottom:2px solid #FFE600}
.sn{font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:10px;color:#ccc;letter-spacing:.08em}
.st2{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:15px;text-transform:uppercase;letter-spacing:.04em}
.fg{display:grid;grid-template-columns:1fr 1fr;gap:11px}.fg.one{grid-template-columns:1fr}
.fld{display:flex;flex-direction:column;gap:3px}
label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#777}
input[type=text],textarea{background:#fff;border:1px solid #E0E0E0;border-radius:3px;color:#222;font-family:"Inter",sans-serif;font-size:13px;padding:7px 9px;width:100%;outline:none}
input[type=text]:focus,textarea:focus{border-color:#111}
input::placeholder,textarea::placeholder{color:#ccc}
textarea{resize:vertical;min-height:78px;line-height:1.6}
.ph-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.ph-wrap{display:flex;flex-direction:column;gap:3px}
.ph-slot{background:#F8F8F8;border:1px dashed #DDD;border-radius:3px;aspect-ratio:4/3;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;position:relative;overflow:hidden}
.ph-slot:hover{border-color:#111}.ph-slot.has{border-style:solid;border-color:#DDD}
.ph-slot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ph-ov{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;opacity:0;color:#fff;font-size:10px;font-weight:600;text-transform:uppercase}
.ph-slot:hover .ph-ov{opacity:1}
.ph-lbl{font-size:9px;font-weight:600;color:#ccc;text-transform:uppercase}.ph-plus{font-size:18px;color:#ccc}
.ph-slot.has .ph-lbl,.ph-slot.has .ph-plus{display:none}
.cap input{font-size:11px;padding:3px 7px;color:#aaa}
.gbar{position:sticky;bottom:0;background:linear-gradient(to top,#fff 60%,transparent);padding:14px 0 22px;margin-top:20px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.stx{font-size:12px;color:#777;display:none}.stx.on{display:inline}.stx.ok{color:#4CAF50}.stx.err{color:#E53935}
.hidden{display:none}
`;

app.get('/edit/:id', requireAuth, (req,res) => {
  const r = REPORTS[req.params.id] || {};
  const id = req.params.id;

  // Embed photos directly in page as JSON — server has them in memory
  const photoJSON = JSON.stringify((r.photos||[]).map(p=>({d:p.data||null,c:p.caption||''})));
  const V = k => (r[k]||'').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  res.send(shell('Edit Report','dash',`
    <style>${ECSS}</style>
    <div class="ph">
      <div class="pt">${r.address||'Edit Report'}</div>
      <a href="/" class="btn bg bs">← Dashboard</a>
    </div>
    <div class="layout">
      <nav class="sb">
        <div class="sg">Sections</div>
        <a class="sna" href="#s1"><div class="dot"></div>Site Details</a>
        <a class="sna" href="#s2"><div class="dot"></div>Unit Details</a>
        <a class="sna" href="#s3"><div class="dot"></div>Findings</a>
        <a class="sna" href="#s4"><div class="dot"></div>Cause</a>
        <a class="sna" href="#s5"><div class="dot"></div>Recommendation</a>
        <a class="sna" href="#s6"><div class="dot"></div>Summary</a>
        <a class="sna" href="#s7"><div class="dot"></div>Photos</a>
        <div class="sg" style="margin-top:10px">Actions</div>
        <a class="sna" href="#" id="aWrite"><div class="dot"></div>Write Sections</a>
        <a class="sna" href="#" id="aGen"><div class="dot"></div>Generate Report</a>
        <a class="sna" href="#" id="aSave"><div class="dot"></div>Save Draft</a>
      </nav>
      <div class="ed">
        <div class="sec" id="s1">
          <div class="sh"><span class="sn">01</span><span class="st2">Site &amp; Inspection Details</span></div>
          <div class="fg one"><div class="fld"><label>Property Address</label><input type="text" id="address" value="${V('address')}"></div></div><br>
          <div class="fg">
            <div class="fld"><label>Inspection Date</label><input type="text" id="inspDate" value="${V('inspDate')}"></div>
            <div class="fld"><label>Inspection Time</label><input type="text" id="inspTime" value="${V('inspTime')}"></div>
            <div class="fld"><label>Report Date</label><input type="text" id="rptDate" value="${V('rptDate')}"></div>
            <div class="fld"><label>Insured / Person Met</label><input type="text" id="insured" value="${V('insured')}"></div>
            <div class="fld"><label>Attending Technician</label><input type="text" id="tech" value="${V('tech')}"></div>
          </div>
        </div>
        <div class="sec" id="s2">
          <div class="sh"><span class="sn">02</span><span class="st2">Unit Details</span></div>
          <div class="fg">
            <div class="fld"><label>Item Inspected</label><input type="text" id="item" value="${V('item')}"></div>
            <div class="fld"><label>Make &amp; Model</label><input type="text" id="model" value="${V('model')}"></div>
            <div class="fld"><label>Approximate Age</label><input type="text" id="age" value="${V('age')}"></div>
            <div class="fld"><label>Circuit Cable Size</label><input type="text" id="cable" value="${V('cable')}"></div>
            <div class="fld"><label>Voltage</label><input type="text" id="voltage" value="${V('voltage')}"></div>
            <div class="fld"><label>Cause (Short)</label><input type="text" id="causeS" value="${V('causeS')}"></div>
            <div class="fld"><label>Owner Reported Date</label><input type="text" id="ownerDate" value="${V('ownerDate')}"></div>
            <div class="fld"><label>Wear &amp; Tear Unrelated</label><input type="text" id="wearTear" value="${V('wearTear')||'No'}"></div>
          </div>
        </div>
        <div class="sec" id="s3">
          <div class="sh"><span class="sn">03</span><span class="st2">Inspection Findings</span></div>
          <div class="fg one"><div class="fld"><label>Findings Narrative</label><textarea id="findTxt" rows="6">${r.findings||''}</textarea></div></div>
        </div>
        <div class="sec" id="s4">
          <div class="sh"><span class="sn">04</span><span class="st2">Cause of Damage</span></div>
          <div class="fg one"><div class="fld"><label>Detailed Cause</label><textarea id="causeD" rows="5">${r.causeD||''}</textarea></div></div>
        </div>
        <div class="sec" id="s5">
          <div class="sh"><span class="sn">05</span><span class="st2">Repair Recommendation</span></div>
          <div class="fg one">
            <div class="fld"><label>Recommendation</label><textarea id="recTxt" rows="3">${r.rec||''}</textarea></div>
            <div class="fld"><label>Repair Detail</label><textarea id="repTxt" rows="3">${r.repair||''}</textarea></div>
          </div>
        </div>
        <div class="sec" id="s6">
          <div class="sh"><span class="sn">06</span><span class="st2">Summary</span></div>
          <div class="fg one"><div class="fld"><label>Summary Statement</label><textarea id="sumTxt" rows="5">${r.summary||''}</textarea></div></div>
        </div>
        <div class="sec" id="s7">
          <div class="sh"><span class="sn">07</span><span class="st2">Site Photographs</span></div>
          <div class="ph-grid" id="pg"></div>
          <div id="fi2"></div>
        </div>
        <div class="gbar">
          <button class="btn by" id="bWrite">✎ Write Sections</button>
          <button class="btn bb" id="bGen">⚡ Generate Report</button>
          <button class="btn bg bs" id="bSave">Save Draft</button>
          <span class="stx" id="stx"></span>
        </div>
      </div>
    </div>
    <script>
    const RID=${JSON.stringify(id)};
    const INIT=${photoJSON};
    const PD=INIT.map(p=>p.d);
    const PC=INIT.map((p,i)=>p.c||'Photo '+(i+1));
    const PR=new Array(INIT.length).fill(0);
    window._rt='';

    function buildPhotos(){
      const g=document.getElementById('pg'),f=document.getElementById('fi2');
      g.innerHTML='';f.innerHTML='';
      for(let i=0;i<9;i++){
        const inp=document.createElement('input');inp.type='file';inp.accept='image/*';inp.className='hidden';inp.id='pfi'+i;
        inp.onchange=e=>{const r=new FileReader();r.onload=ev=>{PD[i]=ev.target.result;buildPhotos();};r.readAsDataURL(e.target.files[0]);};
        f.appendChild(inp);
        const w=document.createElement('div');w.className='ph-wrap';
        const s=document.createElement('div');s.className='ph-slot'+(PD[i]?' has':'');
        s.onclick=()=>document.getElementById('pfi'+i).click();
        s.innerHTML='<div class="ph-plus">+</div><div class="ph-lbl">Photo '+(i+1)+'</div><div class="ph-ov">Change</div>';
        if(PD[i]){
          const img=document.createElement('img');img.src=PD[i];s.insertBefore(img,s.firstChild);
          const del=document.createElement('button');del.textContent='✕';
          del.style.cssText='position:absolute;top:4px;right:4px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:10px;cursor:pointer;z-index:10';
          del.onclick=e=>{e.stopPropagation();PD[i]=null;PC[i]='Photo '+(i+1);PR[i]=0;buildPhotos();};
          s.appendChild(del);
          const rot=document.createElement('button');rot.textContent='↻';rot.title='Rotate';
          rot.style.cssText='position:absolute;top:4px;left:4px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;z-index:10;line-height:1';
          rot.onclick=e=>{e.stopPropagation();rotatePh(i);};
          s.appendChild(rot);
        }
        const cw=document.createElement('div');cw.className='cap';
        const ci=document.createElement('input');ci.type='text';ci.id='pc'+i;ci.value=PC[i];ci.placeholder='Caption';
        cw.appendChild(ci);w.appendChild(s);w.appendChild(cw);g.appendChild(w);
      }
    }

    function rotatePh(i){
      if(!PD[i])return;
      const img=new Image();
      img.onload=function(){
        const c=document.createElement('canvas'),deg=(PR[i]+90)%360,sw=deg===90||deg===270;
        c.width=sw?img.height:img.width;c.height=sw?img.width:img.height;
        const ctx=c.getContext('2d');ctx.translate(c.width/2,c.height/2);ctx.rotate(deg*Math.PI/180);
        ctx.drawImage(img,-img.width/2,-img.height/2);
        PD[i]=c.toDataURL('image/jpeg',0.9);PR[i]=deg;buildPhotos();
      };img.src=PD[i];
    }

    function g(id){const el=document.getElementById(id);return el?el.value.trim():'';}
    function collect(){
      return{address:g('address'),inspDate:g('inspDate'),inspTime:g('inspTime'),rptDate:g('rptDate'),
        insured:g('insured'),tech:g('tech'),item:g('item'),model:g('model'),age:g('age'),
        cable:g('cable'),voltage:g('voltage'),causeS:g('causeS'),ownerDate:g('ownerDate'),wearTear:g('wearTear'),
        findings:g('findTxt'),causeD:g('causeD'),rec:g('recTxt'),repair:g('repTxt'),summary:g('sumTxt'),
        photos:PD.map((d,i)=>({data:d,caption:document.getElementById('pc'+i)?.value||'Photo '+(i+1)}))};
    }

    function status(msg,cls){const s=document.getElementById('stx');s.textContent=msg;s.className='stx on'+(cls?' '+cls:'');}

    async function writeSections(){
      document.getElementById('bWrite').textContent='Writing...';
      status('Claude is writing the sections...');
      try{
        const res=await fetch('/api/write/'+RID,{method:'POST'});
        const j=await res.json();if(!j.ok)throw new Error(j.error);
        if(j.findings)document.getElementById('findTxt').value=j.findings;
        if(j.causeD)document.getElementById('causeD').value=j.causeD;
        if(j.rec)document.getElementById('recTxt').value=j.rec;
        if(j.repair)document.getElementById('repTxt').value=j.repair;
        if(j.summary)document.getElementById('sumTxt').value=j.summary;
        status('Sections written — review then Generate Report','ok');
        await save(true);
      }catch(e){status(e.message,'err');}
      document.getElementById('bWrite').textContent='✎ Write Sections';
    }

    async function generate(){
      document.getElementById('bGen').textContent='Generating...';
      status('Writing report...');
      try{
        const d=collect();
        const res=await fetch('/api/generate/'+RID,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
        const j=await res.json();if(!j.ok)throw new Error(j.error);
        window._rt=j.text;
        status('Saving...'); await save(true);
        location.href='/draft/'+RID;
      }catch(e){status(e.message,'err');}
      document.getElementById('bGen').textContent='⚡ Generate Report';
    }

    async function save(silent){
      const d=collect();d.reportText=window._rt||'';
      await fetch('/api/report/'+RID,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
      if(!silent)status('Saved','ok');
    }

    document.getElementById('bWrite').onclick=e=>{e.preventDefault();writeSections();};
    document.getElementById('bGen').onclick=generate;
    document.getElementById('bSave').onclick=()=>save(false);
    document.getElementById('aWrite').onclick=e=>{e.preventDefault();writeSections();};
    document.getElementById('aGen').onclick=e=>{e.preventDefault();generate();};
    document.getElementById('aSave').onclick=e=>{e.preventDefault();save(false);};

    buildPhotos();
    </script>`));
});

// ── Draft Page ────────────────────────────────────────────────────────────────
app.get('/draft/:id', requireAuth, (req,res) => {
  const r = REPORTS[req.params.id];
  if (!r) return res.redirect('/');
  const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const txt = (r.reportText||'')
    .replace(/^\*?\*?Prepared (for|by):?.*$/gmi,'')
    .replace(/^\*?\*?Client:?.*$/gmi,'')
    .replace(/^#{1,3} [\d.]*\s*(.+)$/gm,'<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .split('\n\n').map(b=>b.startsWith('<')?b:'<p>'+esc(b)+'</p>').join('');

  res.send(shell('Draft Report','dash',`
    <style>
    .dw{display:grid;grid-template-columns:1fr 230px;gap:22px;align-items:start}
    .db{background:#fff;border:1px solid #E0E0E0;border-radius:4px;padding:32px 36px}
    .db h2{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#111;margin:20px 0 7px;padding-bottom:5px;border-bottom:2px solid #FFE600}
    .db h2:first-child{margin-top:0}.db p{font-size:13px;line-height:1.8;color:#333;margin:3px 0}
    .dp{position:sticky;top:76px;display:flex;flex-direction:column;gap:9px}
    .dc{background:#F8F8F8;border:1px solid #E0E0E0;border-radius:4px;padding:14px}
    .dc h3{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:9px}
    .dr{font-size:12px;color:#555;margin-bottom:5px;display:flex;justify-content:space-between}
    .dr strong{color:#111;font-weight:600}
    </style>
    <div class="ph">
      <div class="pt">Draft Report</div>
      <div style="display:flex;gap:7px">
        <a href="/edit/${r.id}" class="btn bg bs">← Edit</a>
        <button onclick="exportWord()" class="btn bg">📄 Word</button>
        <button onclick="exportPDF()" class="btn bb">↓ PDF</button>
        <button onclick="approve()" class="btn bgn">✓ Approve</button>
      </div>
    </div>
    <div class="dw">
      <div class="db">${txt||'<p style="color:#bbb">No report text yet — go back and click Generate Report</p>'}</div>
      <div class="dp">
        <div class="dc">
          <h3>Job Details</h3>
          <div class="dr"><span>Address</span><strong>${esc(r.address)||'—'}</strong></div>
          <div class="dr"><span>Date</span><strong>${esc(r.inspDate)||'—'}</strong></div>
          <div class="dr"><span>Insured</span><strong>${esc(r.insured)||'—'}</strong></div>
          <div class="dr"><span>Tech</span><strong>${esc(r.tech)||'—'}</strong></div>
          <div class="dr"><span>Item</span><strong>${esc(r.item)||'—'}</strong></div>
          <div class="dr"><span>Cause</span><strong>${esc(r.causeS)||'—'}</strong></div>
        </div>
        <div class="dc">
          <h3>Actions</h3>
          <a href="/edit/${r.id}" class="btn bg bs" style="width:100%;justify-content:center;margin-bottom:7px">← Back to Editor</a>
          <button onclick="exportWord()" class="btn bg bs" style="width:100%;justify-content:center;margin-bottom:7px">📄 Word Doc</button>
          <button onclick="exportPDF()" class="btn bb bs" style="width:100%;justify-content:center;margin-bottom:7px">↓ Export PDF</button>
          <button onclick="approve()" class="btn bgn bs" style="width:100%;justify-content:center">✓ Approve</button>
        </div>
        <div id="badge" class="dc" style="text-align:center">
          <span style="background:#FFF8E1;color:#F59E0B;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:4px 10px;border-radius:2px">${r.status||'pending'}</span>
        </div>
      </div>
    </div>
    <script>
    const RID=${JSON.stringify(r.id)};
    async function exportPDF(){
      try{
        const res=await fetch('/api/pdf/'+RID,{method:'POST'});
        if(!res.ok)throw new Error('PDF failed');
        const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=url;a.download='Report_${(r.address||'Report').replace(/[^a-zA-Z0-9]+/g,'_')}'+'.pdf';a.click();URL.revokeObjectURL(url);
      }catch(e){alert('PDF Error: '+e.message);}
    }
    async function exportWord(){
      try{
        const res=await fetch('/api/word/'+RID,{method:'POST'});
        if(!res.ok)throw new Error('Word failed');
        const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=url;a.download='Report_${(r.address||'Report').replace(/[^a-zA-Z0-9]+/g,'_')}'+'.docx';a.click();URL.revokeObjectURL(url);
      }catch(e){alert('Word Error: '+e.message);}
    }
    async function approve(){
      await fetch('/api/status/'+RID,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'approved'})});
      document.getElementById('badge').innerHTML='<span style="background:#E8F5E9;color:#4CAF50;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:4px 10px;border-radius:2px">Approved</span>';
    }
    </script>`));
});

// ── Extract PDF ───────────────────────────────────────────────────────────────
app.post('/api/extract', requireAuth, upload.single('pdf'), async (req,res) => {
  try {
    const pdfData = await pdfParse(req.file.buffer);
    const text = pdfData.text.substring(0,8000);

    // Extract structured fields
    const extracted = await claude([{role:'user',content:`Extract fields from this iAudit PDF. Return ONLY valid JSON.
The PDF has labels on the left and values on the right. Extract the VALUES not the labels.

PDF TEXT:
${text}

Return ONLY this JSON:
{"address":"actual street address","inspDate":"e.g. 8 May 2026","inspTime":"e.g. 10:59 AWST","rptDate":"same as inspDate","insured":"person name","tech":"technician name","item":"actual item name","model":"actual make/model","age":"actual age","cable":"actual cable size","voltage":"actual voltage","cutout":"actual measurements","ownerDate":"date of loss","causeS":"actual cause e.g. Water Ingress","wearTear":"No or Yes","yearBuilt":"year","roofType":"roof type","damageDetails":"verbatim Details of damage text"}`}], 1200);

    let data = {};
    try { const m=extracted.match(/\{[\s\S]*\}/); if(m) data=JSON.parse(m[0]); } catch(e) {}
    console.log('Extracted — address:', data.address, '| cause:', data.causeS);

    // Extract photos from PDF
    const pdfDoc = await PDFLib.load(req.file.buffer, {ignoreEncryption:true});
    const rawPhotos = [];
    for (const [,obj] of pdfDoc.context.enumerateIndirectObjects()) {
      try {
        if (obj?.dict) {
          const sub = obj.dict.get(pdfDoc.context.obj('Subtype'));
          if (sub?.toString()==='/Image') {
            const w=parseInt(obj.dict.get(pdfDoc.context.obj('Width'))?.toString()||'0');
            const h=parseInt(obj.dict.get(pdfDoc.context.obj('Height'))?.toString()||'0');
            if (w<100||h<100) continue;
            const bytes=obj.contents;
            if (!bytes||bytes.length<1000) continue;
            const isJpeg=obj.dict.get(pdfDoc.context.obj('Filter'))?.toString().includes('DCT');
            rawPhotos.push({data:`data:${isJpeg?'image/jpeg':'image/png'};base64,`+Buffer.from(bytes).toString('base64'),caption:'Photo '+(rawPhotos.length+1)});
            if (rawPhotos.length>=16) break;
          }
        }
      } catch(e) {}
    }

    // Label photos with Claude vision
    if (rawPhotos.length > 0) {
      try {
        const imgs = rawPhotos.slice(0,9).flatMap((p,i)=>[
          {type:'text',text:'Photo '+(i+1)+':'},
          {type:'image',source:{type:'base64',media_type:p.data.startsWith('data:image/jpeg')?'image/jpeg':'image/png',data:p.data.split(',')[1]}}
        ]);
        imgs.push({type:'text',text:'Label each photo 3-5 words. Return only a JSON array.'});
        const caps = await claude([{role:'user',content:imgs}], 300);
        const arr = JSON.parse(caps.match(/\[[\s\S]*\]/)?.[0]||'[]');
        arr.forEach((c,i)=>{ if(rawPhotos[i]) rawPhotos[i].caption=c; });
      } catch(e) {}
    }

    const photos = Array.from({length:9},(_,i)=>rawPhotos[i]||{data:null,caption:'Photo '+(i+1)});

    const report = {
      id: uuid(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      ...data,
      photos,
      reportText: ''
    };

    saveReport(report);
    res.json({ok:true, id:report.id, photosFound:rawPhotos.length});

  } catch(e) {
    console.error('Extract error:', e);
    res.status(500).json({ok:false, error:e.message});
  }
});

// ── Write Sections ────────────────────────────────────────────────────────────
app.post('/api/write/:id', requireAuth, async (req,res) => {
  const r = REPORTS[req.params.id];
  if (!r) return res.status(404).json({ok:false,error:'Report not found'});
  try {
    const prompt = `Write professional insurance inspection report sections for Prime Time Electricians.

JOB DATA:
- Property: ${r.address||'not recorded'} (built ${r.yearBuilt||'unknown'}, ${r.roofType||'unknown'} roof)
- Date: ${r.inspDate||''} at ${r.inspTime||''}
- Insured: ${r.insured||'not recorded'}
- Technician: ${r.tech||'not recorded'}
- Item: ${r.item||'not recorded'} (${r.model||'unknown'}, approx ${r.age||'unknown'})
- Cable: ${r.cable||'not recorded'} | Voltage: ${r.voltage||'not recorded'} | Cutout: ${r.cutout||'not recorded'}
- Cause: ${r.causeS||'not recorded'}
- Wear & tear unrelated: ${r.wearTear||'No'}
- Owner reported: ${r.ownerDate||'not recorded'}
- Technician notes: ${r.damageDetails||'none'}

Return ONLY this JSON:
{"findings":"3-4 sentences: property, what inspected, condition, measurements","causeD":"3-4 sentences: how damage occurred using technician notes, what failed, why unsafe","rec":"1-2 sentences: recommend replacement or repair and why","repair":"1 sentence: specifically what work must be done","summary":"3-4 sentences: item inspected, cause and outcome. Do NOT repeat address or year built."}`;

    const txt = await claude([{role:'user',content:prompt}], 1500);
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON in response');
    const sections = JSON.parse(m[0]);
    Object.assign(r, sections);
    saveReport(r);
    res.json({ok:true, ...sections});
  } catch(e) {
    res.status(500).json({ok:false, error:e.message});
  }
});

// ── Generate Full Report ──────────────────────────────────────────────────────
app.post('/api/generate/:id', requireAuth, async (req,res) => {
  const r = REPORTS[req.params.id];
  if (!r) return res.status(404).json({ok:false,error:'Report not found'});
  // Update with any edits from the form
  Object.assign(r, req.body);
  const d = r;
  const isNA = v => !v||['-','n/a','na','none','nil',''].includes(String(v).trim().toLowerCase());
  const prompt = `Write a professional insurance inspection report for Prime Time Electricians. Use ## headings. Do NOT include "Prepared for" or "Client" lines. Start directly with ## 1. Site & Inspection Details.

SITE: ${d.address} | ${d.inspDate} ${d.inspTime||''} | Insured: ${d.insured||''} | Tech: ${d.tech||''}
ITEM: ${[d.item,d.model,d.age,d.cable].filter(v=>!isNA(v)).join(', ')||'Not provided'}
FINDINGS: ${d.findings||'Not provided'}
CAUSE: ${[d.causeS,d.causeD].filter(v=>!isNA(v)).join(' — ')||'Not provided'}
RECOMMENDATION: ${[d.rec,d.repair].filter(v=>!isNA(v)).join(' ')||'Not provided'}
SUMMARY: ${d.summary||'Not provided'}

Sections: ## 1. Site & Inspection Details  ## 2. Item Inspected  ## 3. Inspection Findings  ## 4. Cause of Damage  ## 5. Repair Recommendation  ## 6. Summary`;

  try {
    const text = await claude([{role:'user',content:prompt}], 2000);
    const cleaned = text.replace(/^\*?\*?Prepared (for|by):?.*$/gmi,'').replace(/^\*?\*?Client:?.*$/gmi,'').trim();
    r.reportText = cleaned;
    saveReport(r);
    res.json({ok:true, text:cleaned});
  } catch(e) {
    res.status(500).json({ok:false, error:e.message});
  }
});

// ── CRUD ──────────────────────────────────────────────────────────────────────
app.post('/api/report/:id', requireAuth, (req,res) => {
  const r = REPORTS[req.params.id] || {id:req.params.id,createdAt:new Date().toISOString(),status:'pending'};
  Object.assign(r, req.body);
  saveReport(r);
  res.json({ok:true});
});

app.delete('/api/report/:id', requireAuth, (req,res) => {
  delete REPORTS[req.params.id];
  try { fs.writeFileSync('/tmp/reports.json', JSON.stringify(REPORTS)); } catch(e) {}
  res.json({ok:true});
});

app.post('/api/status/:id', requireAuth, (req,res) => {
  const r = REPORTS[req.params.id];
  if (r) { r.status=req.body.status; saveReport(r); }
  res.json({ok:true});
});

// ── PDF Export ────────────────────────────────────────────────────────────────
app.post('/api/pdf/:id', requireAuth, (req,res) => {
  const r = REPORTS[req.params.id];
  if (!r?.reportText) return res.status(400).json({ok:false,error:'No report text'});
  buildPDF(r, res);
});

function buildPDF(r, res) {
  try {
    const PW=595.28, PH=841.89, ML=57, MR=57, MB=100, CW=PW-ML-MR;
    let hBuf=null, fBuf=null;
    try { hBuf=fs.readFileSync(HEADER_IMG); } catch(e) {}
    try { fBuf=fs.readFileSync(FOOTER_IMG); } catch(e) {}
    const hdrH = hBuf ? Math.round(PW*(350/2068)) : 75;
    const CTOP = hdrH+16, CBOT=PH-MB;

    const doc = new PDFDocument({size:'A4',margin:0,autoFirstPage:false});
    const chunks = [];
    doc.on('data',c=>chunks.push(c));
    doc.on('end',()=>{
      const fname = 'Report_'+(r.address||'Report').replace(/[^a-zA-Z0-9]+/g,'_')+'.pdf';
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition','attachment; filename="'+fname+'"');
      res.send(Buffer.concat(chunks));
    });

    const pItems = (r.photos||[]).filter(p=>p&&p.data).map(p=>({
      buf: Buffer.from(p.data.split(',')[1],'base64'),
      caption: p.caption||''
    }));

    function chrome(){
      if(hBuf){try{doc.image(hBuf,0,0,{width:PW,height:hdrH});}catch(e){}}
      else{doc.rect(0,0,PW,hdrH).fill('#111111');doc.fontSize(18).fillColor('#FFE600').font('Helvetica-Bold').text('PRIME TIME ELECTRICIANS',ML,18,{width:CW});doc.fontSize(9).fillColor('#ffffff').font('Helvetica').text('Insurance Inspection Report',ML,46,{width:CW});}
      if(fBuf){try{const fH=40,fW=fH*(792/438);doc.image(fBuf,ML,PH-65,{width:fW,height:fH});}catch(e){}}
      const pg=doc.bufferedPageRange().count;
      doc.fontSize(7).fillColor('#999999')
        .text('Confidential — Prepared for Insurance Purposes Only',0,PH-48,{align:'right',width:PW-MR})
        .text('Prime Time Electricians  |  ABN 88 151 349 012  |  EC 9142  |  Page '+pg,0,PH-36,{align:'right',width:PW-MR});
      doc.x=ML; doc.y=CTOP;
    }

    function np(){doc.addPage();chrome();}
    function chk(n){if(doc.y+n>CBOT)np();}
    function hd(t){chk(55);doc.moveDown(0.3);doc.fontSize(10.5).fillColor('#111111').font('Helvetica-Bold').text(t,ML,doc.y,{width:CW});doc.moveTo(ML,doc.y+2).lineTo(ML+CW,doc.y+2).strokeColor('#FFE600').lineWidth(1.5).stroke();doc.y=doc.y+7;doc.x=ML;}
    function bt(p){chk(35);doc.fontSize(9.5).fillColor('#333333').font('Helvetica').text(p,ML,doc.y,{width:CW,lineGap:2.5});doc.moveDown(0.3);}

    const secs=[]; let cur=null;
    for(const line of r.reportText.split('\n')){
      if(line.match(/^#{1,3} /)){if(cur)secs.push(cur);cur={title:line.replace(/^#{1,3} [\d.]*\s*/,'').trim().toUpperCase(),paras:[]};}
      else if(line.trim()&&cur)cur.paras.push(line.trim());
    }
    if(cur)secs.push(cur);

    np();
    for(const sec of secs){
      if(/PHOTO/i.test(sec.title))continue;
      hd(sec.title);
      for(const p of sec.paras)bt(p);
    }

    if(pItems.length>0){
      chk(55); doc.moveDown(0.3); hd('SITE PHOTOGRAPHS');
      const COLS=3,GX=10;
      const IW=Math.floor((CW-GX*(COLS-1))/COLS);
      const IH=Math.round(IW*0.67);
      const RH=IH+20;
      let col=0, ry=doc.y+4;
      for(const{buf,caption}of pItems){
        if(col===0&&ry+RH>CBOT){np();ry=doc.y+4;}
        const x=ML+col*(IW+GX);
        try{doc.image(buf,x,ry,{fit:[IW,IH],align:'center',valign:'center'});}catch(e){}
        doc.rect(x,ry,IW,IH).strokeColor('#EEEEEE').lineWidth(0.5).stroke();
        doc.fontSize(7.5).fillColor('#444444').font('Helvetica').text(caption,x,ry+IH+3,{width:IW,align:'center',lineBreak:false});
        col++;if(col>=COLS){col=0;ry+=RH;}
      }
    }

    doc.end();
  } catch(e) {
    console.error('PDF error:',e);
    if(!res.headersSent)res.status(500).json({ok:false,error:e.message});
  }
}

// ── Word Export ───────────────────────────────────────────────────────────────
app.post('/api/word/:id', requireAuth, async (req,res) => {
  const r = REPORTS[req.params.id];
  if (!r?.reportText) return res.status(400).json({ok:false,error:'No report text'});
  try {
    const children = [];
    try {
      const hBuf = fs.readFileSync(HEADER_IMG);
      children.push(new Paragraph({children:[new ImageRun({data:hBuf,transformation:{width:620,height:95},type:'jpg'})]}));
      children.push(new Paragraph({text:''}));
    } catch(e) {
      children.push(new Paragraph({children:[new TextRun({text:'PRIME TIME ELECTRICIANS',bold:true,size:36,color:'111111'})]}));
    }

    const secs=[]; let cur=null;
    for(const line of r.reportText.split('\n')){
      if(line.match(/^#{1,3} /)){if(cur)secs.push(cur);cur={title:line.replace(/^#{1,3} [\d.]*\s*/,'').trim().toUpperCase(),paras:[]};}
      else if(line.trim()&&cur)cur.paras.push(line.trim());
    }
    if(cur)secs.push(cur);

    for(const sec of secs){
      if(/PHOTO/i.test(sec.title))continue;
      children.push(new Paragraph({children:[new TextRun({text:sec.title,bold:true,size:22,color:'111111'})],border:{bottom:{style:BorderStyle.SINGLE,size:12,color:'FFE600',space:4}},spacing:{before:280,after:120}}));
      for(const p of sec.paras){
        children.push(new Paragraph({children:[new TextRun({text:p,size:20,color:'333333'})],spacing:{after:120},alignment:AlignmentType.JUSTIFIED}));
      }
    }

    const pItems=(r.photos||[]).filter(p=>p&&p.data);
    if(pItems.length>0){
      children.push(new Paragraph({children:[new TextRun({text:'SITE PHOTOGRAPHS',bold:true,size:22,color:'111111'})],border:{bottom:{style:BorderStyle.SINGLE,size:12,color:'FFE600',space:4}},spacing:{before:280,after:160}}));
      for(let i=0;i<pItems.length;i+=2){
        const row=pItems.slice(i,i+2);
        const rc=[];
        for(const p of row){
          try{rc.push(new ImageRun({data:Buffer.from(p.data.split(',')[1],'base64'),transformation:{width:270,height:185},type:p.data.startsWith('data:image/jpeg')?'jpg':'png'}));rc.push(new TextRun({text:'    '}));}catch(e){}
        }
        if(rc.length)children.push(new Paragraph({children:rc,spacing:{after:40}}));
        children.push(new Paragraph({children:row.map(p=>new TextRun({text:(p.caption||'').padEnd(45),size:16,color:'666666',italics:true})),spacing:{after:140}}));
      }
    }

    const doc = new Document({
      styles:{default:{document:{run:{font:'Arial',size:20}}}},
      sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:720,right:720,bottom:720,left:720}}},children}]
    });
    const buffer = await Packer.toBuffer(doc);
    const fname = 'Report_'+(r.address||'Report').replace(/[^a-zA-Z0-9]+/g,'_')+'.docx';
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition','attachment; filename="'+fname+'"');
    res.send(buffer);
  } catch(e) {
    console.error('Word error:',e);
    res.status(500).json({ok:false,error:e.message});
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log('PT Portal on port '+PORT));

