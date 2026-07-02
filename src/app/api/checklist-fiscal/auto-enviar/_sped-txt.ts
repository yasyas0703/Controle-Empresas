// Reconhecimento e parse do arquivo .txt do SPED EFD-Fiscal (ICMS/IPI).
//
// Diferente das guias/livros, isto NÃO é PDF: é um arquivo de registros
// pipe-delimitados (um por linha). Só interessa o cabeçalho |0000|, que traz o
// PERÍODO de apuração e o CNPJ do declarante — o resto (|0150|, |0200|…) é
// participante/produto e não precisamos ler.
//
// Só empresas com RET cuja raiz de CNPJ está em SPED_TXT_CNPJ_RAIZES (hoje só a
// HEDRONS) mandam esse .txt anexado no lote combinado; qualquer outro .txt vira
// pendência no route (não vaza). Ver empresaEnviaSpedTxt em validarGuia.ts.

/**
 * True se o buffer parece um SPED EFD-Fiscal: a 1ª linha não-vazia começa com
 * `|0000|`. Olha só o começo — o arquivo pode ter dezenas de milhares de linhas.
 * Usa latin1 porque só precisamos casar caracteres ASCII (pipes/dígitos).
 */
export function ehSpedFiscalTxt(buffer: Buffer): boolean {
  const inicio = buffer.subarray(0, 4096).toString('latin1');
  for (const linha of inicio.split(/\r?\n/)) {
    const t = linha.trim();
    if (!t) continue;
    return /^\|0000\|/.test(t);
  }
  return false;
}

export interface CabecalhoSped {
  /** 14 dígitos do CNPJ do declarante (campo 7 do |0000|), ou null. */
  cnpj: string | null;
  /** Competência YYYY-MM derivada de DT_INI (campo 4), ou null. */
  competencia: string | null;
}

/**
 * Lê o registro |0000| do SPED EFD-Fiscal. Layout (campos separados por `|`):
 *   |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|UF|IE|COD_MUN|...
 * Após `split('|')` (o 1º elemento é vazio, antes da 1ª barra):
 *   [1]=0000  [4]=DT_INI(ddmmaaaa)  [5]=DT_FIN  [6]=NOME  [7]=CNPJ
 * A competência é o mês de DT_INI DIRETO (SPED não tem "vencimento" pra subtrair).
 */
export function parseCabecalhoSped(buffer: Buffer): CabecalhoSped {
  const inicio = buffer.subarray(0, 4096).toString('latin1');
  const linha = inicio
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^\|0000\|/.test(l));
  if (!linha) return { cnpj: null, competencia: null };

  const campos = linha.split('|');
  const dtIni = (campos[4] ?? '').replace(/\D/g, ''); // ddmmaaaa
  const cnpjDigitos = (campos[7] ?? '').replace(/\D/g, '');

  let competencia: string | null = null;
  if (dtIni.length === 8) {
    const mes = dtIni.slice(2, 4);
    const ano = dtIni.slice(4, 8);
    const mNum = Number(mes);
    const aNum = Number(ano);
    if (mNum >= 1 && mNum <= 12 && aNum >= 2020 && aNum <= new Date().getUTCFullYear() + 1) {
      competencia = `${ano}-${mes}`;
    }
  }
  return { cnpj: cnpjDigitos.length === 14 ? cnpjDigitos : null, competencia };
}
