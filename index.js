const express = require('express');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const isVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME);

// Resolve SQLite database path with fallback for serverless environment (/tmp)
const getDbPath = () => {
  if (isVercel) {
    const tmpDbPath = path.join('/tmp', 'books.db');
    if (!fs.existsSync(tmpDbPath)) {
      const candidates = [
        path.join(__dirname, 'books.db'),
        path.join(process.cwd(), 'books.db'),
        path.join(process.cwd(), 'lab-02', 'books.db'),
        path.join(__dirname, '..', 'books.db')
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          try {
            fs.copyFileSync(candidate, tmpDbPath);
            break;
          } catch (e) {
            console.error('Error copying db to /tmp:', e);
          }
        }
      }
    }
    return tmpDbPath;
  }
  return path.join(__dirname, 'books.db');
};

let db = null;
let dbPromise = null;

const getDB = async () => {
  if (db) return db;
  if (!dbPromise) {
    dbPromise = (async () => {
      const resolvedPath = getDbPath();
      const database = await open({ filename: resolvedPath, driver: sqlite3.Database });

      // If table does not exist (e.g. fresh /tmp), initialize table & seed
      const tableCheck = await database.get("SELECT name FROM sqlite_master WHERE type='table' AND name='book';");
      if (!tableCheck) {
        const schemaCandidates = [
          path.join(__dirname, 'schema.sql'),
          path.join(process.cwd(), 'schema.sql'),
          path.join(process.cwd(), 'lab-02', 'schema.sql'),
          path.join(__dirname, '..', 'schema.sql')
        ];
        for (const schemaPath of schemaCandidates) {
          if (fs.existsSync(schemaPath)) {
            const schemaSql = fs.readFileSync(schemaPath, 'utf8');
            await database.exec(schemaSql);
            break;
          }
        }
      }
      db = database;
      return db;
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
