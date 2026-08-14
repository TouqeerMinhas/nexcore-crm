// migrate.js
const pool = require('./config/db');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');

async function migrate() {
  try {
    console.log('Starting MySQL Migration for Hostinger...');

    // 1. Users Table (Callers & Admin)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        passwordHash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'caller',
        active BOOLEAN DEFAULT TRUE,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // 2. Clients Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id VARCHAR(36) PRIMARY KEY,
        company VARCHAR(255),
        contactName VARCHAR(255),
        phone VARCHAR(100),
        email VARCHAR(255),
        website VARCHAR(255),
        linkedin VARCHAR(255),
        address TEXT,
        status VARCHAR(100) DEFAULT 'Not Contacted',
        nextFollowUp DATETIME NULL,
        dealDomain VARCHAR(100),
        notes TEXT,
        assignedTo VARCHAR(36),
        contactChannels JSON,
        importedBy VARCHAR(36),
        importedByRole VARCHAR(50),
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // 3. Calls Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS calls (
        id VARCHAR(36) PRIMARY KEY,
        clientId VARCHAR(36),
        callerId VARCHAR(36),
        channel VARCHAR(50) DEFAULT 'Call',
        outcome VARCHAR(100),
        notes TEXT,
        duration VARCHAR(50),
        recordingUrl VARCHAR(255),
        externalCallId VARCHAR(255),
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 4. Password Resets Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS passwordResets (
        id VARCHAR(36) PRIMARY KEY,
        userId VARCHAR(36) NOT NULL,
        codeHash VARCHAR(255) NOT NULL,
        expiresAt BIGINT NOT NULL,
        attempts INT DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. Settings Table (For Logo URL)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT
      )
    `);

    // Insert Default Admin
    const [adminRows] = await pool.query('SELECT id FROM users WHERE role = ?', ['admin']);
    if (adminRows.length === 0) {
      const adminId = uuid();
      const passHash = bcrypt.hashSync('admin123', 10);
      await pool.query(
        'INSERT INTO users (id, name, email, passwordHash, role, active) VALUES (?, ?, ?, ?, ?, ?)',
        [adminId, 'NexCore Admin', 'admin@nexcore.local', passHash, 'admin', true]
      );
      console.log('Default Admin created: admin@nexcore.local / admin123');
    }

    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();