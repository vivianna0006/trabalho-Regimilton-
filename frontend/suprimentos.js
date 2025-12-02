document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('sup-form');
  const valorInput = document.getElementById('sup-valor');
  const descricaoInput = document.getElementById('sup-descricao');
  const dataInput = document.getElementById('sup-data');
  const btnSubmit = document.querySelector('.sup-submit-btn');
  const btnRecarregar = document.getElementById('sup-recarregar');
  const btnHistorico = document.getElementById('sup-ir-historico');
  const totalGeralEl = document.getElementById('sup-total-geral');
  const ultimoValorEl = document.getElementById('sup-ultimo-valor');
  const ultimoInfoEl = document.getElementById('sup-ultimo-info');

  let registros = [];

  const token = () => sessionStorage.getItem('authToken') || sessionStorage.getItem('token') || '';

  const formatCurrencyInput = (value) => {
    const digits = (value || '').toString().replace(/\D/g, '');
    if (!digits) return '';
    const padded = digits.padStart(3, '0');
    const cents = padded.slice(-2);
    const integer = padded.slice(0, -2);
    const formatted = parseInt(integer || '0', 10).toLocaleString('pt-BR');
    return `${formatted},${cents}`;
  };

  const parseCurrency = (value) => {
    if (!value) return NaN;
    const normalized = value.toString().replace(/\./g, '').replace(',', '.');
    const parsed = parseFloat(normalized);
    return Number.isNaN(parsed) ? NaN : parsed;
  };

  const formatMoney = (value) => {
    const num = Number(value) || 0;
    const sinal = num < 0 ? '-' : '';
    const abs = Math.abs(num);
    return `R$ ${sinal}${abs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatDateTime = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('pt-BR');
  };

  const setSubmitting = (isSubmitting) => {
    if (!btnSubmit) return;
    btnSubmit.disabled = isSubmitting;
    btnSubmit.textContent = isSubmitting ? 'Registrando...' : 'Registrar entrada';
  };

  const atualizarResumo = ({ totalList = [], lastList = [] } = {}) => {
    const totalGeral = (totalList || []).reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
    totalGeralEl.textContent = formatMoney(totalGeral);

    const baseUltimos = (lastList && lastList.length) ? lastList : totalList;
    if (!baseUltimos || !baseUltimos.length) {
      ultimoValorEl.textContent = formatMoney(0);
      ultimoInfoEl.textContent = 'Ainda nao ha registros';
      return;
    }

    const ultimo = baseUltimos.slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    ultimoValorEl.textContent = formatMoney(ultimo.amount);
    ultimoInfoEl.textContent = `${formatDateTime(ultimo.date)} por ${ultimo.user || '-'}`;
  };

  const carregarSuprimentos = async () => {
    try {
      const options = { headers: { 'x-auth-token': token() }, cache: 'no-store' };
      const [respAtivos, respTodos] = await Promise.all([
        ApiClient.fetch('/api/suprimentos?ativos=1', options),
        ApiClient.fetch('/api/suprimentos', options)
      ]);
      if (!respAtivos.ok || !respTodos.ok) throw new Error('Nao foi possivel carregar os suprimentos.');

      const parseList = (data) => (Array.isArray(data)
        ? data.map((r) => ({
          id: r.id,
          amount: Number(r.amount ?? r.valor ?? 0) || 0,
          user: r.user || '',
          description: r.description || r.descricao || '',
          date: r.date || r.data || new Date().toISOString()
        }))
        : []);

      const ativos = parseList(await respAtivos.json());
      const todos = parseList(await respTodos.json());
      registros = ativos;
      atualizarResumo({ totalList: ativos, lastList: todos });
    } catch (error) {
      console.error(error);
      registros = [];
      atualizarResumo();
    }
  };

  const registrarSuprimento = async (payload) => {
    setSubmitting(true);
    try {
      const resp = await ApiClient.fetch('/api/suprimentos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token()
        },
        body: JSON.stringify(payload)
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.message || 'Erro ao registrar o suprimento.');
      showToast?.(data.message || 'Suprimento registrado com sucesso!');
      form?.reset();
      if (dataInput) dataInput.value = '';
      valorInput?.focus();
      await carregarSuprimentos();
    } catch (error) {
      console.error(error);
      showToast?.(error.message || 'Erro ao registrar o suprimento.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (valorInput) {
    valorInput.addEventListener('input', (e) => {
      e.target.value = formatCurrencyInput(e.target.value);
    });
    valorInput.addEventListener('blur', (e) => {
      e.target.value = formatCurrencyInput(e.target.value);
    });
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const descricao = (descricaoInput?.value || '').trim();
      const valor = parseCurrency(valorInput?.value);
      const usuario = sessionStorage.getItem('username') || '';

      if (!usuario) {
        showToast?.('Usuario nao identificado. Faca login novamente.', 'error');
        return;
      }
      if (!valorInput?.value || Number.isNaN(valor) || valor <= 0) {
        showToast?.('Informe um valor valido para registrar.', 'error');
        valorInput?.focus();
        return;
      }
      if (!descricao) {
        showToast?.('Descreva o motivo do suprimento.', 'error');
        descricaoInput?.focus();
        return;
      }

      const dataValor = dataInput?.value ? new Date(dataInput.value) : new Date();
      const payload = {
        valor,
        descricao,
        user: usuario,
        data: Number.isNaN(dataValor.getTime()) ? undefined : dataValor.toISOString()
      };

      registrarSuprimento(payload);
    });
  }

  btnRecarregar?.addEventListener('click', carregarSuprimentos);
  btnHistorico?.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.href = 'historico.html';
  });

  // Preenche o datetime com agora para agilizar o registro
  if (dataInput) {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    dataInput.value = local.toISOString().slice(0, 16);
  }

  carregarSuprimentos();
});
