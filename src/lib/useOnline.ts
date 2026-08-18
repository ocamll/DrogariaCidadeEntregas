import { useSyncExternalStore } from 'react'

// Conectividade como estado REATIVO, pra tela que precisa mudar de texto
// quando a rede cai ou volta.
//
// O que existia antes era `navigator.onLine` lido direto no meio do JSX.
// Isso lê o valor certo, mas só no instante do render — e como nada
// assinava os eventos `online`/`offline`, o React não tinha motivo pra
// renderizar de novo. Quem tirasse a rede com a tela de Nova Corrida
// aberta continuava vendo "Confirmar saída" e nenhum aviso, até que outra
// interação qualquer forçasse um render.
//
// Isso é da mesma família do defeito que o §39 já custou caro: a tela
// afirmando uma coisa que o servidor (aqui, o navegador) não confirma. Lá
// o botão liberava dizendo "identidade conferida" quando só o formato
// tinha sido checado; aqui o botão diz "Confirmar saída" — que é o texto
// do caminho ONLINE, com selo na hora — quando o clique vai, na verdade,
// só registrar na fila. O caixa merece saber qual das duas coisas vai
// acontecer ANTES de colher duas assinaturas.
//
// `useSyncExternalStore` e não `useState` + `useEffect`: é a API feita
// pra ler estado que mora fora do React, e evita a janela entre o
// primeiro render e o efeito assinar, onde um evento se perderia.
//
// IMPORTANTE — isto é pra EXIBIÇÃO, não pra decisão. Quem vai agir (o
// `handleConfirmar`, a criação de PIN, a conferência de identidade) deve
// continuar lendo `navigator.onLine` na hora: entre o render e o clique a
// rede pode ter mudado, e o que vale é o estado no instante da ação, não
// o do último render.

function assinar(aoMudar: () => void): () => void {
  window.addEventListener('online', aoMudar)
  window.addEventListener('offline', aoMudar)
  return () => {
    window.removeEventListener('online', aoMudar)
    window.removeEventListener('offline', aoMudar)
  }
}

function ler(): boolean {
  return navigator.onLine
}

// Sem SSR neste projeto, mas o terceiro argumento é obrigatório na
// assinatura que o React espera quando existe snapshot de servidor; devolve
// `true` porque "online" é o estado neutro — assumir offline faria a tela
// piscar o aviso de fila em toda carga.
function lerNoServidor(): boolean {
  return true
}

export function useOnline(): boolean {
  return useSyncExternalStore(assinar, ler, lerNoServidor)
}
