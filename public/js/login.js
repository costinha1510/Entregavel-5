const form = document.querySelector('#login-form');
const password = document.querySelector('#password');
const passwordToggle = document.querySelector('.password-toggle');
const notice = document.querySelector('#login-notice');

passwordToggle.addEventListener('click', () => {
  const reveal = password.type === 'password';
  password.type = reveal ? 'text' : 'password';
  passwordToggle.textContent = reveal ? 'Ocultar' : 'Mostrar';
  passwordToggle.setAttribute('aria-label', reveal ? 'Ocultar senha' : 'Mostrar senha');
  passwordToggle.setAttribute('aria-pressed', String(reveal));
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  notice.hidden = false;
  notice.textContent = 'A autenticação ainda não está conectada. Fale com o suporte para solicitar acesso.';
});

form.addEventListener('input', () => {
  notice.hidden = true;
});
