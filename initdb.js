const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

(async () => {
  try {
    const dbPath = path.join(__dirname, 'books.db');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    await db.exec('DROP TABLE IF EXISTS book;');
    await db.exec(schemaSql);
    await db.close();

    console.log('Database successfully re-initialized with 9 books from schema.sql!');
  } catch (error) {
    console.error('Failed to initialize database:', error.message);
    process.exit(1);
  }
})();
