// Logica do Registro de Venda (caixa.js)

const buscaInput = document.getElementById('busca-produto');
const listaProdutosDiv = document.getElementById('lista-produtos');
const listaVendaDiv = document.getElementById('lista-venda');
const totalVendaEl = document.getElementById('total-venda');
const finalizarVendaBtn = document.getElementById('finalizar-venda-btn');
const valorRecebidoInput = document.getElementById('valor-recebido');
const valorTrocoInput = document.getElementById('valor-troco');
const formaPagamentoSelect = document.getElementById('forma-pagamento');
const trocoSuprimentoEl = document.getElementById('troco-suprimento');
const trocoDeltaEl = document.getElementById('troco-delta');
const trocoTotalEl = document.getElementById('troco-total');
const trocoRecarregarBtn = document.getElementById('troco-recarregar');
const totalItensNumberTargets = Array.from(document.querySelectorAll('[data-total-itens-num]'));
const totalItensLabelTargets = Array.from(document.querySelectorAll('[data-total-itens-label]'));
const totalValorTargets = Array.from(document.querySelectorAll('[data-total-valor]'));
const trocoPrevistoTargets = Array.from(document.querySelectorAll('[data-troco-previsto]'));
const trocoHintTargets = Array.from(document.querySelectorAll('[data-troco-hint]'));

const API_URL = 'http://localhost:3000';
const STORAGE_TROCO_DELTA = 'fc_troco_delta';
const STORAGE_TROCO_ENTREGUE = 'fc_troco_entregue';

let todosOsProdutos = [];
let vendaAtual = [];
let totalSuprimentos = 0;

const formatarValor = (valor) => {
  const numero = Number(valor || 0);
  const seguro = Number.isFinite(numero) ? numero : 0;
  return `R$ ${seguro.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

const totalVendaAtual = () => vendaAtual.reduce((acc, it) => acc + Number(it.valor || 0), 0);

const atualizarTrocoPrevisto = () => {
  const total = totalVendaAtual();
  const recebido = parseMoeda(valorRecebidoInput?.value);
  const troco = recebido ? Math.max(0, recebido - total) : 0;
  const textoTroco = formatarValor(troco);

  trocoPrevistoTargets.forEach((el) => {
    el.textContent = textoTroco;
  });

  trocoHintTargets.forEach((el) => {
    if (!recebido) {
      el.textContent = 'Informe o valor recebido';
    } else if (total === 0) {
      el.textContent = 'Adicione itens para calcular o troco';
    } else if (troco > 0) {
      el.textContent = 'Troco previsto para o cliente';
    } else {
      el.textContent = 'Sem troco a devolver';
    }
  });
};

const atualizarResumoVenda = () => {
  const total = totalVendaAtual();
  const itens = vendaAtual.length;
  const totalTexto = formatarValor(total);
  const itensLabel = itens === 1 ? '1 item' : `${itens} itens`;

  totalValorTargets.forEach((el) => {
    el.textContent = totalTexto;
  });
  if (totalVendaEl && !totalValorTargets.includes(totalVendaEl)) {
    totalVendaEl.textContent = totalTexto;
  }

  totalItensNumberTargets.forEach((el) => {
    el.textContent = itens;
  });
  totalItensLabelTargets.forEach((el) => {
    el.textContent = itensLabel;
  });

  atualizarTrocoPrevisto();
};

const lerTrocoDelta = () => {
  const raw = sessionStorage.getItem(STORAGE_TROCO_DELTA) ?? localStorage.getItem(STORAGE_TROCO_DELTA) ?? '0';
  const num = parseFloat(raw);
  return Number.isFinite(num) ? num : 0;
};

const lerTrocoEntregue = () => {
  const raw = sessionStorage.getItem(STORAGE_TROCO_ENTREGUE) ?? localStorage.getItem(STORAGE_TROCO_ENTREGUE) ?? '0';
  const num = parseFloat(raw);
  return Number.isFinite(num) ? num : 0;
};

const salvarTrocoDelta = () => {
  const totalVenda = totalVendaAtual();
  const recebido = parseMoeda(valorRecebidoInput?.value);
  const trocoDado = parseMoeda(valorTrocoInput?.value);
  if (totalVenda <= 0 || !Number.isFinite(recebido) || !Number.isFinite(trocoDado)) return;
  const trocoEsperado = Math.max(0, recebido - totalVenda);
  const delta = trocoEsperado - trocoDado; // positivo = entregou menos (sobra no caixa)
  const acumulado = lerTrocoDelta();
  const novoTotal = acumulado + delta;
  const salvo = novoTotal.toFixed(2);
  sessionStorage.setItem(STORAGE_TROCO_DELTA, salvo);
  try { localStorage.setItem(STORAGE_TROCO_DELTA, salvo); } catch (_) { }

  // Acumula o total de troco entregue (para exibir no fechamento)
  const totalEntregue = lerTrocoEntregue() + trocoDado;
  const salvoEntregue = totalEntregue.toFixed(2);
  sessionStorage.setItem(STORAGE_TROCO_ENTREGUE, salvoEntregue);
  try { localStorage.setItem(STORAGE_TROCO_ENTREGUE, salvoEntregue); } catch (_) { }
};

const atualizarPainelTroco = async () => {
  const delta = lerTrocoDelta();
  if (trocoDeltaEl) trocoDeltaEl.textContent = formatarValor(delta);
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const resp = await fetch(`${API_URL}/api/caixa/resumo?data=${hoje}&_=${Date.now()}`, { cache: 'no-store' });
    if (!resp.ok) throw new Error('Resumo indisponivel');
    const resumo = await resp.json();
    totalSuprimentos = Number(resumo.suprimentos || totalSuprimentos || 0);
    const caixaPrevisto = Number(resumo.esperadoCaixaDinheiro || 0);
    if (trocoSuprimentoEl) trocoSuprimentoEl.textContent = formatarValor(totalSuprimentos);
    if (trocoTotalEl) trocoTotalEl.textContent = formatarValor(caixaPrevisto + delta);
  } catch (_) {
    if (trocoSuprimentoEl) trocoSuprimentoEl.textContent = formatarValor(totalSuprimentos);
    if (trocoTotalEl) trocoTotalEl.textContent = formatarValor(totalSuprimentos + delta);
  }
};

const carregarTotalSuprimentos = async () => {
  try {
    const resp = await fetch(`${API_URL}/api/suprimentos?ativos=1`, { cache: 'no-store' });
    if (!resp.ok) throw new Error();
    const data = await resp.json();
    const soma = (Array.isArray(data) ? data : []).reduce(
      (acc, s) => acc + (Number(s.amount ?? s.valor ?? 0) || 0),
      0
    );
    totalSuprimentos = soma;
    await atualizarPainelTroco();
  } catch (_) {
    totalSuprimentos = 0;
    await atualizarPainelTroco();
  }
};

const fetchProdutos = async () => {
  try {
    const response = await fetch(`${API_URL}/api/produtos`);
    if (!response.ok) throw new Error('Não foi possível carregar os produtos do estoque.');
    todosOsProdutos = await response.json();
    renderizarProdutos([]);
  } catch (error) {
    console.error('ERRO AO BUSCAR PRODUTOS:', error);
    if (typeof showToast === 'function') showToast(error.message, 'error');
  }
};

const renderizarProdutos = (produtos) => {
  if (!listaProdutosDiv) return;
  listaProdutosDiv.innerHTML = '';
  produtos.forEach((produto) => {
    const preco = Number(produto.valor || 0);
    const produtoDiv = document.createElement('div');
    produtoDiv.className = 'item-produto';
    produtoDiv.innerHTML = `
            <div class="item-produto__info">
                <span class="item-produto__nome">${produto.nome}</span>
                <span class="item-produto__meta">Cód: ${produto.id}</span>
            </div>
            <strong class="item-produto__valor">${formatarValor(preco)}</strong>
            <button class="add-btn" data-id="${produto.id}">Adicionar</button>
        `;
    listaProdutosDiv.appendChild(produtoDiv);
  });
};

const renderizarVenda = () => {
  if (!listaVendaDiv) return;
  listaVendaDiv.innerHTML = '';
  vendaAtual.forEach((item, index) => {
    const preco = Number(item.valor || 0);
    const codigo = item.id ?? 's/ código';
    const itemDiv = document.createElement('div');
    itemDiv.className = 'item-venda';
    itemDiv.innerHTML = `
            <div class="item-venda__info">
                <span class="item-venda__nome">${item.nome}</span>
                <span class="item-venda__meta">Cód: ${codigo}</span>
            </div>
            <strong class="item-venda__valor">${formatarValor(preco)}</strong>
            <button class="remove-btn" data-index="${index}">Remover</button>
        `;
    listaVendaDiv.appendChild(itemDiv);
  });
  atualizarResumoVenda();
};

buscaInput?.addEventListener('input', () => {
  const termoBusca = buscaInput.value.toLowerCase();
  if (termoBusca.length >= 2) {
    const produtosFiltrados = todosOsProdutos.filter(
      (produto) =>
        produto.nome.toLowerCase().includes(termoBusca) ||
        produto.id?.toString().toLowerCase().includes(termoBusca)
    );
    renderizarProdutos(produtosFiltrados);
  } else {
    renderizarProdutos([]);
  }
});

listaProdutosDiv?.addEventListener('click', (e) => {
  if (e.target.classList.contains('add-btn')) {
    const produtoId = e.target.dataset.id;
    const produtoParaAdicionar = todosOsProdutos.find((p) => p.id?.toString() === produtoId);
    if (produtoParaAdicionar) {
      vendaAtual.push({ ...produtoParaAdicionar });
      renderizarVenda();
      if (buscaInput) {
        buscaInput.value = '';
        buscaInput.focus();
      }
      renderizarProdutos([]);
    }
  }
});

listaVendaDiv?.addEventListener('click', (e) => {
  if (e.target.classList.contains('remove-btn')) {
    const indexParaRemover = parseInt(e.target.dataset.index, 10);
    vendaAtual.splice(indexParaRemover, 1);
    renderizarVenda();
  }
});

finalizarVendaBtn?.addEventListener('click', async () => {
  if (vendaAtual.length === 0) {
    showToast?.('Adicione pelo menos um produto para finalizar a venda.', 'error');
    return;
  }
  const vendedor = sessionStorage.getItem('username');
  const formaPagamento = formaPagamentoSelect?.value || 'dinheiro';
  const recebido = parseMoeda(valorRecebidoInput?.value);
  const trocoEntregue = Math.max(0, parseMoeda(valorTrocoInput?.value));
  const saleData = {
    items: vendaAtual,
    seller: vendedor,
    paymentMethod: formaPagamento,
    receivedAmount: recebido,
    changeGiven: trocoEntregue
  };

  try {
    const response = await fetch(`${API_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(saleData),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Ocorreu um erro no servidor.');
    showToast?.('Venda finalizada e registrada com sucesso!');
    if (formaPagamento === 'dinheiro') {
      salvarTrocoDelta();
    }
    vendaAtual = [];
    renderizarVenda();
    await atualizarPainelTroco();
    if (valorRecebidoInput) valorRecebidoInput.value = '';
    if (valorTrocoInput) valorTrocoInput.value = '';
    if (formaPagamentoSelect) formaPagamentoSelect.value = 'dinheiro';
    atualizarTrocoPrevisto();
  } catch (error) {
    console.error('ERRO ao finalizar venda:', error);
    showToast?.(error.message, 'error');
  }
});

// Mascara dos campos de troco
[valorRecebidoInput, valorTrocoInput].forEach((input) => {
  input?.addEventListener('input', (e) => {
    e.target.value = formatarMoedaInput(e.target.value);
    atualizarTrocoPrevisto();
  });
  input?.addEventListener('blur', (e) => {
    e.target.value = formatarMoedaInput(e.target.value);
    atualizarTrocoPrevisto();
  });
});

// Init
fetchProdutos();
carregarTotalSuprimentos();
atualizarPainelTroco();
atualizarResumoVenda();
trocoRecarregarBtn?.addEventListener('click', carregarTotalSuprimentos);
