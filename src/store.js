'use strict';
// Stockage JSON simple sur disque, écrit de façon atomique.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

function emptyDb() {
  return {
    nextTicketId: 1,
    users: [
      { id: 1, username: 'admin', name: 'Administrateur', role: 'admin', password: hashPassword('admin123') },
      { id: 2, username: 'agent', name: 'Agent Support', role: 'agent', password: hashPassword('agent123') },
      { id: 3, username: 'user', name: 'Utilisateur Démo', role: 'user', password: hashPassword('user123') },
    ],
    tickets: [],
  };
}

class Store {
  constructor(file) {
    this.file = file;
    if (file && fs.existsSync(file)) {
      this.db = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      this.db = emptyDb();
      this.save();
    }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store, hashPassword, verifyPassword };
