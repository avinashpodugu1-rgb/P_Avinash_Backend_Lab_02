const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const isVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME);

// Resolve source books.db path
const getSourceDbPath = () => {
  const candidates = [
    path.join(__dirname, 'books.db'),
    path.join(process.cwd(), 'books.db'),
    path.join(process.cwd(), 'lab-02', 'books.db'),
    path.join(__dirname, '..', 'books.db')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(__dirname, 'books.db');
};

// Resolve sql-wasm.wasm binary buffer
const getWasmBinary = () => {
  const candidates = [
    path.join(__dirname, 'sql-wasm.wasm'),
    path.join(__dirname, '..', 'sql-wasm.wasm'),
    path.join(process.cwd(), 'sql-wasm.wasm'),
    path.join(process.cwd(), 'lab-02', 'sql-wasm.wasm'),
    path.join(__dirname, 'node_modules/sql.js/dist/sql-wasm.wasm'),
    path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        return fs.readFileSync(c);
      } catch (e) {
        console.error('Error reading wasm binary:', e.message);
      }
    }
  }
  return null;
};

// Database wrapper for sql.js (WebAssembly SQLite)
class SqlJsDatabase {
  constructor(filePath, SQL) {
    this.filePath = filePath;
    this.SQL = SQL;
    if (fs.existsSync(filePath)) {
      const buf = fs.readFileSync(filePath);
      this.db = new SQL.Database(buf);
    } else {
      this.db = new SQL.Database();
    }
  }

  save() {
    try {
      const data = this.db.export();
      fs.writeFileSync(this.filePath, Buffer.from(data));
    } catch (e) {
      console.error('Error saving db:', e.message);
    }
  }

  async all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    if (params && params.length > 0) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  async get(sql, params = []) {
    const stmt = this.db.prepare(sql);
    if (params && params.length > 0) stmt.bind(params);
    let row = undefined;
    if (stmt.step()) row = stmt.getAsObject();
    stmt.free();
    return row;
  }

  async run(sql, params = []) {
    this.db.run(sql, params);
    const lastIDRes = this.db.exec('SELECT last_insert_rowid() AS id;');
    const lastID = lastIDRes[0]?.values[0]?.[0] || 0;
    const changesRes = this.db.exec('SELECT changes() AS ch;');
    const changes = changesRes[0]?.values[0]?.[0] || 0;
    this.save();
    return { lastID, changes };
  }

  async exec(sql) {
    this.db.exec(sql);
    this.save();
  }
}

let db = null;
let dbPromise = null;

const getDB = async () => {
  if (db) return db;
  if (!dbPromise) {
    dbPromise = (async () => {
      const sourceDb = getSourceDbPath();
      let targetDbPath = sourceDb;

      if (isVercel) {
        targetDbPath = path.join('/tmp', 'books.db');
        try {
          if (!fs.existsSync(targetDbPath) && fs.existsSync(sourceDb)) {
            fs.copyFileSync(sourceDb, targetDbPath);
          }
        } catch (e) {
          console.error('Copy to /tmp error:', e);
        }
      }

      // In Vercel / serverless environment, use sql.js (WebAssembly) to avoid GLIBC native binary issues
      if (isVercel) {
        const initSqlJs = require('sql.js');
        const wasmBinary = getWasmBinary();
        const SQL = await initSqlJs(wasmBinary ? { wasmBinary } : {});
        db = new SqlJsDatabase(targetDbPath, SQL);
        return db;
      }

      // In local environment, try sqlite3 first, fallback to sql.js
      try {
        const sqlite3 = require('sqlite3');
        const { open } = require('sqlite');
        db = await open({ filename: targetDbPath, driver: sqlite3.Database });
        return db;
      } catch (err) {
        console.warn('sqlite3 failed, falling back to sql.js (WASM):', err.message);
        const initSqlJs = require('sql.js');
        const wasmBinary = getWasmBinary();
        const SQL = await initSqlJs(wasmBinary ? { wasmBinary } : {});
        db = new SqlJsDatabase(targetDbPath, SQL);
        return db;
      }
    })();
  }
  return dbPromise;
};

// Middleware to ensure DB connection is ready before handling any request
app.use(async (req, res, next) => {
  try {
    req.db = await getDB();
    next();
  } catch (error) {
    res.status(500).json({ error: `DB Error: ${error.message}` });
  }
});

// Start local server only when executed directly and not inside serverless
const initializeDBAndServer = async () => {
  try {
    await getDB();
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}/`);
    });
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

if (!isVercel && require.main === module) {
  initializeDBAndServer();
}

const isValidBook = (b) =>
  b && typeof b.title === 'string' && b.title.trim() !== '' &&
  typeof b.author === 'string' && b.author.trim() !== '' &&
  Number.isInteger(b.price) && Number.isInteger(b.pages);

// GET root route - API overview
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Lab 2: SQLite database and CRUD routes API',
    endpoints: {
      getAllBooks: 'GET /books/',
      getOneBook: 'GET /books/:bookId/',
      addBook: 'POST /books/',
      updateBook: 'PUT /books/:bookId/',
      deleteBook: 'DELETE /books/:bookId/'
    }
  });
});

// GET all books
app.get(['/books', '/books/'], async (req, res) => {
  try {
    const books = await (req.db || db).all('SELECT * FROM book ORDER BY id;');
    res.status(200).json(books);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET one book
app.get(['/books/:bookId', '/books/:bookId/'], async (req, res) => {
  try {
    const book = await (req.db || db).get('SELECT * FROM book WHERE id = ?;', [req.params.bookId]);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.status(200).json(book);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST add a book
app.post(['/books', '/books/'], async (req, res) => {
  try {
    if (!isValidBook(req.body)) {
      return res.status(400).json({ error: 'title, author (text), price and pages (integers) are required' });
    }
    const { title, author, price, pages } = req.body;
    const result = await (req.db || db).run(
      'INSERT INTO book (title, author, price, pages) VALUES (?, ?, ?, ?);',
      [title, author, price, pages]
    );
    res.status(201).json({ message: 'Book added successfully', bookId: result.lastID });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT update a book
app.put(['/books/:bookId', '/books/:bookId/'], async (req, res) => {
  try {
    if (!isValidBook(req.body)) {
      return res.status(400).json({ error: 'title, author (text), price and pages (integers) are required' });
    }
    const { title, author, price, pages } = req.body;
    const result = await (req.db || db).run(
      'UPDATE book SET title = ?, author = ?, price = ?, pages = ? WHERE id = ?;',
      [title, author, price, pages, req.params.bookId]
    );
    if (result.changes === 0) return res.status(404).json({ error: 'Book not found' });
    res.status(200).json({ message: 'Book updated successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE a book
app.delete(['/books/:bookId', '/books/:bookId/'], async (req, res) => {
  try {
    const result = await (req.db || db).run('DELETE FROM book WHERE id = ?;', [req.params.bookId]);
    if (result.changes === 0) return res.status(404).json({ error: 'Book not found' });
    res.status(200).json({ message: 'Book deleted successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Unknown routes
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

module.exports = app;
