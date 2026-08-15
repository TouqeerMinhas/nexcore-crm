const fs = require('fs');
const path = require('path');
const db = require('./db');

function toMySQLDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function migrate() {
  const file = path.join(__dirname, 'data', 'db.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    console.log('Starting NexCore CRM migration...');

    /*
     * USERS
     */
    for (const user of json.users || []) {
      await connection.execute(
        `INSERT INTO users
        (id, name, email, passwordHash, role, active, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          email = VALUES(email),
          passwordHash = VALUES(passwordHash),
          role = VALUES(role),
          active = VALUES(active),
          updatedAt = VALUES(updatedAt)`,
        [
          user.id,
          user.name,
          user.email,
          user.passwordHash,
          user.role,
          user.active !== false ? 1 : 0,
          toMySQLDate(user.createdAt),
          toMySQLDate(user.updatedAt)
        ]
      );
    }

    console.log(`Users migrated: ${(json.users || []).length}`);

    /*
     * CLIENTS
     */
    for (const client of json.clients || []) {
      await connection.execute(
        `INSERT INTO clients
        (
          id,
          company,
          contactName,
          phone,
          email,
          website,
          linkedin,
          address,
          status,
          nextFollowUp,
          contactChannels,
          dealDomain,
          notes,
          assignedTo,
          importedBy,
          importedByRole,
          createdAt,
          updatedAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          company = VALUES(company),
          contactName = VALUES(contactName),
          phone = VALUES(phone),
          email = VALUES(email),
          website = VALUES(website),
          linkedin = VALUES(linkedin),
          address = VALUES(address),
          status = VALUES(status),
          nextFollowUp = VALUES(nextFollowUp),
          contactChannels = VALUES(contactChannels),
          dealDomain = VALUES(dealDomain),
          notes = VALUES(notes),
          assignedTo = VALUES(assignedTo),
          importedBy = VALUES(importedBy),
          importedByRole = VALUES(importedByRole),
          updatedAt = VALUES(updatedAt)`,
        [
          client.id,
          client.company || '',
          client.contactName || '',
          client.phone || '',
          client.email || '',
          client.website || '',
          client.linkedin || '',
          client.address || '',
          client.status || 'Not Contacted',
          client.nextFollowUp
            ? toMySQLDate(client.nextFollowUp)
            : null,
          JSON.stringify(client.contactChannels || []),
          client.dealDomain || '',
          client.notes || '',
          client.assignedTo || null,
          client.importedBy || null,
          client.importedByRole || null,
          toMySQLDate(client.createdAt),
          toMySQLDate(client.updatedAt)
        ]
      );
    }

    console.log(`Clients migrated: ${(json.clients || []).length}`);

    /*
     * CALLS
     */
    for (const call of json.calls || []) {
      await connection.execute(
        `INSERT INTO calls
        (
          id,
          clientId,
          callerId,
          channel,
          outcome,
          notes,
          duration,
          recordingUrl,
          externalCallId,
          createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          clientId = VALUES(clientId),
          callerId = VALUES(callerId),
          channel = VALUES(channel),
          outcome = VALUES(outcome),
          notes = VALUES(notes),
          duration = VALUES(duration),
          recordingUrl = VALUES(recordingUrl),
          externalCallId = VALUES(externalCallId)`,
        [
          call.id,
          call.clientId,
          call.callerId,
          call.channel || 'Call',
          call.outcome || '',
          call.notes || '',
          call.duration || '',
          call.recordingUrl || '',
          call.externalCallId || '',
          toMySQLDate(call.createdAt)
        ]
      );
    }

    console.log(`Calls migrated: ${(json.calls || []).length}`);

    /*
     * ACTIVITIES
     */
    for (const activity of json.activities || []) {
      await connection.execute(
        `INSERT INTO activities
        (id, userId, clientId, type, description, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          userId = VALUES(userId),
          clientId = VALUES(clientId),
          type = VALUES(type),
          description = VALUES(description)`,
        [
          activity.id,
          activity.userId || null,
          activity.clientId || null,
          activity.type || '',
          activity.description || '',
          toMySQLDate(activity.createdAt)
        ]
      );
    }

    console.log(`Activities migrated: ${(json.activities || []).length}`);

    /*
     * SETTINGS
     */
    await connection.execute(
  `INSERT INTO settings (setting_key, setting_value)
   VALUES (?, ?)
   ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
  [
    'logoUrl',
    json.settings?.logoUrl || ''
  ]
);

console.log('Settings migrated.');

    /*
     * PASSWORD RESETS
     */
    for (const reset of json.passwordResets || []) {
      await connection.execute(
        `INSERT INTO passwordResets
        (id, userId, codeHash, expiresAt, attempts, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          codeHash = VALUES(codeHash),
          expiresAt = VALUES(expiresAt),
          attempts = VALUES(attempts)`,
        [
          reset.id,
          reset.userId,
          reset.codeHash,
          reset.expiresAt,
          reset.attempts || 0,
          toMySQLDate(reset.createdAt)
        ]
      );
    }

    console.log(
      `Password resets migrated: ${(json.passwordResets || []).length}`
    );

    await connection.commit();

    console.log('');
    console.log('======================================');
    console.log('NexCore CRM migration completed!');
    console.log('======================================');

  } catch (error) {
    await connection.rollback();

    console.error('');
    console.error('Migration failed.');
    console.error(error);

    process.exitCode = 1;
  } finally {
    connection.release();
    await db.end();
  }
}

migrate();