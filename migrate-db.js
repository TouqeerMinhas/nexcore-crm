require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const dbPath = path.join(__dirname, 'data', 'db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

async function migrate() {
  console.log('Starting NexCore CRM migration...\n');

  // -------------------------
  // USERS
  // -------------------------
  if (db.users?.length) {
    const users = db.users.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      password_hash: user.passwordHash,
      role: user.role,
      active: user.active !== false,
      created_at: user.createdAt,
      updated_at: user.updatedAt || null
    }));

    const { error } = await supabase
      .from('users')
      .upsert(users, { onConflict: 'id' });

    if (error) throw new Error(`Users migration failed: ${error.message}`);

    console.log(`✓ Users migrated: ${users.length}`);
  }

  // -------------------------
  // CLIENTS
  // -------------------------
  if (db.clients?.length) {
    const clients = db.clients.map(client => ({
      id: client.id,
      company: client.company || '',
      contact_name: client.contactName || '',
      phone: client.phone || '',
      email: client.email || '',
      website: client.website || '',
      linkedin: client.linkedin || '',
      address: client.address || '',
      status: client.status || 'Not Contacted',
      next_follow_up: client.nextFollowUp || null,
      contact_channels: client.contactChannels || [],
      deal_domain: client.dealDomain || '',
      notes: client.notes || '',
      assigned_to: client.assignedTo || null,
      imported_by: client.importedBy || null,
      imported_by_role: client.importedByRole || null,
      created_at: client.createdAt,
      updated_at: client.updatedAt
    }));

    const { error } = await supabase
      .from('clients')
      .upsert(clients, { onConflict: 'id' });

    if (error) throw new Error(`Clients migration failed: ${error.message}`);

    console.log(`✓ Clients migrated: ${clients.length}`);
  }

  // -------------------------
  // CALLS
  // -------------------------
  if (db.calls?.length) {
    const calls = db.calls.map(call => ({
      id: call.id,
      client_id: call.clientId || null,
      caller_id: call.callerId || null,
      channel: call.channel || 'Call',
      outcome: call.outcome || '',
      notes: call.notes || '',
      duration: call.duration || '',
      recording_url: call.recordingUrl || '',
      external_call_id: call.externalCallId || '',
      created_at: call.createdAt
    }));

    const { error } = await supabase
      .from('calls')
      .upsert(calls, { onConflict: 'id' });

    if (error) throw new Error(`Calls migration failed: ${error.message}`);

    console.log(`✓ Calls migrated: ${calls.length}`);
  }

  // -------------------------
  // ACTIVITIES
  // -------------------------
  if (db.activities?.length) {
    const activities = db.activities.map(activity => ({
      id: activity.id,
      user_id: activity.userId || null,
      client_id: activity.clientId || null,
      type: activity.type || '',
      title: activity.title || '',
      description: activity.description || '',
      created_at: activity.createdAt
    }));

    const { error } = await supabase
      .from('activities')
      .upsert(activities, { onConflict: 'id' });

    if (error) {
      throw new Error(`Activities migration failed: ${error.message}`);
    }

    console.log(`✓ Activities migrated: ${activities.length}`);
  }

  // -------------------------
  // SETTINGS
  // -------------------------
  if (db.settings) {
    const { error } = await supabase
      .from('settings')
      .upsert({
        id: 1,
        logo_url: db.settings.logoUrl || ''
      }, { onConflict: 'id' });

    if (error) throw new Error(`Settings migration failed: ${error.message}`);

    console.log('✓ Settings migrated');
  }

  // -------------------------
  // PASSWORD RESETS
  // -------------------------
  if (db.passwordResets?.length) {
    const resets = db.passwordResets.map(reset => ({
      id: reset.id,
      user_id: reset.userId,
      code_hash: reset.codeHash,
      expires_at: reset.expiresAt,
      attempts: reset.attempts || 0,
      created_at: reset.createdAt
    }));

    const { error } = await supabase
      .from('password_resets')
      .upsert(resets, { onConflict: 'id' });

    if (error) {
      throw new Error(`Password resets migration failed: ${error.message}`);
    }

    console.log(`✓ Password resets migrated: ${resets.length}`);
  }

  console.log('\n================================');
  console.log('NexCore CRM migration completed!');
  console.log('================================');
}

migrate().catch(error => {
  console.error('\n❌ Migration failed:');
  console.error(error.message);
  process.exit(1);
});