const list = document.querySelector('#users-list');
const message = document.querySelector('#admin-message');
let csrfToken = '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function statusLabel(status) {
  return ({ pending: 'Pendente', approved: 'Aprovado', rejected: 'Rejeitado' })[status] || status;
}

function showMessage(text, isError = false) {
  message.hidden = !text;
  message.textContent = text;
  message.classList.toggle('error', isError);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.method && !['GET', 'HEAD', 'OPTIONS'].includes(options.method.toUpperCase())) {
    if (!csrfToken) {
      const tokenResponse = await fetch('/api/auth/csrf-token');
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok) throw new Error(tokenData.error || 'Não foi possível validar a solicitação.');
      csrfToken = tokenData.token;
    }
    headers['X-CSRF-Token'] = csrfToken;
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, { ...options, headers });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.');
  return data;
}

function createdAtLabel(value) {
  if (!value) return '—';
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

async function loadUsers() {
  showMessage('');
  try {
    const users = await api('/api/admin/users');
    if (!users.length) {
      list.innerHTML = '<tr><td colspan="5">Nenhum cadastro encontrado.</td></tr>';
      return;
    }
    list.innerHTML = users.map((user) => `<tr>
      <td class="primary-cell">${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(createdAtLabel(user.created_at))}</td>
      <td><span class="status-badge ${escapeHtml(user.status)}"><i></i>${escapeHtml(statusLabel(user.status))}</span></td>
      <td class="actions-cell">${user.role === 'user' && user.status === 'pending'
        ? `<button class="primary-button user-action" data-id="${Number(user.id)}" data-status="approved" type="button">Aprovar</button> <button class="secondary-button user-action" data-id="${Number(user.id)}" data-status="rejected" type="button">Rejeitar</button>`
        : '—'}</td>
    </tr>`).join('');
  } catch (error) {
    list.innerHTML = '<tr><td colspan="5">Não foi possível carregar os usuários.</td></tr>';
    showMessage(error.message, true);
  }
}

list.addEventListener('click', async (event) => {
  const button = event.target.closest('.user-action');
  if (!button) return;
  button.disabled = true;
  try {
    const result = await api(`/api/admin/users/${button.dataset.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: button.dataset.status }),
    });
    showMessage(result.status === 'approved' ? 'Cadastro aprovado. O usuário já pode entrar.' : 'Cadastro rejeitado.');
    await loadUsers();
  } catch (error) {
    button.disabled = false;
    showMessage(error.message, true);
  }
});

document.querySelector('#refresh-users').addEventListener('click', loadUsers);
document.querySelector('#logout').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    location.assign('/login.html');
  }
});

loadUsers();
