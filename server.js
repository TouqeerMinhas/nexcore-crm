const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const { v4: uuid } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const dbFile = path.join(DATA_DIR, 'db.json');
const defaultDb = { users: [], clients: [], calls: [], activities: [], settings: { logoUrl: '' }, passwordResets: [] };
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify(defaultDb, null, 2));
function readDb() {
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  if (!db.settings) db.settings = { logoUrl: '' };
  if (!Array.isArray(db.passwordResets)) db.passwordResets = [];
  return db;
}
function writeDb(db) { fs.writeFileSync(dbFile, JSON.stringify(db, null, 2)); }

function initAdmin() {
  const db = readDb();
  if (!db.users.length) {
    db.users.push({ id: uuid(), name: 'NexCore Admin', email: 'admin@nexcore.local', passwordHash: bcrypt.hashSync('admin123', 10), role: 'admin', active: true, createdAt: new Date().toISOString() });
    writeDb(db);
  }
}
initAdmin();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'change-this-nexcore-secret', resave: false, saveUninitialized: false, cookie: { maxAge: 1000 * 60 * 60 * 12, httpOnly: true } }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(ROOT, 'public')));

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 30 * 1024 * 1024 } });
const SERVICES = ['Web Development','Designing','UI/UX Design','Video Editing','Social Media Marketing','AI Automation'];
const STATUSES = ['Not Contacted','Received','Not Received','Declined','Scheduled','Follow-up','Interested','Closed Won','Closed Lost'];
const CHANNELS = ['Call','Email','WhatsApp'];

function auth(req, res, next) {
  const db = readDb();
  const user = db.users.find(u => u.id === req.session.userId && u.active !== false);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}
function adminOnly(req, res, next) { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' }); next(); }
function normalize(s) { return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (match) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[match]);
}
function pick(row, names) { const entries = Object.entries(row); for (const n of names) { const hit = entries.find(([k]) => normalize(k) === normalize(n)); if (hit) return hit[1]; } return ''; }
function clientForViewer(db, req, id) { const c = db.clients.find(x => x.id === id); if (!c) return null; if (req.user.role === 'admin') return c; if (c.assignedTo && c.assignedTo !== req.user.id) return null; return c; }

app.get('/api/settings/logo', (req,res)=>{ const db=readDb(); res.json({ logoUrl: db.settings?.logoUrl || '' }); });
app.post('/api/settings/logo', auth, adminOnly, upload.single('logo'), (req,res)=>{
  if(!req.file) return res.status(400).json({error:'Logo image is required'});
  const allowed=['image/png','image/jpeg','image/webp','image/svg+xml'];
  if(!allowed.includes(req.file.mimetype)){ try{fs.unlinkSync(req.file.path)}catch{}; return res.status(400).json({error:'Use PNG, JPG, WEBP, or SVG'}); }
  const ext=path.extname(req.file.originalname).toLowerCase() || '.png';
  const target=path.join(UPLOAD_DIR, 'company-logo'+ext);
  for(const old of fs.readdirSync(UPLOAD_DIR)){ if(old.startsWith('company-logo.')){ try{fs.unlinkSync(path.join(UPLOAD_DIR,old))}catch{} } }
  fs.renameSync(req.file.path,target);
  const db=readDb(); db.settings={...(db.settings||{}),logoUrl:'/uploads/'+path.basename(target)+'?v='+Date.now()}; writeDb(db);
  res.json({ok:true,logoUrl:db.settings.logoUrl});
});
app.delete('/api/settings/logo', auth, adminOnly, (req,res)=>{
  const db=readDb();
  if(db.settings?.logoUrl){ const file=path.basename(db.settings.logoUrl.split('?')[0]); try{fs.unlinkSync(path.join(UPLOAD_DIR,file))}catch{} }
  db.settings={...(db.settings||{}),logoUrl:''}; writeDb(db); res.json({ok:true});
});

app.get('/api/me', auth, (req,res)=> res.json({ user: { id:req.user.id, name:req.user.name, email:req.user.email, role:req.user.role }, services: SERVICES, statuses: STATUSES, channels: CHANNELS }));

app.post('/api/login', (req,res)=>{
  const db = readDb(); const { email, password } = req.body;
  const user = db.users.find(u => normalize(u.email) === normalize(email) && u.active !== false);
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) return res.status(401).json({ error:'Invalid email or password' });
  req.session.userId = user.id; res.json({ ok:true });
});
app.post('/api/logout', (req,res)=> req.session.destroy(()=>res.json({ok:true})));


function getSmtpTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.SMTP_SECURE || (port === 465)).toLowerCase() === 'true',
    auth: { user, pass }
  });
}

function cleanupExpiredPasswordResets(db) {
  const now = Date.now();
  db.passwordResets = db.passwordResets.filter(
    (item) => item.expiresAt > now
  );
}

app.post('/api/forgot-password', async (req, res) => {
  const email = normalize(req.body.email || '');
  const genericMessage = 'If that account email exists, a reset code has been sent.';

  if (!email) {
    return res.status(400).json({ error: 'Email address is required' });
  }

  const db = readDb();
  cleanupExpiredPasswordResets(db);

  const user = db.users.find(
    (item) => normalize(item.email) === email &&
      (item.role === 'caller' || item.role === 'admin') &&
      item.active !== false
  );

  if (!user) {
    return res.json({ ok: true, message: genericMessage });
  }

  const transporter = getSmtpTransport();
  if (!transporter) {
    return res.status(503).json({
      error: 'Password reset email is not configured yet. Ask the CRM admin to configure SMTP settings.'
    });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const now = Date.now();
  const expiresAt = now + 10 * 60 * 1000;

  db.passwordResets = db.passwordResets.filter(
    (item) => item.userId !== user.id
  );

  db.passwordResets.push({
    id: uuid(),
    userId: user.id,
    codeHash: bcrypt.hashSync(code, 10),
    expiresAt,
    attempts: 0,
    createdAt: new Date(now).toISOString()
  });

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: 'NexCore CRM Password Reset Code',
      text: [
        `Hello ${user.name},`,
        '',
        `Your NexCore CRM password reset code is: ${code}`,
        '',
        'This code expires in 10 minutes.',
        'If you did not request a password reset, you can ignore this email.',
        '',
        'NexCore IT Agency CRM'
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#161616;max-width:560px;margin:auto">
          <h2 style="color:#710014;margin-bottom:8px">NexCore CRM</h2>
          <p>Hello ${escapeHtml(user.name)},</p>
          <p>Use the following one-time code to reset your CRM password:</p>
          <div style="font-size:32px;font-weight:800;letter-spacing:8px;background:#f2f1ed;padding:18px;text-align:center;border-radius:12px;color:#710014">${code}</div>
          <p><strong>This code expires in 10 minutes.</strong></p>
          <p>If you did not request this reset, you can safely ignore this email.</p>
        </div>
      `
    });

    writeDb(db);
    return res.json({ ok: true, message: genericMessage });
  } catch (error) {
    console.error('Password reset email failed:', error);
    return res.status(502).json({
      error: 'Could not send the reset email. Check the SMTP settings and try again.'
    });
  }
});

app.post('/api/reset-password', (req, res) => {
  const email = normalize(req.body.email || '');
  const code = String(req.body.code || '').trim();
  const newPassword = String(req.body.newPassword || '');

  if (!email || !code || !newPassword) {
    return res.status(400).json({
      error: 'Email, reset code and new password are required.'
    });
  }

  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Reset code must be 6 digits.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({
      error: 'New password must be at least 6 characters.'
    });
  }

  const db = readDb();
  cleanupExpiredPasswordResets(db);

  const user = db.users.find(
    (item) => normalize(item.email) === email &&
      (item.role === 'caller' || item.role === 'admin')
  );

  if (!user || user.active === false) {
    return res.status(400).json({ error: 'Invalid or expired reset code.' });
  }

  const reset = db.passwordResets.find((item) => item.userId === user.id);

  if (!reset || reset.expiresAt <= Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired reset code.' });
  }

  if (reset.attempts >= 5) {
    return res.status(429).json({
      error: 'Too many invalid attempts. Request a new reset code.'
    });
  }

  if (!bcrypt.compareSync(code, reset.codeHash)) {
    reset.attempts += 1;
    writeDb(db);
    return res.status(400).json({ error: 'Invalid or expired reset code.' });
  }

  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  user.updatedAt = new Date().toISOString();
  db.passwordResets = db.passwordResets.filter(
    (item) => item.userId !== user.id
  );
  writeDb(db);

  return res.json({ ok: true, message: 'Password reset successfully. You can now sign in.' });
});

function buildPerformance(clients, calls, callerId='', callerName='') {
  const today = new Date().toISOString().slice(0, 10);
  const byStatus = Object.fromEntries(STATUSES.map((status) => [
    status,
    clients.filter((client) => client.status === status).length
  ]));
  const wins = byStatus['Closed Won'] || 0;
  const total = clients.length;
  const active = clients.filter((client) => !['Closed Won', 'Closed Lost'].includes(client.status)).length;
  const followups = clients.filter((client) =>
    client.nextFollowUp &&
    client.nextFollowUp.slice(0, 10) <= today &&
    !['Closed Won', 'Closed Lost'].includes(client.status)
  ).length;
  const progress = total ? Math.round((wins / total) * 100) : 0;

  return {
    callerId,
    callerName,
    totals: { clients: total, calls: calls.length, followups, wins, active },
    progress,
    byStatus
  };
}

app.get('/api/dashboard', auth, (req,res)=>{
  const db = readDb();
  const clients = visibleClients(db, req);
  const calls = req.user.role === 'admin'
    ? db.calls
    : db.calls.filter((call) => call.callerId === req.user.id);

  const performance = buildPerformance(clients, calls, req.user.id, req.user.name);

  if (req.user.role !== 'admin') {
    return res.json(performance);
  }

  const callerUsers = db.users.filter((user) => user.role === 'caller');
  const callerStats = callerUsers.map((caller) => {
    const callerClients = db.clients.filter((client) => client.assignedTo === caller.id);
    const callerCalls = db.calls.filter((call) => call.callerId === caller.id);
    return buildPerformance(callerClients, callerCalls, caller.id, caller.name);
  });

  res.json({ ...performance, callerStats });
});

app.get('/api/callers', auth, adminOnly, (req,res)=>{ const db=readDb(); res.json(db.users.filter(u=>u.role==='caller').map(u=>({id:u.id,name:u.name,email:u.email,active:u.active!==false}))); });
app.post('/api/callers', auth, adminOnly, (req,res)=>{
  const {name,email,password}=req.body; if(!name||!email||!password) return res.status(400).json({error:'Name, email and password are required'});
  const db=readDb(); if(db.users.some(u=>normalize(u.email)===normalize(email))) return res.status(400).json({error:'Email already exists'});
  const user={id:uuid(),name,email,passwordHash:bcrypt.hashSync(password,10),role:'caller',active:true,createdAt:new Date().toISOString()}; db.users.push(user); writeDb(db); res.json({id:user.id,name:user.name,email:user.email});
});
app.patch('/api/callers/:id', auth, adminOnly, (req,res)=>{ const db=readDb(); const u=db.users.find(x=>x.id===req.params.id&&x.role==='caller'); if(!u)return res.status(404).json({error:'Caller not found'}); if(req.body.name)u.name=req.body.name; if(req.body.password)u.passwordHash=bcrypt.hashSync(req.body.password,10); if(typeof req.body.active==='boolean')u.active=req.body.active; writeDb(db); res.json({ok:true}); });

function visibleClients(db, req) { if (req.user.role==='admin') return db.clients; return db.clients.filter(c=>!c.assignedTo || c.assignedTo===req.user.id); }
app.get('/api/clients', auth, (req,res)=>{
  const db=readDb(); let list=visibleClients(db,req); const q=normalize(req.query.q||''); const status=req.query.status; const assigned=req.query.assignedTo;
  if(q) list=list.filter(c=>[c.company,c.contactName,c.phone,c.email,c.website].some(v=>normalize(v).includes(q)));
  if(status) list=list.filter(c=>c.status===status);
  if(assigned && req.user.role==='admin') list=list.filter(c=>c.assignedTo===assigned);
  const callers=Object.fromEntries(db.users.map(u=>[u.id,u.name]));
  res.json(list.map(c=>({...c,assignedToName:callers[c.assignedTo]||'Unassigned'})));
});

app.post('/api/clients', auth, (req,res)=>{
  const db=readDb(); const b=req.body;
  if(!b.phone && !b.company && !b.contactName) return res.status(400).json({error:'At least phone, company or contact name is required'});
  const client={id:uuid(),company:b.company||'',contactName:b.contactName||'',phone:b.phone||'',email:b.email||'',website:b.website||'',linkedin:b.linkedin||'',address:b.address||'',status:b.status||'Not Contacted',nextFollowUp:b.nextFollowUp||'',contactChannels:b.contactChannels||[],dealDomain:b.dealDomain||'',notes:b.notes||'',assignedTo:req.user.role==='admin'?(b.assignedTo||''):req.user.id,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  db.clients.unshift(client); writeDb(db); res.json(client);
});
app.patch('/api/clients/:id', auth, (req,res)=>{
  const db=readDb(); const c=clientForViewer(db,req,req.params.id); if(!c)return res.status(404).json({error:'Client not found'});
  const allowed=['company','contactName','phone','email','website','linkedin','address','status','nextFollowUp','contactChannels','dealDomain','notes','assignedTo'];
  for(const k of allowed) if(k in req.body) c[k]=req.body[k]; if(req.user.role==='caller') c.assignedTo=req.user.id; c.updatedAt=new Date().toISOString(); writeDb(db); res.json(c);
});
app.delete('/api/clients/:id', auth, adminOnly, (req,res)=>{ const db=readDb(); const before=db.clients.length; db.clients=db.clients.filter(c=>c.id!==req.params.id); db.calls=db.calls.filter(c=>c.clientId!==req.params.id); writeDb(db); res.json({deleted:db.clients.length<before}); });

app.post('/api/import/excel', auth, upload.single('file'), (req,res)=>{
  if(!req.file) return res.status(400).json({error:'Excel file required'});
  try {
    const wb=XLSX.readFile(req.file.path); const ws=wb.Sheets[wb.SheetNames[0]]; const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
    const db=readDb(); const callers=db.users.filter(u=>u.role==='caller' && u.active!==false); let imported=0;
    for(const row of rows){
      const rawAssigned=String(pick(row,['assigned to','caller','caller email','caller name','caller id'])); let assignedTo='';
      if(req.user.role==='caller') assignedTo=req.user.id;
      else if(rawAssigned){ const match=callers.find(u=>normalize(u.id)===normalize(rawAssigned)||normalize(u.email)===normalize(rawAssigned)||normalize(u.name)===normalize(rawAssigned)); assignedTo=match?match.id:''; }
      const now=new Date().toISOString();
      const c={id:uuid(),company:String(pick(row,['company','company name','business name'])),contactName:String(pick(row,['contact person','contact name','name'])),phone:String(pick(row,['phone','phone number','mobile','contact phone'])),email:String(pick(row,['email','company email','contact email'])),website:String(pick(row,['website','website url','site'])),linkedin:String(pick(row,['linkedin','company linkedin','contact linkedin'])),address:String(pick(row,['address'])),status:'Not Contacted',nextFollowUp:'',contactChannels:[],dealDomain:'',notes:String(pick(row,['notes','note'])),assignedTo,importedBy:req.user.id,importedByRole:req.user.role,createdAt:now,updatedAt:now};
      if(c.phone||c.company||c.contactName||c.email) { db.clients.push(c); imported++; }
    }
    writeDb(db); fs.unlinkSync(req.file.path); res.json({imported,totalRows:rows.length,importedBy:req.user.name});
  } catch(e){ try{fs.unlinkSync(req.file.path)}catch{}; res.status(400).json({error:'Could not read Excel file',detail:e.message}); }
});

app.get('/api/calls', auth, (req,res)=>{
  const db=readDb();
  const visible=visibleClients(db,req);
  const visibleIds=new Set(visible.map(c=>c.id));
  const callers=Object.fromEntries(db.users.map(u=>[u.id,u.name]));
  const clientMap=Object.fromEntries(visible.map(c=>[c.id,c]));
  const list=db.calls
    .filter(call=>visibleIds.has(call.clientId))
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
    .map(call=>({
      ...call,
      callerName:callers[call.callerId]||'Unknown caller',
      client:clientMap[call.clientId]||null
    }));
  res.json(list);
});

app.get('/api/followups', auth, (req,res)=>{
  const db = readDb();
  const visible = visibleClients(db, req);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const list = visible
    .filter(client => client.nextFollowUp && !['Closed Won','Closed Lost'].includes(client.status))
    .map(client => {
      const due = new Date(client.nextFollowUp);
      const dueDate = client.nextFollowUp.slice(0, 10);
      let bucket = 'upcoming';
      if (due.getTime() < now.getTime()) bucket = 'overdue';
      else if (dueDate === today) bucket = 'today';
      return { ...client, reminderBucket: bucket, followUpAt: client.nextFollowUp };
    })
    .sort((a,b) => new Date(a.followUpAt) - new Date(b.followUpAt));
  res.json({
    overdue: list.filter(x => x.reminderBucket === 'overdue'),
    today: list.filter(x => x.reminderBucket === 'today'),
    upcoming: list.filter(x => x.reminderBucket === 'upcoming'),
    count: list.length
  });
});

app.get('/api/clients/:id/calls', auth, (req,res)=>{
  const db=readDb();
  if(!clientForViewer(db,req,req.params.id))return res.status(404).json({error:'Client not found'});
  res.json(db.calls.filter(c=>c.clientId===req.params.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
});
app.post('/api/calls', auth, upload.single('recording'), (req,res)=>{
  const db=readDb(); const c=clientForViewer(db,req,req.body.clientId); if(!c)return res.status(404).json({error:'Client not found'});
  if(req.user.role==='caller') c.assignedTo=req.user.id;
  const call={id:uuid(),clientId:c.id,callerId:req.user.id,channel:req.body.channel||'Call',outcome:req.body.outcome||'',notes:req.body.notes||'',duration:req.body.duration||'',recordingUrl:req.file?('/uploads/'+path.basename(req.file.path)):(req.body.recordingUrl||''),createdAt:new Date().toISOString()};
  db.calls.push(call);
  if(req.body.outcome && STATUSES.includes(req.body.outcome)) c.status=req.body.outcome;
  if(req.body.nextFollowUp) c.nextFollowUp=req.body.nextFollowUp;
  if(req.body.channel) c.contactChannels=Array.from(new Set([...(c.contactChannels||[]),req.body.channel]));
  c.updatedAt=new Date().toISOString(); writeDb(db); res.json(call);
});

app.post('/api/webhooks/dialer', (req,res)=>{
  const token=req.get('x-nexcore-token'); if(process.env.DIALER_WEBHOOK_TOKEN && token!==process.env.DIALER_WEBHOOK_TOKEN) return res.status(401).json({error:'Invalid token'});
  const db=readDb(); const b=req.body; const call={id:uuid(),clientId:b.clientId||'',callerId:b.callerId||'',channel:'Call',outcome:b.outcome||'',notes:b.notes||'',duration:b.duration||'',recordingUrl:b.recordingUrl||'',externalCallId:b.externalCallId||'',createdAt:new Date().toISOString()}; db.calls.push(call); writeDb(db); res.json({ok:true,id:call.id});
});

app.use((req,res)=> res.sendFile(path.join(ROOT,'public','index.html')));
app.listen(PORT,()=>console.log(`NexCore CRM running at http://localhost:${PORT}`));
