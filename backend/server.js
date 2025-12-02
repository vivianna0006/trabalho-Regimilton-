// Clean Server for Styllo Fashion (UTF-8)
const express = require('express');
const bcrypt = require('bcrypt');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;
const activeSessions = new Map();

const USERS_DB_PATH = path.join(__dirname, 'database.json');
const PRODUCTS_DB_FILE = path.join(__dirname, 'estoque.json');
const SALES_DB_FILE = path.join(__dirname, 'sales.json');
const TRANSACTIONS_DB_FILE = path.join(__dirname, 'cash_transactions.json');
const SUPRIMENTOS_DB_FILE = path.join(__dirname, 'suprimentos.json');
const DEVOLUCOES_DB_FILE = path.join(__dirname, 'devolucoes.json');
const FECHAMENTO_DB_FILE = path.join(__dirname, 'fechamentohistorico.json');

app.use(cors());
app.use(express.json());

const readData = (filePath) => {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
};
const writeData = (filePath, data) => { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); };

const normalizeText = (v) => typeof v === 'string' ? v.trim() : '';
const lowercaseText = (v) => normalizeText(v).toLowerCase();
const digitsOnly = (v) => normalizeText(v).replace(/[^0-9]/g, '');

const MIN_USERNAME_LENGTH = 3;
const MIN_PASSWORD_LENGTH = 6;
const isStrongPassword = (pwd) => {
  const str = typeof pwd === 'string' ? pwd.trim() : '';
  if (str.length < MIN_PASSWORD_LENGTH || str.length > 64) return false;
  // Aceita s? letras, s? n?meros ou combina??es; rejeita caracteres especiais
  return /^[A-Za-z0-9]+$/.test(str);
};

// (helpers removidos por solicita��o de revers�o)

const canonicalCargo = (value) => {
  const n = lowercaseText(value);
  if (!n) return '';
  if (['administrador', 'gerente'].includes(n)) return 'Administrador';
  if (['funcionario', 'funcionarios', 'colaborador', 'colaboradores'].includes(n)) return 'Funcionario';
  return '';
};

const isValidEmail = (value) => {
  const email = lowercaseText(value);
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const isValidPhone = (digits) => {
  const d = digitsOnly(digits);
  return d.length === 10 || d.length === 11;
};

// CPF validator (check digits)
const isValidCPF = (value) => {
  const s = digitsOnly(value);
  if (s.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(s)) return false;
  const calc = (base) => {
    let sum = 0; let weight = base.length + 1;
    for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (weight - i);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  const d1 = calc(s.slice(0, 9));
  const d2 = calc(s.slice(0, 10));
  return d1 === Number(s[9]) && d2 === Number(s[10]);
};

// Sessions + helpers reutiliz�veis
const getSession = (req) => {
  const bearer = (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
  const token = req.header('x-auth-token') || bearer;
  return token ? activeSessions.get(token) : null;
};

const readClosings = () => {
  try {
    const raw = fs.readFileSync(FECHAMENTO_DB_FILE, 'utf8').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
};
const writeClosings = (list) => writeData(FECHAMENTO_DB_FILE, Array.isArray(list) ? list : []);
const getLastClosingDate = () => {
  const closings = readClosings();
  if (!Array.isArray(closings) || !closings.length) return null;
  const ordered = closings
    .map((c) => new Date(c.criadoEm || c.data || c.date || 0))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => b - a);
  return ordered[0] || null;
};

const toDayKey = (value) => {
  if (!value && value !== 0) return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const safeNumber = (v) => Number(v) || 0;
const readSuprimentosFile = () => {
  try { return readData(SUPRIMENTOS_DB_FILE) || []; } catch (_) { return []; }
};
const writeSuprimentosFile = (suprimentos) => {
  writeData(SUPRIMENTOS_DB_FILE, Array.isArray(suprimentos) ? suprimentos : []);
};
const removerSuprimentoPorId = (id) => {
  const idStr = String(id ?? '').trim();
  if (!idStr) return false;
  const suprimentos = readSuprimentosFile();
  const filtrado = Array.isArray(suprimentos) ? suprimentos.filter((s) => String(s.id ?? '').trim() !== idStr) : [];
  const alterou = filtrado.length !== suprimentos.length;
  if (alterou) writeSuprimentosFile(filtrado);
  return alterou;
};

const removeSuprimentoDaBase = (target) => {
  if (!target) return;
  const lista = readSuprimentosFile();
  if (!Array.isArray(lista) || !lista.length) return;
  const idx = lista.findIndex((s) => {
    if (target.id != null && String(s.id) === String(target.id)) return true;
    const amountMatch = Math.abs(safeNumber(s.amount ?? s.valor) - safeNumber(target.amount)) < 0.0001;
    const dateMatch = toDayKey(s.date || s.data) && toDayKey(target.date || target.data) && toDayKey(s.date || s.data) === toDayKey(target.date || target.data);
    const userMatch = lowercaseText(s.user) === lowercaseText(target.user);
    return amountMatch && dateMatch && userMatch;
  });
  if (idx >= 0) {
    lista.splice(idx, 1);
    writeSuprimentosFile(lista);
  }
};
const normalizeSuprimento = (raw = {}) => {
  const amount = Math.abs(safeNumber(raw.amount ?? raw.valor ?? raw.total ?? raw.value));
  if (!amount) return null;
  const date = raw.date || raw.data || raw.createdAt || new Date().toISOString();
  const user = normalizeText(raw.user || raw.usuario || raw.vendedor || raw.seller || '');
  const description = normalizeText(raw.description || raw.descricao || raw.reason || raw.motivo || raw.obs || '');
  const id = raw.id || raw._id || raw.timestamp || null;
  return { id, amount, date, user, description };
};
const mergeSuprimentos = (transactionsOverride) => {
  const transactions = Array.isArray(transactionsOverride) ? transactionsOverride : (readData(TRANSACTIONS_DB_FILE) || []);
  const suprimentosArquivo = readSuprimentosFile();
  const map = new Map();

  const addEntry = (raw) => {
    const normalized = normalizeSuprimento(raw);
    if (!normalized) return;
    const dateKey = normalized.date ? String(normalized.date) : (toDayKey(normalized.date) || '');
    const key = normalized.id
      ? `id:${normalized.id}`
      : `k:${dateKey}|${normalized.amount.toFixed(2)}|${lowercaseText(normalized.user)}|${lowercaseText(normalized.description)}`;
    if (!map.has(key)) map.set(key, normalized);
  };

  transactions.filter((t) => lowercaseText(t.type) === 'suprimento').forEach(addEntry);
  suprimentosArquivo.forEach(addEntry);

  return Array.from(map.values()).sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
};
const registrarSuprimento = ({ amount, user, description, date }) => {
  const valor = Math.abs(safeNumber(amount));
  if (!valor) throw new Error('O valor do suprimento � inv�lido.');
  const usuario = normalizeText(user || '');
  if (!usuario) throw new Error('Usu�rio do suprimento n�o informado.');
  const parsedDate = date ? new Date(date) : new Date();
  const agora = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
  const entrada = {
    id: Date.now(),
    amount: valor,
    user: usuario,
    description: normalizeText(description || ''),
    date: agora.toISOString()
  };

  const transactions = readData(TRANSACTIONS_DB_FILE) || [];
  transactions.push({
    id: entrada.id,
    type: 'suprimento',
    amount: entrada.amount,
    user: entrada.user,
    date: entrada.date,
    description: entrada.description || null,
    reason: entrada.description || null
  });
  writeData(TRANSACTIONS_DB_FILE, transactions);

  const suprimentos = readSuprimentosFile();
  suprimentos.push({
    id: entrada.id,
    descricao: entrada.description || null,
    description: entrada.description || null,
    valor: entrada.amount,
    amount: entrada.amount,
    user: entrada.user,
    data: entrada.date,
    date: entrada.date
  });
  writeSuprimentosFile(suprimentos);

  return entrada;
};
const readSuprimentos = (transactionsOverride) => mergeSuprimentos(transactionsOverride);

async function calcularResumoDia(targetDate) {
  const dia = toDayKey(targetDate || new Date());
  if (!dia) throw new Error('Data invalida para resumo.');

  const sales = readData(SALES_DB_FILE) || [];
  const transactions = readData(TRANSACTIONS_DB_FILE) || [];
  const suprimentosUnificados = readSuprimentos(transactions);
  const devolucoes = readDevolucoes() || [];
  const fechamentos = readClosings();

  const ultimoFechamento = fechamentos
    .filter((f) => toDayKey(f.data) === dia)
    .sort((a, b) => new Date(b.criadoEm || b.data || 0) - new Date(a.criadoEm || a.data || 0))[0];
  const corte = ultimoFechamento ? new Date(ultimoFechamento.criadoEm || ultimoFechamento.data) : null;

  let vendasDinheiro = 0;
  let vendasCartao = 0;
  let trocoCartaoPix = 0;
  const saleMap = new Map();

  sales
    .filter((s) => toDayKey(s.date) === dia && (!corte || new Date(s.date) > corte))
    .forEach((sale) => {
      const total = (Array.isArray(sale.items) ? sale.items : []).reduce((acc, it) => acc + (Number(it.valor || 0) || 0), 0);
      const metodo = lowercaseText(sale.paymentMethod || sale.formaPagamento || sale.metodoPagamento || sale.payment || sale.pagamento || sale.metodo || '');
      const isPix = metodo.includes('pix');
      const isCartao = ['cart', 'cred', 'deb'].some((needle) => metodo.includes(needle));
      const isDigital = isCartao || isPix;
      const recebido = safeNumber(sale.receivedAmount || sale.valorRecebido || sale.recebido || 0);
      const valorCartao = isDigital ? (recebido > 0 ? recebido : total) : 0;
      const trocoDigital = Math.max(0, safeNumber(sale.changeGiven || sale.troco || sale.trocoEntregue || 0));

      if (isDigital) {
        vendasCartao += valorCartao;
        trocoCartaoPix += trocoDigital;
      } else {
        vendasDinheiro += total;
      }

      if (sale.id || sale.saleId) saleMap.set(String(sale.id || sale.saleId), { total, isCartao: isDigital });
    });

  const suprimentos = suprimentosUnificados
    .filter((t) => toDayKey(t.date) === dia && (!corte || new Date(t.date) > corte))
    .reduce((acc, t) => acc + Math.abs(safeNumber(t.amount)), 0);

  const sangrias = transactions
    .filter((t) => toDayKey(t.date) === dia && (!corte || new Date(t.date) > corte) && lowercaseText(t.type) === 'sangria')
    .reduce((acc, t) => acc + Math.abs(safeNumber(t.amount)), 0);

  let devolucoesDinheiro = 0;
  let devolucoesCartao = 0;
  devolucoes
    .filter((d) => toDayKey(d.date) === dia && (!corte || new Date(d.date) > corte))
    .forEach((d) => {
      const valor = safeNumber(d.amount) || (Array.isArray(d.items) ? d.items.reduce((s, it) => s + safeNumber(it.amount || it.valor), 0) : 0);
      if (!valor) return;
      const sale = d.saleId ? saleMap.get(String(d.saleId)) : null;
      const isCartao = sale ? sale.isCartao : false; // se desconhecido, assume dinheiro
      if (isCartao) devolucoesCartao += valor; else devolucoesDinheiro += valor;
    });
  const devolucoesDia = devolucoesDinheiro + devolucoesCartao;

  const vendasDinheiroLiquidas = vendasDinheiro - devolucoesDinheiro;
  const vendasCartaoLiquido = vendasCartao - devolucoesCartao;
  const esperadoCaixaDinheiro = suprimentos + vendasDinheiroLiquidas - sangrias - trocoCartaoPix;
  const esperadoGeral = esperadoCaixaDinheiro + vendasCartaoLiquido;

  return {
    date: dia,
    suprimentos,
    vendasDinheiro,
    vendasCartao: vendasCartaoLiquido,
    sangrias,
    trocoCartaoPix,
    devolucoes: devolucoesDia,
    devolucoesDinheiro,
    devolucoesCartao,
    esperadoCaixaDinheiro,
    esperadoGeral,
    corte: corte ? corte.toISOString() : null
  };
}
app.get('/api/status', (req, res) => {
  try {
    const users = readData(USERS_DB_PATH);
    const hasManager = users.some(u => canonicalCargo(u.cargo) === 'Administrador');
    res.status(200).json({ usersExist: hasManager });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
});

// Helpers: devolu��es file
const readDevolucoes = () => {
  try { return JSON.parse(fs.readFileSync(DEVOLUCOES_DB_FILE, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
};
const writeDevolucoes = (list) => {
  writeData(DEVOLUCOES_DB_FILE, Array.isArray(list) ? list : []);
};

// USERS: Return all usernames (authenticated, any role)
app.get('/api/users/usernames', (req, res) => {
  try {
    const authToken = req.header('x-auth-token');
    const session = authToken ? activeSessions.get(authToken) : null;
    if (!session) return res.status(401).json({ message: 'Token de acesso inv�lido ou expirado.' });

    const users = readData(USERS_DB_PATH) || [];
    const usernames = users
      .map((u) => (u && typeof u.username === 'string') ? u.username : null)
      .filter(Boolean)
      .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
    res.status(200).json(usernames);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao listar usu�rios.' });
  }
});

// HISTORY: Robust sales reader (tolerates concatenated JSON arrays)
app.get('/api/history/sales-all', (req, res) => {
  try {
    // Normalize file on read to keep it tidy
    try { normalizeSalesFile(); } catch (_) { }
    const { vendedor, seller, dia, from, to, produtoId, produtoNome, search, sort } = req.query || {};
    const raw = fs.readFileSync(SALES_DB_FILE, 'utf8');
    let sales = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) sales = parsed;
    } catch (_) {
      const regex = /\[[\s\S]*?\]/g;
      let m;
      while ((m = regex.exec(raw)) !== null) {
        try {
          const part = JSON.parse(m[0]);
          if (Array.isArray(part)) sales.push(...part);
        } catch { }
      }
    }

    const sellerFilter = String(seller || vendedor || '').trim().toLowerCase();
    const day = String(dia || '').trim();
    const fromStr = String(from || '').trim();
    const toStr = String(to || '').trim();
    const pid = String(produtoId || '').trim().toLowerCase();
    const pname = String(produtoNome || '').trim().toLowerCase();
    const q = String(search || '').trim().toLowerCase();

    const parseDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; };
    const fromDate = parseDate(fromStr);
    const toDate = parseDate(toStr);

    const filtered = sales.filter((sale) => {
      try {
        const sDate = new Date(sale.date);
        if (sellerFilter && String(sale.seller || '').toLowerCase() !== sellerFilter) return false;
        if (day && !String(sale.date || '').startsWith(day)) return false;
        if (fromDate && sDate < fromDate) return false;
        if (toDate && sDate > toDate) return false;
        if (pid) {
          const items = Array.isArray(sale.items) ? sale.items : [];
          const hasId = items.some((it) => String(it.id || it.codigo || '').toLowerCase().includes(pid));
          if (!hasId) return false;
        }
        if (pname) {
          const items = Array.isArray(sale.items) ? sale.items : [];
          const hasName = items.some((it) => String(it.nome || it.name || '').toLowerCase().includes(pname));
          if (!hasName) return false;
        }
        if (q) {
          const sellerMatch = String(sale.seller || '').toLowerCase().includes(q);
          const items = Array.isArray(sale.items) ? sale.items : [];
          const itemMatch = items.some((it) => {
            const idv = String(it.id || it.codigo || '').toLowerCase();
            const nm = String(it.nome || it.name || '').toLowerCase();
            const ds = String(it.descricao || it.desc || '').toLowerCase();
            return idv.includes(q) || nm.includes(q) || ds.includes(q);
          });
          if (!(sellerMatch || itemMatch)) return false;
        }
        return true;
      } catch { return false; }
    });

    const computeTotal = (sale) => {
      const items = Array.isArray(sale.items) ? sale.items : [];
      return items.reduce((acc, it) => acc + (Number(it.valor || 0) || 0), 0);
    };

    const key = String(sort || 'date_desc');
    const sorted = filtered.slice().sort((a, b) => {
      if (key === 'date_asc') return (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0);
      if (key === 'total_desc') return (computeTotal(b) || 0) - (computeTotal(a) || 0);
      if (key === 'total_asc') return (computeTotal(a) || 0) - (computeTotal(b) || 0);
      return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
    });

    res.status(200).json(sorted);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao ler hist�rico de vendas.' });
  }
});

// Helper: normalize sales.json into a single JSON array
function normalizeSalesFile() {
  const raw = fs.readFileSync(SALES_DB_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return; // already fine
  } catch (_) { }
  const regex = /\[[\s\S]*?\]/g;
  let m; const merged = [];
  while ((m = regex.exec(raw)) !== null) {
    try {
      const part = JSON.parse(m[0]);
      if (Array.isArray(part)) merged.push(...part);
    } catch { }
  }
  writeData(SALES_DB_FILE, merged);
}

// REGISTER
app.post('/api/register', async (req, res) => {
  try {
    const body = req.body || {};
    let rawUsername = normalizeText(body.username);
    const passwordRaw = typeof body.password === 'string' ? body.password.trim() : '';
    const desiredCargo = canonicalCargo(body.cargo);
    const nomeCompleto = normalizeText(body.nomeCompleto || body.nome || body.fullName);
    const cpfDigits = digitsOnly(body.cpf);
    const email = lowercaseText(body.email);
    const telefoneDigits = digitsOnly(body.telefone || body.phone || body.telefoneCelular);

    if (!rawUsername || rawUsername.length < MIN_USERNAME_LENGTH)
      return res.status(400).json({ message: `Informe um usuario com pelo menos ${MIN_USERNAME_LENGTH} caracteres.` });
    if (!passwordRaw || passwordRaw.length < MIN_PASSWORD_LENGTH)
      return res.status(400).json({ message: `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` });
    if (!isStrongPassword(passwordRaw))
      return res.status(400).json({ message: 'A senha deve usar apenas letras e/ou numeros (sem simbolos) e ter ate 64 caracteres.' });

    const users = readData(USERS_DB_PATH);
    const isFirstUser = users.length === 0;
    const cargoBase = isFirstUser ? 'Administrador' : (desiredCargo || 'Funcionario');
    const cargoNorm = canonicalCargo(cargoBase);
    if (!cargoNorm) return res.status(400).json({ message: 'Cargo invalido. Use Administrador ou Funcionario.' });

    if (!nomeCompleto || nomeCompleto.length < 3) return res.status(400).json({ message: 'Informe o nome completo do funcionario.' });

    if (!isFirstUser) {
      if (!cpfDigits) return res.status(400).json({ message: 'Informe o CPF do funcionario.' });
      if (!email) return res.status(400).json({ message: 'Informe o email do funcionario.' });
      if (!telefoneDigits) return res.status(400).json({ message: 'Informe o telefone do funcionario.' });
      if (!isValidEmail(email)) return res.status(400).json({ message: 'Email invalido.' });
      if (!isValidPhone(telefoneDigits)) return res.status(400).json({ message: 'Telefone invalido.' });
    }

    if (!isFirstUser && cargoNorm === 'Funcionario') rawUsername = cpfDigits;
    if (!isFirstUser && !isValidCPF(cpfDigits)) {
      return res.status(400).json({ message: 'CPF invalido.' });
    }
    if (!rawUsername) return res.status(400).json({ message: 'Usuario invalido.' });

    const existingUsername = users.find(u => typeof u.username === 'string' && u.username.toLowerCase() === rawUsername.toLowerCase());
    if (existingUsername) return res.status(409).json({ message: 'Este nome de usuario ja esta em uso.' });
    if (cpfDigits && users.some(u => u.cpf && digitsOnly(u.cpf) === cpfDigits)) return res.status(409).json({ message: 'Ja existe um funcionario com este CPF.' });
    if (email && users.some(u => typeof u.email === 'string' && u.email.toLowerCase() === email)) return res.status(409).json({ message: 'Ja existe um funcionario com este email.' });

    if (!isFirstUser) {
      const authToken = req.header('x-auth-token');
      const session = authToken ? activeSessions.get(authToken) : null;
      const isAdminSession = session && canonicalCargo(session.cargo) === 'Administrador';
      if (!isAdminSession) return res.status(403).json({ message: 'Apenas administradores autenticados podem cadastrar usuarios.' });
    }

    const hashedPassword = await bcrypt.hash(passwordRaw, 10);
    const nowIso = new Date().toISOString();
    const newUser = {
      username: rawUsername,
      password: hashedPassword,
      cargo: cargoNorm,
      nomeCompleto: nomeCompleto || rawUsername,
      cpf: cpfDigits || null,
      email: email || null,
      telefone: telefoneDigits || null,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    users.push(newUser);
    writeData(USERS_DB_PATH, users);
    return res.status(201).json({
      message: 'Funcionario cadastrado com sucesso!', user: {
        username: newUser.username,
        cargo: newUser.cargo,
        nomeCompleto: newUser.nomeCompleto,
        cpf: newUser.cpf,
        email: newUser.email,
        telefone: newUser.telefone
      }
    });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno no servidor.' });
  }
});
// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const body = req.body || {};
    const inputUsername = normalizeText(body.username);
    const inputPassword = typeof body.password === 'string' ? body.password : '';

    const users = readData(USERS_DB_PATH);
    let user = users.find(u => typeof u.username === 'string' && u.username.toLowerCase() === inputUsername.toLowerCase());
    const inputDigits = digitsOnly(inputUsername);
    if (!user && inputDigits.length === 11) {
      user = users.find(u => u && u.cpf && digitsOnly(u.cpf) === inputDigits);
    }
    if (!user) return res.status(401).json({ success: false, message: 'Usu�rio ou senha inv�lidos.' });

    if (canonicalCargo(user.cargo) === 'Funcionario') {
      if (inputDigits.length !== 11 || digitsOnly(user.cpf || '') !== inputDigits)
        return res.status(401).json({ success: false, message: 'Para funcion�rio, utilize o CPF como usu�rio.' });
    }

    if (!inputPassword || !(await bcrypt.compare(inputPassword, user.password)))
      return res.status(401).json({ success: false, message: 'Usu�rio ou senha inv�lidos.' });

    for (const [tokenValue, sess] of activeSessions.entries()) {
      if (sess.username === user.username) activeSessions.delete(tokenValue);
    }

    const token = crypto.randomUUID();
    activeSessions.set(token, { username: user.username, cargo: user.cargo, issuedAt: Date.now() });
    return res.status(200).json({ success: true, message: 'Login bem-sucedido!', cargo: user.cargo, username: user.username, token });
  } catch (e) {
    res.status(500).json({ message: 'Erro no servidor.' });
  }
});

// Rota para buscar o hist�rico de vendas com filtros
app.get('/api/history/sales', async (req, res) => {
  try {
    let sales = await readSales();
    const { vendedor, dia, produtoId, produtoNome } = req.query;

    if (vendedor) {
      sales = sales.filter(sale => sale.seller === vendedor);
    }
    if (dia) { // Formato esperado: YYYY-MM-DD
      sales = sales.filter(sale => sale.date.startsWith(dia));
    }
    if (produtoId) {
      sales = sales.filter(sale => sale.items.some(item => item.id.toLowerCase().includes(produtoId.toLowerCase())));
    }
    if (produtoNome) {
      sales = sales.filter(sale => sale.items.some(item => item.nome.toLowerCase().includes(produtoNome.toLowerCase())));
    }
    res.json(sales.reverse()); // Retorna as mais recentes primeiro
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar hist�rico de vendas." });
  }
});

// Rota para buscar o hist�rico de sangrias com filtros
app.get('/api/history/sangrias', async (req, res) => {
  try {
    let transactions = await readTransactions();
    const { vendedor, dia } = req.query;

    if (vendedor) {
      transactions = transactions.filter(t => t.user === vendedor);
    }
    if (dia) {
      transactions = transactions.filter(t => t.date.startsWith(dia));
    }
    res.json(transactions.reverse());
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar hist�rico de sangrias." });
  }
});

// Rota para buscar o hist�rico de devolu��es com filtros
app.get('/api/history/devolucoes', (req, res) => {
  try {
    const raw = readDevolucoes() || [];
    // Normaliza registros de diferentes formatos em um shape comum
    const normalized = raw.map((r) => {
      const base = {
        id: r.id || Date.now(),
        date: r.date || new Date().toISOString(),
        saleId: r.saleId || null,
        user: r.user || r.vendedor || '',
        reason: r.reason || r.motivo || null,
        amount: Number(r.amount || 0) || 0,
        items: []
      };
      // Suporte a formatos: items[], produto �nico, products
      if (Array.isArray(r.items)) {
        base.items = r.items.map(it => ({
          productId: it.productId ?? it.id ?? it.codigo ?? null,
          productName: it.productName ?? it.nome ?? it.name ?? null,
          quantity: Number(it.quantity || 1) || 1,
          amount: Number(it.amount || 0) || 0
        }));
        if (!base.amount) base.amount = base.items.reduce((s, it) => s + (Number(it.amount || 0) || 0), 0);
      } else if (r.produto) {
        const p = r.produto;
        base.items = [{ productId: p.id || null, productName: p.nome || p.name || null, quantity: 1, amount: Number(p.valor || 0) || 0 }];
        if (!base.amount) base.amount = base.items[0].amount;
      }
      return base;
    });

    const { vendedor = '', dia = '', from = '', to = '', produtoId = '', produtoNome = '', search = '', sort = 'date_desc' } = req.query || {};
    const vnorm = String(vendedor).trim().toLowerCase();
    const dday = String(dia).trim();
    const fromStr = String(from).trim();
    const toStr = String(to).trim();
    const pid = String(produtoId).trim().toLowerCase();
    const pname = String(produtoNome).trim().toLowerCase();
    const q = String(search).trim().toLowerCase();
    const parseDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; };
    const fromDate = parseDate(fromStr);
    const toDate = parseDate(toStr);

    const filtered = normalized.filter((r) => {
      try {
        const rDate = new Date(r.date);
        if (dday && !String(r.date || '').startsWith(dday)) return false;
        if (fromDate && rDate < fromDate) return false;
        if (toDate && rDate > toDate) return false;
        if (vnorm && !String(r.user || '').toLowerCase().includes(vnorm)) return false;
        if (pid) {
          const ok = Array.isArray(r.items) && r.items.some(it => String(it.productId || '').toLowerCase().includes(pid));
          if (!ok) return false;
        }
        if (pname) {
          const okn = Array.isArray(r.items) && r.items.some(it => String(it.productName || '').toLowerCase().includes(pname));
          if (!okn) return false;
        }
        if (q) {
          const reasonMatch = String(r.reason || '').toLowerCase().includes(q);
          const userMatch = String(r.user || '').toLowerCase().includes(q);
          const itemMatch = Array.isArray(r.items) && r.items.some(it => {
            return String(it.productId || '').toLowerCase().includes(q) || String(it.productName || '').toLowerCase().includes(q);
          });
          if (!(reasonMatch || userMatch || itemMatch)) return false;
        }
        return true;
      } catch { return false; }
    }).sort((a, b) => {
      if (sort === 'amount_desc') return (Number(b.amount) || 0) - (Number(a.amount) || 0);
      if (sort === 'amount_asc') return (Number(a.amount) || 0) - (Number(b.amount) || 0);
      if (sort === 'date_asc') return (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0);
      return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
    });

    res.status(200).json(filtered);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar hist�rico de devolu��es.' });
  }
});

// Rota para buscar o histrico de suprimentos com filtros


// Rota para apagar uma venda inteira
app.delete('/api/history/sales/:id', async (req, res) => {
  try {
    const saleId = parseInt(req.params.id, 10);
    let sales = await readSales();
    const initialLength = sales.length;
    sales = sales.filter(sale => sale.id !== saleId);

    if (sales.length === initialLength) {
      return res.status(404).json({ message: "Venda n�o encontrada." });
    }

    await writeSales(sales);
    res.json({ success: true, message: 'Venda apagada com sucesso!' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao apagar a venda.' });
  }
});

// Rota para processar uma devolu��o
app.post('/api/devolucao', async (req, res) => {
  try {
    const { saleId, produto, motivo, vendedor } = req.body;

    // 1. Registar a devolu��o
    const devolucoes = await readDevolucoes();
    const novaDevolucao = {
      id: new Date().getTime(),
      saleId,
      produto,
      motivo,
      vendedor,
      date: new Date().toISOString()
    };
    devolucoes.push(novaDevolucao);
    await writeDevolucoes(devolucoes);

    // 2. Marcar o item como devolvido na venda original
    const sales = await readSales();
    const saleIndex = sales.findIndex(s => s.id === saleId);
    if (saleIndex > -1) {
      const itemIndex = sales[saleIndex].items.findIndex(item => item.id === produto.id && !item.devolvido);
      if (itemIndex > -1) {
        sales[saleIndex].items[itemIndex].devolvido = true;
        await writeSales(sales);
      }
    }

    // 3. Atualizar o estoque (opcional, mas recomendado)
    // Esta parte pode ser adicionada depois para aumentar a quantidade em estoque

    res.status(201).json({ success: true, message: 'Devolu��o registada com sucesso!' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao processar devolu��o.' });
  }
});

// USERS list (admin-only)
app.get('/api/users', (req, res) => {
  try {
    const authToken = req.header('x-auth-token');
    const session = authToken ? activeSessions.get(authToken) : null;
    if (!session) return res.status(401).json({ message: 'Token de acesso inv�lido ou expirado.' });
    if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem consultar funcionarios.' });

    const { search = '', cargo } = req.query || {};
    const normalizedSearch = lowercaseText(search);
    const desiredCargo = canonicalCargo(cargo);

    const users = readData(USERS_DB_PATH);
    const entries = users.map(u => ({
      username: u.username || '',
      cargo: u.cargo || '',
      nomeCompleto: normalizeText(u.nomeCompleto) || u.username || '',
      email: u.email || null,
      telefone: u.telefone || null,
      cpf: u.cpf || null,
      createdAt: u.createdAt || null,
      updatedAt: u.updatedAt || null
    }));

    const filtered = entries.filter((entry) => {
      if (desiredCargo && canonicalCargo(entry.cargo) !== desiredCargo) return false;
      if (!normalizedSearch) return true;
      const values = [entry.username, entry.nomeCompleto, entry.email, entry.telefone, entry.cpf].map(v => lowercaseText(v));
      return values.some(v => v.includes(normalizedSearch));
    }).sort((a, b) => {
      const aTime = a.createdAt ? Date.parse(a.createdAt) || 0 : 0;
      const bTime = b.createdAt ? Date.parse(b.createdAt) || 0 : 0;
      if (aTime === bTime) return (lowercaseText(a.nomeCompleto)).localeCompare(lowercaseText(b.nomeCompleto));
      return bTime - aTime;
    });

    // USERS: Update (admin-only)
    app.put('/api/users/:username', async (req, res) => {
      try {
        const authToken = req.header('x-auth-token');
        const session = authToken ? activeSessions.get(authToken) : null;
        if (!session) return res.status(401).json({ message: 'Token de acesso inv�lido ou expirado.' });
        if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem editar funcion�rios.' });

        const targetUsername = String(req.params.username || '').trim();
        if (!targetUsername) return res.status(400).json({ message: 'Usu�rio alvo inv�lido.' });

        const users = readData(USERS_DB_PATH);
        const idx = users.findIndex(u => typeof u.username === 'string' && u.username.toLowerCase() === targetUsername.toLowerCase());
        if (idx === -1) return res.status(404).json({ message: 'Funcion�rio n�o encontrado.' });

        const body = req.body || {};
        const updates = {};
        if (typeof body.nomeCompleto === 'string') updates.nomeCompleto = normalizeText(body.nomeCompleto);
        if (typeof body.email === 'string') updates.email = lowercaseText(body.email);
        if (typeof body.telefone === 'string') updates.telefone = digitsOnly(body.telefone);
        if (typeof body.cpf === 'string') updates.cpf = digitsOnly(body.cpf);
        if (typeof body.cargo === 'string') updates.cargo = canonicalCargo(body.cargo) || users[idx].cargo;

        if (updates.email && !isValidEmail(updates.email)) return res.status(400).json({ message: 'Email inv�lido.' });
        if (updates.telefone && !isValidPhone(updates.telefone)) return res.status(400).json({ message: 'Telefone inv�lido.' });
        if (updates.cpf && updates.cpf.length && updates.cpf !== (digitsOnly(users[idx].cpf || ''))) {
          if (!isValidCPF(updates.cpf)) return res.status(400).json({ message: 'CPF inv�lido.' });
          if (users.some((u, i) => i !== idx && u.cpf && digitsOnly(u.cpf) === updates.cpf)) return res.status(409).json({ message: 'J� existe um funcion�rio com este CPF.' });
        }
        if (updates.email && updates.email !== lowercaseText(users[idx].email || '')) {
          if (users.some((u, i) => i !== idx && typeof u.email === 'string' && lowercaseText(u.email) === updates.email)) return res.status(409).json({ message: 'J� existe um funcion�rio com este email.' });
        }

        if (typeof body.password === 'string' && body.password.trim()) {
          const pw = body.password.trim();
          if (pw.length < 6) return res.status(400).json({ message: 'A senha deve ter pelo menos 6 caracteres.' });
          updates.password = await bcrypt.hash(pw, 10);
        }

        const now = new Date().toISOString();
        users[idx] = { ...users[idx], ...updates, updatedAt: now };
        writeData(USERS_DB_PATH, users);

        const u = users[idx];
        return res.status(200).json({
          message: 'Funcion�rio atualizado com sucesso!',
          user: { username: u.username, cargo: u.cargo, nomeCompleto: u.nomeCompleto, cpf: u.cpf, email: u.email, telefone: u.telefone, updatedAt: u.updatedAt }
        });
      } catch (e) {
        res.status(500).json({ message: 'Erro ao atualizar funcion�rio.' });
      }
    });

    // USERS: Delete (admin-only)
    app.delete('/api/users/:username', (req, res) => {
      try {
        const authToken = req.header('x-auth-token');
        const session = authToken ? activeSessions.get(authToken) : null;
        if (!session) return res.status(401).json({ message: 'Token de acesso inv�lido ou expirado.' });
        if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem excluir funcion�rios.' });

        const targetUsername = String(req.params.username || '').trim();
        if (!targetUsername) return res.status(400).json({ message: 'Usu�rio alvo inv�lido.' });

        const users = readData(USERS_DB_PATH);
        const idx = users.findIndex(u => typeof u.username === 'string' && u.username.toLowerCase() === targetUsername.toLowerCase());
        if (idx === -1) return res.status(404).json({ message: 'Funcion�rio n�o encontrado.' });

        // Evitar excluir o �ltimo administrador
        const isAdmin = canonicalCargo(users[idx].cargo) === 'Administrador';
        if (isAdmin) {
          const adminCount = users.filter(u => canonicalCargo(u.cargo) === 'Administrador').length;
          if (adminCount <= 1) return res.status(400).json({ message: 'N�o � poss�vel excluir o �ltimo administrador.' });
        }

        const removed = users.splice(idx, 1)[0];
        writeData(USERS_DB_PATH, users);
        // Encerrar sess�es do usu�rio removido
        for (const [tokenValue, sess] of activeSessions.entries()) {
          if (sess.username && String(sess.username).toLowerCase() === String(removed.username).toLowerCase()) {
            activeSessions.delete(tokenValue);
          }
        }
        return res.status(200).json({ success: true, message: 'Funcion�rio exclu�do com sucesso.' });
      } catch (e) {
        res.status(500).json({ message: 'Erro ao excluir funcion�rio.' });
      }
    });
    res.status(200).json({ total: entries.length, results: filtered });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno no servidor.' });
  }
});

// PRODUCTS
app.get('/api/produtos', (req, res) => {
  try {
    const { categoria, subcategoria, search } = req.query || {};
    const cat = normalizeText(categoria);
    const sub = normalizeText(subcategoria);
    const q = lowercaseText(search);
    const produtos = readData(PRODUCTS_DB_FILE);

    let list = produtos;
    if (cat) list = list.filter(p => normalizeText(p.categoriaNome).toLowerCase() === cat.toLowerCase());
    if (sub) list = list.filter(p => normalizeText(p.subcategoriaNome).toLowerCase() === sub.toLowerCase());
    if (q) {
      list = list.filter(p => {
        const vals = [p.id, p.nome, p.descricao, p.categoriaNome, p.subcategoriaNome].map(v => lowercaseText(v));
        return vals.some(v => v.includes(q));
      });
    }
    res.status(200).json(list);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar produtos.' });
  }
});

app.get('/api/produtos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const produtos = readData(PRODUCTS_DB_FILE);
    const prod = produtos.find(p => p.id === id);
    if (!prod) return res.status(404).json({ message: 'Produto n�o encontrado.' });
    res.status(200).json(prod);
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao buscar produto.' });
  }
});

app.post('/api/produtos', (req, res) => {
  try {
    const novo = req.body || {};
    const produtos = readData(PRODUCTS_DB_FILE);
    if (!novo || !novo.id) return res.status(400).json({ message: 'Produto inv�lido.' });
    if (produtos.some(p => p.id === novo.id)) return res.status(409).json({ message: 'J� existe um produto com este ID.' });
    produtos.push(novo);
    writeData(PRODUCTS_DB_FILE, produtos);
    res.status(201).json({ message: 'Produto adicionado com sucesso.' });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao adicionar produto.' });
  }
});

app.put('/api/produtos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const produtos = readData(PRODUCTS_DB_FILE);
    const idx = produtos.findIndex(p => p.id === id);
    if (idx < 0) return res.status(404).json({ message: 'Produto n�o encontrado.' });
    produtos[idx] = { ...produtos[idx], ...body, id };
    writeData(PRODUCTS_DB_FILE, produtos);
    res.status(200).json({ message: 'Produto atualizado com sucesso.' });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao atualizar produto.' });
  }
});

app.delete('/api/produtos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const produtos = readData(PRODUCTS_DB_FILE);
    const idx = produtos.findIndex(p => p.id === id);
    if (idx < 0) return res.status(404).json({ message: 'Produto n�o encontrado.' });
    produtos.splice(idx, 1);
    writeData(PRODUCTS_DB_FILE, produtos);
    res.status(200).json({ message: 'Produto exclu�do com sucesso.' });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao excluir produto.' });
  }
});

// SALES
app.post('/api/sales', (req, res) => {
  try {
    const { items, seller } = req.body || {};
    if (!Array.isArray(items) || items.length === 0 || !seller)
      return res.status(400).json({ message: 'Dados da venda incompletos.' });
    const metodoPagamento = normalizeText(
      req.body.paymentMethod
      || req.body.formaPagamento
      || req.body.metodoPagamento
      || req.body.payment
      || req.body.pagamento
      || req.body.metodo
      || ''
    ) || 'dinheiro';
    const recebido = safeNumber(req.body.receivedAmount ?? req.body.valorRecebido ?? req.body.recebido);
    const trocoEntregue = Math.max(0, safeNumber(req.body.changeGiven ?? req.body.troco ?? req.body.trocoEntregue ?? 0));

    const sales = readData(SALES_DB_FILE);
    sales.push({
      id: Date.now(),
      date: new Date().toISOString(),
      items,
      seller,
      paymentMethod: metodoPagamento,
      receivedAmount: recebido || 0,
      changeGiven: trocoEntregue
    });
    writeData(SALES_DB_FILE, sales);
    res.status(201).json({ message: 'Venda registrada com sucesso!' });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao registrar a venda.' });
  }
});

app.get('/api/sales', (req, res) => {
  try {
    try { normalizeSalesFile(); } catch (_) { }
    const authToken = req.header('x-auth-token');
    const session = authToken ? activeSessions.get(authToken) : null;
    if (!session) return res.status(401).json({ message: 'Token de acesso inv�lido ou expirado.' });
    if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem consultar o hist�rico de vendas.' });

    const sales = readData(SALES_DB_FILE) || [];
    const parseDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; };

    const { from, to, seller = '', search = '', id: idStr, productId: productIdStr, sort: sortKey, page: pageStr, pageSize: pageSizeStr } = req.query || {};
    const fromDate = parseDate(from);
    const toDate = parseDate(to);
    const sellerNorm = lowercaseText(seller);
    const searchNorm = lowercaseText(search);
    const idFilter = idStr ? String(idStr).trim() : '';
    const prodIdFilter = productIdStr ? String(productIdStr).trim() : '';

    const filtered = sales.filter((sale) => {
      try {
        const saleDate = new Date(sale.date);
        if (idFilter) {
          const sid = String(sale.id || '').trim();
          if (sid !== idFilter) return false;
        }
        if (fromDate && saleDate < fromDate) return false;
        if (toDate && saleDate > toDate) return false;
        if (sellerNorm && !lowercaseText(sale.seller || '').includes(sellerNorm)) return false;
        if (prodIdFilter) {
          const items = Array.isArray(sale.items) ? sale.items : [];
          const needle = lowercaseText(prodIdFilter);
          const hasProd = items.some((it) => lowercaseText(String(it.id || it.codigo || '')).includes(needle));
          if (!hasProd) return false;
        }
        if (searchNorm) {
          const sellerMatch = lowercaseText(sale.seller || '').includes(searchNorm);
          const items = Array.isArray(sale.items) ? sale.items : [];
          const itemMatch = items.some((it) => {
            const idVal = lowercaseText(it.id || '');
            const nameVal = lowercaseText(it.nome || it.name || '');
            const descVal = lowercaseText(it.descricao || '');
            return idVal.includes(searchNorm) || nameVal.includes(searchNorm) || descVal.includes(searchNorm);
          });
          if (!(sellerMatch || itemMatch)) return false;
        }
        return true;
      } catch { return false; }
    }).map((sale) => {
      const items = Array.isArray(sale.items) ? sale.items : [];
      const totalItems = items.length;
      const totalValue = items.reduce((acc, it) => acc + (Number(it.valor || 0) || 0), 0);
      return { id: sale.id, date: sale.date, seller: sale.seller || '', totalItems, totalValue, items };
    }).sort((a, b) => {
      const key = String(sortKey || 'date_desc');
      if (key === 'date_asc') return (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0);
      if (key === 'total_desc') return (Number(b.totalValue) || 0) - (Number(a.totalValue) || 0);
      if (key === 'total_asc') return (Number(a.totalValue) || 0) - (Number(b.totalValue) || 0);
      return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
    });

    const pageNum = Math.max(1, parseInt(pageStr || '1', 10) || 1);
    const sizeNum = Math.min(100, Math.max(1, parseInt(pageSizeStr || '10', 10) || 10));
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / sizeNum));
    const page = Math.min(pageNum, totalPages);
    const startIdx = (page - 1) * sizeNum;
    const endIdx = startIdx + sizeNum;
    const paged = filtered.slice(startIdx, endIdx);

    res.status(200).json({ total, page, pageSize: sizeNum, totalPages, results: paged });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno no servidor.' });
  }
});

// SALES: Summary (admin-only) - aggregates by date
app.get('/api/sales/summary', (req, res) => {
  try {
    const authToken = req.header('x-auth-token');
    const session = authToken ? activeSessions.get(authToken) : null;
    if (!session) return res.status(401).json({ message: 'Token de acesso inv�lido ou expirado.' });
    if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem consultar o hist�rico de vendas.' });

    const parseDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; };
    const { from, to, seller = '', search = '', productId: productIdStr } = req.query || {};
    const fromDate = parseDate(from);
    const toDate = parseDate(to);
    const sellerNorm = lowercaseText(seller);
    const searchNorm = lowercaseText(search);
    const prodIdFilter = productIdStr ? lowercaseText(String(productIdStr).trim()) : '';

    const sales = readData(SALES_DB_FILE) || [];

    const filtered = sales.filter((sale) => {
      try {
        const saleDate = new Date(sale.date);
        if (fromDate && saleDate < fromDate) return false;
        if (toDate && saleDate > toDate) return false;
        if (sellerNorm && !lowercaseText(sale.seller || '').includes(sellerNorm)) return false;
        const items = Array.isArray(sale.items) ? sale.items : [];
        if (prodIdFilter) {
          const hasProd = items.some((it) => lowercaseText(String(it.id || it.codigo || '')).includes(prodIdFilter));
          if (!hasProd) return false;
        }
        if (searchNorm) {
          const sellerMatch = lowercaseText(sale.seller || '').includes(searchNorm);
          const itemMatch = items.some((it) => {
            const idVal = lowercaseText(it.id || '');
            const nameVal = lowercaseText(it.nome || it.name || '');
            const descVal = lowercaseText(it.descricao || '');
            return idVal.includes(searchNorm) || nameVal.includes(searchNorm) || descVal.includes(searchNorm);
          });
          if (!(sellerMatch || itemMatch)) return false;
        }
        return true;
      } catch { return false; }
    });

    // aggregate by YYYY-MM-DD (local time)
    const toKey = (d) => {
      const dt = new Date(d);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const acc = Object.create(null);
    let sumValue = 0; let sumItems = 0; let sumCount = 0;
    for (const sale of filtered) {
      const key = toKey(sale.date);
      const items = Array.isArray(sale.items) ? sale.items : [];
      const totalValue = items.reduce((a, it) => a + (Number(it.valor || 0) || 0), 0);
      const totalItems = items.length;
      if (!acc[key]) acc[key] = { date: key, totalValue: 0, totalItems: 0, count: 0 };
      acc[key].totalValue += totalValue;
      acc[key].totalItems += totalItems;
      acc[key].count += 1;
      sumValue += totalValue; sumItems += totalItems; sumCount += 1;
    }
    const byDate = Object.values(acc).sort((a, b) => a.date.localeCompare(b.date));
    res.status(200).json({ totalValue: sumValue, totalItems: sumItems, count: sumCount, byDate });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao gerar resumo de vendas.' });
  }
});

// SALES: Delete entire sale (admin-only)
app.delete('/api/sales/:id', (req, res) => {
  try {
    const authToken = req.header('x-auth-token');
    const session = authToken ? activeSessions.get(authToken) : null;
    if (!session) return res.status(401).json({ message: 'Token de acesso inv�lido ou expirado.' });
    if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem excluir vendas.' });

    const { id } = req.params;
    const sales = readData(SALES_DB_FILE) || [];
    const idx = sales.findIndex(s => String(s.id || '') === String(id || ''));
    if (idx < 0) return res.status(404).json({ message: 'Venda n�o encontrada.' });
    sales.splice(idx, 1);
    writeData(SALES_DB_FILE, sales);
    return res.status(200).json({ message: 'Venda exclu�da com sucesso.' });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao excluir venda.' });
  }
});

// SALES: Delete alias via POST (some environments block DELETE from browsers)
app.post('/api/sales/:id/delete', (req, res) => {
  try {
    const authToken = req.header('x-auth-token');
    const session = authToken ? activeSessions.get(authToken) : null;
    if (!session) return res.status(401).json({ message: 'Token de acesso inv�lido ou expirado.' });
    if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem excluir vendas.' });

    const { id } = req.params;
    const sales = readData(SALES_DB_FILE) || [];
    const idx = sales.findIndex(s => String(s.id || '') === String(id || ''));
    if (idx < 0) return res.status(404).json({ message: 'Venda n�o encontrada.' });
    sales.splice(idx, 1);
    writeData(SALES_DB_FILE, sales);
    return res.status(200).json({ message: 'Venda exclu�da com sucesso.' });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao excluir venda.' });
  }
});

// SALES: Remove items from a sale (admin-only)
app.patch('/api/sales/:id/items/remove', (req, res) => {
  try {
    const authToken = req.header('x-auth-token');
    const session = authToken ? activeSessions.get(authToken) : null;
    if (!session) return res.status(401).json({ message: 'Token de acesso inv�lido ou expirado.' });
    if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem alterar vendas.' });

    const { id } = req.params;
    const { indices, productIds } = req.body || {};
    const sales = readData(SALES_DB_FILE) || [];
    const sale = sales.find(s => String(s.id || '') === String(id || ''));
    if (!sale) return res.status(404).json({ message: 'Venda n�o encontrada.' });
    const items = Array.isArray(sale.items) ? sale.items : [];

    let removedCount = 0;
    let newItems = items;

    if (Array.isArray(indices) && indices.length > 0) {
      const idxSet = new Set(indices.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n)));
      removedCount = Array.from(idxSet).filter(n => n >= 0 && n < items.length).length;
      newItems = items.filter((_, i) => !idxSet.has(i));
    } else if (Array.isArray(productIds) && productIds.length > 0) {
      const toRemove = new Set(productIds.map(v => String(v)));
      const before = items.length;
      newItems = items.filter((it) => !toRemove.has(String(it.id || it.codigo || '')));
      removedCount = before - newItems.length;
    } else {
      return res.status(400).json({ message: 'Informe indices ou productIds para remover.' });
    }

    sale.items = newItems;
    const idx = sales.findIndex(s => s === sale);
    sales[idx] = sale;
    writeData(SALES_DB_FILE, sales);
    return res.status(200).json({ message: `Itens removidos: ${removedCount}.`, removed: removedCount });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao remover itens da venda.' });
  }
});

// SALES: Remove items alias via POST
app.post('/api/sales/:id/items/remove', (req, res) => {
  try {
    const authToken = req.header('x-auth-token');
    const session = authToken ? activeSessions.get(authToken) : null;
    if (!session) return res.status(401).json({ message: 'Token de acesso inv�lido ou expirado.' });
    if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem alterar vendas.' });

    const { id } = req.params;
    const { indices, productIds } = req.body || {};
    const sales = readData(SALES_DB_FILE) || [];
    const sale = sales.find(s => String(s.id || '') === String(id || ''));
    if (!sale) return res.status(404).json({ message: 'Venda n�o encontrada.' });
    const items = Array.isArray(sale.items) ? sale.items : [];

    let removedCount = 0;
    let newItems = items;

    if (Array.isArray(indices) && indices.length > 0) {
      const idxSet = new Set(indices.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n)));
      removedCount = Array.from(idxSet).filter(n => n >= 0 && n < items.length).length;
      newItems = items.filter((_, i) => !idxSet.has(i));
    } else if (Array.isArray(productIds) && productIds.length > 0) {
      const toRemove = new Set(productIds.map(v => String(v)));
      const before = items.length;
      newItems = items.filter((it) => !toRemove.has(String(it.id || it.codigo || '')));
      removedCount = before - newItems.length;
    } else {
      return res.status(400).json({ message: 'Informe indices ou productIds para remover.' });
    }

    sale.items = newItems;
    const idx = sales.findIndex(s => s === sale);
    sales[idx] = sale;
    writeData(SALES_DB_FILE, sales);
    return res.status(200).json({ message: `Itens removidos: ${removedCount}.`, removed: removedCount });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao remover itens da venda.' });
  }
});

// CASH: Refund (Devolu��o) - admin-only
app.post('/api/refunds', (req, res) => {
  try {
    const authToken = req.header('x-auth-token');
    const session = authToken ? activeSessions.get(authToken) : null;
    if (!session) return res.status(401).json({ message: 'Token de acesso inv�lido ou expirado.' });
    if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem registrar devolu��es.' });

    const { saleId, amount, user, reason, items } = req.body || {};
    if (!amount || Number(amount) <= 0 || !user) return res.status(400).json({ message: 'Valor da devolu��o inv�lido.' });

    const devolucoes = readDevolucoes() || [];
    const entry = {
      id: Date.now(),
      amount: Number(amount),
      user,
      date: new Date().toISOString(),
      saleId: saleId || null,
      items: Array.isArray(items) ? items.map(it => ({
        productId: it.productId ?? it.id ?? it.codigo ?? null,
        productName: it.productName ?? it.nome ?? it.name ?? null,
        quantity: Number(it.quantity || 1) || 1,
        amount: Number(it.amount || 0) || 0
      })) : [],
      reason: reason || null
    };
    devolucoes.push(entry);
    writeDevolucoes(devolucoes);

    // Remove refunded items from original sale (item-by-item)
    try {
      normalizeSalesFile();
      const sales = readData(SALES_DB_FILE) || [];
      const idx = sales.findIndex(s => String(s.id) === String(saleId));
      if (idx >= 0) {
        const sale = sales[idx];
        let newItems = Array.isArray(sale.items) ? sale.items.slice() : [];
        const refundItems = Array.isArray(entry.items) ? entry.items : [];
        refundItems.forEach((it) => {
          const pid = String(it.productId || '').trim();
          if (!pid) return;
          const rIdx = newItems.findIndex(x => String(x.id || '').trim() === pid);
          if (rIdx >= 0) newItems.splice(rIdx, 1);
        });
        if (newItems.length === 0) {
          sales.splice(idx, 1);
        } else {
          sales[idx] = { ...sale, items: newItems };
        }
        writeData(SALES_DB_FILE, sales);
      }
    } catch (_) { }

    res.status(201).json({ message: 'Devolu��o registrada com sucesso!', refund: entry });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao registrar devolu��o.' });
  }
});

// CASH: Refund delete (admin-only)
app.delete('/api/refunds/:id', (req, res) => {
  try {
    const authToken = req.header('x-auth-token');
    const session = authToken ? activeSessions.get(authToken) : null;
    if (!session) return res.status(401).json({ message: 'Token de acesso inv�lido ou expirado.' });
    if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem excluir devolu��es.' });

    const { id } = req.params;
    const devolucoes = readDevolucoes() || [];
    const idx = devolucoes.findIndex(r => String(r.id || '') === String(id || ''));
    if (idx < 0) return res.status(404).json({ message: 'Devolu��o n�o encontrada.' });
    devolucoes.splice(idx, 1);
    writeDevolucoes(devolucoes);
    return res.status(200).json({ message: 'Devolu��o exclu�da com sucesso.' });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao excluir devolu��o.' });
  }
});

// CASH: Sangria
app.post('/api/sangria', (req, res) => {
  try {
    const { amount, user, reason } = req.body || {};
    if (!amount || amount <= 0 || !user) return res.status(400).json({ message: 'O valor da sangria � inv�lido.' });
    const transactions = readData(TRANSACTIONS_DB_FILE);
    transactions.push({ id: Date.now(), type: 'sangria', amount, user, date: new Date().toISOString(), reason: reason || null });
    writeData(TRANSACTIONS_DB_FILE, transactions);
    res.status(201).json({ message: 'Sangria registrada com sucesso!' });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao registrar a sangria.' });
  }
});

// CASH: Suprimento (alias singular/plural)
const suprimentoPostRoutes = ['/api/suprimento', '/api/suprimentos'];
const handleSuprimentoRegistro = (req, res) => {
  try {
    const session = getSession(req);
    const body = req.body || {};
    const amount = safeNumber(body.amount ?? body.valor ?? body.total ?? body.value);
    const description = body.description || body.descricao || body.reason || body.motivo || '';
    const user = body.user || body.usuario || body.vendedor || (session ? (session.username || session.user) : '');
    const data = body.data || body.date || null;

    const suprimento = registrarSuprimento({ amount, user, description, date: data });
    res.status(201).json({ message: 'Suprimento registrado com sucesso!', suprimento });
  } catch (e) {
    const msg = e && e.message ? e.message : 'Erro interno ao registrar o suprimento.';
    const status = msg.toLowerCase().includes('inv�lido') || msg.toLowerCase().includes('informado') ? 400 : 500;
    res.status(status).json({ message: msg });
  }
};
suprimentoPostRoutes.forEach((route) => app.post(route, handleSuprimentoRegistro));

// CASH: Transactions history (sangria/suprimento)
app.get('/api/transactions', (req, res) => {
  try {
    const authToken = req.header('x-auth-token');
    const session = authToken ? activeSessions.get(authToken) : null;
    if (!session) return res.status(401).json({ message: 'Token de acesso inv�lido ou expirado.' });
    if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem consultar o hist�rico de caixa.' });

    const { type = '', from, to, user = '', search = '', id: idStr, productId: productIdStr, sort: sortKey, page: pageStr, pageSize: pageSizeStr } = req.query || {};
    const typeNorm = lowercaseText(type);
    const userNorm = lowercaseText(user);
    const searchNorm = lowercaseText(search);
    const idFilter = idStr ? String(idStr).trim() : '';
    const prodIdFilter = productIdStr ? String(productIdStr).trim() : '';
    const parseDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; };
    const fromDate = parseDate(from);
    const toDate = parseDate(to);

    const all = readData(TRANSACTIONS_DB_FILE) || [];
    const filtered = all.filter((t) => {
      try {
        if (typeNorm && lowercaseText(t.type) !== typeNorm) return false;
        const date = new Date(t.date);
        if (idFilter) {
          const tid = String(t.id || '').trim();
          if (tid !== idFilter) return false;
        }
        if (fromDate && date < fromDate) return false;
        if (toDate && date > toDate) return false;
        if (userNorm && !lowercaseText(t.user || '').includes(userNorm)) return false;
        if (prodIdFilter) {
          if (lowercaseText(t.type) !== 'devolucao') return false;
          const items = Array.isArray(t.items) ? t.items : [];
          const needle = lowercaseText(prodIdFilter);
          const hasProd = items.some((it) => lowercaseText(String(it.productId || it.id || it.codigo || '')).includes(needle));
          if (!hasProd) return false;
        }
        if (searchNorm) {
          const idMatch = String(t.id || '').toLowerCase().includes(searchNorm);
          const userMatch = lowercaseText(t.user || '').includes(searchNorm);
          const typeMatch = lowercaseText(t.type || '').includes(searchNorm);
          const reasonMatch = lowercaseText(t.reason || '').includes(searchNorm);
          const saleIdMatch = String(t.saleId || '').toLowerCase().includes(searchNorm);
          let itemMatch = false;
          const items = Array.isArray(t.items) ? t.items : [];
          if (items.length) {
            itemMatch = items.some((it) => {
              const pid = lowercaseText(it.productId || it.id || it.codigo || '');
              return pid.includes(searchNorm);
            });
          }
          if (!(idMatch || userMatch || typeMatch || reasonMatch || saleIdMatch || itemMatch)) return false;
        }
        return true;
      } catch { return false; }
    }).map((t) => ({
      id: t.id,
      date: t.date,
      user: t.user || '',
      type: t.type || '',
      amount: Number(t.amount || 0) || 0,
      saleId: t.saleId || null,
      description: t.description || t.descricao || t.reason || null,
      items: Array.isArray(t.items) ? t.items.map(it => ({
        productId: it.productId ?? it.id ?? it.codigo ?? null,
        quantity: Number(it.quantity || 0) || 0,
        amount: Number(it.amount || 0) || 0
      })) : null,
      reason: t.reason || null
    }))
      .sort((a, b) => {
        const key = String(sortKey || 'date_desc');
        if (key === 'date_asc') return (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0);
        if (key === 'amount_desc') return (Number(b.amount) || 0) - (Number(a.amount) || 0);
        if (key === 'amount_asc') return (Number(a.amount) || 0) - (Number(b.amount) || 0);
        return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
      });

    const pageNum = Math.max(1, parseInt(pageStr || '1', 10) || 1);
    const sizeNum = Math.min(100, Math.max(1, parseInt(pageSizeStr || '10', 10) || 10));
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / sizeNum));
    const page = Math.min(pageNum, totalPages);
    const startIdx = (page - 1) * sizeNum;
    const endIdx = startIdx + sizeNum;
    const paged = filtered.slice(startIdx, endIdx);

    res.status(200).json({ total, page, pageSize: sizeNum, totalPages, results: paged });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao consultar transa��es.' });
  }
});

// CASH: Transactions delete (admin-only)
app.delete('/api/transactions/:id', (req, res) => {
  try {
    const authToken = req.header('x-auth-token');
    const session = authToken ? activeSessions.get(authToken) : null;
    if (!session) return res.status(401).json({ message: 'Token de acesso invalido ou expirado.' });
    if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem excluir transacoes.' });

    const { id } = req.params;
    const all = readData(TRANSACTIONS_DB_FILE) || [];
    const idx = all.findIndex(t => String(t.id || '') === String(id || ''));
    if (idx < 0) return res.status(404).json({ message: 'Transacao nao encontrada.' });
    const removida = all.splice(idx, 1)[0];
    writeData(TRANSACTIONS_DB_FILE, all);
    if (lowercaseText(removida?.type) === 'suprimento') removeSuprimentoDaBase(removida);
    return res.status(200).json({ message: 'Transacao excluida com sucesso.' });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao excluir transacao.' });
  }
});

// CAIXA: resumo e fechamento di�rio
const resumoRoutes = ['/api/caixa/resumo', '/caixa/resumo'];
const fechamentoRoutes = ['/api/caixa/fechar', '/caixa/fechar'];
const DIF_TOLERANCIA = 0.01;

app.get(resumoRoutes, async (req, res) => {
  try {
    const { data, trocoSessao, ajusteTroco, trocoDelta, trocoEntregue, troco } = req.query || {};
    const resumo = await calcularResumoDia(data);
    const trocoEnt = safeNumber(trocoEntregue || troco); // troco efetivamente entregue
    const trocoDeltaVal = safeNumber(trocoSessao || ajusteTroco || trocoDelta); // esperado - entregue (delta)
    resumo.ajusteTroco = trocoDeltaVal;
    resumo.trocoEntregue = trocoEnt;
    resumo.esperadoCaixaDinheiro += trocoDeltaVal;
    resumo.esperadoGeral += trocoDeltaVal;
    return res.status(200).json(resumo);
  } catch (e) {
    res.status(500).json({ message: e.message || 'Erro ao calcular resumo do caixa.' });
  }
});

app.post(fechamentoRoutes, async (req, res) => {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ message: 'Token de acesso inv�lido ou expirado.' });
    if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem fechar o caixa.' });

    const body = req.body || {};
    const dia = toDayKey(body.data || new Date());
    if (!dia) return res.status(400).json({ message: 'Data do fechamento inv�lida.' });

    const resumo = await calcularResumoDia(dia);
    const dinheiroContado = safeNumber(body.dinheiroContado);
    const cartaoContado = safeNumber(body.cartaoContado || body.cartaoExtrato);
    const trocoEntregue = safeNumber(body.trocoEntregue || 0);
    const ajusteTroco = safeNumber(body.ajusteTroco || body.trocoSessao || body.trocoAjuste); // delta (esperado - entregue)

    const esperadoCaixa = resumo.esperadoCaixaDinheiro + ajusteTroco;
    const esperadoGeral = resumo.esperadoGeral + ajusteTroco;

    const difDinheiro = dinheiroContado - esperadoCaixa;
    const difCartao = cartaoContado - resumo.vendasCartao;
    const difGeral = difDinheiro + difCartao;
    const faltaDinheiro = difDinheiro < -DIF_TOLERANCIA;
    const faltaCartao = difCartao < -DIF_TOLERANCIA;
    const sobraDinheiro = difDinheiro > DIF_TOLERANCIA;
    const sobraCartao = difCartao > DIF_TOLERANCIA;
    const statusFinal = (faltaDinheiro || faltaCartao)
      ? 'Faltou'
      : (sobraDinheiro || sobraCartao)
        ? 'Sobrando'
        : (Math.abs(difGeral) <= DIF_TOLERANCIA ? 'Bateu' : (difGeral < 0 ? 'Faltou' : 'Sobrando')) ;

    const novoRegistro = {
      id: Date.now(),
      data: dia,
      usuario: session.username || session.user || '',
      criadoEm: new Date().toISOString(),
      esperado: { ...resumo, ajusteTroco, trocoEntregue, esperadoCaixaDinheiro: esperadoCaixa, esperadoGeral },
      contagem: { dinheiroContado, cartaoContado },
      diferencas: { dinheiro: difDinheiro, cartao: difCartao, geral: difGeral },
      status: statusFinal
    };
    const historico = readClosings();
    const atualizado = Array.isArray(historico) ? [...historico, novoRegistro] : [novoRegistro];
    writeClosings(atualizado.sort((a, b) => (Date.parse(b.criadoEm || b.data) || 0) - (Date.parse(a.criadoEm || a.data) || 0)));

    return res.status(201).json({ message: 'Fechamento salvo com sucesso!', fechamento: novoRegistro });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Erro ao salvar fechamento.' });
  }
});
// CAIXA: histórico de fechamentos (admin-only)
app.get('/api/history/fechamentos', (req, res) => {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ message: 'Token de acesso invalido ou expirado.' });
    if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem consultar fechamentos.' });

    const { dia = '', user = '', from = '', to = '' } = req.query || {};
    const dayKey = toDayKey(dia);
    const parseDate = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
    const fromDate = parseDate(from);
    const toDate = parseDate(to);
    const userNorm = lowercaseText(user);

    const historico = readClosings() || [];
    const filtrados = historico.filter((f) => {
      const fDate = new Date(f.data || f.criadoEm || 0);
      if (dayKey && toDayKey(f.data) !== dayKey) return false;
      if (fromDate && fDate < fromDate) return false;
      if (toDate && fDate > toDate) return false;
      if (userNorm && !lowercaseText(f.usuario || f.user || '').includes(userNorm)) return false;
      return true;
    }).sort((a, b) => (Date.parse(b.data || b.criadoEm || 0) || 0) - (Date.parse(a.data || a.criadoEm || 0) || 0));

    return res.status(200).json(filtrados);
  } catch (e) {
    res.status(500).json({ message: e.message || 'Erro ao consultar fechamentos.' });
  }
});
// SUPRIMENTOS: delete (admin-only)
app.delete('/api/suprimentos/:id', (req, res) => {
  try {
    const authToken = req.header('x-auth-token');
    const session = authToken ? activeSessions.get(authToken) : null;
    if (!session) return res.status(401).json({ message: 'Token de acesso invalido ou expirado.' });
    if (canonicalCargo(session.cargo) !== 'Administrador') return res.status(403).json({ message: 'Apenas administradores podem excluir suprimentos.' });

    const { id } = req.params;
    const idStr = String(id || '').trim();
    if (!idStr) return res.status(400).json({ message: 'ID do suprimento invalido.' });

    const transactions = readData(TRANSACTIONS_DB_FILE) || [];
    const txFiltradas = transactions.filter((t) => !(lowercaseText(t.type) === 'suprimento' && String(t.id || '') === idStr));
    const removeuTx = txFiltradas.length !== transactions.length;
    if (removeuTx) writeData(TRANSACTIONS_DB_FILE, txFiltradas);

    const removeuSup = removerSuprimentoPorId(idStr);
    if (removeuSup || removeuTx) return res.status(200).json({ message: 'Suprimento removido com sucesso.' });
    return res.status(404).json({ message: 'Suprimento nao encontrado.' });
  } catch (e) {
    res.status(500).json({ message: 'Erro interno ao excluir suprimento.' });
  }
});

// SUPRIMENTOS: leitura consolidada
app.get('/api/suprimentos', (req, res) => {
  try {
    const { ativos, ativosAposFechamento, apenasAtivos } = req.query || {};
    const ativosFlag = [ativos, ativosAposFechamento, apenasAtivos]
      .map((v) => String(v || '').trim().toLowerCase())
      .some((v) => ['1', 'true', 'sim', 'yes'].includes(v));
    const corteRaw = ativosFlag ? getLastClosingDate() : null;
    const corte = (corteRaw && !Number.isNaN(corteRaw.getTime()) && corteRaw <= new Date()) ? corteRaw : null;

    const lista = readSuprimentos();
    const base = Array.isArray(lista) ? lista : [];
    const filtrada = (ativosFlag && corte)
      ? base.filter((s) => {
        const data = new Date(s.date || s.data);
        if (Number.isNaN(data.getTime())) return true; // nao esconde registros sem data valida
        return data > corte;
      })
      : base;

    const formatada = filtrada.map((s) => ({
      id: s.id,
      descricao: s.description || null,
      description: s.description || null,
      valor: s.amount,
      amount: s.amount,
      user: s.user,
      data: s.date,
      date: s.date
    }));
    res.json(formatada);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao ler suprimentos.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor Styllo Fashion ouvindo em http://localhost:${PORT}`);
});




