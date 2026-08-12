import type { ReactNode } from 'react'
import type { AuthProfile } from '@/data/auth'
import {
  useDocumentosConvenioPendentes,
  useMarcarDocumentoConvenioRecebido,
  useReceitasPendentes,
  useMarcarReceitaRecebida,
} from '@/data/documentos'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

// A lista tem teto — se bateu nele, diz na cara em vez de deixar o caixa
// achar que acabou. Aparece só quando realmente há mais pendência.
function AvisoTemMais({ mostrar }: { mostrar: boolean }) {
  if (!mostrar) return null
  return (
    <p className="text-sm text-destructive">
      Há mais pendências do que cabe nesta lista — vai limpando as mais antigas (que aparecem
      primeiro) que o resto aparece.
    </p>
  )
}

// As duas listas (convênio e receita) não têm os mesmos campos, mas têm as
// mesmas PERGUNTAS: qual vale, de quem, desde quando, e o botão de dar
// baixa. Antes eram duas tabelas independentes com contagem de colunas
// diferente, então cada uma calculava as larguras por conta e as colunas
// iguais não se alinhavam entre si.
//
// Aqui as duas usam a mesma grade, e `table-fixed` é o que garante o
// alinhamento: sem ele, o layout automático ainda dimensionaria cada
// tabela pelo próprio conteúdo e o "Cliente" de uma cairia num x
// diferente do "Cliente" da outra. A coluna do meio existe nas duas —
// quando não há convênio, mostra "—" em vez de sumir e desalinhar tudo.
const LARGURAS = ['w-[16%]', 'w-[30%]', 'w-[22%]', 'w-[14%]', 'w-[18%]']

type LinhaPendencia = {
  id: string
  numeroVale: string
  clienteNome: string
  meio: string
  desde: string
}

function TabelaPendencias({
  linhas,
  rotuloMeio,
  rotuloAcao,
  onAcao,
}: {
  linhas: LinhaPendencia[]
  rotuloMeio: string
  rotuloAcao: string
  onAcao: (id: string) => void
}) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className={LARGURAS[0]}>Vale</TableHead>
          <TableHead className={LARGURAS[1]}>Cliente</TableHead>
          <TableHead className={LARGURAS[2]}>{rotuloMeio}</TableHead>
          <TableHead className={LARGURAS[3]}>Desde</TableHead>
          <TableHead className={LARGURAS[4]} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {linhas.map((linha) => (
          <TableRow key={linha.id}>
            <TableCell className="tabular-nums">{linha.numeroVale}</TableCell>
            <TableCell className="whitespace-normal break-words">{linha.clienteNome}</TableCell>
            <TableCell className="whitespace-normal break-words">{linha.meio}</TableCell>
            <TableCell className="tabular-nums">{formatarData(linha.desde)}</TableCell>
            <TableCell>
              <Button variant="outline" size="sm" onClick={() => onAcao(linha.id)}>
                {rotuloAcao}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{titulo}</h3>
      {children}
    </div>
  )
}

function DocumentosConvenio({ profile }: { profile: AuthProfile }) {
  const { data, isLoading, isError, error } = useDocumentosConvenioPendentes()
  const marcarRecebido = useMarcarDocumentoConvenioRecebido()

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError) return <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>
  if (!data || data.itens.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum documento de convênio pendente.</p>
  }

  return (
    <>
      <AvisoTemMais mostrar={data.temMais} />
      <TabelaPendencias
        rotuloMeio="Convênio"
        rotuloAcao="Marcar recebido"
        linhas={data.itens.map((doc) => ({
          id: doc.id,
          numeroVale: doc.numeroVale,
          clienteNome: doc.clienteNome,
          meio: doc.convenioNome ?? '—',
          desde: doc.ocorridoEmLocal,
        }))}
        onAcao={(id) =>
          marcarRecebido.mutate({
            entregaId: id,
            recebidoPor: profile.id,
            ocorridoEmLocal: new Date().toISOString(),
          })
        }
      />
    </>
  )
}

function ReceitasPendentes({ profile }: { profile: AuthProfile }) {
  const { data, isLoading, isError, error } = useReceitasPendentes()
  const marcarRecebida = useMarcarReceitaRecebida()

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError) return <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>
  if (!data || data.itens.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma receita pendente de devolução.</p>
  }

  return (
    <>
      <AvisoTemMais mostrar={data.temMais} />
      <TabelaPendencias
        rotuloMeio="Documento"
        rotuloAcao="Marcar devolvida"
        linhas={data.itens.map((receita) => ({
          id: receita.id,
          numeroVale: receita.numeroVale,
          clienteNome: receita.clienteNome,
          // receita não tem convênio: a coluna do meio existe só pra as
          // duas tabelas continuarem alinhadas coluna a coluna.
          meio: 'Receita',
          desde: receita.ocorridoEmLocal,
        }))}
        onAcao={(id) =>
          marcarRecebida.mutate({
            entregaId: id,
            recebidoPor: profile.id,
            ocorridoEmLocal: new Date().toISOString(),
          })
        }
      />
    </>
  )
}

export function DocumentosPendentes({ profile }: { profile: AuthProfile }) {
  return (
    <div className="flex flex-col gap-6">
      <Secao titulo="Documentos de convênio">
        <DocumentosConvenio profile={profile} />
      </Secao>
      <Secao titulo="Receitas">
        <ReceitasPendentes profile={profile} />
      </Secao>
    </div>
  )
}
