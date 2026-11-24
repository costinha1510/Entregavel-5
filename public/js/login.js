const loginForm = document.querySelector('#login-form');
const registerForm = document.querySelector('#register-form');
const notice = document.querySelector('#login-notice');
const title = document.querySelector('#form-title');
const description = document.querySelector('#form-description');
const switchPrompt = document.querySelector('#switch-prompt');
const switchLink = document.querySelector('#switch-link');
let csrfToken = '';

function showNotice(message, isError = false) {
  notice.hidden = !message;
  notice.textContent = message;
  notice.classList.toggle('error', isError);
}

function showForm(mode) {
  const registering = mode === 'register';
  loginForm.hidden = registering;
  registerForm.hidden = !registering;
  title.textContent = registering ? 'Crie sua conta' : 'Acesse sua conta';
  description.textContent = registering
    ? 'Após o cadastro, aguarde a aprovação do administrador.'
    : 'Entre com seu e-mail e senha para continuar.';
  switchPrompt.textContent = registering ? 'Já tem uma conta?' : 'Ainda não tem uma conta?';
  switchLink.textContent = registering ? 'Entrar' : 'Criar conta';
  switchLink.href = registering ? '#login' : '#register';
  showNotice('');
}

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  const response = await fetch('/api/auth/csrf-token', { credentials: 'same-origin' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Não foi possível iniciar a autenticação.');
  csrfToken = result.token;
  return csrfToken;
}

async function submitForm(form, endpoint, buttonLabel, successHandler) {
  const button = form.querySelector('[type="submit"]');
  const originalLabel = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Aguarde…';
  showNotice('');
  try {
    const token = await getCsrfToken();
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível concluir. Tente novamente.');
    successHandler(result);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = originalLabel || `${buttonLabel} <span aria-hidden="true">→</span>`;
  }
}

switchLink.addEventListener('click', (event) => {
  event.preventDefault();
  showForm(registerForm.hidden ? 'register' : 'login');
});

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  submitForm(loginForm, '/api/auth/login', 'Entrar', (result) => {
    const requestedPath = new URLSearchParams(location.search).get('next');
    const next = requestedPath?.startsWith('/') && !requestedPath.startsWith('//') && !requestedPath.startsWith('/login.html')
      ? requestedPath
      : result.redirect || '/';
    location.assign(next);
  });
});

registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!registerForm.reportValidity()) return;
  const password = registerForm.elements.password.value;
  if (password !== registerForm.elements.confirmPassword.value) {
    showNotice('As senhas não coincidem.', true);
    return;
  }
  submitForm(registerForm, '/api/auth/register', 'Criar conta', (result) => {
    const email = registerForm.elements.email.value;
    loginForm.elements.email.value = email;
    registerForm.reset();
    showForm('login');
    showNotice(result.message || 'Cadastro recebido. Aguarde a aprovação do administrador.');
  });
});

const statusMessages = {
  pending: 'Seu cadastro aguarda aprovação do administrador.',
  rejected: 'Seu cadastro foi rejeitado. Entre em contato com o suporte.',
  forbidden: 'Esta área é restrita ao administrador.',
};
const status = new URLSearchParams(location.search).get('status');
if (statusMessages[status]) showNotice(statusMessages[status], status !== 'pending');
if (new URLSearchParams(location.search).get('mode') === 'register') showForm('register');
