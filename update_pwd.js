const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const db = new Database('./prisma/dev.db');
const hash = bcrypt.hashSync('password', 12);

db.prepare('UPDATE User SET passwordHash = ? WHERE email = ?').run(hash, 'demo@example.com');
console.log('Updated user password for demo@example.com to "password"');
db.close();
