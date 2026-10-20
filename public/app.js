'use strict';
(() => {
  const LABELS = {
    status: { ouvert: 'Ouvert', en_cours: 'En cours', en_attente: 'En attente', resolu: 'Résolu', ferme: 'Fermé' },
    priority: { basse: 'Basse', normale: 'Normale', haute: 'Haute', critique: 'Critique' },
    category: {
      incident: 'Incident', demande: 'Demande', question: 'Question', materiel: 'Matériel',
      logiciel: 'Logiciel', reseau: 'Réseau', autre: 'Autre',
    },
    role: { admin: 'Administrateur', agent: 'Agent', user: 'Utilisateur' },
    field: { status: 'le statut', priority: 'la priorité', category: 'la catégorie', assigneeId: "l'assigné", title: 'le titre', description: 'la description' },
  };

  const state = { token: null, user: null, meta: null, users: [] };
  try { state.token = localStorage.getItem('token'); } catch {}

  const $ = (sel, root = document) => root.querySelector(sel);
  const view = $('#view');

  // ---- Utilitaires -------------------------------------------------------

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (iso) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const statusBadge = (s) => `<span class="badge" style="background:var(--s-${s})">${LABELS.status[s]}</span>`;
  const prioBadge = (p) => `<span class="badge" style="background:var(--p-${p})">${LABELS.priority[p]}</span>`;
  const options = (list, labels, selected, empty) =>
    (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
    list.map((v) => `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(labels ? labels[v] : v)}</option>`).join('');
  const isStaff = () => state.user && ['admin', 'agent'].includes(state.user.role);
  const staffUsers = () => state.users.filter((u) => u.role !== 'user');

  function toast(msg, err = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (err ? ' err' : '');
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), 3000);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && url !== '/api/login') {
      logout(false);
      throw new Error('Session expirée');
    }
    if (!res.ok) throw new Error(data.error || 'Erreur');
    return data;
  }

  function setToken(token) {
    state.token = token;
    try { token ? localStorage.setItem('token', token) : localStorage.removeItem('token'); } catch {}
  }

  async function logout(callApi = true) {
    if (callApi && state.token) await api('POST', '/api/logout').catch(() => {});
    setToken(null);
    state.user = null;
    location.hash = '#/login';
    render();
  }

  // ---- Vues --------------------------------------------------------------

  function loginView() {
    $('#topbar').hidden = true;
    view.innerHTML = `
      <div class="card login">
        <h1>🎫 Ticketing</h1>
        <form id="login-form">
          <label for="username">Identifiant</label>
          <input id="username" name="username" autocomplete="username" required autofocus>
          <label for="password">Mot de passe</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
          <div class="error" id="login-error"></div>
          <button class="btn btn-primary" style="width:100%;margin-top:.5rem">Se connecter</button>
        </form>
        <p class="hint">Comptes de démo : <b>admin</b> / admin123 · <b>agent</b> / agent123 · <b>user</b> / user123</p>
      </div>`;
    $('#login-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const { token, user } = await api('POST', '/api/login', { username: f.get('username'), password: f.get('password') });
        setToken(token);
        state.user = user;
        await loadContext();
        location.hash = '#/';
      } catch (err) {
        $('#login-error').textContent = err.message;
      }
    };
  }

  function bars(data, labels, colorVar) {
    const max = Math.max(1, ...Object.values(data));
    return Object.entries(data).map(([k, n]) => `
      <div class="bar-row">
        <span>${labels[k]}</span>
        <div class="bar"><span style="width:${(n / max) * 100}%;background:var(--${colorVar}-${k}, var(--primary))"></span></div>
        <b style="text-align:right">${n}</b>
      </div>`).join('');
  }

  async function dashboardView() {
    const [s, recent] = await Promise.all([api('GET', '/api/stats'), api('GET', '/api/tickets?sort=updated')]);
    const open = s.byStatus.ouvert + s.byStatus.en_cours + s.byStatus.en_attente;
    view.innerHTML = `
      <h1>Bonjour ${esc(state.user.name)} 👋</h1>
      <div class="grid stats">
        <a class="card stat" href="#/tickets"><div class="n">${s.total}</div><div class="l">Tickets au total</div></a>
        <div class="card stat"><div class="n">${open}</div><div class="l">Tickets actifs</div></div>
        ${isStaff() ? `
        <a class="card stat" href="#/tickets?assignee=me"><div class="n">${s.assignedToMe}</div><div class="l">Assignés à moi</div></a>
        <a class="card stat" href="#/tickets?assignee=none"><div class="n">${s.unassigned}</div><div class="l">Non assignés</div></a>` : ''}
        <div class="card stat"><div class="n">${s.byPriority.critique}</div><div class="l">Critiques</div></div>
      </div>
      <div class="grid two-col">
        <div class="card"><h2>Par statut</h2>${bars(s.byStatus, LABELS.status, 's')}</div>
        <div class="card"><h2>Par priorité</h2>${bars(s.byPriority, LABELS.priority, 'p')}</div>
      </div>
      <div class="card" style="margin-top:1rem">
        <h2>Activité récente</h2>
        ${ticketTable(recent.slice(0, 8))}
      </div>`;
    bindRows();
  }

  function ticketTable(list) {
    if (!list.length) return `<div class="empty">Aucun ticket pour l'instant. <a href="#/tickets/new">Créer un ticket</a></div>`;
    return `
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Titre</th><th>Statut</th><th>Priorité</th><th>Catégorie</th><th>Assigné</th><th>Mis à jour</th></tr></thead>
        <tbody>
          ${list.map((t) => `
            <tr data-id="${t.id}">
              <td class="muted">#${t.id}</td>
              <td><a href="#/tickets/${t.id}">${esc(t.title)}</a><div class="small muted">par ${esc(t.requester?.name || '—')}${t.commentCount ? ` · 💬 ${t.commentCount}` : ''}</div></td>
              <td>${statusBadge(t.status)}</td>
              <td>${prioBadge(t.priority)}</td>
              <td><span class="tag">${LABELS.category[t.category]}</span></td>
              <td>${esc(t.assignee?.name || '—')}</td>
              <td class="small muted">${fmtDate(t.updatedAt)}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;
  }

  function bindRows() {
    view.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
      tr.onclick = (e) => { if (e.target.tagName !== 'A') location.hash = `#/tickets/${tr.dataset.id}`; };
    });
  }

  async function listView(params) {
    const m = state.meta;
    view.innerHTML = `
      <div class="row" style="align-items:center;margin-bottom:1rem">
        <h1 style="margin:0">Tickets</h1>
        <div style="flex:0"><a class="btn btn-primary" href="#/tickets/new">+ Nouveau ticket</a></div>
      </div>
      <form class="filters" id="filters">
        <input name="q" placeholder="Rechercher (titre, description, n°)…" value="${esc(params.get('q') || '')}">
        <select name="status">${options(m.statuses, LABELS.status, params.get('status'), 'Tous les statuts')}</select>
        <select name="priority">${options(m.priorities, LABELS.priority, params.get('priority'), 'Toutes priorités')}</select>
        <select name="category">${options(m.categories, LABELS.category, params.get('category'), 'Toutes catégories')}</select>
        ${isStaff() ? `<select name="assignee">
          <option value="">Tous les assignés</option>
          <option value="me" ${params.get('assignee') === 'me' ? 'selected' : ''}>Moi</option>
          <option value="none" ${params.get('assignee') === 'none' ? 'selected' : ''}>Non assigné</option>
          ${staffUsers().map((u) => `<option value="${u.id}" ${params.get('assignee') === String(u.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select>` : ''}
        <select name="sort">
          ${options(['updated', 'created', 'priority', 'id'], { updated: 'Tri : mise à jour', created: 'Tri : création', priority: 'Tri : priorité', id: 'Tri : numéro' }, params.get('sort') || 'updated')}
        </select>
      </form>
      <div class="card" id="list"><div class="empty">Chargement…</div></div>`;

    const form = $('#filters');
    const apply = () => {
      const p = new URLSearchParams();
      for (const [k, v] of new FormData(form)) if (v) p.set(k, v);
      const qs = p.toString();
      history.replaceState(null, '', `#/tickets${qs ? '?' + qs : ''}`);
      load(p);
    };
    let timer;
    form.oninput = (e) => { clearTimeout(timer); timer = setTimeout(apply, e.target.name === 'q' ? 250 : 0); };
    form.onsubmit = (e) => { e.preventDefault(); apply(); };

    async function load(p) {
      const list = await api('GET', `/api/tickets?${p}`);
      $('#list').innerHTML = `<div class="small muted" style="margin-bottom:.5rem">${list.length} ticket(s)</div>` + ticketTable(list);
      bindRows();
    }
    await load(params);
  }

  function newTicketView() {
    const m = state.meta;
    view.innerHTML = `
      <h1>Nouveau ticket</h1>
      <form class="card" id="new-ticket">
        <label for="title">Titre</label>
        <input id="title" name="title" maxlength="200" required placeholder="Résumé du problème ou de la demande">
        <div class="row">
          <div><label>Catégorie</label><select name="category">${options(m.categories, LABELS.category, 'incident')}</select></div>
          <div><label>Priorité</label><select name="priority">${options(m.priorities, LABELS.priority, 'normale')}</select></div>
          ${isStaff() ? `<div><label>Assigner à</label><select name="assigneeId">${options(staffUsers().map((u) => u.id), Object.fromEntries(staffUsers().map((u) => [u.id, u.name])), '', 'Personne')}</select></div>` : ''}
        </div>
        <label for="description">Description</label>
        <textarea id="description" name="description" required placeholder="Décrivez le contexte, les étapes pour reproduire, le résultat attendu…"></textarea>
        <div class="actions">
          <a class="btn" href="#/tickets">Annuler</a>
          <button class="btn btn-primary">Créer le ticket</button>
        </div>
      </form>`;
    $('#new-ticket').onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      if (!body.assigneeId) delete body.assigneeId;
      try {
        const t = await api('POST', '/api/tickets', body);
        toast(`Ticket #${t.id} créé`);
        location.hash = `#/tickets/${t.id}`;
      } catch (err) { toast(err.message, true); }
    };
  }

  function historyLine(h) {
    const who = esc(h.author?.name || 'Inconnu');
    if (h.action === 'created') return `${who} a créé le ticket`;
    const fmt = (v) => {
      if (h.field === 'status') return LABELS.status[v];
      if (h.field === 'priority') return LABELS.priority[v];
      if (h.field === 'category') return LABELS.category[v];
      if (h.field === 'assigneeId') return esc(state.users.find((u) => u.id === v)?.name || (v ? `#${v}` : 'personne'));
      return null;
    };
    const from = fmt(h.from), to = fmt(h.to);
    return from !== null
      ? `${who} a changé ${LABELS.field[h.field]} : ${from || '—'} → <b>${to || '—'}</b>`
      : `${who} a modifié ${LABELS.field[h.field] || h.field}`;
  }

  async function detailView(id) {
    const t = await api('GET', `/api/tickets/${id}`);
    const m = state.meta;
    const staff = isStaff();
    const mine = t.requesterId === state.user.id;
    const canEdit = staff || (mine && t.status === 'ouvert');

    const sideField = (label, name, list, labels, value, extra = '') =>
      `<dt>${label}</dt><dd><select data-field="${name}" ${extra}>${options(list, labels, value)}</select></dd>`;

    view.innerHTML = `
      <p class="small"><a href="#/tickets">← Retour aux tickets</a></p>
      <div class="grid detail">
        <div>
          <div class="card">
            <div class="muted small">#${t.id} · ouvert par ${esc(t.requester?.name)} le ${fmtDate(t.createdAt)}</div>
            <div id="ticket-body">
              <h1 style="margin:.4rem 0 .75rem">${esc(t.title)}</h1>
              <p class="desc">${esc(t.description)}</p>
            </div>
            ${canEdit ? `<div class="actions"><button class="btn btn-sm" id="edit">Modifier</button></div>` : ''}
          </div>
          <div class="card" style="margin-top:1rem">
            <h2>Commentaires (${t.comments.length})</h2>
            ${t.comments.length ? t.comments.map((c) => `
              <div class="comment ${c.internal ? 'internal' : ''}">
                <header><span><b>${esc(c.author?.name || 'Inconnu')}</b>${c.internal ? ' · 🔒 note interne' : ''}</span><span>${fmtDate(c.createdAt)}</span></header>
                <p class="desc">${esc(c.body)}</p>
              </div>`).join('') : '<p class="muted">Aucun commentaire.</p>'}
            <form id="comment-form" style="margin-top:1rem">
              <textarea name="body" required placeholder="Ajouter une réponse…" style="min-height:90px"></textarea>
              <div class="actions" style="justify-content:space-between;align-items:center">
                ${staff ? '<label class="check"><input type="checkbox" name="internal"> Note interne (invisible pour le demandeur)</label>' : '<span></span>'}
                <button class="btn btn-primary">Envoyer</button>
              </div>
            </form>
          </div>
        </div>
        <aside class="card">
          <dl class="meta" style="margin:0">
            ${staff
              ? sideField('Statut', 'status', m.statuses, LABELS.status, t.status)
              : `<dt>Statut</dt><dd>${statusBadge(t.status)}</dd>`}
            ${canEdit
              ? sideField('Priorité', 'priority', m.priorities, LABELS.priority, t.priority)
              : `<dt>Priorité</dt><dd>${prioBadge(t.priority)}</dd>`}
            ${canEdit
              ? sideField('Catégorie', 'category', m.categories, LABELS.category, t.category)
              : `<dt>Catégorie</dt><dd><span class="tag">${LABELS.category[t.category]}</span></dd>`}
            ${staff
              ? `<dt>Assigné à</dt><dd><select data-field="assigneeId">${options(staffUsers().map((u) => u.id), Object.fromEntries(staffUsers().map((u) => [u.id, u.name])), t.assigneeId ?? '', 'Personne')}</select></dd>
                 ${t.assigneeId !== state.user.id ? '<dd><button class="btn btn-sm" id="take" style="margin-top:.4rem">M\'assigner</button></dd>' : ''}`
              : `<dt>Assigné à</dt><dd>${esc(t.assignee?.name || 'Pas encore assigné')}</dd>`}
            <dt>Dernière mise à jour</dt><dd>${fmtDate(t.updatedAt)}</dd>
            ${t.resolvedAt ? `<dt>Résolu le</dt><dd>${fmtDate(t.resolvedAt)}</dd>` : ''}
          </dl>
          <div style="margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap">
            ${!staff && mine && t.status !== 'ferme' ? '<button class="btn btn-sm" data-status="ferme">Fermer le ticket</button>' : ''}
            ${!staff && mine && ['resolu', 'ferme'].includes(t.status) ? '<button class="btn btn-sm" data-status="ouvert">Rouvrir</button>' : ''}
            ${state.user.role === 'admin' ? '<button class="btn btn-sm btn-danger" id="delete">Supprimer</button>' : ''}
          </div>
          <h2 style="margin-top:1.5rem">Historique</h2>
          <ul class="history" style="padding-left:1rem;margin:0">
            ${[...t.history].reverse().map((h) => `<li>${historyLine(h)}<br><span class="small">${fmtDate(h.at)}</span></li>`).join('')}
          </ul>
        </aside>
      </div>`;

    const update = async (patch) => {
      try {
        await api('PATCH', `/api/tickets/${t.id}`, patch);
        toast('Ticket mis à jour');
        detailView(t.id);
      } catch (err) { toast(err.message, true); }
    };

    view.querySelectorAll('select[data-field]').forEach((sel) => {
      sel.onchange = () => update({ [sel.dataset.field]: sel.dataset.field === 'assigneeId' ? (sel.value ? Number(sel.value) : null) : sel.value });
    });
    view.querySelectorAll('button[data-status]').forEach((b) => { b.onclick = () => update({ status: b.dataset.status }); });
    $('#take')?.addEventListener('click', () => update({ assigneeId: state.user.id, ...(t.status === 'ouvert' ? { status: 'en_cours' } : {}) }));
    $('#delete')?.addEventListener('click', async () => {
      if (!confirm(`Supprimer définitivement le ticket #${t.id} ?`)) return;
      try { await api('DELETE', `/api/tickets/${t.id}`); toast('Ticket supprimé'); location.hash = '#/tickets'; }
      catch (err) { toast(err.message, true); }
    });
    $('#edit')?.addEventListener('click', () => {
      $('#ticket-body').innerHTML = `
        <form id="edit-form">
          <label>Titre</label><input name="title" maxlength="200" required value="${esc(t.title)}">
          <label>Description</label><textarea name="description" required>${esc(t.description)}</textarea>
          <div class="actions"><button type="button" class="btn" id="cancel-edit">Annuler</button><button class="btn btn-primary">Enregistrer</button></div>
        </form>`;
      $('#edit').hidden = true;
      $('#cancel-edit').onclick = () => detailView(t.id);
      $('#edit-form').onsubmit = (e) => { e.preventDefault(); update(Object.fromEntries(new FormData(e.target))); };
    });
    $('#comment-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api('POST', `/api/tickets/${t.id}/comments`, { body: f.get('body'), internal: f.get('internal') === 'on' });
        detailView(t.id);
      } catch (err) { toast(err.message, true); }
    };
  }

  async function usersView() {
    if (state.user.role !== 'admin') { location.hash = '#/'; return; }
    state.users = await api('GET', '/api/users');
    view.innerHTML = `
      <h1>Utilisateurs</h1>
      <div class="grid detail">
        <div class="card table-wrap">
          <table>
            <thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th></th></tr></thead>
            <tbody>${state.users.map((u) => `
              <tr style="cursor:default"><td>${esc(u.name)}</td><td class="muted">${esc(u.username)}</td><td>${LABELS.role[u.role]}</td>
              <td style="text-align:right">${u.id !== state.user.id ? `<button class="btn btn-sm btn-danger" data-del="${u.id}">Supprimer</button>` : ''}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        <form class="card" id="user-form">
          <h2>Ajouter un utilisateur</h2>
          <label>Nom complet</label><input name="name" required>
          <label>Identifiant</label><input name="username" required autocomplete="off">
          <label>Mot de passe</label><input name="password" type="password" minlength="6" required autocomplete="new-password">
          <label>Rôle</label><select name="role">${options(state.meta.roles, LABELS.role, 'user')}</select>
          <div class="actions"><button class="btn btn-primary">Ajouter</button></div>
        </form>
      </div>`;
    $('#user-form').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/users', Object.fromEntries(new FormData(e.target))); toast('Utilisateur ajouté'); usersView(); }
      catch (err) { toast(err.message, true); }
    };
    view.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Supprimer cet utilisateur ?')) return;
        try { await api('DELETE', `/api/users/${b.dataset.del}`); toast('Utilisateur supprimé'); usersView(); }
        catch (err) { toast(err.message, true); }
      };
    });
  }

  // ---- Routeur -----------------------------------------------------------

  async function loadContext() {
    [state.meta, state.users] = await Promise.all([api('GET', '/api/meta'), api('GET', '/api/users')]);
  }

  async function render() {
    const hash = location.hash.slice(1) || '/';
    const [pathname, qs] = hash.split('?');
    const params = new URLSearchParams(qs || '');

    if (!state.token) return loginView();
    try {
      if (!state.user) {
        state.user = await api('GET', '/api/me');
        await loadContext();
      }
    } catch { return; }

    $('#topbar').hidden = false;
    $('#me-name').textContent = `${state.user.name} (${LABELS.role[state.user.role]})`;
    $('#nav-users').hidden = state.user.role !== 'admin';
    document.querySelectorAll('.topbar nav a:not(.btn)').forEach((a) => {
      const href = a.getAttribute('href').slice(1);
      a.classList.toggle('active', href === '/' ? pathname === '/' : pathname.startsWith(href));
    });

    try {
      let m;
      if (pathname === '/' || pathname === '/login') await dashboardView();
      else if (pathname === '/tickets') await listView(params);
      else if (pathname === '/tickets/new') newTicketView();
      else if ((m = pathname.match(/^\/tickets\/(\d+)$/))) await detailView(m[1]);
      else if (pathname === '/users') await usersView();
      else view.innerHTML = '<div class="empty">Page introuvable. <a href="#/">Accueil</a></div>';
      window.scrollTo(0, 0);
    } catch (err) {
      view.innerHTML = `<div class="card empty">${esc(err.message)}<br><a href="#/tickets">Retour aux tickets</a></div>`;
    }
  }

  $('#logout').onclick = () => logout();
  window.addEventListener('hashchange', render);
  render();
})();
