'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

let server, base;

before(async () => {
  ({ server } = createApp()); // stockage en mémoire
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function login(username, password) {
  const r = await call('POST', '/api/login', { body: { username, password } });
  assert.equal(r.status, 200);
  return r.body.token;
}

test('connexion refusée avec un mauvais mot de passe', async () => {
  const r = await call('POST', '/api/login', { body: { username: 'admin', password: 'nope' } });
  assert.equal(r.status, 401);
});

test('les routes protégées exigent un jeton', async () => {
  assert.equal((await call('GET', '/api/tickets')).status, 401);
});

test('cycle de vie complet d\'un ticket', async () => {
  const user = await login('user', 'user123');
  const agent = await login('agent', 'agent123');

  const created = await call('POST', '/api/tickets', {
    token: user,
    body: { title: 'Imprimante en panne', description: 'Elle ne répond plus', priority: 'haute', category: 'materiel' },
  });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(created.body.status, 'ouvert');

  // Un utilisateur ne peut pas passer son ticket en cours ni l'assigner.
  assert.equal((await call('PATCH', `/api/tickets/${id}`, { token: user, body: { status: 'en_cours' } })).status, 403);
  assert.equal((await call('PATCH', `/api/tickets/${id}`, { token: user, body: { assigneeId: 2 } })).status, 403);

  // L'agent prend le ticket.
  const taken = await call('PATCH', `/api/tickets/${id}`, { token: agent, body: { assigneeId: 2, status: 'en_cours' } });
  assert.equal(taken.status, 200);
  assert.equal(taken.body.assignee.username, 'agent');

  // Le demandeur ne peut plus modifier le titre une fois le ticket pris en charge.
  assert.equal((await call('PATCH', `/api/tickets/${id}`, { token: user, body: { title: 'x' } })).status, 403);

  // Note interne invisible pour le demandeur.
  await call('POST', `/api/tickets/${id}/comments`, { token: agent, body: { body: 'Toner vide ?', internal: true } });
  await call('POST', `/api/tickets/${id}/comments`, { token: agent, body: { body: 'Nous regardons.' } });
  const seenByUser = await call('GET', `/api/tickets/${id}`, { token: user });
  assert.equal(seenByUser.body.comments.length, 1);
  const seenByAgent = await call('GET', `/api/tickets/${id}`, { token: agent });
  assert.equal(seenByAgent.body.comments.length, 2);

  // Une réponse du demandeur relance un ticket en attente.
  await call('PATCH', `/api/tickets/${id}`, { token: agent, body: { status: 'en_attente' } });
  await call('POST', `/api/tickets/${id}/comments`, { token: user, body: { body: 'Voici une photo' } });
  assert.equal((await call('GET', `/api/tickets/${id}`, { token: agent })).body.status, 'en_cours');

  const resolved = await call('PATCH', `/api/tickets/${id}`, { token: agent, body: { status: 'resolu' } });
  assert.ok(resolved.body.resolvedAt);
  assert.ok(resolved.body.history.length >= 4);

  // Le demandeur peut fermer son ticket.
  assert.equal((await call('PATCH', `/api/tickets/${id}`, { token: user, body: { status: 'ferme' } })).body.status, 'ferme');
});

test('isolation : un utilisateur ne voit que ses tickets', async () => {
  const admin = await login('admin', 'admin123');
  await call('POST', '/api/users', { token: admin, body: { username: 'bob', password: 'secret1', name: 'Bob', role: 'user' } });
  const bob = await login('bob', 'secret1');
  const user = await login('user', 'user123');

  const t = await call('POST', '/api/tickets', { token: user, body: { title: 'Privé', description: 'à moi' } });
  assert.equal((await call('GET', `/api/tickets/${t.body.id}`, { token: bob })).status, 404);
  const list = await call('GET', '/api/tickets', { token: bob });
  assert.equal(list.body.length, 0);
});

test('filtres, recherche et statistiques', async () => {
  const agent = await login('agent', 'agent123');
  await call('POST', '/api/tickets', { token: agent, body: { title: 'VPN coupé', description: 'réseau', priority: 'critique', category: 'reseau' } });

  const byQ = await call('GET', '/api/tickets?q=vpn', { token: agent });
  assert.ok(byQ.body.every((t) => t.title.toLowerCase().includes('vpn')));
  assert.ok(byQ.body.length >= 1);

  const byPrio = await call('GET', '/api/tickets?priority=critique', { token: agent });
  assert.ok(byPrio.body.length >= 1 && byPrio.body.every((t) => t.priority === 'critique'));

  const stats = await call('GET', '/api/stats', { token: agent });
  assert.ok(stats.body.total >= 3);
  assert.ok(stats.body.byPriority.critique >= 1);
});

test('validation des entrées', async () => {
  const user = await login('user', 'user123');
  assert.equal((await call('POST', '/api/tickets', { token: user, body: { title: '', description: 'x' } })).status, 400);
  assert.equal((await call('POST', '/api/tickets', { token: user, body: { title: 'a', description: 'b', priority: 'urgentissime' } })).status, 400);
});

test('seul un admin peut supprimer', async () => {
  const admin = await login('admin', 'admin123');
  const agent = await login('agent', 'agent123');
  const t = await call('POST', '/api/tickets', { token: agent, body: { title: 'À supprimer', description: 'x' } });
  assert.equal((await call('DELETE', `/api/tickets/${t.body.id}`, { token: agent })).status, 403);
  assert.equal((await call('DELETE', `/api/tickets/${t.body.id}`, { token: admin })).status, 200);
  assert.equal((await call('GET', `/api/tickets/${t.body.id}`, { token: admin })).status, 404);
});
