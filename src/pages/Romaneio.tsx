import { useEffect, useState } from 'react'
import { useRomaneio, quandoAconteceu, ehDaFarmacia } from '@/data/romaneios'
import type { AssinaturaDoRomaneio, RomaneioCompleto } from '@/data/romaneios'
import { BlocoAssinatura } from '@/components/Custodia'
import { baixarArquivo } from '@/lib/credencialDownload'
import { driveConfigurado, prepararDrive } from '@/lib/googleDrive'
import { duracaoDaCorrida } from '@/lib/datas'
import type { ViaDoRomaneio } from '@/lib/romaneioPdf'
import { formatBRL } from '@/lib/money'
import {
  lerRetorno,
  textoDoDesfecho,
  textoDoDocumento,
  textoDoPagamentoRealizado,
} from '@/lib/documentoDoRetorno'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmAndamento } from '@/components/EmAndamento'
import { Consulta } from '@/components/Consulta'
import { derivarEstado } from '@/lib/estadoDeConsulta'

// O documento em si. Ele é a fonte da verdade — o PDF sai daqui e não o
// contrário.
//
// Tudo que aparece nesta tela vem do SNAPSHOT gravado no romaneio, nunca
// de uma consulta nova a `entregas`. Se um vale mudar depois (correção
// cadastral, por exemplo), esta tela continua mostrando o que foi
// assinado — que é o ponto inteiro de existir um documento selado.
//
// DOIS DOCUMENTOS, UM LAYOUT CADA. Até 2026-09-13 a página só sabia desenhar
// a saída e recusava o retorno. O payload do retorno não tem valores nem
// endereço — o DCRR1 assina só o que ACRESCENTA —, e desenhá-lo com o layout
// da saída imprimia `R$ NaN`. Agora cada um tem o seu corpo, e o que é comum
// (botões, custódia, integridade) fica de fora dos dois.

type ValeDoPayload = {
  entrega_id: string
  numero_vale: string
  tipo: string
  cliente_nome: string
  cliente_endereco: string
  quantidade_vales: number
  valor_compra_cents: number
  valor_entrega_cents: number
  pagamentos_previstos?: Array<{ forma: string; valor_cents: number }>
}

/**
 * A casca da consulta. Ela não desenha documento nenhum: decide se há
 * documento a desenhar.
 *
 * ANTES DAQUI ISTO ERA UM `if (!data)` SÓ, e ele fundia duas coisas que
 * a página não pode confundir:
 *
 *     data === undefined   o servidor NÃO RESPONDEU
 *     data === null        o servidor respondeu: não existe
 *
 * `buscarRomaneio` devolve `RomaneioCompleto | null`, então o `null` é
 * uma resposta de domínio legítima — e `!undefined` e `!null` são os
 * dois `true`. Offline, a página dizia **"Romaneio não encontrado"**
 * sobre um documento de custódia SELADO, que é a pior afirmação falsa
 * do app inteiro: ela nega uma prova assinada.
 *
 * Agora o `null` chega como `ready` (houve resposta) e vira a frase de
 * ausência pelo `estaVazio`; a falta de resposta chega como
 * `unavailable` e diz outra coisa.
 */
export function Romaneio({
  romaneioId,
  onVoltar,
}: {
  romaneioId: string
  onVoltar: () => void
}) {
  const consulta = useRomaneio(romaneioId)
  const estado = derivarEstado(consulta)

  return (
    <div className="mx-auto max-w-3xl">
      <Consulta
        estado={estado}
        estaVazio={(r) => r === null}
        vazio={
          <div>
            <Button variant="ghost" className="mb-3" onClick={onVoltar}>
              ← Voltar
            </Button>
            <p className="text-sm text-muted-foreground">Romaneio não encontrado.</p>
          </div>
        }
        aoRecarregar={() => void consulta.refetch()}
      >
        {(romaneio) =>
          romaneio ? <RomaneioCarregado romaneio={romaneio} onVoltar={onVoltar} /> : null
        }
      </Consulta>
    </div>
  )
}

function RomaneioCarregado({
  romaneio,
  onVoltar,
}: {
  romaneio: RomaneioCompleto
  onVoltar: () => void
}) {
  const [ocupado, setOcupado] = useState<ViaDoRomaneio | 'drive' | null>(null)
  const [erroPdf, setErroPdf] = useState<string | null>(null)
  const [enviadoAoDrive, setEnviadoAoDrive] = useState<string | null>(null)

  // Pré-carrega o script do Google ao montar, pra o clique não gastar o
  // gesto do usuário esperando rede — o pop-up de autorização aberto tarde
  // demais é bloqueado pelo navegador. Mesma armadilha já paga no acerto.
  useEffect(() => {
    prepararDrive()
  }, [])

  // O romaneio chega por PROP, já estreitado — e isso deixou de ser
  // disciplina pra ser tipo. Antes as funções carregavam um
  // `if (!data) return` cada, porque o `data` da query é
  // `RomaneioCompleto | undefined`; o risco que aqueles guards seguravam
  // era o nome do arquivo, que é a chave de dedupe no Drive: um
  // "romaneio-undefined-farmacia.pdf" pousando numa pasta é pior que um
  // erro, porque parece um arquivo.
  //
  // Agora não há como escrever isso — a página só monta com romaneio.
  //
  // TODO: quando a correção cadastral por evento existir (categoria 1 da
  // regra 7), as correções entram aqui — a seção do PDF já está pronta pra
  // recebê-las.
  const nomeDoArquivo = (romaneio: RomaneioCompleto, via: ViaDoRomaneio) =>
    `romaneio-${romaneio.numero}-${via}.pdf`

  async function gerarPdf(romaneio: RomaneioCompleto, via: ViaDoRomaneio) {
    // Import dinâmico: é ele que puxa o jspdf, e ninguém deve baixar
    // 400 kB só por abrir a página do romaneio.
    const { montarRomaneioPdf } = await import('@/lib/romaneioPdf')
    const bytes = await montarRomaneioPdf(romaneio, via, [])
    return new Blob([bytes], { type: 'application/pdf' })
  }

  async function baixar(via: ViaDoRomaneio) {
    setErroPdf(null)
    setEnviadoAoDrive(null)
    setOcupado(via)
    try {
      baixarArquivo(await gerarPdf(romaneio, via), nomeDoArquivo(romaneio, via), 'application/pdf')
    } catch (e) {
      setErroPdf(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(null)
    }
  }

  async function enviarParaDrive() {
    setErroPdf(null)
    setEnviadoAoDrive(null)
    setOcupado('drive')
    try {
      // AUTORIZA PRIMEIRO, antes de gerar os PDFs. Gerar leva centenas de
      // milissegundos e o pop-up aberto depois disso deixa de contar como
      // resposta ao clique.
      const {
        autorizarDrive,
        enviarAoDrive,
        caminhoDoRomaneio,
        novoCachePastas,
        NOME_DA_PASTA_ROMANEIOS,
      } = await import('@/lib/googleDrive')
      await autorizarDrive()

      // As DUAS vias, porque a da farmácia é o arquivo e a da agência é o
      // que se compartilha — e as duas saem do mesmo snapshot selado.
      // Cada uma vai pra sua subpasta, então são dois envios; o cache
      // compartilhado evita repetir a busca de filial/mês/dia.
      const aconteceu = quandoAconteceu(romaneio)
      const cache = novoCachePastas()
      const enviados = []
      for (const via of ['farmacia', 'agencia'] as const) {
        enviados.push(
          ...(await enviarAoDrive(
            [{ nome: nomeDoArquivo(romaneio, via), blob: await gerarPdf(romaneio, via) }],
            caminhoDoRomaneio(romaneio.lojaNome, aconteceu, via),
            cache
          ))
        )
      }

      const atualizados = enviados.filter((e) => e.atualizado).length
      const observacao = atualizados > 0 ? ` (${atualizados} já existiam e foram substituídos)` : ''
      const ateODia = caminhoDoRomaneio(romaneio.lojaNome, aconteceu, 'farmacia').slice(1, -1)
      setEnviadoAoDrive(
        `${enviados.length} arquivos em ${NOME_DA_PASTA_ROMANEIOS} › ` +
          `${ateODia.join(' › ')}, um em cada via${observacao}.`
      )
    } catch (e) {
      setErroPdf(`Não foi possível enviar ao Drive: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setOcupado(null)
    }
  }

  // O slot da farmácia é `caixa` na saída e `responsavel_loja` no retorno —
  // os dois literais estão dentro do hash e nunca mudam. "Não é motoboy" é
  // a pergunta certa; `=== 'caixa'` deixava o retorno sem quem recebeu.
  const farmacia = romaneio.assinaturas.find(ehDaFarmacia)
  const motoboy = romaneio.assinaturas.find((a) => !ehDaFarmacia(a))

  return (
    // Sem `mx-auto max-w-3xl` aqui: quem dá o container é a casca da
    // consulta, pra a mensagem de indisponível cair na mesma coluna que
    // o documento cairia.
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onVoltar}>
          ← Voltar
        </Button>
        {/* Duas vias porque os destinatários são dois: a da agência omite
            o que é dado comercial da farmácia — o valor da compra na saída,
            e como o cliente pagou no retorno. */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!!ocupado} onClick={() => void baixar('farmacia')}>
            {ocupado === 'farmacia' ? <EmAndamento>Gerando</EmAndamento> : 'PDF — via da farmácia'}
          </Button>
          <Button variant="outline" disabled={!!ocupado} onClick={() => void baixar('agencia')}>
            {ocupado === 'agencia' ? <EmAndamento>Gerando</EmAndamento> : 'PDF — via da agência'}
          </Button>
          {/* Sem VITE_GOOGLE_CLIENT_ID o botão não aparece: prometer envio
              num ambiente que não tem como autorizar seria a tela
              afirmando o que não sabe. */}
          {driveConfigurado() && (
            <Button variant="outline" disabled={!!ocupado} onClick={() => void enviarParaDrive()}>
              {ocupado === 'drive' ? <EmAndamento>Enviando</EmAndamento> : 'Enviar ao Drive'}
            </Button>
          )}
        </div>
      </div>
      {erroPdf && <p className="mb-3 text-sm text-destructive">{erroPdf}</p>}
      {enviadoAoDrive && <p className="mb-3 text-sm text-foreground/70">{enviadoAoDrive}</p>}

      {romaneio.tipo === 'retorno' ? (
        <DocumentoRetorno romaneio={romaneio} farmacia={farmacia} motoboy={motoboy} />
      ) : (
        <DocumentoSaida romaneio={romaneio} farmacia={farmacia} motoboy={motoboy} />
      )}
    </div>
  )
}

type PropsDoDocumento = {
  romaneio: RomaneioCompleto
  farmacia: AssinaturaDoRomaneio | undefined
  motoboy: AssinaturaDoRomaneio | undefined
}

function DocumentoSaida({ romaneio, farmacia, motoboy }: PropsDoDocumento) {
  const payload = romaneio.payload as { vales?: ValeDoPayload[] } | null
  const vales = payload?.vales ?? []
  const totalEntrega = vales.reduce((s, v) => s + v.valor_entrega_cents, 0)
  const totalCompra = vales.reduce((s, v) => s + v.valor_compra_cents, 0)
  const totalVales = vales.reduce((s, v) => s + v.quantidade_vales, 0)

  // Os relógios do retorno têm TRÊS estados que não podem se parecer, e
  // um campo vazio diria a mesma coisa nos três:
  //   - romaneio em conflito não tem corrida nenhuma (a saída não selou);
  //   - corrida aberta tem corrida e ainda não tem retorno;
  //   - corrida fechada antes de 2026-08-10 tem o relógio do servidor e
  //     nunca teve o do dispositivo, porque a coluna não existia.
  // Antes daqui a tela dizia "corrida ainda aberta" também no primeiro
  // caso, que é a tela afirmando o que não sabe.
  const corrida = romaneio.corrida
  const retornoServidor = !corrida
    ? 'sem corrida vinculada'
    : corrida.retornoEm
      ? new Date(corrida.retornoEm).toLocaleString('pt-BR')
      : 'corrida ainda aberta'
  const retornoBalcao = !corrida
    ? 'sem corrida vinculada'
    : !corrida.retornoEm
      ? 'corrida ainda aberta'
      : corrida.retornoEmLocal
        ? new Date(corrida.retornoEmLocal).toLocaleString('pt-BR')
        : 'não registrado'

  return (
    <Card>
      <CardHeader>
        <Cabecalho titulo={`Romaneio ${romaneio.numero}`} romaneio={romaneio} />
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <section className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Campo rotulo="Filial" valor={romaneio.lojaNome} />
          <Campo rotulo="Agência" valor={motoboy?.agenciaNome ?? null} />
          <Campo rotulo="Motoboy" valor={motoboy?.nome ?? null} />
          {/* "Pela farmácia", não "Caixa": quem sela pode ser caixa,
              gerente ou admin, e o sistema não impõe papel na saída. O
              cargo real de quem assinou aparece na Custódia, vindo de
              `papel_no_momento`. */}
          <Campo rotulo="Pela farmácia" valor={romaneio.criadoPorNome} />
          <Campo rotulo="IP" valor={romaneio.ip} />
        </section>

        {/* OS RELÓGIOS, em duas colunas FIXAS: balcão à esquerda,
            servidor à direita. Antes eram um grid de fluxo automático
            com dois campos condicionais no meio, então "Retorno
            (balcão)" caía do lado do servidor e vice-versa conforme o
            romaneio. A regra 8 só serve pra alguma coisa se der pra
            comparar os dois relógios de bater o olho, e coluna que troca
            de lado desfaz isso. Colunas explícitas — e não ordem de
            fluxo — é o que garante o pareamento mesmo com campo opcional
            entre eles. */}
        <section className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Campo rotulo="Saída (balcão)" valor={dataHora(romaneio.ocorridoEmLocal)} />
            {/* Corrida ainda aberta é DITA, nunca omitida: campo ausente
                e "o motoboy não voltou" não podem se parecer, e a
                diferença é o que alguém procura ao abrir este
                documento. */}
            <Campo rotulo="Retorno (balcão)" valor={retornoBalcao} />
          </div>
          <div className="flex flex-col gap-1">
            <Campo rotulo="Selado (servidor)" valor={dataHora(romaneio.seladoEm)} />
            {/* Só faz diferença quando os dois horários divergem, que é
                exatamente o caso da saída offline. */}
            {romaneio.modo === 'offline_sincronizada' && (
              <Campo rotulo="Recebido (servidor)" valor={dataHora(romaneio.recebidoEmServidor)} />
            )}
            <Campo rotulo="Retorno (servidor)" valor={retornoServidor} />
          </div>
          {/* A duração usa o relógio do SERVIDOR nos dois lados —
              misturar com o do dispositivo daria um intervalo que não
              aconteceu. Por ser derivada dos dois, fica embaixo das duas
              colunas, não dentro de uma delas. */}
          <div className="sm:col-span-2">
            <Campo
              rotulo="Duração"
              valor={duracaoDaCorrida(corrida?.saidaEm ?? null, corrida?.retornoEm ?? null)}
            />
          </div>
        </section>

        <section>
          <Subtitulo>O que saiu</Subtitulo>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vale</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-center">Vales</TableHead>
                <TableHead className="text-center">Compra</TableHead>
                <TableHead className="text-center">Entrega</TableHead>
                <TableHead className="text-center">Pagamento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vales.map((vale) => (
                <TableRow key={vale.entrega_id}>
                  <TableCell className="font-medium tabular-nums">{vale.numero_vale}</TableCell>
                  <TableCell className="whitespace-normal break-words">
                    <p className="text-sm font-medium">{vale.cliente_nome}</p>
                    <p className="text-xs text-foreground/70">{vale.cliente_endereco}</p>
                  </TableCell>
                  <TableCell className="text-center tabular-nums">{vale.quantidade_vales}</TableCell>
                  <TableCell className="text-center tabular-nums">
                    {vale.tipo === 'transferencia' ? '—' : formatBRL(vale.valor_compra_cents)}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {formatBRL(vale.valor_entrega_cents)}
                  </TableCell>
                  <TableCell className="whitespace-normal text-center text-xs">
                    {(vale.pagamentos_previstos ?? []).map((p) => p.forma).join(' + ') || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-sm">
            <strong>{vales.length}</strong> entrega(s) · <strong>{totalVales}</strong> vale(s) ·{' '}
            <strong>{formatBRL(totalCompra)}</strong> em compras ·{' '}
            <strong>{formatBRL(totalEntrega)}</strong> em teles
          </p>
        </section>

        {romaneio.status === 'conflito' ? (
          <SecaoConflito
            romaneio={romaneio}
            titulo="Esta saída não pôde ser selada."
            texto="Os vales já estavam em outra corrida quando esta saída sincronizou. O registro foi guardado, e os vales continuam na corrida que foi selada primeiro. A gestão precisa resolver."
          />
        ) : (
          <SecaoCustodia farmacia={farmacia} motoboy={motoboy} />
        )}

        <SecaoIntegridade romaneio={romaneio} farmacia={farmacia} motoboy={motoboy} />
      </CardContent>
    </Card>
  )
}

// O RETORNO: o que voltou, e só o que ele ACRESCENTA à saída.
//
// Nada de endereço nem de valor de compra/entrega: estão selados na saída, e
// o DCRR1 os referencia pelo `saida_hash` em vez de copiá-los. A leitura sai
// de `lerRetorno` — a mesma do PDF —, com os documentos vindos das linhas `d`
// do canônico assinado.
function DocumentoRetorno({ romaneio, farmacia, motoboy }: PropsDoDocumento) {
  const leitura = lerRetorno(romaneio.payload, romaneio.canonico)
  const corrida = romaneio.corrida

  return (
    <Card>
      <CardHeader>
        <Cabecalho titulo={`Romaneio de retorno ${romaneio.numero}`} romaneio={romaneio} />
        {/* O número é rótulo para quem procura o papel. Quem amarra os dois
            documentos é o `saida_hash` dentro do DCRR1. */}
        <p className="text-sm text-foreground/70">
          Referente à saída{' '}
          <strong className="text-foreground">{romaneio.saidaNumero ?? '(número não disponível)'}</strong>
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <section className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Campo rotulo="Filial" valor={romaneio.lojaNome} />
          <Campo rotulo="Agência" valor={motoboy?.agenciaNome ?? null} />
          <Campo rotulo="Motoboy" valor={motoboy?.nome ?? null} />
          {/* Quem RECEBEU pela farmácia — caixa, gerente ou admin. O cargo
              no instante vem na Custódia, de `papel_no_momento`. */}
          <Campo rotulo="Recebido por" valor={farmacia?.nome ?? romaneio.criadoPorNome} />
          <Campo rotulo="IP" valor={romaneio.ip} />
        </section>

        {/* Mesmo pareamento da saída: balcão à esquerda, servidor à direita. */}
        <section className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Campo rotulo="Retorno (balcão)" valor={dataHora(romaneio.ocorridoEmLocal)} />
          </div>
          <div className="flex flex-col gap-1">
            <Campo rotulo="Selado (servidor)" valor={dataHora(romaneio.seladoEm)} />
            {romaneio.modo === 'offline_sincronizada' && (
              <Campo rotulo="Recebido (servidor)" valor={dataHora(romaneio.recebidoEmServidor)} />
            )}
            <Campo rotulo="Saída (servidor)" valor={dataHora(corrida?.saidaEm ?? null)} />
          </div>
          <div className="sm:col-span-2">
            <Campo
              rotulo="Duração"
              valor={duracaoDaCorrida(corrida?.saidaEm ?? null, corrida?.retornoEm ?? null)}
            />
          </div>
        </section>

        <section>
          <Subtitulo>{leitura.declarado ? 'O que foi declarado' : 'O que voltou'}</Subtitulo>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vale</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-center">Desfecho</TableHead>
                <TableHead className="text-center">Pagamento</TableHead>
                <TableHead className="text-center">Documentos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leitura.vales.map((vale) => (
                <TableRow key={vale.entregaId}>
                  <TableCell className="font-medium tabular-nums">
                    {vale.numeroVale ?? `${vale.entregaId.slice(0, 8)}…`}
                  </TableCell>
                  <TableCell className="whitespace-normal break-words">
                    <p className="text-sm font-medium">{vale.clienteNome ?? '—'}</p>
                    {vale.tipo === 'transferencia' && (
                      <p className="text-xs text-foreground/70">Transferência</p>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal text-center text-sm">
                    <p>{textoDoDesfecho(vale)}</p>
                    {vale.detalhe && <p className="text-xs text-foreground/70">{vale.detalhe}</p>}
                  </TableCell>
                  <TableCell className="whitespace-normal text-center text-xs tabular-nums">
                    {vale.realizados.length === 0
                      ? '—'
                      : vale.realizados.map((p, i) => <p key={i}>{textoDoPagamentoRealizado(p)}</p>)}
                    {vale.situacaoPagamento === 'divergiu' && (
                      <p className="font-medium text-amber-700 dark:text-amber-400">
                        diverge do previsto
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal text-center text-xs">
                    {vale.documentos.length === 0
                      ? '—'
                      : vale.documentos.map((d) => (
                          <p
                            key={d.tipo}
                            className={d.situacao === 'faltante' ? 'font-medium text-destructive' : ''}
                          >
                            {textoDoDocumento(d)}
                          </p>
                        ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-sm">
            <strong>{leitura.vales.length}</strong> vale(s) · <strong>{leitura.entregues}</strong>{' '}
            entregue(s) · <strong>{leitura.insucessos}</strong> insucesso(s)
            {leitura.documentosRecebidos + leitura.documentosFaltantes > 0 && (
              <>
                {' '}
                · documentos: <strong>{leitura.documentosRecebidos}</strong> recebido(s),{' '}
                <strong>{leitura.documentosFaltantes}</strong> faltante(s)
              </>
            )}
            {leitura.pagamentosDivergentes > 0 && (
              <>
                {' '}
                · <strong>{leitura.pagamentosDivergentes}</strong> pagamento(s) divergente(s)
              </>
            )}
          </p>
        </section>

        {romaneio.status === 'conflito' ? (
          <SecaoConflito
            romaneio={romaneio}
            titulo="Este retorno não pôde ser selado."
            texto="O registro foi guardado, e a corrida continua aberta. Nada acima foi aplicado aos vales. A gestão precisa resolver."
          />
        ) : (
          <SecaoCustodia farmacia={farmacia} motoboy={motoboy} />
        )}

        <SecaoIntegridade romaneio={romaneio} farmacia={farmacia} motoboy={motoboy} />
      </CardContent>
    </Card>
  )
}

function Cabecalho({ titulo, romaneio }: { titulo: string; romaneio: RomaneioCompleto }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CardTitle>{titulo}</CardTitle>
      {romaneio.status === 'conflito' ? (
        <Badge variant="destructive">Conflito — não selado</Badge>
      ) : (
        <Badge variant="secondary">Selado</Badge>
      )}
      {romaneio.modo === 'offline_sincronizada' && <Badge variant="outline">Registrado offline</Badge>}
    </div>
  )
}

function Subtitulo({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold tracking-wider uppercase text-foreground/70">
      {children}
    </h3>
  )
}

function SecaoConflito({
  romaneio,
  titulo,
  texto,
}: {
  romaneio: RomaneioCompleto
  titulo: string
  texto: string
}) {
  return (
    <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <p className="mb-2 font-medium text-destructive">{titulo}</p>
      <p>{texto}</p>
      <pre className="mt-2 overflow-x-auto rounded bg-background/60 p-2 text-xs">
        {JSON.stringify(
          (romaneio.conflito as { motivos?: unknown })?.motivos ?? romaneio.conflito,
          null,
          2
        )}
      </pre>
    </section>
  )
}

function SecaoCustodia({
  farmacia,
  motoboy,
}: {
  farmacia: AssinaturaDoRomaneio | undefined
  motoboy: AssinaturaDoRomaneio | undefined
}) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold tracking-wider uppercase text-foreground/70">
        Custódia
      </h3>
      <div className="grid gap-6 sm:grid-cols-2">
        {farmacia && <BlocoAssinatura assinatura={farmacia} />}
        {motoboy && <BlocoAssinatura assinatura={motoboy} />}
      </div>
    </section>
  )
}

function SecaoIntegridade({ romaneio, farmacia, motoboy }: PropsDoDocumento) {
  return (
    <section className="border-t pt-4">
      <Subtitulo>Integridade</Subtitulo>
      {/* Os hashes por extenso, não abreviados: esta é a tela onde
          alguém confere um contra o outro documento. Abreviar aqui
          tiraria justamente a utilidade. */}
      <div className="flex flex-col gap-1 font-mono text-[11px] break-all">
        <p>
          <span className="text-foreground/60">documento </span>
          {romaneio.documentHash}
        </p>
        {farmacia?.signatureHash && (
          <p>
            <span className="text-foreground/60">assin. farmácia </span>
            {farmacia.signatureHash}
          </p>
        )}
        {motoboy?.signatureHash && (
          <p>
            <span className="text-foreground/60">assin. motoboy </span>
            {motoboy.signatureHash}
          </p>
        )}
        {romaneio.finalHash && (
          <p className="font-semibold">
            <span className="font-normal text-foreground/60">envelope </span>
            {romaneio.finalHash}
          </p>
        )}
      </div>
    </section>
  )
}

function dataHora(iso: string | null): string | null {
  return iso ? new Date(iso).toLocaleString('pt-BR') : null
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div className="flex gap-2">
      <span className="w-40 shrink-0 text-foreground/60">{rotulo}</span>
      <span className="break-words">{valor ?? '—'}</span>
    </div>
  )
}
