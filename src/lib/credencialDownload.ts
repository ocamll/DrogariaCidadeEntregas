// Entrega da credencial ao usuário. Nada persiste.
//
// Substitui o `credential-service.ts` da especificação, que gravava os
// arquivos numa pasta com `node:fs`. Além de não haver backend aqui, um
// diretório com todas as credenciais funcionais é exatamente o que o
// desenho deste projeto evita: **o arquivo É o cartão** — quem o tiver
// imprime uma cópia que funciona.
//
// Os cuidados que ficam, e que não são decorativos:
//   - nada de localStorage, sessionStorage ou IndexedDB;
//   - token e código de barras nunca vão pra log nem telemetria;
//   - os SVGs não sobem pra storage, CDN ou monitoramento;
//   - o ObjectURL é revogado depois do download;
//   - o aviso pra apagar os arquivos depois de imprimir continua na tela.
//
// O navegador NÃO consegue apagar depois um arquivo da pasta de
// downloads. Isso continua sendo ação do usuário, e é por isso que o
// aviso importa.

import {
  generateMotoboyCredential,
  type MotoboyCredentialData,
  type GeneratedCredential,
} from './credencialMotoboy'

export function baixarArquivo(conteudo: string | Blob, filename: string, tipo: string): void {
  const blob = typeof conteudo === 'string' ? new Blob([conteudo], { type: tipo }) : conteudo
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = objectUrl
  anchor.download = filename
  anchor.style.display = 'none'

  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  // Revoga o acesso temporário ao conteúdo em memória.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
}

export function baixarSvg(svg: string, filename: string): void {
  baixarArquivo(svg, filename, 'image/svg+xml;charset=utf-8')
}

/**
 * Gera e entrega os dois lados. O intervalo entre um e outro existe
 * porque alguns navegadores bloqueiam o segundo download disparado no
 * mesmo gesto — a tela oferece botões separados de frente e verso pra
 * quando isso acontecer mesmo assim.
 */
export async function downloadMotoboyCredential(
  data: MotoboyCredentialData,
  assetsBaseUrl?: string
): Promise<GeneratedCredential> {
  const gerada = await generateMotoboyCredential(data, assetsBaseUrl)

  baixarSvg(gerada.frontSvg, 'credencial-motoboy-frente.svg')
  window.setTimeout(() => baixarSvg(gerada.backSvg, 'credencial-motoboy-verso.svg'), 300)

  // Devolve o que gerou pra tela poder oferecer os downloads separados
  // sem gerar de novo — gerar duas vezes seria dois arquivos diferentes
  // do mesmo cartão, e não há motivo pra isso existir.
  return gerada
}
