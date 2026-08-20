import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Tudo que diz "alguma coisa está acontecendo AGORA".
//
// A regra que separa o que anima do que não anima, e que vale pro `…`
// que aparecer daqui pra frente:
//
//   reticência de PROCESSO  → anima  (Carregando, Salvando, Enviando…)
//   reticência de TRUNCAMENTO ou de PLACEHOLDER → parada
//     (`1 … 5 6 … 84` da paginação, `hash abc123…`, `Selecione…`)
//
// Movimento aqui não é enfeite: é o que distingue "está rodando" de uma
// frase que ficou na tela. Foi exatamente essa confusão que motivou o
// componente (ver `StatusDeGravacao.tsx`). Onde o `…` quer dizer "tem
// mais coisa" ou "escolha algo", movimento seria mentira.

/**
 * As três reticências animadas.
 *
 * São três `<span>` de verdade em vez de um `…` com animação em cima, e
 * a razão é de layout: elas pulsam por opacidade e `translateY`, e os
 * três caracteres ficam SEMPRE ocupando o mesmo espaço. Animar aparecendo
 * e sumindo (`.` → `..` → `...`) faria a frase mudar de largura três
 * vezes por segundo, e num rótulo de botão isso mexe o botão inteiro.
 *
 * `aria-hidden` porque o conteúdo é decorativo — quem usa leitor de tela
 * já ouviu "Carregando", e três pontos pulsando não acrescentam nada.
 *
 * A animação mora no `index.css` (`.reticencia`), inclusive o que
 * acontece sob `prefers-reduced-motion` — onde some o deslocamento, não
 * o sinal.
 */
export function Reticencias({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex', className)} aria-hidden="true">
      <span className="reticencia">.</span>
      <span className="reticencia">.</span>
      <span className="reticencia">.</span>
    </span>
  )
}

/**
 * Rótulo de ação em curso — "Salvando", "Enviando", "Gerando".
 *
 * O `<span>` em volta não é supérfluo: o `Button` do shadcn é
 * `inline-flex` com `gap-1.5`, então o texto e as `Reticencias` entrariam
 * como DOIS itens de flex e abririam 6px entre a palavra e os pontos.
 * Envolvidos, são um item só. Vale pra qualquer container flex, não só
 * pro botão.
 */
export function EmAndamento({ children }: { children: ReactNode }) {
  return (
    <span>
      {children}
      <Reticencias />
    </span>
  )
}

/**
 * O "Carregando…" de tela e de lista, que aparecia em 19 lugares como
 * `<p className="text-sm text-muted-foreground">Carregando…</p>` copiado
 * à mão — e por isso ia sair de 19 lugares diferentes na hora de animar.
 */
export function Carregando({ texto = 'Carregando', className }: { texto?: string; className?: string }) {
  return (
    <p className={cn('text-sm text-muted-foreground', className)}>
      {texto}
      <Reticencias />
    </p>
  )
}
