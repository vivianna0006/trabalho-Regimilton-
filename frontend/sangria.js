document.addEventListener('DOMContentLoaded', () => {
  const sangriaForm = document.getElementById('sangria-form');
  const valorInput = document.getElementById('sangria-valor');
  const motivoInput = document.getElementById('sangria-motivo');
  const submitBtn = document.querySelector('.sangria-submit-btn');
  const resetBtn = document.querySelector('.sangria-reset-btn');

  const formatCurrency = (value) => {
    const digits = (value || '').replace(/\D/g, '');
    if (!digits) {
      return '';
    }

    const number = digits.padStart(3, '0');
    const cents = number.slice(-2);
    const integer = number.slice(0, -2);
    const integerFormatted = parseInt(integer || '0', 10).toLocaleString('pt-BR');
    return `${integerFormatted},${cents}`;
  };

  const parseCurrency = (value) => {
    if (!value) {
      return NaN;
    }
    return parseFloat(value.replace(/\./g, '').replace(',', '.'));
  };

  const setSubmitting = (isSubmitting) => {
    if (!submitBtn) {
      return;
    }

    submitBtn.disabled = isSubmitting;
    submitBtn.classList.toggle('is-loading', isSubmitting);
    submitBtn.textContent = isSubmitting ? 'Registrando...' : 'Confirmar retirada';
  };

  if (valorInput) {
    valorInput.addEventListener('input', () => {
      const formatted = formatCurrency(valorInput.value);
      valorInput.value = formatted;
    });

    valorInput.addEventListener('blur', () => {
      if (!valorInput.value) {
        valorInput.value = '';
      }
    });
  }

  if (resetBtn && sangriaForm) {
    resetBtn.addEventListener('click', () => {
      setTimeout(() => {
        if (valorInput) {
          valorInput.value = '';
          valorInput.focus();
        }
      }, 0);
    });
  }

  if (!sangriaForm || !valorInput || !motivoInput) {
    return;
  }

  sangriaForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const rawValue = valorInput.value;
    const motivo = motivoInput.value.trim();
    const usuario = sessionStorage.getItem('username');

    if (!usuario) {
      showToast('Erro: Usuário nao identificado. Faça login novamente.', 'error');
      return;
    }

    const valorNumerico = parseCurrency(rawValue);

    if (!rawValue || Number.isNaN(valorNumerico) || valorNumerico <= 0) {
      showToast('Informe um valor válido para registrar a sangria.', 'error');
      valorInput.focus();
      return;
    }

    if (!motivo) {
      showToast('Informe o motivo da sangria.', 'error');
      motivoInput.focus();
      return;
    }

    const payload = {
      type: 'sangria',
      amount: valorNumerico,
      reason: motivo,
      user: usuario,
    };

    try {
      setSubmitting(true);
      const response = await ApiClient.fetch('/sangria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = response.headers?.get('content-type')?.includes('application/json')
        ? await response.json()
        : {};

      if (!response.ok) {
        throw new Error(data.message || 'não foi possível registrar a sangria.');
      }

      showToast('Sangria registrada com sucesso!');
      sangriaForm.reset();
      valorInput.focus();
    } catch (error) {
      showToast(error.message || 'Erro ao registrar a sangria.', 'error');
    } finally {
      setSubmitting(false);
    }
  });
});
