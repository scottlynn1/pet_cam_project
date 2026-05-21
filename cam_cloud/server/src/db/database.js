import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const db = new Database(process.env.DB_PATH || './users.db');

export async function seedDatabase() {
  const saltRounds = 10;
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      hub INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();

  db.prepare('DELETE FROM users').run();
  // Optional: Reset the Auto-Increment counter
  db.prepare("DELETE FROM sqlite_sequence WHERE name='users'").run();
  const insertUser = db.prepare('INSERT INTO users (username, password, hub) VALUES (?, ?, ?)');

  const initialeUsers = [
      { name: 'scott', pass: 'B@obean2026', hub: 123 },
      { name: 'selena', pass: 'B@obean2026', hub: 123 }
    ];

  console.log("Seeding new users...");
  
  for (const user of initialeUsers) {
    const hash = await bcrypt.hash(user.pass, saltRounds);
    insertUser.run(user.name, hash, user.hub);
  }
}

export default db;