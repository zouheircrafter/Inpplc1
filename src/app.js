'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store, hashPassword, verifyPassword } = require('./store');

const STATUSES = ['ouvert', 'en_cours', 'en_attente', 'resolu', 'ferme'];
const PRIORITIES = ['basse', 'normale', 'haute', 'critique'];
const CATEGORIES = ['incident', 'demande', 'question', 'materiel', 'logiciel', 'reseau', 'autre'];
const ROLES = ['admin', 'agent', 'user'];

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function publicUser(u) {
  return u && { id: u.id, username: u.username, name: u.name, role: u.role };
}

function isStaff(u) {
  return u.role === 'admin' || u.role === 'agent';
}

function str(v, field, { required = false, max = 5000 } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `Le champ « ${field} » est obligatoire`);
    return undefined;
  }
  if (typeof v !== 'string') throw new HttpError(400, `Le champ « ${field} » est invalide`);
  const s = v.trim();
  if (required && !s) throw new HttpError(400, `Le champ « ${field} » est obligatoire`);
  if (s.length > max) throw new HttpError(400, `Le champ « ${field} » est trop long`);
  return s;
}

function oneOf(v, list, field) {
  if (v === undefined) return undefined;
  if (!list.includes(v)) throw new HttpError(400, `Valeur invalide pour « ${field} »`);
  return v;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) {
        reject(new HttpError(413, 'Requête trop volumineuse'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

function createApp({ dataFile } = {}) {
  const store = new Store(dataFile);
  const db = () => store.db;
  const sessions = new Map(); // token -> userId

  const now = () => new Date().toISOString();

  function findUser(id) {
    return db().users.find((u) => u.id === id);
  }

  function auth(req) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    const userId = token && sessions.get(token);
    const user = userId && findUser(userId);
    if (!user) throw new HttpError(401, 'Authentification requise');
    return user;
  }

  function getTicket(id, user) {
    const t = db().tickets.find((x) => x.id === Number(id));
    if (!t) throw new HttpError(404, 'Ticket introuvable');
    if (!isStaff(user) && t.requesterId !== user.id) throw new HttpError(404, 'Ticket introuvable');
    return t;
  }

  function serializeTicket(t, user, { full = false } = {}) {
    const out = {
      ...t,
      requester: publicUser(findUser(t.requesterId)),
      assignee: publicUser(findUser(t.assigneeId)) || null,
    };
    let comments = t.comments.filter((c) => isStaff(user) || !c.internal);
    out.commentCount = comments.length;
    if (full) {
      out.comments = comments.map((c) => ({ ...c, author: publicUser(findUser(c.authorId)) }));
      out.history = t.history.map((h) => ({ ...h, author: publicUser(findUser(h.authorId)) }));
    } else {
      delete out.comments;
      delete out.history;
    }
    return out;
  }

  // ---- Handlers -----------------------------------------------------------

  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp(
      '^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$'
    );
    routes.push({ method, re, keys, handler });
  };

  route('POST', '/api/login', async (req) => {
    const body = await readBody(req);
    const user = db().users.find((u) => u.username === body.username);
    if (!user || !verifyPassword(String(body.password || ''), user.password)) {
      throw new HttpError(401, 'Identifiants incorrects');
    }
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, user.id);
    return { token, user: publicUser(user) };
  });

  route('POST', '/api/logout', async (req) => {
    const h = req.headers.authorization || '';
    sessions.delete(h.replace(/^Bearer /, ''));
    return { ok: true };
  });

  route('GET', '/api/me', async (req) => publicUser(auth(req)));

  route('GET', '/api/meta', async () => ({
    statuses: STATUSES,
    priorities: PRIORITIES,
    categories: CATEGORIES,
    roles: ROLES,
  }));

  route('GET', '/api/users', async (req) => {
    const user = auth(req);
    const users = isStaff(user) ? db().users : [user];
    return users.map(publicUser);
  });

  route('POST', '/api/users', async (req) => {
    const user = auth(req);
    if (user.role !== 'admin') throw new HttpError(403, 'Réservé aux administrateurs');
    const body = await readBody(req);
    const username = str(body.username, 'identifiant', { required: true, max: 50 });
    const password = str(body.password, 'mot de passe', { required: true, max: 200 });
    if (password.length < 6) throw new HttpError(400, 'Le mot de passe doit faire au moins 6 caractères');
    if (db().users.some((u) => u.username === username)) {
      throw new HttpError(409, 'Cet identifiant existe déjà');
    }
    const newUser = {
      id: Math.max(0, ...db().users.map((u) => u.id)) + 1,
      username,
      name: str(body.name, 'nom', { max: 100 }) || username,
      role: oneOf(body.role, ROLES, 'rôle') || 'user',
      password: hashPassword(password),
    };
    db().users.push(newUser);
    store.save();
    return { status: 201, body: publicUser(newUser) };
  });

  route('DELETE', '/api/users/:id', async (req, { id }) => {
    const user = auth(req);
    if (user.role !== 'admin') throw new HttpError(403, 'Réservé aux administrateurs');
    const target = findUser(Number(id));
    if (!target) throw new HttpError(404, 'Utilisateur introuvable');
    if (target.id === user.id) throw new HttpError(400, 'Impossible de supprimer votre propre compte');
    db().users = db().users.filter((u) => u.id !== target.id);
    for (const s of [...sessions]) if (s[1] === target.id) sessions.delete(s[0]);
    for (const t of db().tickets) if (t.assigneeId === target.id) t.assigneeId = null;
    store.save();
    return { ok: true };
  });

  route('GET', '/api/stats', async (req) => {
    const user = auth(req);
    const tickets = db().tickets.filter((t) => isStaff(user) || t.requesterId === user.id);
    const count = (key, values) =>
      Object.fromEntries(values.map((v) => [v, tickets.filter((t) => t[key] === v).length]));
    return {
      total: tickets.length,
      byStatus: count('status', STATUSES),
      byPriority: count('priority', PRIORITIES),
      byCategory: count('category', CATEGORIES),
      assignedToMe: tickets.filter((t) => t.assigneeId === user.id && !['resolu', 'ferme'].includes(t.status)).length,
      unassigned: tickets.filter((t) => !t.assigneeId && !['resolu', 'ferme'].includes(t.status)).length,
    };
  });

  route('GET', '/api/tickets', async (req, _p, query) => {
    const user = auth(req);
    let list = db().tickets.filter((t) => isStaff(user) || t.requesterId === user.id);
    const q = (query.get('q') || '').toLowerCase().trim();
    if (q) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          `#${t.id}` === q ||
          String(t.id) === q
      );
    }
    for (const key of ['status', 'priority', 'category']) {
      const v = query.get(key);
      if (v) list = list.filter((t) => t[key] === v);
    }
    const assignee = query.get('assignee');
    if (assignee === 'me') list = list.filter((t) => t.assigneeId === user.id);
    else if (assignee === 'none') list = list.filter((t) => !t.assigneeId);
    else if (assignee) list = list.filter((t) => t.assigneeId === Number(assignee));

    const sort = query.get('sort') || 'updated';
    const prio = (t) => PRIORITIES.indexOf(t.priority);
    const sorters = {
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
      priority: (a, b) => prio(b) - prio(a) || b.updatedAt.localeCompare(a.updatedAt),
      id: (a, b) => a.id - b.id,
    };
    list = [...list].sort(sorters[sort] || sorters.updated);
    return list.map((t) => serializeTicket(t, user));
  });

  route('POST', '/api/tickets', async (req) => {
    const user = auth(req);
    const body = await readBody(req);
    const ts = now();
    const ticket = {
      id: db().nextTicketId++,
      title: str(body.title, 'titre', { required: true, max: 200 }),
      description: str(body.description, 'description', { required: true }),
      status: 'ouvert',
      priority: oneOf(body.priority, PRIORITIES, 'priorité') || 'normale',
      category: oneOf(body.category, CATEGORIES, 'catégorie') || 'autre',
      requesterId: user.id,
      assigneeId: null,
      createdAt: ts,
      updatedAt: ts,
      comments: [],
      history: [{ at: ts, authorId: user.id, action: 'created' }],
    };
    if (isStaff(user) && body.assigneeId) {
      const a = findUser(Number(body.assigneeId));
      if (!a || !isStaff(a)) throw new HttpError(400, 'Assigné invalide');
      ticket.assigneeId = a.id;
    }
    db().tickets.push(ticket);
    store.save();
    return { status: 201, body: serializeTicket(ticket, user, { full: true }) };
  });

  route('GET', '/api/tickets/:id', async (req, { id }) => {
    const user = auth(req);
    return serializeTicket(getTicket(id, user), user, { full: true });
  });

  route('PATCH', '/api/tickets/:id', async (req, { id }) => {
    const user = auth(req);
    const t = getTicket(id, user);
    const body = await readBody(req);
    const changes = {};

    const ownerEditable = t.requesterId === user.id && t.status === 'ouvert';
    if (body.title !== undefined || body.description !== undefined) {
      if (!isStaff(user) && !ownerEditable) {
        throw new HttpError(403, 'Vous ne pouvez plus modifier ce ticket');
      }
      if (body.title !== undefined) changes.title = str(body.title, 'titre', { required: true, max: 200 });
      if (body.description !== undefined) changes.description = str(body.description, 'description', { required: true });
    }

    if (body.category !== undefined) {
      if (!isStaff(user) && !ownerEditable) throw new HttpError(403, 'Action non autorisée');
      changes.category = oneOf(body.category, CATEGORIES, 'catégorie');
    }

    if (body.priority !== undefined) {
      if (!isStaff(user) && !ownerEditable) throw new HttpError(403, 'Action non autorisée');
      changes.priority = oneOf(body.priority, PRIORITIES, 'priorité');
    }

    if (body.status !== undefined) {
      const status = oneOf(body.status, STATUSES, 'statut');
      // Un demandeur peut seulement fermer son ticket ou le rouvrir.
      if (!isStaff(user) && !['ferme', 'ouvert'].includes(status)) {
        throw new HttpError(403, 'Action non autorisée');
      }
      changes.status = status;
    }

    if (body.assigneeId !== undefined) {
      if (!isStaff(user)) throw new HttpError(403, 'Action non autorisée');
      if (body.assigneeId === null || body.assigneeId === '') {
        changes.assigneeId = null;
      } else {
        const a = findUser(Number(body.assigneeId));
        if (!a || !isStaff(a)) throw new HttpError(400, 'Assigné invalide');
        changes.assigneeId = a.id;
      }
    }

    const ts = now();
    for (const [field, value] of Object.entries(changes)) {
      if (t[field] === value) continue;
      t.history.push({ at: ts, authorId: user.id, action: 'changed', field, from: t[field], to: value });
      t[field] = value;
    }
    if (changes.status === 'resolu' && !t.resolvedAt) t.resolvedAt = ts;
    if (changes.status && !['resolu', 'ferme'].includes(changes.status)) delete t.resolvedAt;
    t.updatedAt = ts;
    store.save();
    return serializeTicket(t, user, { full: true });
  });

  route('DELETE', '/api/tickets/:id', async (req, { id }) => {
    const user = auth(req);
    if (user.role !== 'admin') throw new HttpError(403, 'Réservé aux administrateurs');
    const t = getTicket(id, user);
    db().tickets = db().tickets.filter((x) => x.id !== t.id);
    store.save();
    return { ok: true };
  });

  route('POST', '/api/tickets/:id/comments', async (req, { id }) => {
    const user = auth(req);
    const t = getTicket(id, user);
    const body = await readBody(req);
    const ts = now();
    const comment = {
      id: Math.max(0, ...t.comments.map((c) => c.id)) + 1,
      authorId: user.id,
      body: str(body.body, 'commentaire', { required: true }),
      internal: isStaff(user) && body.internal === true,
      createdAt: ts,
    };
    t.comments.push(comment);
    // Une réponse du demandeur relance un ticket en attente.
    if (!isStaff(user) && t.status === 'en_attente') {
      t.history.push({ at: ts, authorId: user.id, action: 'changed', field: 'status', from: t.status, to: 'en_cours' });
      t.status = 'en_cours';
    }
    t.updatedAt = ts;
    store.save();
    return { status: 201, body: { ...comment, author: publicUser(user) } };
  });

  // ---- Serveur ------------------------------------------------------------

  function serveStatic(req, res, pathname) {
    let file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(PUBLIC_DIR, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') return send(405, { error: 'Méthode non autorisée' });
      return serveStatic(req, res, url.pathname);
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      try {
        const result = await r.handler(req, params, url.searchParams);
        if (result && typeof result.status === 'number' && 'body' in result) {
          return send(result.status, result.body);
        }
        return send(200, result);
      } catch (err) {
        if (err instanceof HttpError) return send(err.status, { error: err.message });
        console.error(err);
        return send(500, { error: 'Erreur interne du serveur' });
      }
    }
    send(404, { error: 'Route inconnue' });
  }

  return { server: http.createServer(handler), store };
}

module.exports = { createApp, STATUSES, PRIORITIES, CATEGORIES };
