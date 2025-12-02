// frontend/fechamentocaixa.js

const ENDPOINT_SUMARIO = '/caixa/resumo';
const ENDPOINT_FECHAMENTO = '/caixa/fechar';
const DIF_TOLERANCIA = 0.01;
const FC_RESET_AFTER_RELOAD = 'fcResetAfterReload';
const isGerente = () => {
  const cargo = (sessionStorage.getItem('userCargo') || '').trim().toLowerCase();
  return cargo === 'administrador' || cargo === 'gerente';
};
const hideLucroParaFuncionario = () => {
  if (isGerente()) return;
  const lucroTop = document.querySelector('.fc-top-panel');
  if (lucroTop) lucroTop.style.display = 'none';
  const lucroLinha = document.querySelector('[data-lucro-final]');
  if (lucroLinha) lucroLinha.style.display = 'none';
};

const formEls = {
  data: document.getElementById('data-fechamento'),
  dinheiroContado: document.getElementById('dinheiro-contado'),
  cartaoExtrato: document.getElementById('cartao-extrato'),
  btnRecarregar: document.getElementById('btn-recarregar'),
  btnFinalizar: document.getElementById('finalizar-fechamento'),
  statusResumo: document.getElementById('fc-status-carregamento'),
  statusData: document.getElementById('fc-data-resumo'),
  statusDataTop: document.getElementById('fc-data-top'),
  hint: document.getElementById('fc-footer-hint'),
};

let resumoEsperado = null;

const token = () => sessionStorage.getItem('authToken') || sessionStorage.getItem('token') || '';
const lerTrocoDelta = () => {
  const raw = sessionStorage.getItem('fc_troco_delta') ?? localStorage.getItem('fc_troco_delta') ?? '0';
  const num = parseFloat(raw);
  return Number.isFinite(num) ? num : 0;
};
const lerTrocoEntregue = () => {
  const raw = sessionStorage.getItem('fc_troco_entregue') ?? localStorage.getItem('fc_troco_entregue') ?? '0';
  const num = parseFloat(raw);
  return Number.isFinite(num) ? num : 0;
};

const formatarMoeda = (valor) => {
  const abs = Math.abs(valor || 0);
  const sinal = valor > 0 ? '+' : (valor < 0 ? '-' : '');
  return `R$ ${sinal}${abs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatarMoedaInput = (valor) => {
  const digits = (valor || '').toString().replace(/\D/g, '');
  if (!digits) return '';
  const padded = digits.padStart(3, '0');
  const cents = padded.slice(-2);
  const integer = padded.slice(0, -2);
  const inteiroFormatado = parseInt(integer || '0', 10).toLocaleString('pt-BR');
  return `${inteiroFormatado},${cents}`;
};

const parseMoeda = (valor) => {
  if (!valor) return 0;
  const normalizado = valor.toString().replace(/\./g, '').replace(',', '.');
  const parsed = parseFloat(normalizado);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const classStatus = (valor) => {
  if (Math.abs(valor) <= DIF_TOLERANCIA) return { texto: 'Bateu', classe: 'sobra-tag neutro-tag', linha: 'neutro-tag' };
  if (valor < 0) return { texto: 'Faltou', classe: 'quebra-tag', linha: 'quebra-tag' };
  return { texto: 'Sobrando', classe: 'sobra-tag', linha: 'sobra-tag' };
};
const classStatusGeral = (difDinheiro, difCartao, difGeral) => {
  if (difDinheiro < -DIF_TOLERANCIA || difCartao < -DIF_TOLERANCIA) return { texto: 'Faltou', classe: 'quebra-tag', linha: 'quebra-tag' };
  if (difDinheiro > DIF_TOLERANCIA || difCartao > DIF_TOLERANCIA) return { texto: 'Sobrando', classe: 'sobra-tag', linha: 'sobra-tag' };
  if (Math.abs(difGeral) <= DIF_TOLERANCIA) return { texto: 'Bateu', classe: 'sobra-tag neutro-tag', linha: 'neutro-tag' };
  return classStatus(difGeral);
};

const setStatusPill = (texto, state = 'info') => {
  if (!formEls.statusResumo) return;
  formEls.statusResumo.textContent = texto;
  formEls.statusResumo.className = `pill pill-soft ${state === 'error' ? 'quebra-tag' : ''}`;
};

const setResumoDataLabel = () => {
  if (!formEls.data?.value) return;
  const [ano, mes, dia] = formEls.data.value.split('-').map(Number);
  if (!ano || !mes || !dia) return;
  const dataFormatada = new Date(ano, mes - 1, dia).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' });
  if (formEls.statusData) formEls.statusData.textContent = dataFormatada;
  if (formEls.statusDataTop) formEls.statusDataTop.textContent = dataFormatada;
};

const setReloadState = (isLoading) => {
  if (!formEls.btnRecarregar) return;
  formEls.btnRecarregar.textContent = isLoading ? 'Recarregando...' : 'Recarregar dados';
  formEls.btnRecarregar.disabled = isLoading;
};

const resetFechamentoUI = () => {
  resumoEsperado = null;
  if (formEls.dinheiroContado) formEls.dinheiroContado.value = '';
  if (formEls.cartaoExtrato) formEls.cartaoExtrato.value = '';
  formEls.dinheiroContado.dataset.esperadoDinheiro = '0.00';
  formEls.cartaoExtrato.dataset.esperadoCartao = '0.00';
  const zeros = { suprimentos: 0, vendasDinheiro: 0, vendasCartao: 0, sangrias: 0, devolucoes: 0, ajusteTroco: 0, lucro: 0, esperadoCaixaDinheiro: 0, esperadoGeral: 0 };
  renderResumoEsperado(zeros);
  renderDiferencas();
  setStatusPill('Informe a contagem', 'info');
  formEls.btnFinalizar.disabled = true;
};

const renderResumoEsperado = (dados) => {
  const trocoSessao = Number.isFinite(dados.ajusteTroco) ? dados.ajusteTroco : lerTrocoDelta();
  const trocoEntregue = lerTrocoEntregue();
  const lucroDestaque = document.getElementById('val-lucro-destaque');
  const lucroStatus = document.getElementById('fc-lucro-status');
  const lucroVendas = document.getElementById('val-lucro-vendas');
  const lucroDescontos = document.getElementById('val-lucro-descontos');
  const totalVendas = Number(dados.vendasDinheiro || 0) + Number(dados.vendasCartao || 0);
  const sangriasValor = Number.isFinite(dados.sangriasSaida) ? Math.abs(dados.sangriasSaida) : Math.abs(Number(dados.sangrias || 0));
  const descontos = sangriasValor + Math.abs(Number(dados.devolucoes || 0));

  document.getElementById('val-suprimento').textContent = formatarMoeda(dados.suprimentos);
  document.getElementById('val-vendas-dinheiro').textContent = formatarMoeda(dados.vendasDinheiro);
  document.getElementById('val-vendas-cartao').textContent = formatarMoeda(dados.vendasCartao);
  document.getElementById('val-sangrias').textContent = formatarMoeda(-sangriasValor);
  const devolTotal = Number.isFinite(dados.devolucoes)
    ? Number(dados.devolucoes)
    : (Number(dados.devolucoesDinheiro || 0) + Number(dados.devolucoesCartao || 0));
  document.getElementById('val-devolucoes').textContent = formatarMoeda(devolTotal);
  document.getElementById('val-troco-sessao').textContent = formatarMoeda(trocoEntregue || 0);
  document.getElementById('val-esperado-caixa').textContent = formatarMoeda(dados.esperadoCaixaDinheiro);
  document.getElementById('val-esperado-geral').textContent = formatarMoeda(dados.esperadoGeral);

  formEls.dinheiroContado.dataset.esperadoDinheiro = Number(dados.esperadoCaixaDinheiro || 0).toFixed(2);
  formEls.cartaoExtrato.dataset.esperadoCartao = Number(dados.vendasCartao || 0).toFixed(2);
  if (lucroDestaque) lucroDestaque.textContent = formatarMoeda(dados.lucro);
  if (lucroStatus) lucroStatus.textContent = 'Considera vendas, devoluções, sangrias e suprimentos do dia.';
  if (lucroVendas) lucroVendas.textContent = formatarMoeda(totalVendas);
  if (lucroDescontos) lucroDescontos.textContent = formatarMoeda(descontos);
};

const renderDiferencas = () => {
  const dinheiroContado = parseMoeda(formEls.dinheiroContado?.value);
  const cartaoExtrato = parseMoeda(formEls.cartaoExtrato?.value);
  const esperadoDinheiro = parseFloat(formEls.dinheiroContado.dataset.esperadoDinheiro) || 0;
  const esperadoCartao = parseFloat(formEls.cartaoExtrato.dataset.esperadoCartao) || 0;
  const lucro = resumoEsperado?.lucro ?? 0;

  const difDinheiro = dinheiroContado - esperadoDinheiro;
  const difCartao = cartaoExtrato - esperadoCartao;
  const difGeral = difDinheiro + difCartao;

  const statusD = classStatus(difDinheiro);
  const statusC = classStatus(difCartao);
  const statusG = classStatusGeral(difDinheiro, difCartao, difGeral);
  const statusResumo = statusG;

  document.getElementById('val-dif-dinheiro').textContent = formatarMoeda(difDinheiro);
  document.getElementById('val-dif-dinheiro').className = statusD.linha;
  document.getElementById('status-dinheiro').textContent = statusD.texto;
  document.getElementById('status-dinheiro').className = `pill-status ${statusD.classe}`;

  document.getElementById('val-dif-cartao').textContent = formatarMoeda(difCartao);
  document.getElementById('val-dif-cartao').className = statusC.linha;
  document.getElementById('status-cartao').textContent = statusC.texto;
  document.getElementById('status-cartao').className = `pill-status ${statusC.classe}`;

  document.getElementById('val-dif-geral').textContent = formatarMoeda(difGeral);
  document.getElementById('val-dif-geral').className = statusG.linha;
  document.getElementById('status-geral').textContent = statusG.texto;
  document.getElementById('status-geral').className = `pill-status ${statusG.classe}`;

  document.getElementById('val-lucro-final').textContent = formatarMoeda(lucro);
  document.getElementById('status-geral-resumo').textContent = statusResumo.texto;
  document.getElementById('status-geral-resumo').className = `pill-status ${statusResumo.classe}`;

  const podeFinalizar = resumoEsperado && (Number.isFinite(difGeral) || Number.isFinite(difDinheiro));
  const temContagem = (dinheiroContado + cartaoExtrato) > 0 || (esperadoDinheiro + esperadoCartao) > 0;
  formEls.btnFinalizar.disabled = !(podeFinalizar && temContagem);
  formEls.hint.textContent = formEls.btnFinalizar.disabled
    ? 'Preencha os valores contados para habilitar o fechamento.'
    : 'Revise as diferenças antes de finalizar.';
};

const carregarResumo = async () => {
  if (!formEls.data?.value) {
    setStatusPill('Selecione uma data', 'error');
    return;
  }

  setStatusPill('Carregando...', 'info');
  resumoEsperado = null;
  formEls.btnFinalizar.disabled = true;
  formEls.hint.textContent = 'Carregando dados...';
  setReloadState(true);

  try {
    const response = await ApiClient.fetch(`${ENDPOINT_SUMARIO}?data=${formEls.data.value}&trocoSessao=${lerTrocoDelta()}&trocoEntregue=${lerTrocoEntregue()}&_=${Date.now()}`, {
      headers: { 'x-auth-token': token(), 'Cache-Control': 'no-store' },
      cache: 'no-store'
    });

    if (!response.ok) {
      const erro = await response.json().catch(() => ({}));
      throw new Error(erro.message || 'NÃ£o foi possível carregar o resumo.');
    }

    const dados = await response.json();
    const trocoAjuste = Number.isFinite(dados.ajusteTroco) ? Number(dados.ajusteTroco) : lerTrocoDelta(); // sobra/falta de troco acumulada

    // esperado do backend jÃ¡ inclui suprimentos + vendasDinheiro - devoluÃ§Ãµes - sangrias
    const esperadoCaixaDinheiro = Number(dados.esperadoCaixaDinheiro || 0);
    const esperadoGeral = Number(dados.esperadoGeral || 0);
    const devolTotal = Number.isFinite(dados.devolucoes)
      ? Number(dados.devolucoes)
      : (Number(dados.devolucoesDinheiro || 0) + Number(dados.devolucoesCartao || 0));
    const sangriasValor = Number.isFinite(dados.sangriasSaida) ? Math.abs(dados.sangriasSaida) : Math.abs(Number(dados.sangrias || 0));
    const lucroTeorico = Number(dados.vendasDinheiro || 0)
      + Number(dados.vendasCartao || 0)
      - devolTotal
      - sangriasValor;

    resumoEsperado = {
      suprimentos: Number(dados.suprimentos || 0),
      vendasDinheiro: Number(dados.vendasDinheiro || 0),
      vendasCartao: Number(dados.vendasCartao || 0),
      sangrias: sangriasValor,
      devolucoes: devolTotal,
      ajusteTroco: trocoAjuste,
      lucro: lucroTeorico,
      esperadoCaixaDinheiro,
      esperadoGeral,
    };

    renderResumoEsperado(resumoEsperado);

    // Preenche contagem: cartao/pix vem do extrato; dinheiro fica zerado para contagem manual
    if (formEls.dinheiroContado) formEls.dinheiroContado.value = formatarMoedaInput('0');
    if (formEls.cartaoExtrato) formEls.cartaoExtrato.value = formatarMoedaInput(resumoEsperado.vendasCartao.toFixed(2));

    setResumoDataLabel();
    setStatusPill('Resumo carregado', 'ok');
    formEls.btnFinalizar.disabled = false;
    setReloadState(false);

    renderDiferencas();
  } catch (error) {
    console.error(error);
    resumoEsperado = null;
    setStatusPill('Erro ao carregar', 'error');
    if (typeof showToast === 'function') showToast(error.message || 'Erro ao carregar resumo.', 'error');
    resetFechamentoUI();
  } finally {
    setReloadState(false);
  }
};

const recarregarResumo = async (event) => {
  event?.preventDefault();
  try {
    if (window.ApiClient?.resetBaseUrl) window.ApiClient.resetBaseUrl();
  } catch (_) { /* ignore reset errors */ }
  await carregarResumo();
};

const finalizarCaixa = async () => {
  if (!resumoEsperado || !formEls.data?.value) return;
  const dinheiroContado = parseMoeda(formEls.dinheiroContado.value);
  const cartaoContado = parseMoeda(formEls.cartaoExtrato.value);
  const esperadoCaixa = parseFloat(formEls.dinheiroContado.dataset.esperadoDinheiro) || 0;
  const esperadoCartao = parseFloat(formEls.cartaoExtrato.dataset.esperadoCartao) || 0;
  const ajusteTroco = lerTrocoDelta();

  const difGeralTexto = document.getElementById('val-dif-geral').textContent;
  const statusFinal = document.getElementById('status-geral').textContent || 'Bateu';

  const confirma = confirm(`Confirmar fechamento de ${formEls.data.value}?\nStatus: ${statusFinal}\nDiferença: ${difGeralTexto}`);
  if (!confirma) return;

  setStatusPill('Finalizando...', 'info');
  formEls.btnFinalizar.disabled = true;
  try {
    const payload = {
      data: formEls.data.value,
      dinheiroContado,
      cartaoContado,
      esperadoCaixa,
      esperadoCartao,
      ajusteTroco,
      trocoEntregue: lerTrocoEntregue(),
      user: sessionStorage.getItem('username') || ''
    };

    const response = await ApiClient.fetch(ENDPOINT_FECHAMENTO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': token() },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Erro ao finalizar fechamento.');

    if (typeof showToast === 'function') showToast(data.message || 'Fechamento salvo com sucesso!');
    setStatusPill('Fechamento salvo', 'ok');
    sessionStorage.setItem(FC_RESET_AFTER_RELOAD, '1');
    // Limpa deltas para o proximo dia
    sessionStorage.removeItem('fc_troco_delta');
    sessionStorage.removeItem('fc_troco_entregue');
    try {
      localStorage.removeItem('fc_troco_delta');
      localStorage.removeItem('fc_troco_entregue');
    } catch (_) { }

    setTimeout(() => {
      try { window.location.reload(); } catch (_) { window.location.href = window.location.href; }
    }, 1500);
  } catch (error) {
    console.error(error);
    setStatusPill('Erro ao salvar', 'error');
    if (typeof showToast === 'function') showToast(error.message || 'Erro ao finalizar fechamento.', 'error');
    formEls.btnFinalizar.disabled = false;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const hoje = new Date().toISOString().split('T')[0];
  if (formEls.data) formEls.data.value = hoje;

  if (isGerente()) {
    formEls.btnRecarregar?.addEventListener('click', recarregarResumo);
  } else if (formEls.btnRecarregar) {
    formEls.btnRecarregar.style.display = 'none';
  }
  hideLucroParaFuncionario();
  formEls.data?.addEventListener('change', carregarResumo);
  [formEls.dinheiroContado, formEls.cartaoExtrato].forEach((input) => {
    input?.addEventListener('input', (e) => {
      e.target.value = formatarMoedaInput(e.target.value);
      renderDiferencas();
    });
    input?.addEventListener('blur', (e) => {
      e.target.value = formatarMoedaInput(e.target.value);
    });
  });
  formEls.btnFinalizar?.addEventListener('click', finalizarCaixa);

  const resetAfterReload = sessionStorage.getItem(FC_RESET_AFTER_RELOAD) === '1';
  if (resetAfterReload) {
    sessionStorage.removeItem(FC_RESET_AFTER_RELOAD);
    sessionStorage.removeItem('fc_troco_entregue');
    try { localStorage.removeItem('fc_troco_entregue'); } catch (_) { }

    setResumoDataLabel();
    resetFechamentoUI();
  }

  setResumoDataLabel();
  carregarResumo();
});








