/* global ApiClient, showToast */
document.addEventListener('DOMContentLoaded', () => {
  // Helpers
  const token = () => sessionStorage.getItem('authToken') || '';
  const currentUser = () => sessionStorage.getItem('username') || '';
  const isAdmin = () => String(sessionStorage.getItem('userCargo') || '').trim().toLowerCase() === 'administrador';
  const toJson = async (resp) => { try { return await resp.json(); } catch { return null; } };
  const debounce = (fn, ms = 300) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(null, args), ms); }; };
  const setLoading = (listaId, msg = 'Carregando...') => { const el = document.getElementById(listaId); if (el) el.innerHTML = `<p>${msg}</p>`; };
  const formatMoney = (v) => `R$ ${(Number(v || 0) || 0).toFixed(2)}`;
  const formatDateTime = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('pt-BR'); };
  const safeList = (v) => (Array.isArray(v) ? v : []);
  const api = async (path, options = {}) => { try { await ApiClient.fetch('/status', { cache: 'no-store' }); } catch (_) { } return ApiClient.fetch(path, options); };

  const ensureSearchInput = (sectionId, inputId, placeholder) => {
    const existing = document.getElementById(inputId);
    if (existing) return existing;
    const container = document.querySelector(`#${sectionId} .filters`) || document.getElementById(sectionId);
    if (!container) return null;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = inputId;
    input.placeholder = placeholder;
    container.insertBefore(input, container.querySelector('button') || null);
    return input;
  };

  // Tabs com navegacao shareable
  const tabs = Array.from(document.querySelectorAll('.tab-button'));
  const tabContents = Array.from(document.querySelectorAll('.tab-content'));
  const searchParams = new URLSearchParams(window.location.search);
  const initialTabRaw = searchParams.get('tab') || (window.location.hash || '').replace('#', '');
  const hasDirectTabParam = Boolean(initialTabRaw);
  const validTabIds = new Set(tabContents.map(c => c.id));

  const setUrlTab = (tabId) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tabId);
      window.history.replaceState({}, '', url.toString());
    } catch (_) { /* ignore */ }
  };

  const activateTab = (tabId, updateUrl = false) => {
    if (!validTabIds.has(tabId)) return;
    tabs.forEach((t) => {
      const isActive = t.getAttribute('data-tab') === tabId;
      t.classList.toggle('active', isActive);
    });
    tabContents.forEach((c) => c.classList.toggle('active', c.id === tabId));
    if (updateUrl) setUrlTab(tabId);
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const id = tab.getAttribute('data-tab');
      activateTab(id, true);
    });
  });

  const initialTab = validTabIds.has(initialTabRaw) ? initialTabRaw : 'vendas';
  activateTab(initialTab, false);

  if (hasDirectTabParam && validTabIds.has(initialTab)) {
    tabs.forEach((tab) => {
      if (tab.getAttribute('data-tab') !== initialTab) {
        tab.style.display = 'none';
      }
    });
    tabContents.forEach((section) => {
      if (section.id !== initialTab) {
        section.style.display = 'none';
      }
    });
  }

  // Vendedores
  const setDefaultVendedores = () => {
    document.querySelectorAll('select[id^="filtro-vendedor"]').forEach((s) => {
      if (s) s.innerHTML = '<option value="">Todos os funcionários</option>';
    });
  };
  const setVendedores = (users) => {
    const list = Array.from(new Set((users || []).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
    document.querySelectorAll('select[id^="filtro-vendedor"]').forEach((s) => {
      if (!s) return;
      s.innerHTML = '<option value="">Todos os funcionários</option>';
      list.forEach(u => { s.innerHTML += `<option value="${u}">${u}</option>`; });
    });
  };
  const carregarVendedores = async () => {
    setDefaultVendedores();
    try {
      let resp = await api('/users/usernames', { headers: { 'x-auth-token': token() } });
      if (!resp.ok) resp = await api('/users', { headers: { 'x-auth-token': token() } });
      let data = await toJson(resp);
      if (data && Array.isArray(data.results)) data = data.results.map(u => u && u.username).filter(Boolean);
      if (Array.isArray(data) && data.length && typeof data[0] === 'object') data = data.map(u => u && u.username).filter(Boolean);
      if (Array.isArray(data)) { setVendedores(data); return; }
    } catch (_) { /* tenta fallback */ }
    try {
      const resp = await api('/history/sales-all');
      const vendas = await toJson(resp);
      if (Array.isArray(vendas)) setVendedores(vendas.map(v => v && v.seller).filter(Boolean));
    } catch (_) { }
  };

  // --------------------------------------------------------------------------
  // Historico de Vendas
  // --------------------------------------------------------------------------
  const vendasFilters = {
    vendedor: document.getElementById('filtro-vendedor-vendas'),
    dia: document.getElementById('filtro-dia-vendas'),
    diaAte: document.getElementById('filtro-dia-ate-vendas'),
    produtoId: document.getElementById('filtro-produto-id'),
    produtoNome: document.getElementById('filtro-produto-nome'),
    ordem: document.getElementById('filtro-ordem-vendas'),
    limpar: document.getElementById('limpar-filtros-vendas'),
    exportar: document.getElementById('exportar-vendas-csv'),
    busca: ensureSearchInput('vendas', 'filtro-busca-vendas', 'Buscar por ID da venda, item ou nome do funcionário...')
  };
  const resumoVendasEl = document.getElementById('resumo-vendas');
  const vendasListaEl = document.getElementById('historico-vendas-lista');
  const modal = document.getElementById('modal-devolucao');
  const devSaleIdEl = document.getElementById('dev-sale-id');
  const devItemsEl = document.getElementById('dev-items');
  const devMotivoEl = document.getElementById('dev-motivo');
  const confirmarBtn = document.getElementById('confirmar-devolucao');
  const cancelarBtn = document.getElementById('cancelar-devolucao');
  const fecharBtn = document.getElementById('fechar-modal-devolucao');
  let vendasAtuais = [];

  const cacheSalesForReports = (sales) => {
    const monthMap = new Map();
    const yearMap = new Map();
    safeList(sales).forEach((sale) => {
      const dt = new Date(sale.date);
      if (Number.isNaN(dt.getTime())) return;
      const total = safeList(sale.items).reduce((acc, it) => acc + (Number(it.valor || it.amount || 0) || 0), 0);
      const monthKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      const yearKey = `${dt.getFullYear()}`;
      const bump = (map, key) => {
        if (!map.has(key)) map.set(key, { total: 0, count: 0 });
        const ref = map.get(key);
        ref.total += total;
        ref.count += 1;
      };
      bump(monthMap, monthKey);
      bump(yearMap, yearKey);
    });
    try {
      sessionStorage.setItem('historySalesCache', JSON.stringify({
        updatedAt: Date.now(),
        totalCount: safeList(sales).length,
        byMonth: Array.from(monthMap.entries()).map(([period, stats]) => ({ period, total: stats.total, count: stats.count })),
        byYear: Array.from(yearMap.entries()).map(([period, stats]) => ({ period, total: stats.total, count: stats.count }))
      }));
    } catch (_) { /* storage cheia ou indisponivel */ }
  };

  const closeModal = () => { if (modal) modal.style.display = 'none'; };
  const openModal = () => { if (modal) modal.style.display = 'flex'; };
  const findSaleById = (id) => safeList(vendasAtuais).find(s => String(s.id) === String(id));
  const openRefundModal = (saleId) => {
    const sale = findSaleById(saleId);
    if (!sale || !modal || !devSaleIdEl || !devItemsEl) return;
    devSaleIdEl.textContent = saleId;
    if (devMotivoEl) devMotivoEl.value = '';
    const items = safeList(sale.items);
    devItemsEl.innerHTML = items.map((p, idx) => {
      const price = Number(p.valor || p.amount || 0) || 0;
      const label = `${p.nome || p.name || p.productName || '-'} (ID: ${p.id || p.productId || ''}) - ${formatMoney(price)}`;
      return `<label class="dev-item"><input type="checkbox" data-index="${idx}" checked /> <span>${label}</span></label>`;
    }).join('');
    openModal();
  };
  const renderizarVendas = (vendas) => {
    if (!vendasListaEl) return;
    vendasListaEl.innerHTML = '';
    const arr = safeList(vendas);
    if (!arr.length) {
      vendasListaEl.innerHTML = '<p>Nenhuma venda encontrada.</p>';
      if (resumoVendasEl) resumoVendasEl.textContent = '0 venda(s) - Total R$ 0,00';
      return;
    }
    arr.forEach((venda) => {
      const items = safeList(venda.items);
      const totalVenda = items.reduce((acc, it) => acc + (Number(it.valor || it.amount || 0) || 0), 0);
      const produtosHTML = items.map((p) => {
        const pid = p.id || p.productId || '';
        const nome = p.nome || p.name || p.productName || '-';
        const preco = formatMoney(p.valor || p.amount || 0);
        const devolvido = p.devolvido ? ' class="devolvido"' : '';
        return `<li${devolvido}>${nome} (ID: ${pid}) - ${preco}</li>`;
      }).join('');
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <div class="item-header">
          <span>Venda ID: ${venda.id}</span>
          <span>${formatDateTime(venda.date)}</span>
        </div>
        <div class="item-details">
          <span><b>Funcionário:</b> ${venda.seller || '-'}</span>
          <span><b>Total:</b> ${formatMoney(totalVenda)}</span>
          ${venda.paymentMethod || venda.metodoPagamento ? `<span><b>Pagamento:</b> ${venda.paymentMethod || venda.metodoPagamento}</span>` : ''}
          <div><b>Itens vendidos:</b><ul class="product-list">${produtosHTML}</ul></div>
        </div>
        ${isAdmin() ? `
          <div class="item-actions">
            <button class="btn-devolver btn-primary" data-sale-id="${venda.id}">Devolucao</button>
            <button class="btn-excluir-venda btn-danger" data-sale-id="${venda.id}">Excluir venda</button>
          </div>` : ''}
      `;
      vendasListaEl.appendChild(div);
    });
    if (resumoVendasEl) {
      const total = arr.reduce((acc, v) => acc + safeList(v.items).reduce((s, it) => s + (Number(it.valor || it.amount || 0) || 0), 0), 0);
      resumoVendasEl.textContent = `${arr.length} venda(s) - Total ${formatMoney(total)}`;
    }
  };

  const excluirVenda = async (saleId) => {
    if (!confirm('Excluir esta venda?')) return;
    try {
      let resp = await api(`/sales/${saleId}`, { method: 'DELETE', headers: { 'x-auth-token': token() } });
      if (!resp.ok) resp = await api(`/sales/${saleId}/delete`, { method: 'POST', headers: { 'x-auth-token': token() } });
      if (!resp.ok) throw new Error('Falha ao excluir');
      try { showToast('Venda excluída com sucesso!'); } catch (_) { }
      await buscarHistoricoVendas();
      try { await buscarHistoricoDevolucoes(); } catch (_) { }
    } catch (e) {
      console.error('Erro ao excluir venda:', e);
      try { showToast('Não foi possivel excluir a venda.', 'error'); } catch (_) { }
    }
  };

  const processarDevolucao = async () => {
    const saleId = devSaleIdEl ? devSaleIdEl.textContent : '';
    const sale = findSaleById(saleId);
    if (!sale) { closeModal(); return; }
    const items = safeList(sale.items);
    const checks = Array.from(devItemsEl.querySelectorAll('input[type="checkbox"][data-index]'));
    const selecionados = checks
      .filter(ch => ch.checked)
      .map(ch => {
        const i = parseInt(ch.getAttribute('data-index') || '-1', 10);
        const p = items[i];
        return p ? {
          productId: p.id || p.productId || '',
          productName: p.nome || p.name || p.productName || '',
          amount: Number(p.valor || p.amount || 0) || 0,
          quantity: Number(p.quantity || p.quantidade || 1) || 1
        } : null;
      })
      .filter(Boolean);
    if (!selecionados.length) {
      try { showToast('Selecione ao menos um item para devolver.', 'error'); } catch (_) { alert('Selecione ao menos um item.'); }
      return;
    }
    const amount = selecionados.reduce((acc, it) => acc + (Number(it.amount || 0) || 0), 0);
    const payload = { saleId, amount, user: currentUser(), reason: (devMotivoEl?.value || '').trim(), items: selecionados };
    try {
      const resp = await api('/refunds', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': token() }, body: JSON.stringify(payload) });
      if (!resp.ok) throw new Error('Falha ao registrar devolução');
      try { showToast('Devolução registrada com sucesso!'); } catch (_) { }
      closeModal();
      await buscarHistoricoVendas();
      try { await buscarHistoricoDevolucoes(); } catch (_) { }
    } catch (e) {
      console.error('Erro ao registrar devolução:', e);
      try { showToast('Não foi possivel registrar a devolução.', 'error'); } catch (_) { }
    }
  };

  if (fecharBtn) fecharBtn.addEventListener('click', closeModal);
  if (cancelarBtn) cancelarBtn.addEventListener('click', closeModal);
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  if (confirmarBtn) confirmarBtn.addEventListener('click', processarDevolucao);
  if (vendasListaEl) {
    vendasListaEl.addEventListener('click', (ev) => {
      const btnDev = ev.target.closest('.btn-devolver');
      const btnExc = ev.target.closest('.btn-excluir-venda');
      if (btnDev) openRefundModal(btnDev.getAttribute('data-sale-id'));
      else if (btnExc) excluirVenda(btnExc.getAttribute('data-sale-id'));
    });
  }

  const buscarHistoricoVendas = async () => {
    setLoading('historico-vendas-lista');
    const vendedor = vendasFilters.vendedor?.value || '';
    const dia = vendasFilters.dia?.value || '';
    const diaAte = vendasFilters.diaAte?.value || '';
    const produtoId = vendasFilters.produtoId?.value || '';
    const produtoNome = vendasFilters.produtoNome?.value || '';
    const ordem = vendasFilters.ordem?.value || 'date_desc';
    const buscaLivre = (vendasFilters.busca?.value || '').trim().toLowerCase();

    const params = new URLSearchParams();
    if (vendedor) params.set('vendedor', vendedor);
    if (dia) { params.set('from', dia); params.set('to', diaAte || dia); }
    if (produtoId) params.set('produtoId', produtoId);
    if (produtoNome) { params.set('produtoNome', produtoNome); params.set('search', produtoNome); }
    if (ordem) params.set('sort', ordem);

    try {
      let vendas = [];
      try {
        const resp = await api(`/history/sales-all?${params.toString()}`, { cache: 'no-store' });
        const data = await toJson(resp);
        if (!resp.ok) throw new Error('fallback');
        vendas = Array.isArray(data) ? data : [];
      } catch (_) {
        let resp = await api(`/sales?${params.toString()}`, { headers: { 'x-auth-token': token() }, cache: 'no-store' });
        if (!resp.ok) throw new Error('Falha ao buscar vendas');
        const data = await toJson(resp);
        vendas = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
      }
      if (buscaLivre) {
        vendas = vendas.filter((sale) => {
          const term = buscaLivre;
          const idMatch = String(sale.id || '').toLowerCase().includes(term);
          const sellerMatch = String(sale.seller || '').toLowerCase().includes(term);
          const itemMatch = safeList(sale.items).some((it) => {
            return String(it.id || it.codigo || '').toLowerCase().includes(term) ||
              String(it.nome || it.name || it.productName || '').toLowerCase().includes(term);
          });
          return idMatch || sellerMatch || itemMatch;
        });
      }
      vendasAtuais = vendas;
      cacheSalesForReports(vendas);
      renderizarVendas(vendas);
    } catch (e) {
      console.error(e);
      vendasAtuais = [];
      renderizarVendas([]);
    }
  };

  if (vendasFilters.vendedor) vendasFilters.vendedor.addEventListener('change', buscarHistoricoVendas);
  if (vendasFilters.dia) vendasFilters.dia.addEventListener('change', buscarHistoricoVendas);
  if (vendasFilters.diaAte) vendasFilters.diaAte.addEventListener('change', buscarHistoricoVendas);
  if (vendasFilters.produtoId) vendasFilters.produtoId.addEventListener('input', debounce(buscarHistoricoVendas));
  if (vendasFilters.produtoNome) vendasFilters.produtoNome.addEventListener('input', debounce(buscarHistoricoVendas));
  if (vendasFilters.ordem) vendasFilters.ordem.addEventListener('change', buscarHistoricoVendas);
  if (vendasFilters.busca) vendasFilters.busca.addEventListener('input', debounce(buscarHistoricoVendas));
  if (vendasFilters.limpar) vendasFilters.limpar.addEventListener('click', () => {
    if (vendasFilters.vendedor) vendasFilters.vendedor.value = '';
    if (vendasFilters.dia) vendasFilters.dia.value = '';
    if (vendasFilters.diaAte) vendasFilters.diaAte.value = '';
    if (vendasFilters.produtoId) vendasFilters.produtoId.value = '';
    if (vendasFilters.produtoNome) vendasFilters.produtoNome.value = '';
    if (vendasFilters.ordem) vendasFilters.ordem.value = 'date_desc';
    if (vendasFilters.busca) vendasFilters.busca.value = '';
    buscarHistoricoVendas();
  });
  if (vendasFilters.exportar) vendasFilters.exportar.addEventListener('click', () => {
    const arr = safeList(vendasAtuais);
    const rows = [['id', 'date', 'seller', 'total', 'itemsCount']];
    arr.forEach((s) => {
      const items = safeList(s.items);
      const total = items.reduce((acc, it) => acc + (Number(it.valor || it.amount || 0) || 0), 0);
      rows.push([s.id, s.date, s.seller || '', total.toFixed(2), items.length]);
    });
    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'vendas.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  });

  // --------------------------------------------------------------------------
  // Historico de Sangria e Suprimentos
  // --------------------------------------------------------------------------
  let sangriasAtuais = [];
  let suprimentosAtuais = [];
  const renderTransacoes = (listaId, items) => {
    const lista = document.getElementById(listaId);
    if (!lista) return;
    lista.innerHTML = '';
    const arr = safeList(items);
    if (listaId === 'historico-sangrias-lista') sangriasAtuais = arr;
    if (listaId === 'historico-suprimentos-lista') suprimentosAtuais = arr;
    const resumoId = listaId === 'historico-sangrias-lista' ? 'resumo-sangrias' : 'resumo-suprimentos';
    const resumoEl = document.getElementById(resumoId);
    if (resumoEl) {
      const total = arr.reduce((s, t) => s + (Number(t.amount || 0) || 0), 0);
      resumoEl.textContent = `${arr.length} registro(s) - Total ${formatMoney(total)}`;
    }
    if (!arr.length) { lista.innerHTML = '<p>Nenhuma transação encontrada.</p>'; return; }
    arr.forEach(t => {
      const div = document.createElement('div');
      div.className = 'history-item';
      const actions = isAdmin() ? `<button class="btn-excluir-transacao btn-danger" data-id="${t.id}" >Excluir</button>` : '';
      div.innerHTML = `
        <div class="item-header">
          <span>ID: ${t.id}</span>
          <span>${formatDateTime(t.date)}</span>
        </div>
        <div class="item-details">
          <span><b>Funcionário:</b> ${t.user || '-'}</span>
          <span><b>Tipo:</b> ${t.type || '-'}</span>
          <span><b>Valor:</b> ${formatMoney(t.amount)}</span>
          ${t.description || t.reason ? `<div><b>Obs:</b> ${t.description || t.reason}</div>` : ''}
        </div>
        ${actions ? `<div class="item-actions">${actions}</div>` : ''}`;
      lista.appendChild(div);
    });
  };

  const excluirTransacao = async (id, refreshCb) => {
    if (!isAdmin()) { try { showToast('Área restrita a administradores.', 'error'); } catch (_) { } return; }
    if (!confirm('Excluir este registro?')) return;
    try {
      const resp = await api(`/transactions/${id}`, { method: 'DELETE', headers: { 'x-auth-token': token() } });
      if (!resp.ok) throw new Error('Falha ao excluir');
      try { showToast('Registro excluido com sucesso!'); } catch (_) { }
      if (typeof refreshCb === 'function') refreshCb();
    } catch (e) {
      console.error('Erro ao excluir transacao:', e);
      try { showToast('Não foi possivel excluir a transacao.', 'error'); } catch (_) { }
    }
  };
  const excluirSuprimento = async (id, refreshCb) => {
    if (!isAdmin()) { try { showToast('Area restrita a administradores.', 'error'); } catch (_) { } return; }
    if (!confirm('Excluir este suprimento?')) return;
    try {
      let resp = await api(`/suprimentos/${id}`, { method: 'DELETE', headers: { 'x-auth-token': token() } });
      if (!resp.ok) resp = await api(`/transactions/${id}`, { method: 'DELETE', headers: { 'x-auth-token': token() } });
      if (!resp.ok) throw new Error('Falha ao excluir');
      try { showToast('Suprimento excluido com sucesso!'); } catch (_) { }
      if (typeof refreshCb === 'function') refreshCb();
    } catch (e) {
      console.error('Erro ao excluir suprimento:', e);
      try { showToast('Não foi possivel excluir o suprimento.', 'error'); } catch (_) { }
    }
  };

  const buscarTransacoes = async (type, listaId, vendedorSelId, diaId, diaAteId, sortSelId) => {
    const vendedor = document.getElementById(vendedorSelId)?.value || '';
    const dia = document.getElementById(diaId)?.value || '';
    const diaAte = diaAteId ? (document.getElementById(diaAteId)?.value || '') : '';
    const sortVal = sortSelId ? (document.getElementById(sortSelId)?.value || '') : '';
    const params = new URLSearchParams({ type, user: vendedor });
    if (dia) params.set('from', dia);
    if (diaAte || dia) params.set('to', diaAte || dia);
    if (sortVal) params.set('sort', sortVal);
    try {
      setLoading(listaId);
      let results = [];
      try {
        const resp = await api(`/transactions?${params.toString()}`, { headers: { 'x-auth-token': token() }, cache: 'no-store' });
        const data = await toJson(resp);
        if (!resp.ok) throw new Error('fallback');
        results = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
      } catch (_) {
        if (type === 'sangria') {
          const legacy = await api(`/history/sangrias?${params.toString()}`, { headers: { 'x-auth-token': token() }, cache: 'no-store' });
          results = await toJson(legacy) || [];
        } else if (type === 'suprimento') {
          const legacySup = await api('/suprimentos', { headers: { 'x-auth-token': token() }, cache: 'no-store' });
          results = await toJson(legacySup) || [];
          results = results.filter(r => !dia || String(r.date || r.data || '').startsWith(dia));
        }
      }
      renderTransacoes(listaId, results);
    } catch (e) {
      console.error(e);
      renderTransacoes(listaId, []);
    }
  };

  const sangriaV = document.getElementById('filtro-vendedor-sangrias');
  const sangriaD = document.getElementById('filtro-dia-sangrias');
  const sangriaDA = document.getElementById('filtro-dia-ate-sangrias');
  const sangriaL = document.getElementById('limpar-filtros-sangrias');
  if (sangriaV) sangriaV.addEventListener('change', () => buscarTransacoes('sangria', 'historico-sangrias-lista', 'filtro-vendedor-sangrias', 'filtro-dia-sangrias', 'filtro-dia-ate-sangrias', 'ordem-sangrias'));
  if (sangriaD) sangriaD.addEventListener('change', () => buscarTransacoes('sangria', 'historico-sangrias-lista', 'filtro-vendedor-sangrias', 'filtro-dia-sangrias', 'filtro-dia-ate-sangrias', 'ordem-sangrias'));
  if (sangriaDA) sangriaDA.addEventListener('change', () => buscarTransacoes('sangria', 'historico-sangrias-lista', 'filtro-vendedor-sangrias', 'filtro-dia-sangrias', 'filtro-dia-ate-sangrias', 'ordem-sangrias'));
  if (sangriaL) sangriaL.addEventListener('click', () => { if (sangriaV) sangriaV.value = ''; if (sangriaD) sangriaD.value = ''; if (sangriaDA) sangriaDA.value = ''; buscarTransacoes('sangria', 'historico-sangrias-lista', 'filtro-vendedor-sangrias', 'filtro-dia-sangrias', 'filtro-dia-ate-sangrias', 'ordem-sangrias'); });

  const suprV = document.getElementById('filtro-vendedor-suprimentos');
  const suprD = document.getElementById('filtro-dia-suprimentos');
  const suprDA = document.getElementById('filtro-dia-ate-suprimentos');
  const suprL = document.getElementById('limpar-filtros-suprimentos');
  if (suprV) suprV.addEventListener('change', () => buscarTransacoes('suprimento', 'historico-suprimentos-lista', 'filtro-vendedor-suprimentos', 'filtro-dia-suprimentos', 'filtro-dia-ate-suprimentos', 'ordem-suprimentos'));
  if (suprD) suprD.addEventListener('change', () => buscarTransacoes('suprimento', 'historico-suprimentos-lista', 'filtro-vendedor-suprimentos', 'filtro-dia-suprimentos', 'filtro-dia-ate-suprimentos', 'ordem-suprimentos'));
  if (suprDA) suprDA.addEventListener('change', () => buscarTransacoes('suprimento', 'historico-suprimentos-lista', 'filtro-vendedor-suprimentos', 'filtro-dia-suprimentos', 'filtro-dia-ate-suprimentos', 'ordem-suprimentos'));
  if (suprL) suprL.addEventListener('click', () => { if (suprV) suprV.value = ''; if (suprD) suprD.value = ''; if (suprDA) suprDA.value = ''; buscarTransacoes('suprimento', 'historico-suprimentos-lista', 'filtro-vendedor-suprimentos', 'filtro-dia-suprimentos', 'filtro-dia-ate-suprimentos', 'ordem-suprimentos'); });

  const sangriaLista = document.getElementById('historico-sangrias-lista');
  if (sangriaLista) sangriaLista.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-excluir-transacao');
    if (btn) excluirTransacao(btn.getAttribute('data-id'), () => buscarTransacoes('sangria', 'historico-sangrias-lista', 'filtro-vendedor-sangrias', 'filtro-dia-sangrias', 'filtro-dia-ate-sangrias', 'ordem-sangrias'));
  });
  const suprLista = document.getElementById('historico-suprimentos-lista');
  if (suprLista) suprLista.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-excluir-transacao');
    if (btn) excluirSuprimento(btn.getAttribute('data-id'), () => buscarTransacoes('suprimento', 'historico-suprimentos-lista', 'filtro-vendedor-suprimentos', 'filtro-dia-suprimentos', 'filtro-dia-ate-suprimentos', 'ordem-suprimentos'));
  });

  const exportarSangriasBtn = document.getElementById('exportar-sangrias-csv');
  if (exportarSangriasBtn) exportarSangriasBtn.addEventListener('click', () => {
    const arr = safeList(sangriasAtuais);
    const rows = [['id', 'date', 'user', 'type', 'amount']];
    arr.forEach((t) => rows.push([t.id, t.date, t.user || '', t.type || '', Number(t.amount || 0).toFixed(2)]));
    const csv = rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'sangrias.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  });
  const exportarSuprBtn = document.getElementById('exportar-suprimentos-csv');
  if (exportarSuprBtn) exportarSuprBtn.addEventListener('click', () => {
    const arr = safeList(suprimentosAtuais);
    const rows = [['id', 'date', 'user', 'type', 'amount']];
    arr.forEach((t) => rows.push([t.id, t.date, t.user || '', t.type || '', Number(t.amount || 0).toFixed(2)]));
    const csv = rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'suprimentos.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  });

  // --------------------------------------------------------------------------
  // Historico de Devolucoes
  // --------------------------------------------------------------------------
  const devV = document.getElementById('filtro-vendedor-devolucoes');
  const devD = document.getElementById('filtro-dia-devolucoes');
  const devDA = document.getElementById('filtro-dia-ate-devolucoes');
  const devPid = document.getElementById('filtro-produto-id-devolucao');
  const devPnm = document.getElementById('filtro-produto-nome-devolucao');
  const devL = document.getElementById('limpar-filtros-devolucoes');
  const devBusca = ensureSearchInput('devolucoes', 'filtro-busca-devolucoes', 'Buscar por ID da devolucao, venda ou item...');
  let devolucoesAtuais = [];
  const renderDevolucoesList = (items) => {
    const resumoDev = document.getElementById('resumo-devolucoes');
    const totalAmount = safeList(items).reduce((acc, r) => acc + (Number(r.amount || 0) || 0), 0);
    if (resumoDev) resumoDev.textContent = `${(items || []).length} devolucao(oes) - Total ${formatMoney(totalAmount)}`;

    const lista = document.getElementById('historico-devolucoes-lista');
    if (!lista) return;
    lista.innerHTML = '';
    const arr = safeList(items);
    if (!arr.length) { lista.innerHTML = '<p>Nenhuma devolução encontrada.</p>'; return; }
    arr.forEach((r) => {
      const div = document.createElement('div');
      div.className = 'history-item';
      const itemsList = safeList(r.items);
      const itemsHtml = itemsList.map((it) => {
        const pid = it.productId || it.id || '';
        const name = it.productName || it.nome || it.name || '-';
        const amt = Number(it.amount || 0) || 0;
        return `<li>Nome: ${name} (ID: ${pid}) valor: ${formatMoney(amt)}</li>`;
      }).join('');
      div.innerHTML = `
        <div class="item-header">
          <span>Devolução ID: ${r.id}</span>
          <span>${formatDateTime(r.date)}</span>
        </div>
        <div class="item-details">
          <span><b>Funcionário:</b> ${r.user || '-'}</span>
          ${r.saleId ? `<span><b>Venda:</b> ${r.saleId}</span>` : ''}
          <span><b>Total:</b> ${formatMoney(r.amount)}</span>
          <div><b>Motivo:</b> ${r.reason ? String(r.reason) : '-'}</div>
          ${itemsHtml ? `<div><b>Itens:</b><ul class="product-list">${itemsHtml}</ul></div>` : ''}
        </div>`;
      if (isAdmin()) {
        const actions = document.createElement('div');
        actions.className = 'item-actions';
        actions.innerHTML = `<button class="btn-excluir-devolucao btn-danger" data-id="${r.id}">Excluir</button>`;
        div.appendChild(actions);
      }
      lista.appendChild(div);
    });
  };
  const renderDevolucoes = (items) => { devolucoesAtuais = safeList(items); renderDevolucoesList(items); };
  const buscarHistoricoDevolucoes = async () => {
    const params = new URLSearchParams({
      vendedor: devV?.value || '',
      dia: devD?.value || '',
      from: devD?.value || '',
      to: (devDA?.value || devD?.value || ''),
      produtoId: devPid?.value || '',
      produtoNome: devPnm?.value || ''
    });
    const sortDev = document.getElementById('ordem-devolucoes')?.value || '';
    if (sortDev) params.set('sort', sortDev);
    const buscaLivre = (devBusca?.value || '').trim().toLowerCase();
    try {
      setLoading('historico-devolucoes-lista');
      const resp = await api(`/history/devolucoes?${params.toString()}`, { headers: { 'x-auth-token': token() }, cache: 'no-store' });
      let list = await toJson(resp);
      list = Array.isArray(list) ? list : [];
      if (buscaLivre) {
        list = list.filter((r) => {
          const idMatch = String(r.id || '').toLowerCase().includes(buscaLivre) || String(r.saleId || '').toLowerCase().includes(buscaLivre);
          const userMatch = String(r.user || '').toLowerCase().includes(buscaLivre);
          const reasonMatch = String(r.reason || '').toLowerCase().includes(buscaLivre);
          const itemMatch = safeList(r.items).some((it) => {
            return String(it.productId || it.id || '').toLowerCase().includes(buscaLivre) ||
              String(it.productName || it.nome || it.name || '').toLowerCase().includes(buscaLivre);
          });
          return idMatch || userMatch || reasonMatch || itemMatch;
        });
      }
      renderDevolucoes(list);
    } catch (_) { renderDevolucoes([]); }
  };
  if (devV) devV.addEventListener('change', buscarHistoricoDevolucoes);
  if (devD) devD.addEventListener('change', buscarHistoricoDevolucoes);
  if (devDA) devDA.addEventListener('change', buscarHistoricoDevolucoes);
  if (devPid) devPid.addEventListener('input', debounce(buscarHistoricoDevolucoes));
  if (devPnm) devPnm.addEventListener('input', debounce(buscarHistoricoDevolucoes));
  if (devBusca) devBusca.addEventListener('input', debounce(buscarHistoricoDevolucoes));
  if (devL) devL.addEventListener('click', () => { if (devV) devV.value = ''; if (devD) devD.value = ''; if (devDA) devDA.value = ''; if (devPid) devPid.value = ''; if (devPnm) devPnm.value = ''; if (devBusca) devBusca.value = ''; buscarHistoricoDevolucoes(); });
  const exportarDevolucoesBtn = document.getElementById('exportar-devolucoes-csv');
  if (exportarDevolucoesBtn) exportarDevolucoesBtn.addEventListener('click', () => {
    const arr = safeList(devolucoesAtuais);
    const rows = [['id', 'date', 'user', 'saleId', 'total', 'itemsCount']];
    arr.forEach(r => rows.push([r.id, r.date, r.user || '', r.saleId || '', Number(r.amount || 0).toFixed(2), Array.isArray(r.items) ? r.items.length : 0]));
    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'devolucoes.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  });
  const devLista = document.getElementById('historico-devolucoes-lista');
  if (devLista) devLista.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-excluir-devolucao');
    if (btn) excluirDevolucao(btn.getAttribute('data-id'));
  });
  function excluirDevolucao(id) {
    if (!isAdmin()) { try { showToast('Area restrita a administradores.', 'error'); } catch (_) { } return; }
    if (!confirm('Excluir esta devolucao?')) return;
    api(`/refunds/${id}`, { method: 'DELETE', headers: { 'x-auth-token': token() } })
      .then((resp) => { if (!resp.ok) throw new Error('Falha ao excluir'); try { showToast('Devolucao excluida com sucesso!'); } catch (_) { } })
      .then(() => buscarHistoricoDevolucoes())
      .catch((e) => { console.error('Erro ao excluir devolucao:', e); try { showToast('Nao foi possivel excluir a devolucao.', 'error'); } catch (_) { } });
  }

  // --------------------------------------------------------------------------
  // Historico de Fechamentos
  // --------------------------------------------------------------------------
  const fechamentoDia = document.getElementById('filtro-dia-fechamento');
  const fechamentoDiaAte = document.getElementById('filtro-dia-ate-fechamento');
  const fechamentoUser = document.getElementById('filtro-usuario-fechamento');
  const fechamentoLimpar = document.getElementById('limpar-filtros-fechamentos');
  const exportarFechamentosBtn = document.getElementById('exportar-fechamentos-csv');
  const resumoFechamentosEl = document.getElementById('resumo-fechamentos');
  const listaFechamentosEl = document.getElementById('historico-fechamentos-lista');
  let fechamentosAtuais = [];

  const renderFechamentos = (items) => {
    if (!listaFechamentosEl) return;
    const arr = safeList(items);
    listaFechamentosEl.innerHTML = '';
    if (resumoFechamentosEl) resumoFechamentosEl.textContent = `${arr.length} fechamento(s) registrados`;
    if (!arr.length) { listaFechamentosEl.innerHTML = '<p>Nenhum fechamento encontrado.</p>'; return; }
    arr.forEach((f) => {
      const esperado = f.esperado || {};
      const contagem = f.contagem || {};
      const difs = f.diferencas || {};
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <div class="item-header">
          <span>Data: ${f.data || '-'}</span>
          <span>${formatDateTime(f.criadoEm || f.data)}</span>
        </div>
        <div class="item-details">
          <span><b>Funcionário:</b> ${f.usuario || f.user || '-'}</span>
          <span><b>Status:</b> ${f.status || '-'}</span>
          <div><b>Esperado (caixa):</b> ${formatMoney(esperado.esperadoCaixaDinheiro || 0)}</div>
          <div><b>Esperado (geral):</b> ${formatMoney(esperado.esperadoGeral || 0)}</div>
          <div><b>Contagem:</b> Dinheiro ${formatMoney(contagem.dinheiroContado || 0)} | Cartao ${formatMoney(contagem.cartaoContado || 0)}</div>
          <div><b>Diferenças:</b> Dinheiro ${formatMoney(difs.dinheiro || 0)} | Cartao ${formatMoney(difs.cartao || 0)} | Geral ${formatMoney(difs.geral || 0)}</div>
        </div>
      `;
      listaFechamentosEl.appendChild(div);
    });
  };

  const buscarFechamentos = async () => {
    const params = new URLSearchParams();
    if (fechamentoDia?.value) params.set('from', fechamentoDia.value);
    if (fechamentoDiaAte?.value) params.set('to', fechamentoDiaAte.value || fechamentoDia.value);
    if (fechamentoUser?.value) params.set('user', fechamentoUser.value);
    try {
      setLoading('historico-fechamentos-lista');
      const resp = await api(`/history/fechamentos?${params.toString()}`, { headers: { 'x-auth-token': token() }, cache: 'no-store' });
      const data = await toJson(resp);
      const list = Array.isArray(data) ? data : [];
      fechamentosAtuais = list;
      renderFechamentos(list);
    } catch (e) {
      console.error(e);
      renderFechamentos([]);
    }
  };

  if (fechamentoDia) fechamentoDia.addEventListener('change', buscarFechamentos);
  if (fechamentoDiaAte) fechamentoDiaAte.addEventListener('change', buscarFechamentos);
  if (fechamentoUser) fechamentoUser.addEventListener('input', debounce(buscarFechamentos, 300));
  if (fechamentoLimpar) fechamentoLimpar.addEventListener('click', () => {
    if (fechamentoDia) fechamentoDia.value = '';
    if (fechamentoDiaAte) fechamentoDiaAte.value = '';
    if (fechamentoUser) fechamentoUser.value = '';
    buscarFechamentos();
  });

  if (exportarFechamentosBtn) exportarFechamentosBtn.addEventListener('click', () => {
    const arr = safeList(fechamentosAtuais);
    const rows = [['data', 'usuario', 'status', 'esperadoCaixa', 'esperadoGeral', 'dinheiroContado', 'cartaoContado', 'difDinheiro', 'difCartao', 'difGeral']];
    arr.forEach((f) => {
      const esperado = f.esperado || {};
      const contagem = f.contagem || {};
      const difs = f.diferencas || {};
      rows.push([
        f.data || '',
        f.usuario || '',
        f.status || '',
        (Number(esperado.esperadoCaixaDinheiro || 0) || 0).toFixed(2),
        (Number(esperado.esperadoGeral || 0) || 0).toFixed(2),
        (Number(contagem.dinheiroContado || 0) || 0).toFixed(2),
        (Number(contagem.cartaoContado || 0) || 0).toFixed(2),
        (Number(difs.dinheiro || 0) || 0).toFixed(2),
        (Number(difs.cartao || 0) || 0).toFixed(2),
        (Number(difs.geral || 0) || 0).toFixed(2),
      ]);
    });
    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'fechamentos.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  });

  // Inicializacao
  carregarVendedores();
  buscarHistoricoVendas();
  buscarTransacoes('sangria', 'historico-sangrias-lista', 'filtro-vendedor-sangrias', 'filtro-dia-sangrias', 'filtro-dia-ate-sangrias', 'ordem-sangrias');
  buscarTransacoes('suprimento', 'historico-suprimentos-lista', 'filtro-vendedor-suprimentos', 'filtro-dia-suprimentos', 'filtro-dia-ate-suprimentos', 'ordem-suprimentos');
  buscarHistoricoDevolucoes();
  buscarFechamentos();
});

