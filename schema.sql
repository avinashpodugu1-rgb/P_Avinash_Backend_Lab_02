CREATE TABLE IF NOT EXISTS book (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  price INTEGER,
  pages INTEGER
);

INSERT INTO book (title, author, price, pages) VALUES
  ('The Alchemist', 'Paulo Coelho', 299, 208),
  ('Wings of Fire', 'A. P. J. Abdul Kalam', 250, 180),
  ('Clean Code', 'Robert C. Martin', 899, 464),
  ('The Pragmatic Programmer', 'Andrew Hunt', 799, 352),
  ('Atomic Habits', 'James Clear', 499, 320),
  ('Deep Work', 'Cal Newport', 450, 304),
  ('You Don''t Know JS', 'Kyle Simpson', 650, 278),
  ('Eloquent JavaScript', 'Marijn Haverbeke', 550, 472),
  ('The Psychology of Money', 'Morgan Housel', 399, 256);
