import { useEffect, useState } from 'react'
import { useRomaneiosRecebidosEm, quandoAconteceu, TETO_SANGRIA } from '@/data/romaneios'
import { driveConfigurado, prepararDrive } from '@/lib/googleDrive'
import { dataLocal } from '@/lib/datas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// A sangria dos romaneios: no fim do dia, uma passada que arquiva no
// Drive tudo que saiu.
//
// POR QUE ELA EXISTE, se já há o botão na página do romaneio
//
// Porque aquele botão é "compartilhar ESTE romaneio agora", e não faz um
// arquivo. Pra subir tudo pelo botão seria preciso, a cada saída: achar um
// vale daquela corrida na lista, expandir o chevron, abrir o documento e
// clicar — várias vezes por dia, dependendo de alguém lembrar. Um arquivo
// que depende de ninguém esquecer não é um arquivo.
//
// POR QUE AQUI, e não numa tela nova
//
// A aba Fechamento já É a tela do fim do dia, já tem seletor de data (com
// "Hoje") e de filial, e já é o momento em que alguém senta pra fechar. A
// sangria não precisou de controle nenhum novo — usa os dois que já
// estavam ali.
//
// POR QUE REPETIR É DE GRAÇA
//
// O envio procura o arquivo pelo nome antes de criar e substitui o
// conteúdo quando já existe. Então rodar duas vezes no mesmo dia não
// duplica nada, e uma falha no meio (rede, token vencido) se resolve
// clicando de novo: o que já subiu é atualizado, o que faltou é criado.
// É por isso que o envio é um por vez em vez de gerar tudo antes — falhar
// no décimo não desperdiça os nove que já estão lá.

export function SangriaRomaneios({ data, lojaId }: { data: string; lojaId: string }) {
  const { data: romaneios, isLoading, isError, error } = useRomaneiosRecebidosEm({ data, lojaId })
  const [enviando, setEnviando] = useState(false)
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null)
  const [resultado, setResultado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  // O script do Google baixado antes do clique, senão o pop-up de
  // autorização não conta mais como resposta ao gesto do usuário e o
  // navegador bloqueia. Armadilha já paga no item 32.
  useEffect(() => {
    prepararDrive()
  }, [])

  // Sem VITE_GOOGLE_CLIENT_ID não há como autorizar; oferecer o botão
  // seria a tela prometendo o que não pode cumprir.
  if (!driveConfigurado()) return null

  async function enviar() {
    if (!romaneios || romaneios.length === 0) return
    setErro(null)
    setResultado(null)
    setEnviando(true)
    setProgresso({ feitos: 0, total: romaneios.length })

    try {
      // AUTORIZA PRIMEIRO, antes de gerar PDF nenhum.
      const {
        autorizarDrive,
        enviarAoDrive,
        caminhoDoRomaneio,
        novoCachePastas,
        NOME_DA_PASTA_ROMANEIOS,
      } = await import('@/lib/googleDrive')
      await autorizarDrive()

      const { montarRomaneioPdf } = await import('@/lib/romaneioPdf')

      // Um cache só pra sangria inteira. Sem ele, cada romaneio refaria a
      // busca de raiz/filial/mês/dia duas vezes — num dia de 20 saídas,
      // umas 200 idas ao Drive só pra reencontrar as mesmas pastas.
      const cache = novoCachePastas()
      let arquivos = 0
      let emOutroDia = 0

      for (const [i, romaneio] of romaneios.entries()) {
        const aconteceu = quandoAconteceu(romaneio)
        if (dataLocal(new Date(aconteceu)) !== data) emOutroDia++

        // Cada via na sua subpasta, então um envio por via.
        for (const via of ['farmacia', 'agencia'] as const) {
          const enviados = await enviarAoDrive(
            [
              {
                nome: `romaneio-${romaneio.numero}-${via}.pdf`,
                blob: new Blob([await montarRomaneioPdf(romaneio, via, [])], {
                  type: 'application/pdf',
                }),
              },
            ],
            caminhoDoRomaneio(romaneio.lojaNome, aconteceu, via),
            cache
          )
          arquivos += enviados.length
        }
        setProgresso({ feitos: i + 1, total: romaneios.length })
      }

      // "Subiu pra pasta de ontem" parece erro pra quem não sabe por quê.
      // Acontece com saída offline: ela é varrida no dia em que o servidor
      // soube dela, e arquivada no dia em que aconteceu no balcão.
      const nota =
        emOutroDia > 0
          ? ` ${emOutroDia} deles foi arquivado na pasta de outro dia — é uma saída registrada offline, que pertence ao dia em que aconteceu no balcão.`
          : ''
      setResultado(
        `${romaneios.length} romaneio(s), ${arquivos} arquivos em ${NOME_DA_PASTA_ROMANEIOS}.${nota}`
      )
    } catch (e) {
      setErro(
        `Não consegui completar o envio: ${e instanceof Error ? e.message : String(e)} — ` +
          'o que já subiu está lá; clicar de novo continua de onde parou.'
      )
    } finally {
      setEnviando(false)
      setProgresso(null)
    }
  }

  const quantos = romaneios?.length ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Romaneios do dia</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-foreground/70">
          Arquiva no Google Drive os romaneios desta data, nas duas vias, em{' '}
          <span className="whitespace-nowrap">Romaneios › Filial › mês › dia › via</span>. Repetir
          não duplica: um arquivo que já está lá é substituído.
        </p>

        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {isError && (
          <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>
        )}

        {romaneios && quantos === TETO_SANGRIA && (
          <p className="text-sm text-destructive">
            Esse dia bateu o teto de {TETO_SANGRIA} romaneios — filtra por filial pra alcançar
            todos.
          </p>
        )}

        {romaneios && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void enviar()} disabled={enviando || quantos === 0}>
              {progresso
                ? `Enviando ${progresso.feitos} de ${progresso.total}…`
                : 'Enviar ao Drive'}
            </Button>
            <span className="text-sm text-foreground/70">
              {quantos === 0
                ? 'Nenhuma saída registrada nesta data.'
                : `${quantos} romaneio(s) — ${quantos * 2} arquivos.`}
            </span>
          </div>
        )}

        {resultado && <p className="text-sm text-foreground/70">{resultado}</p>}
        {erro && <p className="text-sm text-destructive">{erro}</p>}
      </CardContent>
    </Card>
  )
}
