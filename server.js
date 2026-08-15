require('dotenv').config();

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

const supabase = require('./supabase');

const app = express();

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
// Agar Vercel par run ho raha hai toh /tmp/uploads use karo, warna local uploads folder
const isVercel = process.env.VERCEL || process.env.AWS_REGION; 
const UPLOAD_DIR = isVercel ? '/tmp/uploads' : path.join(ROOT, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-this-nexcore-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 12,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    }
  })
);

app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(ROOT, 'public')));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: 30 * 1024 * 1024
  }
});

const SERVICES = [
  'Web Development',
  'Designing',
  'UI/UX Design',
  'Video Editing',
  'Social Media Marketing',
  'AI Automation'
];

const STATUSES = [
  'Not Contacted',
  'Received',
  'Not Received',
  'Declined',
  'Scheduled',
  'Follow-up',
  'Interested',
  'Closed Won',
  'Closed Lost'
];

const CHANNELS = [
  'Call',
  'Email',
  'WhatsApp'
];


// ======================================================
// HELPERS
// ======================================================

function normalize(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, match => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[match]);
}

function pick(row, names) {
  const entries = Object.entries(row);

  for (const name of names) {
    const hit = entries.find(
      ([key]) => normalize(key) === normalize(name)
    );

    if (hit) return hit[1];
  }

  return '';
}


// ======================================================
// AUTH
// ======================================================

async function auth(req, res, next) {
  try {
    if (!req.session.userId) {
      return res.status(401).json({
        error: 'Unauthorized'
      });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.session.userId)
      .eq('active', true)
      .maybeSingle();

    if (error) {
      console.error('Auth database error:', error);

      return res.status(500).json({
        error: 'Database error'
      });
    }

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized'
      });
    }

    req.user = {
      ...user,
      passwordHash: user.password_hash
    };

    next();

  } catch (error) {
    console.error('Auth error:', error);

    res.status(500).json({
      error: 'Authentication failed'
    });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Admin only'
    });
  }

  next();
}


// ======================================================
// FORMAT CLIENT FOR FRONTEND
// ======================================================

function formatClient(client, callerNames = {}) {
  if (!client) return null;

  return {
    ...client,

    contactName: client.contact_name,
    nextFollowUp: client.next_follow_up,
    contactChannels: client.contact_channels || [],
    dealDomain: client.deal_domain,
    assignedTo: client.assigned_to,

    assignedToName:
      callerNames[client.assigned_to] || 'Unassigned',

    createdAt: client.created_at,
    updatedAt: client.updated_at,

    importedBy: client.imported_by,
    importedByRole: client.imported_by_role
  };
}


// ======================================================
// CLIENT VISIBILITY
// ======================================================

async function getVisibleClients(req) {
  let query = supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false });

  if (req.user.role !== 'admin') {
    query = query.or(
      `assigned_to.is.null,assigned_to.eq.${req.user.id}`
    );
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

async function getClientForViewer(req, clientId) {
  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!client) {
    return null;
  }

  if (req.user.role !== 'admin') {
    if (
      client.assigned_to &&
      client.assigned_to !== req.user.id
    ) {
      return null;
    }
  }

  return client;
}


// ======================================================
// SETTINGS / LOGO
// ======================================================

app.get('/api/settings/logo', async (req,res)=>{ 
  // Direct public folder wale logo ka path return karega
  res.json({ logoUrl: '/company-logo.png' }); 
});


app.post(
  '/api/settings/logo',
  auth,
  adminOnly,
  upload.single('logo'),
  async (req, res) => {

    if (!req.file) {
      return res.status(400).json({
        error: 'Logo image is required'
      });
    }

    const allowed = [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/svg+xml'
    ];

    if (!allowed.includes(req.file.mimetype)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {}

      return res.status(400).json({
        error: 'Use PNG, JPG, WEBP, or SVG'
      });
    }

    try {
      const ext =
        path.extname(req.file.originalname).toLowerCase() ||
        '.png';

      const target =
        path.join(UPLOAD_DIR, 'company-logo' + ext);

      for (const old of fs.readdirSync(UPLOAD_DIR)) {
        if (old.startsWith('company-logo.')) {
          try {
            fs.unlinkSync(
              path.join(UPLOAD_DIR, old)
            );
          } catch {}
        }
      }

      fs.renameSync(req.file.path, target);

      const logoUrl =
        '/uploads/' +
        path.basename(target) +
        '?v=' +
        Date.now();

      const { error } = await supabase
        .from('settings')
        .upsert(
          {
            id: 1,
            logo_url: logoUrl
          },
          {
            onConflict: 'id'
          }
        );

      if (error) throw error;

      res.json({
        ok: true,
        logoUrl
      });

    } catch (error) {
      console.error('Logo upload error:', error);

      res.status(500).json({
        error: 'Could not save logo'
      });
    }
  }
);


app.delete(
  '/api/settings/logo',
  auth,
  adminOnly,
  async (req, res) => {

    try {
      const { data } = await supabase
        .from('settings')
        .select('logo_url')
        .eq('id', 1)
        .maybeSingle();

      if (data?.logo_url) {
        const file = path.basename(
          data.logo_url.split('?')[0]
        );

        try {
          fs.unlinkSync(
            path.join(UPLOAD_DIR, file)
          );
        } catch {}
      }

      const { error } = await supabase
        .from('settings')
        .upsert(
          {
            id: 1,
            logo_url: ''
          },
          {
            onConflict: 'id'
          }
        );

      if (error) throw error;

      res.json({
        ok: true
      });

    } catch (error) {
      console.error('Logo delete error:', error);

      res.status(500).json({
        error: 'Could not delete logo'
      });
    }
  }
);


// ======================================================
// ME
// ======================================================

app.get('/api/me', auth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role
    },
    services: SERVICES,
    statuses: STATUSES,
    channels: CHANNELS
  });
});


// ======================================================
// LOGIN
// ======================================================

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .ilike('email', email || '')
      .eq('active', true)
      .maybeSingle();

    if (error) {
      console.error('Login database error:', error);

      return res.status(500).json({
        error: 'Database error'
      });
    }

    if (
      !user ||
      !bcrypt.compareSync(
        password || '',
        user.password_hash
      )
    ) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    req.session.userId = user.id;

    res.json({
      ok: true
    });

  } catch (error) {
    console.error('Login error:', error);

    res.status(500).json({
      error: 'Login failed'
    });
  }
});


app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({
      ok: true
    });
  });
});


// ======================================================
// PASSWORD RESET
// ======================================================

function getSmtpTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(
    process.env.SMTP_PORT || 465
  );
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure:
      String(
        process.env.SMTP_SECURE ||
        (port === 465)
      ).toLowerCase() === 'true',

    auth: {
      user,
      pass
    }
  });
}


app.post('/api/forgot-password', async (req, res) => {
  const email = normalize(
    req.body.email || ''
  );

  const genericMessage =
    'If that account email exists, a reset code has been sent.';

  if (!email) {
    return res.status(400).json({
      error: 'Email address is required'
    });
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .ilike('email', email)
      .in('role', ['caller', 'admin'])
      .eq('active', true)
      .maybeSingle();

    if (error) throw error;

    if (!user) {
      return res.json({
        ok: true,
        message: genericMessage
      });
    }

    const transporter = getSmtpTransport();

    if (!transporter) {
      return res.status(503).json({
        error:
          'Password reset email is not configured yet.'
      });
    }

    const code = String(
      crypto.randomInt(100000, 1000000)
    );

    const now = Date.now();

    const expiresAt =
      new Date(
        now + 10 * 60 * 1000
      ).toISOString();

    await supabase
      .from('password_resets')
      .delete()
      .eq('user_id', user.id);

    const { error: insertError } =
      await supabase
        .from('password_resets')
        .insert({
          id: uuid(),
          user_id: user.id,
          code_hash: bcrypt.hashSync(
            code,
            10
          ),
          expires_at: expiresAt,
          attempts: 0,
          created_at:
            new Date(now).toISOString()
        });

    if (insertError) {
      throw insertError;
    }

    await transporter.sendMail({
      from:
        process.env.SMTP_FROM ||
        process.env.SMTP_USER,

      to: user.email,

      subject:
        'NexCore CRM Password Reset Code',

      text: [
        `Hello ${user.name},`,
        '',
        `Your NexCore CRM password reset code is: ${code}`,
        '',
        'This code expires in 10 minutes.',
        '',
        'NexCore IT Agency CRM'
      ].join('\n'),

      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#161616;max-width:560px;margin:auto">
          <h2 style="color:#710014">NexCore CRM</h2>

          <p>Hello ${escapeHtml(user.name)},</p>

          <p>
            Use the following one-time code
            to reset your CRM password:
          </p>

          <div style="
            font-size:32px;
            font-weight:800;
            letter-spacing:8px;
            background:#f2f1ed;
            padding:18px;
            text-align:center;
            border-radius:12px;
            color:#710014
          ">
            ${code}
          </div>

          <p>
            <strong>
              This code expires in 10 minutes.
            </strong>
          </p>
        </div>
      `
    });

    res.json({
      ok: true,
      message: genericMessage
    });

  } catch (error) {
    console.error(
      'Password reset error:',
      error
    );

    res.status(502).json({
      error:
        'Could not send the reset email.'
    });
  }
});


app.post('/api/reset-password', async (req, res) => {
  const email = normalize(
    req.body.email || ''
  );

  const code = String(
    req.body.code || ''
  ).trim();

  const newPassword = String(
    req.body.newPassword || ''
  );

  if (!email || !code || !newPassword) {
    return res.status(400).json({
      error:
        'Email, reset code and new password are required.'
    });
  }

  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({
      error:
        'Reset code must be 6 digits.'
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({
      error:
        'New password must be at least 6 characters.'
    });
  }

  try {
    const { data: user, error } =
      await supabase
        .from('users')
        .select('*')
        .ilike('email', email)
        .in('role', ['caller', 'admin'])
        .eq('active', true)
        .maybeSingle();

    if (error) throw error;

    if (!user) {
      return res.status(400).json({
        error:
          'Invalid or expired reset code.'
      });
    }

    const { data: reset, error: resetError } =
      await supabase
        .from('password_resets')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

    if (resetError) throw resetError;

    if (
      !reset ||
      new Date(reset.expires_at).getTime() <= Date.now()
    ) {
      return res.status(400).json({
        error:
          'Invalid or expired reset code.'
      });
    }

    if (reset.attempts >= 5) {
      return res.status(429).json({
        error:
          'Too many invalid attempts. Request a new reset code.'
      });
    }

    if (
      !bcrypt.compareSync(
        code,
        reset.code_hash
      )
    ) {
      await supabase
        .from('password_resets')
        .update({
          attempts: reset.attempts + 1
        })
        .eq('id', reset.id);

      return res.status(400).json({
        error:
          'Invalid or expired reset code.'
      });
    }

    const { error: updateError } =
      await supabase
        .from('users')
        .update({
          password_hash:
            bcrypt.hashSync(
              newPassword,
              10
            ),
          updated_at:
            new Date().toISOString()
        })
        .eq('id', user.id);

    if (updateError) {
      throw updateError;
    }

    await supabase
      .from('password_resets')
      .delete()
      .eq('id', reset.id);

    res.json({
      ok: true,
      message:
        'Password reset successfully. You can now sign in.'
    });

  } catch (error) {
    console.error(
      'Reset password error:',
      error
    );

    res.status(500).json({
      error:
        'Could not reset password.'
    });
  }
});


// ======================================================
// DASHBOARD
// ======================================================

function buildPerformance(
  clients,
  calls,
  callerId = '',
  callerName = ''
) {
  const today =
    new Date()
      .toISOString()
      .slice(0, 10);

  const byStatus = Object.fromEntries(
    STATUSES.map(status => [
      status,
      clients.filter(
        client => client.status === status
      ).length
    ])
  );

  const wins =
    byStatus['Closed Won'] || 0;

  const total =
    clients.length;

  const active =
    clients.filter(
      client =>
        ![
          'Closed Won',
          'Closed Lost'
        ].includes(client.status)
    ).length;

  const followups =
    clients.filter(client =>
      client.next_follow_up &&
      client.next_follow_up.slice(0, 10) <= today &&
      ![
        'Closed Won',
        'Closed Lost'
      ].includes(client.status)
    ).length;

  const progress =
    total
      ? Math.round(
          (wins / total) * 100
        )
      : 0;

  return {
    callerId,
    callerName,

    totals: {
      clients: total,
      calls: calls.length,
      followups,
      wins,
      active
    },

    progress,

    byStatus
  };
}


app.get('/api/dashboard', auth, async (req, res) => {
  try {
    let clientsQuery =
      supabase
        .from('clients')
        .select('*');

    if (req.user.role !== 'admin') {
      clientsQuery =
        clientsQuery.or(
          `assigned_to.is.null,assigned_to.eq.${req.user.id}`
        );
    }

    const {
      data: clients,
      error: clientsError
    } = await clientsQuery;

    if (clientsError) throw clientsError;

    let callsQuery =
      supabase
        .from('calls')
        .select('*');

    if (req.user.role !== 'admin') {
      callsQuery =
        callsQuery.eq(
          'caller_id',
          req.user.id
        );
    }

    const {
      data: calls,
      error: callsError
    } = await callsQuery;

    if (callsError) throw callsError;

    const performance =
      buildPerformance(
        clients || [],
        calls || [],
        req.user.id,
        req.user.name
      );

    if (req.user.role !== 'admin') {
      return res.json(
        performance
      );
    }

    const {
      data: callerUsers,
      error: callerError
    } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'caller');

    if (callerError) throw callerError;

    const callerStats = [];

    for (const caller of callerUsers || []) {
      const callerClients =
        (clients || []).filter(
          client =>
            client.assigned_to === caller.id
        );

      const callerCalls =
        (calls || []).filter(
          call =>
            call.caller_id === caller.id
        );

      callerStats.push(
        buildPerformance(
          callerClients,
          callerCalls,
          caller.id,
          caller.name
        )
      );
    }

    res.json({
      ...performance,
      callerStats
    });

  } catch (error) {
    console.error(
      'Dashboard error:',
      error
    );

    res.status(500).json({
      error:
        'Could not load dashboard'
    });
  }
});


// ======================================================
// CALLERS
// ======================================================

app.get(
  '/api/callers',
  auth,
  adminOnly,
  async (req, res) => {

    try {
      const {
        data,
        error
      } = await supabase
        .from('users')
        .select(
          'id,name,email,active'
        )
        .eq('role', 'caller')
        .order('name');

      if (error) throw error;

      res.json(
        (data || []).map(user => ({
          id: user.id,
          name: user.name,
          email: user.email,
          active:
            user.active !== false
        }))
      );

    } catch (error) {
      console.error(
        'Callers fetch error:',
        error
      );

      res.status(500).json({
        error:
          'Could not load callers'
      });
    }
  }
);


app.post(
  '/api/callers',
  auth,
  adminOnly,
  async (req, res) => {

    const {
      name,
      email,
      password
    } = req.body;

    if (
      !name ||
      !email ||
      !password
    ) {
      return res.status(400).json({
        error:
          'Name, email and password are required'
      });
    }

    try {
      const {
        data: existing
      } = await supabase
        .from('users')
        .select('id')
        .ilike('email', email)
        .maybeSingle();

      if (existing) {
        return res.status(400).json({
          error:
            'Email already exists'
        });
      }

      const user = {
        id: uuid(),
        name,
        email,
        password_hash:
          bcrypt.hashSync(
            password,
            10
          ),
        role: 'caller',
        active: true,
        created_at:
          new Date().toISOString()
      };

      const {
        data,
        error
      } = await supabase
        .from('users')
        .insert(user)
        .select()
        .single();

      if (error) throw error;

      res.json({
        id: data.id,
        name: data.name,
        email: data.email
      });

    } catch (error) {
      console.error(
        'Create caller error:',
        error
      );

      res.status(500).json({
        error:
          'Could not create caller'
      });
    }
  }
);


app.patch(
  '/api/callers/:id',
  auth,
  adminOnly,
  async (req, res) => {

    try {
      const {
        data: user,
        error: findError
      } = await supabase
        .from('users')
        .select('*')
        .eq('id', req.params.id)
        .eq('role', 'caller')
        .maybeSingle();

      if (findError) throw findError;

      if (!user) {
        return res.status(404).json({
          error:
            'Caller not found'
        });
      }

      const update = {};

      if (req.body.name) {
        update.name =
          req.body.name;
      }

      if (req.body.password) {
        update.password_hash =
          bcrypt.hashSync(
            req.body.password,
            10
          );
      }

      if (
        typeof req.body.active ===
        'boolean'
      ) {
        update.active =
          req.body.active;
      }

      update.updated_at =
        new Date().toISOString();

      const {
        error
      } = await supabase
        .from('users')
        .update(update)
        .eq('id', req.params.id);

      if (error) throw error;

      res.json({
        ok: true
      });

    } catch (error) {
      console.error(
        'Update caller error:',
        error
      );

      res.status(500).json({
        error:
          'Could not update caller'
      });
    }
  }
);


// ======================================================
// CLIENTS
// ======================================================

app.get(
  '/api/clients',
  auth,
  async (req, res) => {

    try {
      let query =
        supabase
          .from('clients')
          .select('*')
          .order(
            'created_at',
            {
              ascending: false
            }
          );

      if (req.user.role !== 'admin') {
        query =
          query.or(
            `assigned_to.is.null,assigned_to.eq.${req.user.id}`
          );
      }

      const {
        data: clients,
        error
      } = await query;

      if (error) throw error;

      let list =
        clients || [];

      const q =
        normalize(
          req.query.q || ''
        );

      const status =
        req.query.status;

      const assigned =
        req.query.assignedTo;

      if (q) {
        list =
          list.filter(
            client =>
              [
                client.company,
                client.contact_name,
                client.phone,
                client.email,
                client.website
              ].some(value =>
                normalize(value)
                  .includes(q)
              )
          );
      }

      if (status) {
        list =
          list.filter(
            client =>
              client.status === status
          );
      }

      if (
        assigned &&
        req.user.role === 'admin'
      ) {
        list =
          list.filter(
            client =>
              client.assigned_to ===
              assigned
          );
      }

      const {
        data: users
      } = await supabase
        .from('users')
        .select('id,name');

      const callers =
        Object.fromEntries(
          (users || []).map(
            user => [
              user.id,
              user.name
            ]
          )
        );

      res.json(
        list.map(client =>
          formatClient(
            client,
            callers
          )
        )
      );

    } catch (error) {
      console.error(
        'Clients fetch error:',
        error
      );

      res.status(500).json({
        error:
          'Could not load clients'
      });
    }
  }
);


app.post(
  '/api/clients',
  auth,
  async (req, res) => {

    const b = req.body;

    if (
      !b.phone &&
      !b.company &&
      !b.contactName
    ) {
      return res.status(400).json({
        error:
          'At least phone, company or contact name is required'
      });
    }

    try {
      const now =
        new Date().toISOString();

      const client = {
        id: uuid(),

        company:
          b.company || '',

        contact_name:
          b.contactName || '',

        phone:
          b.phone || '',

        email:
          b.email || '',

        website:
          b.website || '',

        linkedin:
          b.linkedin || '',

        address:
          b.address || '',

        status:
          b.status ||
          'Not Contacted',

        next_follow_up:
          b.nextFollowUp ||
          null,

        contact_channels:
          b.contactChannels ||
          [],

        deal_domain:
          b.dealDomain || '',

        notes:
          b.notes || '',

        assigned_to:
          req.user.role === 'admin'
            ? (
                b.assignedTo ||
                null
              )
            : req.user.id,

        created_at: now,
        updated_at: now
      };

      const {
        data,
        error
      } = await supabase
        .from('clients')
        .insert(client)
        .select()
        .single();

      if (error) throw error;

      res.json(
        formatClient(data)
      );

    } catch (error) {
      console.error(
        'Create client error:',
        error
      );

      res.status(500).json({
        error:
          'Could not create client'
      });
    }
  }
);


app.patch(
  '/api/clients/:id',
  auth,
  async (req, res) => {

    try {
      const client =
        await getClientForViewer(
          req,
          req.params.id
        );

      if (!client) {
        return res.status(404).json({
          error:
            'Client not found'
        });
      }

      const update = {};

      if ('company' in req.body)
        update.company =
          req.body.company;

      if ('contactName' in req.body)
        update.contact_name =
          req.body.contactName;

      if ('phone' in req.body)
        update.phone =
          req.body.phone;

      if ('email' in req.body)
        update.email =
          req.body.email;

      if ('website' in req.body)
        update.website =
          req.body.website;

      if ('linkedin' in req.body)
        update.linkedin =
          req.body.linkedin;

      if ('address' in req.body)
        update.address =
          req.body.address;

      if ('status' in req.body)
        update.status =
          req.body.status;

      if ('nextFollowUp' in req.body)
        update.next_follow_up =
          req.body.nextFollowUp ||
          null;

      if ('contactChannels' in req.body)
        update.contact_channels =
          req.body.contactChannels ||
          [];

      if ('dealDomain' in req.body)
        update.deal_domain =
          req.body.dealDomain ||
          '';

      if ('notes' in req.body)
        update.notes =
          req.body.notes ||
          '';

      if (
        'assignedTo' in req.body &&
        req.user.role === 'admin'
      ) {
        update.assigned_to =
          req.body.assignedTo ||
          null;
      }

      if (req.user.role === 'caller') {
        update.assigned_to =
          req.user.id;
      }

      update.updated_at =
        new Date().toISOString();

      const {
        data,
        error
      } = await supabase
        .from('clients')
        .update(update)
        .eq(
          'id',
          req.params.id
        )
        .select()
        .single();

      if (error) throw error;

      res.json(
        formatClient(data)
      );

    } catch (error) {
      console.error(
        'Update client error:',
        error
      );

      res.status(500).json({
        error:
          'Could not update client'
      });
    }
  }
);


app.delete(
  '/api/clients/:id',
  auth,
  adminOnly,
  async (req, res) => {

    try {
      const {
        data: client
      } = await supabase
        .from('clients')
        .select('id')
        .eq(
          'id',
          req.params.id
        )
        .maybeSingle();

      if (!client) {
        return res.status(404).json({
          error:
            'Client not found'
        });
      }

      const {
        error
      } = await supabase
        .from('clients')
        .delete()
        .eq(
          'id',
          req.params.id
        );

      if (error) throw error;

      res.json({
        deleted: true
      });

    } catch (error) {
      console.error(
        'Delete client error:',
        error
      );

      res.status(500).json({
        error:
          'Could not delete client'
      });
    }
  }
);


// ======================================================
// EXCEL IMPORT
// ======================================================

app.post(
  '/api/import/excel',
  auth,
  upload.single('file'),
  async (req, res) => {

    if (!req.file) {
      return res.status(400).json({
        error:
          'Excel file required'
      });
    }

    try {
      const wb =
        XLSX.readFile(
          req.file.path
        );

      const ws =
        wb.Sheets[
          wb.SheetNames[0]
        ];

      const rows =
        XLSX.utils.sheet_to_json(
          ws,
          {
            defval: ''
          }
        );

      const {
        data: callers,
        error: callerError
      } = await supabase
        .from('users')
        .select(
          'id,name,email'
        )
        .eq(
          'role',
          'caller'
        )
        .eq(
          'active',
          true
        );

      if (callerError)
        throw callerError;

      const importedClients = [];

      for (const row of rows) {
        const rawAssigned =
          String(
            pick(
              row,
              [
                'assigned to',
                'caller',
                'caller email',
                'caller name',
                'caller id'
              ]
            )
          );

        let assignedTo = null;

        if (
          req.user.role ===
          'caller'
        ) {
          assignedTo =
            req.user.id;
        } else if (rawAssigned) {
          const match =
            (callers || []).find(
              user =>
                normalize(
                  user.id
                ) ===
                  normalize(
                    rawAssigned
                  ) ||
                normalize(
                  user.email
                ) ===
                  normalize(
                    rawAssigned
                  ) ||
                normalize(
                  user.name
                ) ===
                  normalize(
                    rawAssigned
                  )
            );

          assignedTo =
            match
              ? match.id
              : null;
        }

        const now =
          new Date().toISOString();

        const client = {
          id: uuid(),

          company: String(
            pick(row, [
              'company',
              'company name',
              'business name'
            ])
          ),

          contact_name: String(
            pick(row, [
              'contact person',
              'contact name',
              'name'
            ])
          ),

          phone: String(
            pick(row, [
              'phone',
              'phone number',
              'mobile',
              'contact phone'
            ])
          ),

          email: String(
            pick(row, [
              'email',
              'company email',
              'contact email'
            ])
          ),

          website: String(
            pick(row, [
              'website',
              'website url',
              'site'
            ])
          ),

          linkedin: String(
            pick(row, [
              'linkedin',
              'company linkedin',
              'contact linkedin'
            ])
          ),

          address: String(
            pick(row, [
              'address'
            ])
          ),

          status:
            'Not Contacted',

          next_follow_up:
            null,

          contact_channels:
            [],

          deal_domain:
            '',

          notes: String(
            pick(row, [
              'notes',
              'note'
            ])
          ),

          assigned_to:
            assignedTo,

          imported_by:
            req.user.id,

          imported_by_role:
            req.user.role,

          created_at:
            now,

          updated_at:
            now
        };

        if (
          client.phone ||
          client.company ||
          client.contact_name ||
          client.email
        ) {
          importedClients.push(
            client
          );
        }
      }

      if (
        importedClients.length
      ) {
        const {
          error
        } = await supabase
          .from('clients')
          .insert(
            importedClients
          );

        if (error) throw error;
      }

      fs.unlinkSync(
        req.file.path
      );

      res.json({
        imported:
          importedClients.length,

        totalRows:
          rows.length,

        importedBy:
          req.user.name
      });

    } catch (error) {
      try {
        fs.unlinkSync(
          req.file.path
        );
      } catch {}

      console.error(
        'Excel import error:',
        error
      );

      res.status(400).json({
        error:
          'Could not read/import Excel file',
        detail:
          error.message
      });
    }
  }
);


// ======================================================
// CALLS
// ======================================================

app.get(
  '/api/calls',
  auth,
  async (req, res) => {

    try {
      const visible =
        await getVisibleClients(
          req
        );

      const visibleIds =
        new Set(
          visible.map(
            client => client.id
          )
        );

      const {
        data: calls,
        error
      } = await supabase
        .from('calls')
        .select('*')
        .order(
          'created_at',
          {
            ascending: false
          }
        );

      if (error) throw error;

      const {
        data: users
      } = await supabase
        .from('users')
        .select(
          'id,name'
        );

      const callers =
        Object.fromEntries(
          (users || []).map(
            user => [
              user.id,
              user.name
            ]
          )
        );

      const clientMap =
        Object.fromEntries(
          visible.map(
            client => [
              client.id,
              formatClient(
                client
              )
            ]
          )
        );

      const list =
        (calls || [])
          .filter(
            call =>
              visibleIds.has(
                call.client_id
              )
          )
          .map(call => ({
            ...call,

            clientId:
              call.client_id,

            callerId:
              call.caller_id,

            recordingUrl:
              call.recording_url,

            externalCallId:
              call.external_call_id,

            createdAt:
              call.created_at,

            callerName:
              callers[
                call.caller_id
              ] ||
              'Unknown caller',

            client:
              clientMap[
                call.client_id
              ] || null
          }));

      res.json(list);

    } catch (error) {
      console.error(
        'Calls fetch error:',
        error
      );

      res.status(500).json({
        error:
          'Could not load calls'
      });
    }
  }
);


app.get(
  '/api/clients/:id/calls',
  auth,
  async (req, res) => {

    try {
      const client =
        await getClientForViewer(
          req,
          req.params.id
        );

      if (!client) {
        return res.status(404).json({
          error:
            'Client not found'
        });
      }

      const {
        data: calls,
        error
      } = await supabase
        .from('calls')
        .select('*')
        .eq(
          'client_id',
          req.params.id
        )
        .order(
          'created_at',
          {
            ascending: false
          }
        );

      if (error) throw error;

      res.json(
        (calls || []).map(
          call => ({
            ...call,

            clientId:
              call.client_id,

            callerId:
              call.caller_id,

            recordingUrl:
              call.recording_url,

            externalCallId:
              call.external_call_id,

            createdAt:
              call.created_at
          })
        )
      );

    } catch (error) {
      console.error(
        'Client calls error:',
        error
      );

      res.status(500).json({
        error:
          'Could not load client calls'
      });
    }
  }
);


app.post(
  '/api/calls',
  auth,
  upload.single('recording'),
  async (req, res) => {

    try {
      const client =
        await getClientForViewer(
          req,
          req.body.clientId
        );

      if (!client) {
        return res.status(404).json({
          error:
            'Client not found'
        });
      }

      const now =
        new Date().toISOString();

      let recordingUrl =
        req.body.recordingUrl ||
        '';

      if (req.file) {
        recordingUrl =
          '/uploads/' +
          path.basename(
            req.file.path
          );
      }

      const call = {
        id: uuid(),

        client_id:
          client.id,

        caller_id:
          req.user.id,

        channel:
          req.body.channel ||
          'Call',

        outcome:
          req.body.outcome ||
          '',

        notes:
          req.body.notes ||
          '',

        duration:
          req.body.duration ||
          '',

        recording_url:
          recordingUrl,

        external_call_id:
          req.body.externalCallId ||
          '',

        created_at:
          now
      };

      const {
        data,
        error
      } = await supabase
        .from('calls')
        .insert(call)
        .select()
        .single();

      if (error) throw error;

      const clientUpdate = {
        updated_at: now
      };

      if (
        req.body.outcome &&
        STATUSES.includes(
          req.body.outcome
        )
      ) {
        clientUpdate.status =
          req.body.outcome;
      }

      if (
        req.body.nextFollowUp
      ) {
        clientUpdate.next_follow_up =
          req.body.nextFollowUp;
      }

      if (req.body.channel) {
        const existingChannels =
          client.contact_channels ||
          [];

        clientUpdate.contact_channels =
          Array.from(
            new Set([
              ...existingChannels,
              req.body.channel
            ])
          );
      }

      if (
        req.user.role ===
        'caller'
      ) {
        clientUpdate.assigned_to =
          req.user.id;
      }

      await supabase
        .from('clients')
        .update(clientUpdate)
        .eq(
          'id',
          client.id
        );

      res.json({
        ...data,

        clientId:
          data.client_id,

        callerId:
          data.caller_id,

        recordingUrl:
          data.recording_url,

        externalCallId:
          data.external_call_id,

        createdAt:
          data.created_at
      });

    } catch (error) {
      console.error(
        'Create call error:',
        error
      );

      res.status(500).json({
        error:
          'Could not create call'
      });
    }
  }
);


// ======================================================
// FOLLOW UPS
// ======================================================

app.get(
  '/api/followups',
  auth,
  async (req, res) => {

    try {
      const clients =
        await getVisibleClients(
          req
        );

      const now =
        new Date();

      const today =
        now
          .toISOString()
          .slice(0, 10);

      const list =
        clients
          .filter(
            client =>
              client.next_follow_up &&
              ![
                'Closed Won',
                'Closed Lost'
              ].includes(
                client.status
              )
          )
          .map(client => {

            const due =
              new Date(
                client.next_follow_up
              );

            const dueDate =
              client.next_follow_up
                .slice(0, 10);

            let bucket =
              'upcoming';

            if (
              due.getTime() <
              now.getTime()
            ) {
              bucket =
                'overdue';
            } else if (
              dueDate ===
              today
            ) {
              bucket =
                'today';
            }

            return {
              ...formatClient(
                client
              ),

              reminderBucket:
                bucket,

              followUpAt:
                client.next_follow_up
            };
          })
          .sort(
            (a, b) =>
              new Date(
                a.followUpAt
              ) -
              new Date(
                b.followUpAt
              )
          );

      res.json({
        overdue:
          list.filter(
            x =>
              x.reminderBucket ===
              'overdue'
          ),

        today:
          list.filter(
            x =>
              x.reminderBucket ===
              'today'
          ),

        upcoming:
          list.filter(
            x =>
              x.reminderBucket ===
              'upcoming'
          ),

        count:
          list.length
      });

    } catch (error) {
      console.error(
        'Followups error:',
        error
      );

      res.status(500).json({
        error:
          'Could not load follow-ups'
      });
    }
  }
);


// ======================================================
// DIALER WEBHOOK
// ======================================================

app.post(
  '/api/webhooks/dialer',
  async (req, res) => {

    const token =
      req.get(
        'x-nexcore-token'
      );

    if (
      process.env.DIALER_WEBHOOK_TOKEN &&
      token !==
        process.env.DIALER_WEBHOOK_TOKEN
    ) {
      return res.status(401).json({
        error:
          'Invalid token'
      });
    }

    try {
      const b =
        req.body;

      const call = {
        id: uuid(),

        client_id:
          b.clientId || null,

        caller_id:
          b.callerId || null,

        channel:
          'Call',

        outcome:
          b.outcome || '',

        notes:
          b.notes || '',

        duration:
          b.duration || '',

        recording_url:
          b.recordingUrl || '',

        external_call_id:
          b.externalCallId ||
          '',

        created_at:
          new Date().toISOString()
      };

      const {
        data,
        error
      } = await supabase
        .from('calls')
        .insert(call)
        .select()
        .single();

      if (error) throw error;

      res.json({
        ok: true,
        id: data.id
      });

    } catch (error) {
      console.error(
        'Dialer webhook error:',
        error
      );

      res.status(500).json({
        error:
          'Could not save dialer call'
      });
    }
  }
);


// ======================================================
// FRONTEND FALLBACK
// ======================================================

app.use(
  (req, res) =>
    res.sendFile(
      path.join(
        ROOT,
        'public',
        'index.html'
      )
    )
);


// ======================================================
// START SERVER
// ======================================================

// app.use((req,res)=> res.sendFile(path.join(ROOT,'public','index.html')));

module.exports = app;