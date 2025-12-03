// frontend/cadastro-funcionarios.js

const API_BASE = window.ApiClient ? window.ApiClient.getBaseUrl() : 'http://localhost:3000';

// Bloqueia acesso para nÃ£o administradores
(function enforceAdminOnly() {
    const cargo = (sessionStorage.getItem('userCargo') || '').trim().toLowerCase();
    const isAdmin = cargo === 'administrador' || cargo === 'gerente';
    if (!isAdmin) {
        alert('Apenas gerentes/administradores podem acessar o cadastro de funcionários.');
        try { window.location.replace('menu.html'); } catch (_) { window.location.href = './menu.html'; }
    }
})();

// --- ELEMENTOS ---
const form = document.getElementById('form-cadastro');
const step1 = document.getElementById('step-1');
const step2 = document.getElementById('step-2');
const stepIndicator1 = document.getElementById('step-indicator-1');
const stepIndicator2 = document.getElementById('step-indicator-2');

const nomeInput = document.getElementById('nome');
const cpfInput = document.getElementById('cpf');
const telefoneInput = document.getElementById('telefone');
const emailInput = document.getElementById('email');
const cargoSelect = document.getElementById('cargo');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirm-password');

const btnProximo = document.getElementById('btn-proximo');
const btnVoltar = document.getElementById('btn-voltar');
const btnLimpar = document.getElementById('btn-limpar');
const togglePassBtn = document.getElementById('toggle-pass');
const toggleConfirmPassBtn = document.getElementById('toggle-confirm-pass');

// Preview e Listagem
const prevNome = document.getElementById('prev-nome');
const prevUser = document.getElementById('prev-user');
const prevCpf = document.getElementById('prev-cpf');
const prevCargo = document.getElementById('prev-cargo');
const prevEmail = document.getElementById('prev-email');
const prevTelefone = document.getElementById('prev-telefone');

const tabelaBody = document.querySelector('#tabela-funcionarios tbody');
const totalSpan = document.getElementById('total-funcionarios');
const searchInput = document.getElementById('search-input');
const filterCargo = document.getElementById('filter-cargo');
const statusDiv = document.getElementById('mensagem-status');
const getAuthToken = () => sessionStorage.getItem('authToken') || sessionStorage.getItem('token') || '';

// Paginação
const btnPrevPage = document.getElementById('btn-prev-page');
const btnNextPage = document.getElementById('btn-next-page');
const pageInfoSpan = document.getElementById('page-info');

// VARIÁVEIS GLOBAIS
let isEditing = false;
let editingUsername = null;
let allUsersData = []; // Lista completa vinda do banco
let currentPage = 1;
const ITEMS_PER_PAGE = 3; // Limite por página

// --- 1. MÁSCARAS ---
const masks = {
    cpf(value) {
        return value.replace(/\D/g, '')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d{1,2})/, '$1-$2')
            .replace(/(-\d{2})\d+?$/, '$1');
    },
    phone(value) {
        return value.replace(/\D/g, '')
            .replace(/(\d{2})(\d)/, '($1) $2')
            .replace(/(\d{4,5})(\d{4})/, '$1-$2')
            .replace(/(-\d{4})\d+?$/, '$1');
    }
};

cpfInput.addEventListener('input', (e) => {
    e.target.value = masks.cpf(e.target.value);
    atualizarPreview();
    sincronizarUsuarioComCpf();
});
telefoneInput.addEventListener('input', (e) => {
    e.target.value = masks.phone(e.target.value);
    atualizarPreview();
});
[nomeInput, emailInput, usernameInput].forEach(input => {
    input.addEventListener('input', atualizarPreview);
});

// --- 2. LÓGICA VISUAL ---
function atualizarPreview() {
    prevNome.textContent = nomeInput.value || '-';
    prevCpf.textContent = cpfInput.value || '-';
    prevEmail.textContent = emailInput.value || '-';
    prevTelefone.textContent = telefoneInput.value || '-';
    prevUser.textContent = usernameInput.value || '-';

    const isManager = cargoSelect.value === 'Administrador';
    prevCargo.textContent = isManager ? 'Gerente' : 'Funcionário';
    prevCargo.className = isManager ? 'badge badge-admin' : 'badge badge-func';
}

function toggleVisibility(input, icon) {
    const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
    input.setAttribute('type', type);
    icon.classList.toggle('fa-eye');
    icon.classList.toggle('fa-eye-slash');
}

togglePassBtn.addEventListener('click', () => toggleVisibility(passwordInput, togglePassBtn));
toggleConfirmPassBtn.addEventListener('click', () => toggleVisibility(confirmPasswordInput, toggleConfirmPassBtn));

cargoSelect.addEventListener('change', () => {
    atualizarPreview();
    sincronizarUsuarioComCpf();
});

function sincronizarUsuarioComCpf() {
    const isGerente = cargoSelect.value === 'Administrador';
    const cpfLimpo = cpfInput.value.replace(/\D/g, '');

    if (!isGerente) {
        usernameInput.value = cpfLimpo;
        usernameInput.setAttribute('readonly', true);
        document.getElementById('username-hint').textContent = 'Login travado no CPF para funcionários.';
    } else {
        usernameInput.removeAttribute('readonly');
        document.getElementById('username-hint').textContent = 'Gerentes podem personalizar o login.';
        if (usernameInput.value === cpfLimpo) usernameInput.value = '';
    }
    document.getElementById('prev-user').textContent = usernameInput.value || '-';
}

// --- 3. WIZARD ---
function validarCPF(cpf) {
    cpf = cpf.replace(/[^\d]+/g, '');
    if (cpf == '') return false;
    if (cpf.length != 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    let add = 0;
    for (let i = 0; i < 9; i++) add += parseInt(cpf.charAt(i)) * (10 - i);
    let rev = 11 - (add % 11);
    if (rev == 10 || rev == 11) rev = 0;
    if (rev != parseInt(cpf.charAt(9))) return false;
    add = 0;
    for (let i = 0; i < 10; i++) add += parseInt(cpf.charAt(i)) * (11 - i);
    rev = 11 - (add % 11);
    if (rev == 10 || rev == 11) rev = 0;
    if (rev != parseInt(cpf.charAt(10))) return false;
    return true;
}

btnProximo.addEventListener('click', () => {
    if (!nomeInput.value || !cpfInput.value || !emailInput.value || !telefoneInput.value) {
        mostrarMensagem('Preencha todos os campos da Etapa 1.', 'error');
        return;
    }
    if (!validarCPF(cpfInput.value)) {
        mostrarMensagem('CPF inválido.', 'error');
        cpfInput.focus();
        return;
    }
    step1.classList.add('hidden');
    step2.classList.remove('hidden');
    stepIndicator1.classList.remove('active');
    stepIndicator2.classList.add('active');
    mostrarMensagem('', 'hidden');
    sincronizarUsuarioComCpf();
});

btnVoltar.addEventListener('click', () => {
    step2.classList.add('hidden');
    step1.classList.remove('hidden');
    stepIndicator2.classList.remove('active');
    stepIndicator1.classList.add('active');
});

btnLimpar.addEventListener('click', () => {
    form.reset();
    isEditing = false;
    editingUsername = null;
    sincronizarUsuarioComCpf();
    atualizarPreview();
    btnVoltar.click();
    mostrarMensagem('', 'hidden');
});

function mostrarMensagem(texto, tipo) {
    statusDiv.textContent = texto;
    statusDiv.className = `status-box ${tipo}`;
    if (tipo === 'hidden') statusDiv.classList.add('hidden');
    else statusDiv.classList.remove('hidden');
}

// --- 4. INTEGRAÇÃO E PAGINAÇÃO ---

async function carregarFuncionarios() {
    try {
        const token = getAuthToken();
        if (!token) {
            console.warn("Sem token de autenticação.");
            return;
        }

        const response = await ApiClient.fetch('/api/users', {
            headers: { 'x-auth-token': token }
        });

        if (response.status === 403) {
            mostrarMensagem('Acesso negado: Apenas gerentes podem ver a lista.', 'error');
            allUsersData = [];
            renderizarTabela();
            return;
        }

        if (!response.ok) throw new Error('Erro ao buscar lista.');

        const data = await response.json();

        // CORREÇÃO CRÍTICA: O server antigo retorna { results: [...] }
        // O código agora verifica onde o array está.
        if (Array.isArray(data)) {
            allUsersData = data;
        } else if (data.results && Array.isArray(data.results)) {
            allUsersData = data.results;
        } else {
            allUsersData = [];
        }

        // Se houver dados no database.json, eles aparecerão agora
        console.log("Funcionários carregados:", allUsersData);

        currentPage = 1;
        renderizarTabela();

    } catch (error) {
        console.error(error);
        renderizarTabela(); // Renderiza vazio
    }
}

function renderizarTabela() {
    tabelaBody.innerHTML = '';

    const termo = searchInput.value.toLowerCase();
    const filtroPerfil = filterCargo.value;

    const filtrados = allUsersData.filter(user => {
        const matchTexto =
            (user.nomeCompleto || '').toLowerCase().includes(termo) ||
            (user.username || '').toLowerCase().includes(termo) ||
            (user.cpf || '').includes(termo);

        const cargoUser = user.cargo || 'Funcionario';
        let matchPerfil = true;
        if (filtroPerfil === 'Administrador') {
            matchPerfil = cargoUser === 'Administrador' || cargoUser === 'Gerente';
        } else if (filtroPerfil === 'Funcionario') {
            matchPerfil = cargoUser === 'Funcionario';
        }

        return matchTexto && matchPerfil;
    });

    document.getElementById('total-funcionarios').textContent = filtrados.length;

    // Paginação
    const totalPages = Math.ceil(filtrados.length / ITEMS_PER_PAGE) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const pageData = filtrados.slice(startIndex, endIndex);

    pageData.forEach(user => {
        const tr = document.createElement('tr');
        const isAdmin = user.cargo === 'Administrador' || user.cargo === 'Gerente';

        tr.innerHTML = `
            <td class="user-cell">
                <div style="font-weight:bold; font-size:1rem;">${user.nomeCompleto || user.username}</div>
                <span class="${isAdmin ? 'badge-admin' : 'badge-func'} badge badge-mini">
                    ${isAdmin ? 'Gerente' : 'Func.'}
                </span>
                <small style="color:#888; margin-left:5px;">${user.username}</small>
            </td>
            <td style="text-align:right;">
                <button class="btn-icon btn-edit" onclick="editarUsuario('${user.username}')" title="Editar">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn-icon btn-delete" onclick="excluirUsuario('${user.username}')" title="Excluir">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tabelaBody.appendChild(tr);
    });

    pageInfoSpan.textContent = `Pág ${currentPage} de ${totalPages}`;
    btnPrevPage.disabled = currentPage === 1;
    btnNextPage.disabled = currentPage === totalPages;
}

btnPrevPage.addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        renderizarTabela();
    }
});
btnNextPage.addEventListener('click', () => {
    // Recalcula para garantir
    const filtrados = allUsersData.length; // Simplificação, ideal filtrar de novo
    renderizarTabela(); // A função renderizar já trata a lógica correta
    if (!btnNextPage.disabled) currentPage++;
    renderizarTabela();
});

searchInput.addEventListener('input', () => { currentPage = 1; renderizarTabela(); });
filterCargo.addEventListener('change', () => { currentPage = 1; renderizarTabela(); });

// --- 5. AÇÕES ---

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (passwordInput.value !== confirmPasswordInput.value) {
        mostrarMensagem('As senhas não coincidem.', 'error');
        return;
    }

    const payload = {
        nomeCompleto: nomeInput.value,
        cpf: cpfInput.value.replace(/\D/g, ''),
        email: emailInput.value,
        telefone: telefoneInput.value.replace(/\D/g, ''),
        cargo: cargoSelect.value,
        username: usernameInput.value,
        password: passwordInput.value
    };

    const token = getAuthToken();

    try {
        let url = '/api/register';
        let method = 'POST';

        if (isEditing) {
            // Se o backend antigo não suportar PUT, talvez precise deletar e recriar.
            // Vamos tentar o PUT, se falhar (404), avisamos.
            url = `/api/users/${editingUsername}`;
            method = 'PUT';
        }

        const response = await ApiClient.fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'x-auth-token': token
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (response.ok) {
            mostrarMensagem(result.message || 'Salvo com sucesso!', 'success');
            btnLimpar.click();
            carregarFuncionarios();
        } else {
            mostrarMensagem(result.message || 'Erro ao salvar.', 'error');
        }
    } catch (error) {
        mostrarMensagem('Erro de conexão.', 'error');
    }
});

window.editarUsuario = (username) => {
    const user = allUsersData.find(u => u.username === username);
    if (!user) return;

    nomeInput.value = user.nomeCompleto || '';
    cpfInput.value = user.cpf ? masks.cpf(user.cpf) : '';
    telefoneInput.value = user.telefone ? masks.phone(user.telefone) : '';
    emailInput.value = user.email || '';

    const isAdmin = user.cargo === 'Administrador' || user.cargo === 'Gerente';
    cargoSelect.value = isAdmin ? 'Administrador' : 'Funcionario';

    usernameInput.value = user.username;
    isEditing = true;
    editingUsername = user.username;

    sincronizarUsuarioComCpf();
    atualizarPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    btnVoltar.click();
    mostrarMensagem(`Editando: ${user.nomeCompleto}`, 'success');
};

window.excluirUsuario = async (username) => {
    if (!confirm(`Excluir ${username}?`)) return;
    const token = getAuthToken();
    try {
        const response = await ApiClient.fetch(`/api/users/${username}`, {
            method: 'DELETE',
            headers: { 'x-auth-token': token }
        });
        if (response.ok) {
            mostrarMensagem('Usuário excluído.', 'success');
            carregarFuncionarios();
        } else {
            mostrarMensagem('Erro ao excluir.', 'error');
        }
    } catch (e) { mostrarMensagem('Erro de conexão.', 'error'); }
};

document.addEventListener('DOMContentLoaded', () => {
    carregarFuncionarios();
    atualizarPreview();
});
