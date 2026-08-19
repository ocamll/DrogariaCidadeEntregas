// Onde cada documento mora no Google Drive.
//
// Este arquivo não importa nada além de `lib/datas.ts`, que também não
// importa nada — em particular, nem o cliente do Drive nem
// `import.meta.env`. É a mesma disciplina de `canonico.ts` e
// `tokenCartao.ts`: regra que decide onde um documento é arquivado tem
// que rodar num teste sem rede e sem consentimento OAuth, e um módulo que
// lê variável de ambiente do Vite não roda no Node.
import { dataLocal, mesLocal } from '@/lib/datas'
//
// O transporte (token, upload, criação de pasta) vive em `googleDrive.ts`.
// Aqui só se responde "que pastas".

/** A raiz de cada tipo de documento, lado a lado no Drive do usuário. */
export const PASTA_ACERTOS = 'Drogaria Cidade Entregas - Acertos'
export const PASTA_ROMANEIOS = 'Drogaria Cidade Entregas - Romaneios'

/**
 * Uma pasta por via, dentro do dia.
 *
 * O nome do arquivo já traz a via (`romaneio-R-000010-agencia.pdf`) e
 * **continua trazendo**: PDF baixado e mandado por e-mail sai da pasta, e
 * fora dela o nome é a única coisa que diz de qual via ele é.
 *
 * "Agência" e não "Tele", que é como a farmácia fala no balcão: o resto
 * do sistema inteiro chama de agência (Cadastros, "A pagar à agência", o
 * relatório por agência), e o Drive não é lugar pra um segundo
 * vocabulário.
 */
export const PASTA_DA_VIA: Record<ViaDoRomaneio, string> = {
  farmacia: 'Via da farmácia',
  agencia: 'Via da agência',
}

/**
 * As duas vias do romaneio. Repetido aqui em vez de importado de
 * `romaneioPdf.ts` porque este módulo não puxa nada — e aquele arquivo
 * carrega o gerador de PDF junto.
 */
export type ViaDoRomaneio = 'farmacia' | 'agencia'

/** Filial sem nome ainda precisa de uma pasta — sumir seria pior. */
export const SEM_FILIAL = 'Sem filial'

/**
 * `Acertos 01-02-2026 a 01-03-2026`. Reenviar o mesmo período cai na
 * mesma subpasta, então o histórico fica organizado por quinzena.
 */
export function nomeDaSubpasta(dataInicio: string, dataFim: string): string {
  const br = (iso: string) => iso.split('-').reverse().join('-')
  return `Acertos ${br(dataInicio)} a ${br(dataFim)}`
}

/** O acerto vive na pasta do período, e em mais nada. */
export function caminhoDoAcerto(periodo: { dataInicio: string; dataFim: string }): string[] {
  return [PASTA_ACERTOS, nomeDaSubpasta(periodo.dataInicio, periodo.dataFim)]
}

/**
 * O destino de cada romaneio:
 *
 *     Drogaria Cidade Entregas - Romaneios
 *       └── Matriz
 *             └── 2026-08
 *                   └── 2026-08-18
 *                         ├── Via da farmácia
 *                         │     └── romaneio-R-000010-farmacia.pdf
 *                         └── Via da agência
 *                               └── romaneio-R-000010-agencia.pdf
 *
 * **Um destino, não dois.** A primeira versão mandava cada romaneio
 * também pra uma pasta `Geral` com todas as filiais juntas; o usuário
 * desfez em 2026-08-19, e a razão dele é a que vale registrar: uma pasta
 * que acumula tudo não ajuda a achar nada — só empurra a busca pra
 * frente. Quem procura um romaneio sabe de que filial ele é.
 *
 * **`AAAA-MM` e `AAAA-MM-DD`, não `08/2026` e `18/08`.** Dois motivos, os
 * dois de fora do navegador: o Google Drive para Desktop renomeia pasta
 * com `/` ao sincronizar pro disco, e `01/2027` cairia entre `01/2026` e
 * `02/2026` na ordenação por nome. A pasta do dia repete o ano e o mês de
 * propósito — ela é linkada e citada solta, e um nome que se explica
 * sozinho vale os seis caracteres.
 *
 * **A data é a do FUSO LOCAL, e é aqui que estava a armadilha.** Fatiar a
 * string ISO daria o dia em UTC, e toda saída depois das 21h em São
 * Gabriel cairia no dia seguinte. Com pasta por mês isso errava uma vez
 * por mês; com pasta por dia, erraria toda noite. Ver `lib/datas.ts`.
 *
 * **Qual instante**: `ocorrido_em_local` primeiro — a saída pertence ao
 * dia em que ela aconteceu no balcão, não ao dia em que o servidor soube
 * dela. Numa saída offline os dois podem ser dias diferentes, e é o
 * primeiro que o operador reconhece. Sem ele, cai no selo e depois no
 * recebimento, que é a única coluna garantidamente preenchida. A cadeia
 * está em `quandoAconteceu`, em `data/romaneios.ts`.
 *
 * `ocorridoEm` é sempre um timestamp COMPLETO, vindo de uma coluna
 * `timestamptz`. Uma string só-data (`'2026-08-18'`) seria lida como
 * meia-noite UTC e, num fuso a oeste, cairia no dia anterior — não passe
 * uma.
 */
export function caminhoDoRomaneio(
  filial: string | null,
  ocorridoEm: string,
  via: ViaDoRomaneio
): string[] {
  const quando = new Date(ocorridoEm)
  const daFilial = filial?.trim() || SEM_FILIAL
  return [PASTA_ROMANEIOS, daFilial, mesLocal(quando), dataLocal(quando), PASTA_DA_VIA[via]]
}
