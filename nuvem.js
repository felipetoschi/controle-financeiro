// Sincronização na nuvem: login com Google (Firebase Authentication) e dados no Firestore.
// Os dados de cada pessoa ficam no documento usuarios/<id da conta>; as regras do Firestore
// só deixam o próprio dono ler e escrever. Sem login, o app funciona só com os dados do aparelho.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, onSnapshot, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// Esta configuração não é secreta: só identifica o projeto. Quem protege os dados são as regras do Firestore.
const firebaseConfig = {
  apiKey: 'AIzaSyAs44GM0wMKOa40YlHmXlU-YYEfIDUS1f4',
  authDomain: 'controle-financeiro-80fcc.firebaseapp.com',
  projectId: 'controle-financeiro-80fcc',
  storageBucket: 'controle-financeiro-80fcc.firebasestorage.app',
  messagingSenderId: '931007806815',
  appId: '1:931007806815:web:f5d4ee1195d64484d54aea',
};

// Guarda com qual conta este aparelho já sincronizou, para não perguntar de novo a cada abertura.
const CHAVE_SINCRONIZADO = 'controle-financeiro:sincronizado-com';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Cache local do Firestore: funciona offline e envia as mudanças quando a internet voltar.
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
const provedor = new GoogleAuthProvider();

const financas = window.financas;
const $ = (seletor) => document.querySelector(seletor);
const btnConta = $('#btn-conta');
const status = $('#status-nuvem');
const nota = $('#nota-dados');

const NOTA_SEM_LOGIN = 'Os dados estão salvos só neste aparelho. Toque em "Entrar" no topo e use sua conta Google para guardá-los na nuvem e usar em todos os seus aparelhos.';

let pararDeOuvir = null;

function lerSincronizado() {
  try {
    return localStorage.getItem(CHAVE_SINCRONIZADO);
  } catch {
    return null;
  }
}

function gravarSincronizado(uid) {
  try {
    if (uid) localStorage.setItem(CHAVE_SINCRONIZADO, uid);
    else localStorage.removeItem(CHAVE_SINCRONIZADO);
  } catch {}
}

function mostrar(usuario, texto, classe = '') {
  btnConta.hidden = false;
  if (!usuario) {
    const complemento = document.createElement('span');
    complemento.className = 'so-tela-grande';
    complemento.textContent = ' com Google';
    btnConta.replaceChildren('Entrar', complemento);
    btnConta.title = '';
    status.hidden = true;
    nota.textContent = NOTA_SEM_LOGIN;
    return;
  }
  const nome = (usuario.displayName || usuario.email || 'Conta').split(' ')[0];
  btnConta.textContent = `☁ ${nome}`;
  btnConta.title = `Conectado como ${usuario.email}. Toque para sair.`;
  status.hidden = false;
  status.className = 'status ' + classe;
  status.textContent = texto;
  nota.textContent = `Conectado como ${usuario.email}. Seus dados ficam salvos na sua conta e aparecem em todos os aparelhos em que você entrar com ela.`;
}

// Junta os dados da conta com os do aparelho, sem duplicar o que já existe nos dois.
function juntar(conta, aparelho) {
  const r = structuredClone(conta);
  for (const lista of ['avulsos', 'fixos', 'parcelados', 'dividas']) {
    const ids = new Set(r[lista].map((x) => x.id));
    for (const item of aparelho[lista]) if (!ids.has(item.id)) r[lista].push(item);
  }
  r.pagos = { ...aparelho.pagos, ...conta.pagos };
  for (const tipo of ['receita', 'despesa']) r.categorias[tipo] = [...new Set([...r.categorias[tipo], ...aparelho.categorias[tipo]])];
  return r;
}

function lerDaConta(snap) {
  try {
    return financas.normalizar(JSON.parse(snap.data().json));
  } catch {
    return null;
  }
}

function conectar(usuario) {
  const referencia = doc(db, 'usuarios', usuario.uid);
  let pronto = false;

  const enviar = (d) => {
    setDoc(referencia, { json: JSON.stringify(d), atualizadoEm: serverTimestamp() })
      .catch((e) => {
        console.error('Erro ao salvar na nuvem', e);
        mostrar(usuario, 'Erro ao salvar na nuvem. Os dados continuam salvos neste aparelho.', 'erro-nuvem');
      });
  };

  // Primeira vez que este aparelho conecta nesta conta: decide o que fazer com os dados de cada lado.
  const primeiraVez = (snap) => {
    const aparelho = financas.dados();
    if (!snap.exists()) {
      enviar(aparelho); // conta nova: leva o que já está no aparelho
    } else {
      const conta = lerDaConta(snap);
      if (!conta) {
        mostrar(usuario, 'Os dados da conta estão em um formato inválido.', 'erro-nuvem');
        return false;
      }
      const iguais = JSON.stringify(conta) === JSON.stringify(aparelho);
      if (iguais || financas.contar(aparelho) === 0 || lerSincronizado() === usuario.uid) {
        financas.substituir(conta);
      } else {
        const unir = confirm(
          `Este aparelho tem ${financas.contar(aparelho)} registro(s) e sua conta tem ${financas.contar(conta)}.\n\n` +
          'OK: juntar os dois (nada se perde)\nCancelar: usar só os dados da conta (os deste aparelho serão substituídos)',
        );
        const final = unir ? juntar(conta, aparelho) : conta;
        financas.substituir(final);
        if (unir) enviar(final);
      }
    }
    gravarSincronizado(usuario.uid);
    financas.aoSalvar = enviar;
    return true;
  };

  mostrar(usuario, 'Sincronizando…', 'offline');
  pararDeOuvir = onSnapshot(referencia, { includeMetadataChanges: true }, (snap) => {
    if (snap.metadata.hasPendingWrites) {
      mostrar(usuario, 'Salvando…', 'offline');
      return;
    }
    if (!pronto) {
      // Na primeira conexão do aparelho, espera a resposta do servidor (o cache pode estar vazio).
      if (snap.metadata.fromCache && lerSincronizado() !== usuario.uid) return;
      if (snap.metadata.fromCache && !snap.exists()) return;
      pronto = primeiraVez(snap);
    } else if (snap.exists()) {
      const conta = lerDaConta(snap);
      if (conta && JSON.stringify(conta) !== JSON.stringify(financas.dados())) financas.substituir(conta);
    }
    if (snap.metadata.fromCache) mostrar(usuario, 'Sem internet: as mudanças são enviadas quando a conexão voltar.', 'offline');
    else mostrar(usuario, '✓ Sincronizado');
  }, (e) => {
    console.error('Erro ao sincronizar', e);
    mostrar(usuario, 'Erro ao sincronizar. Os dados continuam salvos neste aparelho.', 'erro-nuvem');
  });
}

onAuthStateChanged(auth, (usuario) => {
  pararDeOuvir?.();
  pararDeOuvir = null;
  financas.aoSalvar = null;
  if (usuario) conectar(usuario);
  else mostrar(null);
});

btnConta.addEventListener('click', async () => {
  const usuario = auth.currentUser;
  if (usuario) {
    if (!confirm(`Sair da conta ${usuario.email}?\n\nOs dados continuam neste aparelho, mas param de sincronizar.`)) return;
    gravarSincronizado(null);
    await signOut(auth);
    return;
  }
  try {
    await signInWithPopup(auth, provedor);
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provedor);
      return;
    }
    console.error('Erro ao entrar', e);
    alert(`Não foi possível entrar com o Google (${e.code || e.message}).`);
  }
});

getRedirectResult(auth).catch((e) => console.error('Erro ao voltar do login', e));
