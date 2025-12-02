document.addEventListener('DOMContentLoaded', () => {
  const loginBox = document.getElementById('login-box');
  const loginForm = document.getElementById('login-form');

  const parseJson = async (response) => {
    if (!response) return {};
    const contentType = response.headers?.get('content-type') || '';
    if (!contentType.includes('application/json')) return {};
    try { return await response.json(); } catch (_) { return {}; }
  };

  const showError = (message) => { try { showToast(message, 'error'); } catch (_) {} };
  const showInfo = (message) => { try { showToast(message); } catch (_) {} };

  const checkSystemStatus = async () => {
    try {
      const response = await ApiClient.fetch('/status', { cache: 'no-store' });
      const data = await parseJson(response);
      if (!response.ok) throw new Error(data.message || 'Não foi possível verificar o status do sistema.');
      if (data.usersExist) {
        if (loginBox) loginBox.classList.remove('hidden');
      } else {
        window.location.replace('setup.html');
      }
    } catch (error) {
      if (loginBox) loginBox.classList.remove('hidden');
      showError(error.message || 'Não foi possível conectar ao servidor. Verifique se o back-end está em execução.');
    }
  };

  const setGroupError = (input, msg) => {
    if (!input) return;
    const g = input.closest('.input-group');
    if (g) g.classList.add('error');
    const fb = g ? g.querySelector('.input-feedback') : null;
    if (fb) fb.textContent = msg || '';
  };
  const clearGroupError = (input) => {
    if (!input) return;
    const g = input.closest('.input-group');
    if (g) g.classList.remove('error');
    const fb = g ? g.querySelector('.input-feedback') : null;
    if (fb) fb.textContent = '';
  };

  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const userInput = document.getElementById('login-username');
      const passInput = document.getElementById('login-password');
      const username = (userInput?.value || '').trim();
      const password = passInput?.value || '';

      clearGroupError(userInput);
      clearGroupError(passInput);

      let hasErr = false;
      if (!username) { setGroupError(userInput, 'Informe o usuário.'); hasErr = true; }
      if (!password) { setGroupError(passInput, 'Informe a senha.'); hasErr = true; }
      if (hasErr) { showError('Preencha os campos obrigatórios.'); if (!username) { try { userInput.focus(); } catch(_){} } else { try { passInput.focus(); } catch(_){} } return; }

      showInfo('Validando credenciais...');

      try {
        const response = await ApiClient.fetch('/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await parseJson(response);
        if (response.ok && data.success) {
          sessionStorage.setItem('userCargo', data.cargo || '');
          sessionStorage.setItem('username', data.username || username);
          if (data.token) sessionStorage.setItem('authToken', data.token);
          try { showToast((data.message || 'Login bem-sucedido!') + ' Redirecionando...'); } catch (_) {}
          setTimeout(() => {
            try { window.location.replace('menu.html'); } catch(_) { window.location.href = './menu.html'; }
          }, 900);
        } else {
          showError(data.message || 'Não foi possível realizar o login.');
        }
      } catch (error) {
        if (loginBox) loginBox.classList.remove('hidden');
        showError(error.message || 'Não foi possível conectar ao servidor.');
      }
    });
  }

  // Máscara de CPF no usuário quando digitar apenas números + limpa erro ao digitar
  const loginUserInput = document.getElementById('login-username');
  if (loginUserInput) {
    loginUserInput.addEventListener('input', () => { clearGroupError(loginUserInput); });
    loginUserInput.addEventListener('input', () => {
      const v = loginUserInput.value || '';
      if (/[A-Za-z]/.test(v)) return; // se tiver letras, não mascarar
      let digits = v.replace(/\D/g, '');
      if (digits.length > 11) digits = digits.slice(0, 11);
      let masked = digits;
      if (digits.length > 3 && digits.length <= 6) {
        masked = `${digits.slice(0, 3)}.${digits.slice(3)}`;
      } else if (digits.length > 6 && digits.length <= 9) {
        masked = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
      } else if (digits.length > 9) {
        masked = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
      }
      loginUserInput.value = masked;
    });
  }
  (function initEyeToggles() {
    document.querySelectorAll('.eye-toggle').forEach((btn) => {
      const targetId = btn.getAttribute('data-target');
      const target = document.getElementById(targetId);
      if (!target) return;
      const setOpen = (open) => {
        if (open) {
          target.type = 'text';
          btn.classList.add('open');
          btn.classList.remove('closed');
          btn.setAttribute('aria-label', 'Ocultar senha');
          btn.title = 'Ocultar senha';
        } else {
          target.type = 'password';
          btn.classList.remove('open');
          btn.classList.add('closed');
          btn.setAttribute('aria-label', 'Mostrar senha');
          btn.title = 'Mostrar senha';
        }
      };
      setOpen(btn.classList.contains('open'));
      btn.addEventListener('click', () => setOpen(!btn.classList.contains('open')));
    });
  })();

  checkSystemStatus();
});

// Normaliza rótulos estáticos na página de login
document.addEventListener('DOMContentLoaded', () => {
  try {
    const loginUserLabel = document.querySelector('label[for="login-username"]');
    if (loginUserLabel) loginUserLabel.textContent = 'Usuário';
  } catch (_) {}
});
