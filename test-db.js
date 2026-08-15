const db = require('./db');

async function test() {
  try {
    const [rows] = await db.query('SELECT 1 AS connected');
    console.log('MySQL connected successfully:', rows);
    process.exit(0);
  } catch (error) {
    console.error('MySQL connection failed:', error.message);
    process.exit(1);
  }
}

test();