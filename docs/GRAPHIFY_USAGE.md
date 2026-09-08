# Graphify — como usar neste repositório

Construído em 2026-09-08. Artefatos em `graphify-out/`: `graph.html`
(abre no navegador), `graph.json`, `GRAPH_REPORT.md` e `manifest.json`.

## O que ele é, e o que ele não é

**O Graphify é um índice ESTRUTURAL do repositório. Ele não é fonte de
verdade arquitetural.**

**O `CLAUDE.md` continua sendo a fonte** de decisões, invariantes e das
razões por trás delas. O grafo sabe *o que chama o quê*; ele não sabe
*por quê* — e neste projeto o porquê é a metade que custou caro.

## Confiável para

- localização de símbolos (arquivo + linha)
- imports
- relações de chamada
- navegação TS/TSX
- localização das migrations SQL

## Três armadilhas conhecidas

**1. Os pares TS ↔ SQL apontam para o conceito, não para a migration.**
Os links `semantically_similar_to` (`montarCanonico ↔ romaneio_canonico`,
`publicIdDoToken ↔ public_id_do_token`, e os demais) ligam ao nó-conceito
extraído do `CLAUDE.md` — **não** necessariamente ao nó AST da migration
correspondente. Navegar por eles não leva ao arquivo SQL real.

**2. Função SQL redefinida aparece várias vezes**, uma por migration que
a redefine. O grafo não diz qual está vigente. **A vigente é a da
migration cronologicamente mais recente.**

Exemplo que importa: `selar_romaneio_interno` aparece em quatro
migrations; a **vigente é a do E10, `20260902120000`**.

**3. As 51 dangling edges são limitação do extractor, não erro no
código.** Verificadas uma a uma: 36 são módulos externos (`node:fs`,
`node:path`, `react-dom`), 7 são imports de arquivos do projeto que o
extractor não materializou, 7 são re-exports com alias (por exemplo
`credencialPdf.ts:42`, `export { carregarAssetsDaMarca as
carregarAssetsCredencial }`) e 1 é o entrypoint. **Nenhuma indica símbolo
SQL faltando nem referência obsoleta.**

## Regra de uso

**Não use resposta ampla do Graphify como substituto de ler o
`CLAUDE.md`.** O `query` responde bem a *"onde está X"*; para perguntas
amplas ele lista centenas de nós e trunca. Toda pergunta que comece com
*"por que"* se responde no `CLAUDE.md`.

## O que fica de fora do índice

`.graphifyignore` (versionado) mantém o **`NOTAS.md` fora do grafo** —
490 KB que custaram 223 mil tokens de extração numa primeira tentativa,
para produzir nós que duplicam o que o `CLAUDE.md` já diz de forma
normativa. O `CLAUDE.md` **continua indexado**, de propósito.

## Refinamentos adiados (não são bugs a corrigir às pressas)

Duplicação dos nós SQL, clustering fragmentado (87 das 183 comunidades
têm menos de 5 nós), 452 nós isolados, e os IDs semânticos do `CLAUDE.md`
que não casam com os do AST.

**Não edite o `CLAUDE.md` só para mexer no grafo:** ele já foi extraído
semanticamente, e alterá-lo faz um `graphify --update` reprocessá-lo —
cerca de 169 mil tokens.
