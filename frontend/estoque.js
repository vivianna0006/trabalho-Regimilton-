const categorias = [
  { nome: 'Acessórios', subcategorias: { Feminino: [], Masculino: [], 'Infantil Feminina': [], 'Infantil Masculina': [] } },
  { nome: 'Blusas', subcategorias: { Feminina: [], Masculino: [], 'Infantil Feminina': [], 'Infantil Masculina': [] } },
  { nome: 'Bolsas', subcategorias: { Feminino: [], Masculino: [], 'Infantil Feminina': [], 'Infantil Masculina': [] } },
  { nome: 'Bonés', subcategorias: { Feminino: [], Masculino: [] } },
  { nome: 'Calçados', subcategorias: { Feminino: [], Masculino: [], 'Infantil Feminino': [], 'Infantil Masculino': [] } },
  { nome: 'Calças', subcategorias: { Feminina: [], Masculino: [], 'Infantil Feminina': [], 'Infantil Masculina': [] } },
  { nome: 'Cintos', subcategorias: { Feminino: [], Masculino: [] } },
  { nome: 'Cropped', subcategorias: { Feminina: [] } },
  { nome: 'Saias', subcategorias: { Feminina: [], 'Infantil Feminina': [] } },
  { nome: 'Shorts', subcategorias: { Feminina: [], Masculino: [], 'Infantil Feminina': [], 'Infantil Masculina': [] } },
  { nome: 'Vestidos', subcategorias: { Feminina: [], 'Infantil Feminina': [] } }
].sort((a, b) => a.nome.localeCompare(b.nome));

const menuCategorias = document.getElementById('menu-categorias');
const areaProdutos = document.getElementById('area-produtos');
const form = document.getElementById('form-produto');
const campoBusca = document.getElementById('campo-busca');
const categoriaSelect = document.getElementById('categoria-select');
const subcategoriaSelect = document.getElementById('subcategoria-select');
const tamanhosInputs = document.getElementById('tamanhos-inputs');
const fieldsetTamanhos = document.getElementById('fieldset-tamanhos');
const valorInput = document.getElementById('valor');

let categoriaAtiva = null;
let subcategoriaAtiva = null;
let listaProdutosContainer = null;
let subcategoriaContainer = null;
let produtoAtualParaEdicao = null;
let searchTimer;

const modalProduto = document.createElement('div');
modalProduto.id = 'modal-produto';
modalProduto.className = 'modal-container';
modalProduto.innerHTML = `
    <div class="modal-content">
        <span class="close-button">&times;</span>
        <h3 id="modal-titulo"></h3>
        <p id="modal-descricao"></p>
        <div id="modal-tamanhos" class="modal-tamanhos"></div>
        <div class="modal-botoes">
            <button id="btn-salvar-alteracoes" class="btn-modal-salvar">Salvar Alteracoes</button>
            <button id="btn-excluir-produto" class="btn-modal-excluir">Excluir Produto</button>
        </div>
    </div>
`;
document.body.appendChild(modalProduto);

const btnFecharModal = modalProduto.querySelector('.close-button');
const btnExcluirProduto = document.getElementById('btn-excluir-produto');
const btnSalvarAlteracoes = document.getElementById('btn-salvar-alteracoes');
const modalTitulo = document.getElementById('modal-titulo');
const modalDescricao = document.getElementById('modal-descricao');
const modalTamanhos = document.getElementById('modal-tamanhos');

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

const formatPriceBRL = (value) => {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  return 'Valor nao definido';
};

if (valorInput) {
  valorInput.addEventListener('input', () => {
    valorInput.value = formatCurrency(valorInput.value);
  });

  valorInput.addEventListener('blur', () => {
    if (!valorInput.value) {
      valorInput.value = '';
    }
  });
}

const normalize = (texto) => (texto || '').normalize('NFD').replace(/[^\w\s-]/g, '').toLowerCase();
const isTamanhoUnicoCategoria = (nomeCategoria) => {
  const alvo = normalize(nomeCategoria);
  return ['acessorios', 'bones', 'bolsas', 'cintos'].includes(alvo);
};

const setActiveCategoriaBotao = (nome) => {
  categoriaAtiva = nome || null;
  Array.from(menuCategorias.querySelectorAll('button')).forEach((btn) => {
    const isActive = normalize(btn.dataset.categoria) === normalize(nome);
    btn.classList.toggle('is-active', isActive);
  });
};

const renderCategoriaBotoes = () => {
  menuCategorias.innerHTML = '';
  categorias.forEach((cat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.categoria = cat.nome;
    btn.textContent = cat.nome;
    btn.addEventListener('click', () => {
      handleCategoriaClick(cat.nome);
    });
    menuCategorias.appendChild(btn);
  });
  setActiveCategoriaBotao(categoriaAtiva);
};

const renderEmptyState = () => {
  areaProdutos.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'estoque-empty';
  const title = document.createElement('h2');
  title.textContent = 'Selecione uma categoria';
  const msg = document.createElement('p');
  msg.textContent = 'Use a lista ao lado ou a busca para visualizar os produtos.';
  empty.appendChild(title);
  empty.appendChild(msg);
  areaProdutos.appendChild(empty);
  listaProdutosContainer = null;
  subcategoriaContainer = null;
};

const createSizePill = (tamanho, quantidade) => {
  const pill = document.createElement('span');
  pill.className = 'estoque-size-pill';
  const qty = Number(quantidade || 0);
  if (qty === 0) {
    pill.classList.add('sem-estoque');
  } else if (qty > 0 && qty <= 15) {
    pill.classList.add('alerta');
  }
  const label = document.createElement('span');
  label.textContent = tamanho;
  const strong = document.createElement('strong');
  strong.textContent = qty;
  pill.appendChild(label);
  pill.appendChild(strong);
  return pill;
};

const createProdutoCard = (produto) => {
  const card = document.createElement('article');
  card.className = 'estoque-product-card';

  const total = Object.values(produto.tamanhos || {}).reduce((acc, value) => acc + Number(value || 0), 0);
  const hasZero = Object.values(produto.tamanhos || {}).some((valor) => Number(valor || 0) === 0);
  if (total > 0 && total <= 15) {
    card.classList.add('is-low');
  }
  if (hasZero) {
    card.classList.add('has-zero');
  }

  const info = document.createElement('div');
  info.className = 'estoque-product-card__info';

  const title = document.createElement('h3');
  title.className = 'estoque-product-card__title';
  title.textContent = produto.nome;

  const meta = document.createElement('div');
  meta.className = 'estoque-product-card__meta';
  const idSpan = document.createElement('span');
  idSpan.textContent = `ID: ${produto.id}`;
  const categoriaSpan = document.createElement('span');
  categoriaSpan.textContent = produto.categoriaNome ? `Categoria: ${produto.categoriaNome}` : 'Categoria: -';
  const subcategoriaSpan = document.createElement('span');
  subcategoriaSpan.textContent = produto.subcategoriaNome ? `Subcategoria: ${produto.subcategoriaNome}` : 'Subcategoria: -';
  meta.appendChild(idSpan);
  meta.appendChild(categoriaSpan);
  meta.appendChild(subcategoriaSpan);

  const descricao = document.createElement('p');
  descricao.textContent = produto.descricao || 'Sem descricao';
  descricao.style.margin = '0';
  descricao.style.color = '#4b5563';

  const preco = document.createElement('div');
  preco.className = 'estoque-product-card__price';
  preco.textContent = formatPriceBRL(produto.valor);

  const tamanhosWrapper = document.createElement('div');
  tamanhosWrapper.className = 'estoque-product-card__sizes';
  const tamanhos = produto.tamanhos || {};
  const tamanhosOrdenados = Object.keys(tamanhos).sort((a, b) => {
    const numA = Number(a);
    const numB = Number(b);
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
      return numA - numB;
    }
    const ordem = ['PP', 'P', 'M', 'G', 'GG'];
    return ordem.indexOf(a) - ordem.indexOf(b);
  });

  if (tamanhosOrdenados.length === 0) {
    const sem = document.createElement('span');
    sem.className = 'estoque-size-pill sem-estoque';
    sem.textContent = 'Sem tamanhos cadastrados';
    tamanhosWrapper.appendChild(sem);
  } else {
    tamanhosOrdenados.forEach((tamanho) => {
      tamanhosWrapper.appendChild(createSizePill(tamanho, tamanhos[tamanho]));
    });
  }

  info.appendChild(title);
  info.appendChild(meta);
  info.appendChild(descricao);
  info.appendChild(preco);
  info.appendChild(tamanhosWrapper);

  const actions = document.createElement('div');
  actions.className = 'estoque-product-card__actions';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-opcoes';
  btn.textContent = '...';
  btn.addEventListener('click', () => {
    abrirModalProduto(produto.id, produto.nome, produto.descricao, produto.categoriaNome, produto.subcategoriaNome);
  });
  actions.appendChild(btn);

  card.appendChild(info);
  card.appendChild(actions);
  return card;
};

const renderProdutosLayout = ({ titulo, descricao, categoriaNome, subcategorias }) => {
  areaProdutos.innerHTML = '';

  if (categoriaNome) {
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'btn-voltar';
    backBtn.textContent = 'Voltar';
    backBtn.addEventListener('click', () => {
      if (categoriaNome && subcategorias) {
        subcategoriaAtiva = null;
        handleCategoriaClick(categoriaNome);
      } else {
        categoriaAtiva = null;
        setActiveCategoriaBotao(null);
        renderEmptyState();
      }
    });
    areaProdutos.appendChild(backBtn);
  }

  const header = document.createElement('div');
  header.className = 'estoque-products-header';
  const titleEl = document.createElement('h2');
  titleEl.textContent = titulo; 
  header.appendChild(titleEl);
  if (descricao) {
    const descEl = document.createElement('p');
    descEl.textContent = descricao;
    header.appendChild(descEl);
  }
  areaProdutos.appendChild(header);

  if (subcategorias && subcategorias.length > 0) {
    const chips = document.createElement('div');
    chips.className = 'estoque-subcategorias';
    subcategorias.forEach((sub) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = sub;
      chip.className = 'estoque-subcategorias__chip';
      if (normalize(sub) === normalize(subcategoriaAtiva)) {
        chip.classList.add('is-active');
      }
      chip.addEventListener('click', () => {
        subcategoriaAtiva = sub;
        buscarEExibirProdutos(categoriaNome, sub);
      });
      chips.appendChild(chip);
    });
    areaProdutos.appendChild(chips);
    subcategoriaContainer = chips;
  } else {
    subcategoriaContainer = null;
  }

  const lista = document.createElement('div');
  lista.className = 'estoque-product-list';
  areaProdutos.appendChild(lista);
  listaProdutosContainer = lista;
};

const renderProdutos = (produtos) => {
  if (!listaProdutosContainer) {
    return;
  }
  listaProdutosContainer.innerHTML = '';
  if (!produtos || produtos.length === 0) {
    const vazio = document.createElement('div');
    vazio.className = 'estoque-empty';
    const title = document.createElement('h2');
    title.textContent = 'Nenhum produto encontrado';
    const msg = document.createElement('p');
    msg.textContent = 'Tente outra categoria ou ajuste o termo de busca.';
    vazio.appendChild(title);
    vazio.appendChild(msg);
    listaProdutosContainer.appendChild(vazio);
    return;
  }
  produtos.forEach((produto) => {
    listaProdutosContainer.appendChild(createProdutoCard(produto));
  });
};

const handleCategoriaClick = (categoriaNome) => {
  const categoria = categorias.find((c) => normalize(c.nome) === normalize(categoriaNome));
  if (!categoria) {
    return;
  }
  categoriaAtiva = categoria.nome;
  subcategoriaAtiva = null;
  setActiveCategoriaBotao(categoria.nome);

  const subcategorias = Object.keys(categoria.subcategorias || {});
  if (subcategorias.length > 0) {
    renderProdutosLayout({
      titulo: categoria.nome,
      descricao: 'Selecione uma subcategoria para listar os produtos.',
      categoriaNome: categoria.nome,
      subcategorias,
    });
  } else {
    renderProdutosLayout({
      titulo: categoria.nome,
      categoriaNome: categoria.nome,
    });
    buscarEExibirProdutos(categoria.nome);
  }
};

const buscarEExibirProdutos = async (categoriaNome, subcategoriaNome = null) => {
  const params = new URLSearchParams();
  if (categoriaNome) params.append('categoria', categoriaNome);
  if (subcategoriaNome) params.append('subcategoria', subcategoriaNome);

  renderProdutosLayout({
    titulo: subcategoriaNome ? `${categoriaNome} - ${subcategoriaNome}` : categoriaNome || 'Resultados',
    categoriaNome,
    subcategorias: categoriaNome ? Object.keys((categorias.find((c) => normalize(c.nome) === normalize(categoriaNome)) || { subcategorias: {} }).subcategorias || {}) : null,
  });

  renderProdutos();
  const currentList = listaProdutosContainer;
  if (currentList) {
    currentList.innerHTML = '<p>Carregando produtos...</p>';
  }

  try {
    const response = await ApiClient.fetch(`/produtos?${params.toString()}`);
    const produtos = response.ok ? await response.json() : [];
    renderProdutos(produtos);
  } catch (error) {
    console.error('Erro ao carregar produtos:', error);
    if (listaProdutosContainer) {
      listaProdutosContainer.innerHTML = '<p>Erro ao carregar produtos. Verifique a conexao com o servidor.</p>';
    }
  }
};

const realizarBusca = () => {
  const termo = campoBusca.value.trim();
  clearTimeout(searchTimer);

  if (termo === '') {
    categoriaAtiva = null;
    subcategoriaAtiva = null;
    setActiveCategoriaBotao(null);
    renderEmptyState();
    return;
  }

  searchTimer = setTimeout(async () => {
    renderProdutosLayout({
      titulo: `Resultados para "${termo}"`,
      descricao: 'Produtos que correspondem ao termo pesquisado.',
    });
    if (listaProdutosContainer) {
      listaProdutosContainer.innerHTML = '<p>Buscando...</p>';
    }

    try {
      const response = await ApiClient.fetch(`/produtos?termo=${encodeURIComponent(termo)}`);
      const produtos = response.ok ? await response.json() : [];
      renderProdutos(produtos);
    } catch (error) {
      console.error('Erro na busca de produtos:', error);
      if (listaProdutosContainer) {
        listaProdutosContainer.innerHTML = '<p>Nao foi possivel realizar a busca. Verifique a conexao com o servidor.</p>';
      }
    }
  }, 300);
};

const abrirModalProduto = async (id, nome, descricao, categoria, subcategoria) => {
  modalTitulo.textContent = nome;
  modalDescricao.textContent = descricao || 'Sem descricao cadastrada.';
  btnExcluirProduto.onclick = () => excluirProduto(id, categoria, subcategoria);

  try {
    const response = await ApiClient.fetch(`/produtos/${id}`);
    if (!response.ok) {
      throw new Error('Nao foi possivel obter os detalhes do produto.');
    }
    const produto = await response.json();
    produtoAtualParaEdicao = produto;
    modalTamanhos.innerHTML = '';

    const isCalcado = normalize(categoria) === normalize('Calcados');
    const tamanhosOrdenados = Object.keys(produto.tamanhos || {}).sort((a, b) => {
      const numA = Number(a);
      const numB = Number(b);
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
        return numA - numB;
      }
      const ordem = ['PP', 'P', 'M', 'G', 'GG'];
      return ordem.indexOf(a) - ordem.indexOf(b);
    });

    tamanhosOrdenados.forEach((tamanho) => {
      const qtd = produto.tamanhos[tamanho];
      const item = document.createElement('div');
      item.className = 'tamanho-item-modal';
      if (Number(qtd) === 0) {
        item.classList.add('sem-estoque-tamanho');
      } else if (Number(qtd) > 0 && Number(qtd) <= 15) {
        item.classList.add('alerta-tamanho');
      }
      item.innerHTML = `
        <span>${tamanho}:</span>
        <input type="number" id="qtd-${tamanho}" name="${tamanho}" value="${qtd}" min="0" class="input-quantidade">
      `;
      modalTamanhos.appendChild(item);
    });

    modalProduto.classList.add('show-modal');
  } catch (error) {
    console.error('Erro ao carregar produto para o modal:', error);
    showToast('Nao foi possivel carregar os detalhes do produto.', 'error');
  }
};

const fecharModal = () => {
  modalProduto.classList.remove('show-modal');
  produtoAtualParaEdicao = null;
};

btnFecharModal.addEventListener('click', fecharModal);
window.addEventListener('click', (event) => {
  if (event.target === modalProduto) {
    fecharModal();
  }
});

const excluirProduto = async (id, categoriaNome, subcategoriaNome) => {
  if (!confirm(`Tem certeza que deseja excluir o produto ${id}?`)) {
    return;
  }

  try {
    const response = await ApiClient.fetch(`/produtos/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoriaNome, subcategoriaNome }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Erro ao excluir o produto.');
    }

    showToast('Produto excluido com sucesso!');
    fecharModal();
    buscarEExibirProdutos(categoriaNome, subcategoriaNome || undefined);
  } catch (error) {
    console.error('Erro ao excluir produto:', error);
    showToast(error.message || 'Nao foi possivel excluir o produto.', 'error');
  }
};

const salvarAlteracoesNoProduto = async () => {
  if (!produtoAtualParaEdicao) {
    showToast('Nenhum produto selecionado para edicao.', 'error');
    return;
  }

  const categoriaDoProduto = produtoAtualParaEdicao.categoriaNome;
  const subcategoriaDoProduto = produtoAtualParaEdicao.subcategoriaNome;

  const novosTamanhos = {};
  const inputs = modalTamanhos.querySelectorAll('input[type="number"]');
  inputs.forEach((input) => {
    novosTamanhos[input.name] = parseInt(input.value, 10);
  });

  try {
    const response = await ApiClient.fetch(`/produtos/${produtoAtualParaEdicao.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tamanhos: novosTamanhos }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Falha ao salvar as alteracoes.');
    }

    showToast('Alteracoes salvas com sucesso!');
    buscarEExibirProdutos(categoriaDoProduto, subcategoriaDoProduto || undefined);
    fecharModal();
  } catch (error) {
    console.error('Erro ao salvar alteracoes:', error);
    showToast(error.message || 'Nao foi possivel salvar as alteracoes.', 'error');
  }
};

btnSalvarAlteracoes.addEventListener('click', salvarAlteracoesNoProduto);

const adicionarProduto = async (event) => {
  event.preventDefault();

  const id = document.getElementById('id').value.trim();
  const nome = document.getElementById('nome').value.trim();
  const descricao = document.getElementById('descricao').value.trim();
  const categoria = categoriaSelect.value;
  const subcategoria = subcategoriaSelect.value;
  const valorNumerico = parseCurrency(valorInput.value);

  if (!categoria) {
    showToast('Selecione uma categoria antes de adicionar o produto.', 'error');
    return;
  }

  if (Number.isNaN(valorNumerico) || valorNumerico <= 0) {
    showToast('Informe um valor valido para o produto.', 'error');
    valorInput.focus();
    return;
  }

  const tamanhos = {};
  const inputsTamanho = tamanhosInputs.querySelectorAll('input[type="number"]');
  inputsTamanho.forEach((input) => {
    tamanhos[input.name] = parseInt(input.value, 10);
  });

  const novoProduto = {
    id,
    nome,
    descricao,
    valor: valorNumerico,
    categoriaNome: categoria,
    subcategoriaNome: subcategoria,
    tamanhos,
  };

  try {
    const response = await ApiClient.fetch('/produtos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(novoProduto),
    });

    const data = response.headers?.get('content-type')?.includes('application/json') ? await response.json() : {};

    if (!response.ok) {
      throw new Error(data.message || 'Erro ao adicionar o produto.');
    }

    showToast('Produto adicionado com sucesso!');
    form.reset();
    fieldsetTamanhos.style.display = 'none';
    valorInput.value = '';
    if (categoria) {
      buscarEExibirProdutos(categoria, subcategoria || undefined);
    } else {
      renderEmptyState();
    }
  } catch (error) {
    console.error('Erro ao adicionar produto:', error);
    showToast(error.message || 'Nao foi possivel adicionar o produto.', 'error');
  }
};

const carregarFormularioDeCategorias = () => {
  categoriaSelect.innerHTML = '';
  subcategoriaSelect.innerHTML = '';
  categoriaSelect.appendChild(new Option('Selecione uma categoria', ''));
  subcategoriaSelect.appendChild(new Option('Selecione uma subcategoria', ''));

  categorias.forEach((categoria) => {
    categoriaSelect.appendChild(new Option(categoria.nome, categoria.nome));
  });

  const gerarInputsDeTamanho = (tamanhos) => {
    tamanhosInputs.innerHTML = '';
    tamanhos.forEach((tamanho) => {
      const group = document.createElement('div');
      group.className = 'tamanho-input-group';
      group.innerHTML = `
        <label for="qtd-${tamanho}">${tamanho}</label>
        <input type="number" id="qtd-${tamanho}" name="${tamanho}" value="0" min="0" required>
      `;
      tamanhosInputs.appendChild(group);
    });
    fieldsetTamanhos.style.display = 'block';
  };

  const toggleTamanhosVisibility = () => {
    const categoriaSelecionada = categoriaSelect.value;
    const subcategoriaSelecionada = subcategoriaSelect.value;
    if (categoriaSelecionada && subcategoriaSelecionada) {
      const isCalcado = normalize(categoriaSelecionada) === normalize('Calcados');
      const isTamanhoUnico = isTamanhoUnicoCategoria(categoriaSelecionada);
      const tamanhos = isCalcado
        ? ['33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45']
        : (isTamanhoUnico ? ['Unico'] : ['PP', 'P', 'M', 'G', 'GG']);
      gerarInputsDeTamanho(tamanhos);
    } else {
      fieldsetTamanhos.style.display = 'none';
    }
  };

  categoriaSelect.addEventListener('change', () => {
    const categoriaSelecionada = categoriaSelect.value;
    const categoria = categorias.find((c) => normalize(c.nome) === normalize(categoriaSelecionada));
    subcategoriaSelect.innerHTML = '';
    subcategoriaSelect.appendChild(new Option('Selecione uma subcategoria', ''));
    if (categoria?.subcategorias) {
      Object.keys(categoria.subcategorias).forEach((sub) => {
        subcategoriaSelect.appendChild(new Option(sub, sub));
      });
    }
    toggleTamanhosVisibility();
  });

  subcategoriaSelect.addEventListener('change', toggleTamanhosVisibility);
  fieldsetTamanhos.style.display = 'none';
};

const init = () => {
  renderCategoriaBotoes();
  renderEmptyState();
  carregarFormularioDeCategorias();
};

document.addEventListener('DOMContentLoaded', init);
form.addEventListener('submit', adicionarProduto);
campoBusca.addEventListener('input', realizarBusca);
