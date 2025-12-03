document.addEventListener('DOMContentLoaded', () => {
    // --- 1. VERIFICAÇÃO DE LOGIN ---
    const userCargo = sessionStorage.getItem('userCargo');
    if (!userCargo) {
        window.location.href = './index.html';
        return;
    }

    // --- 2. DADOS DO MENU ---
    const menuItems = [
        { text: 'Início', href: 'menu.html', parent: 'menu' },
        {
            text: 'Caixa',
            href: 'caixa.html',
            parent: 'caixa',
                                    dropdown: [
                { text: 'Registro de Venda', href: 'caixa.html', adminOnly: false },
                { text: 'Sangria', href: 'sangria.html', adminOnly: false },
                { text: 'Suprimento de Caixa', href: 'suprimentos.html', adminOnly: false },
                { text: 'Historico de Caixa', href: 'historico.html', adminOnly: true },
                { text: 'Fechamento de Caixa', href: 'fechamentocaixa.html', adminOnly: false }
            ],
        },
        { text: 'Estoque', href: 'estoque.html', parent: 'estoque' },
        // AQUI ESTÁ A CONFIGURAÇÃO QUE VOCÊ PEDIU:
        // adminOnly: true -> Só aparece se userCargo for 'Administrador'
        { text: 'Cadastro de Funcionarios', href: 'cadastro-funcionarios.html', parent: 'cadastro-funcionarios', adminOnly: true }
    ];

    // --- 3. LÓGICA DE CONSTRUÇÃO DO MENU ---
    const navElement = document.querySelector('nav');
    if (!navElement) return;

    // Normaliza 'gerente' para 'Administrador' para garantir que a lógica funcione
    const cargoNormalizado = (userCargo || '').trim().toLowerCase() === 'gerente' ? 'administrador' : (userCargo || '').trim().toLowerCase();
    const isAdministrador = cargoNormalizado === 'administrador';

    const paginaAtual = window.location.pathname.split('/').pop();
    // Bloqueia relatorios para não administradores, mesmo por acesso direto
    if (paginaAtual === 'relatorios.html' && !isAdministrador) {
        window.location.href = './menu.html';
        return;
    }
    let currentPageParent = '';

    // Descobre qual menu deve ficar destacado (active)
    menuItems.forEach(item => {
        if (item.href === paginaAtual) {
            currentPageParent = item.parent;
        }
        if (item.dropdown) {
            item.dropdown.forEach(subItem => {
                if (subItem.href === paginaAtual) {
                    currentPageParent = item.parent;
                }
            });
        }
    });

    const fixLabel = (t) => {
        if (typeof t !== 'string') return t;
        return t.replace('Início', 'Início').replace('Historico', 'Histórico');
    };

    let menuHTML = `<a href="./menu.html" class="brand-name">Styllo Fashion Modas</a><div class="nav-right"><ul class="navbar-links">`;

    menuItems.forEach(item => {
        // SE FOR APENAS PARA ADMIN E USUÁRIO NÃO FOR ADMIN, PULA ESTE ITEM
        if (item.adminOnly && !isAdministrador) return;

        const liClass = (item.parent === currentPageParent) ? 'active' : '';

        if (item.dropdown) {
            menuHTML += `<li class="dropdown ${liClass}"><a href="./${item.href}" class="dropbtn">${fixLabel(item.text)}</a><div class="dropdown-content">`;
            item.dropdown.forEach(subItem => {
                if (!subItem.adminOnly || isAdministrador) {
                    menuHTML += `<a href="${subItem.href}">${fixLabel(subItem.text)}</a>`;
                }
            });
            menuHTML += `</div></li>`;
        } else {
            menuHTML += `<li class="${liClass}"><a href="./${item.href}">${fixLabel(item.text)}</a></li>`;
        }
    });

    // Adiciona Relatórios apenas para administradores + Sair
    if (isAdministrador) {
        menuHTML += `<li><a href="relatorios.html" id="relatorios-link" class="menu-link">Relatórios</a></li>`;
    }
    menuHTML += `
    </ul>
    <button id="logout-btn-menu" type="button">Sair</button>
    </div>`;

    navElement.innerHTML = menuHTML;

    // Dropdown Logic (Clique para abrir, melhor que hover)
    try {
        if (!window.__sfDropdownInit) {
            window.__sfDropdownInit = true;
            const getDropdowns = () => Array.from(document.querySelectorAll('.dropdown'));
            const closeAll = () => getDropdowns().forEach(d => d.classList.remove('open'));

            document.addEventListener('click', (e) => {
                const ddBtn = e.target.closest('.dropdown > .dropbtn');
                const dd = e.target.closest('.dropdown');
                if (ddBtn && dd) {
                    const alreadyOpen = dd.classList.contains('open');
                    if (alreadyOpen) {
                        // Se clicou no link pai e já estava aberto, navega
                        const href = ddBtn.getAttribute('href');
                        if (href && href !== '#') {
                            window.location.href = href;
                            return;
                        }
                    }
                    e.preventDefault();
                    getDropdowns().forEach(d => { if (d !== dd) d.classList.remove('open'); });
                    dd.classList.toggle('open');
                    return;
                }
                if (!dd) closeAll();
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeAll();
            });
        }
    } catch (_) { }

    const logoutBtn = document.getElementById('logout-btn-menu');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (confirm('Tem certeza que deseja sair?')) {
                sessionStorage.clear();
                window.location.replace('index.html');
            }
        });
    }
});


