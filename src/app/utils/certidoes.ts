// Helpers de domínio do Controle Cadastro (checklist de certidões).
// Tipos e constantes ficam em src/app/types.ts; aqui só a lógica.

import type {
  CadastroCertidao,
  CadastroCertidaoColuna,
  CadastroResultado,
  CadastroStatus,
  ChecklistCadastroItem,
  Empresa,
} from '@/app/types';

/** Normaliza a UF da empresa pra sigla de 2 letras maiúsculas (best-effort). */
export function ufDaEmpresa(empresa: Pick<Empresa, 'estado'>): string {
  const raw = (empresa.estado ?? '').trim();
  if (!raw) return '';
  const up = raw.toUpperCase();
  if (up.length === 2) return up;
  // Alguns cadastros guardam o nome do estado por extenso.
  const norm = up.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (norm.includes('SAO PAULO')) return 'SP';
  if (norm.includes('MINAS')) return 'MG';
  return up.slice(0, 2);
}

export function empresaEhSP(empresa: Pick<Empresa, 'estado'>): boolean {
  return ufDaEmpresa(empresa) === 'SP';
}

/** Mapeia uma certidão gravada de volta pra coluna visível do checklist. */
export function colunaDaCertidao(certidao: CadastroCertidao): CadastroCertidaoColuna {
  if (certidao === 'ESTADUAL_ADM' || certidao === 'ESTADUAL_DA') return 'ESTADUAL';
  return certidao as CadastroCertidaoColuna;
}

/** Sub-célula renderizada dentro de uma coluna pra uma empresa. */
export interface CelulaCertidao {
  certidao: CadastroCertidao;
  subLabel?: string; // ex.: "Adm." / "Dív. Ativa" (só SP)
}

/**
 * Quais células uma empresa mostra em cada coluna. ESTADUAL vira 2 sub-células
 * (Administrativa + Dívida Ativa) só pra empresas de SP; nas demais UFs é uma
 * célula única. As outras colunas são sempre 1 célula.
 */
export function celulasDaColuna(
  coluna: CadastroCertidaoColuna,
  empresa: Pick<Empresa, 'estado'>,
): CelulaCertidao[] {
  if (coluna === 'ESTADUAL' && empresaEhSP(empresa)) {
    return [
      { certidao: 'ESTADUAL_ADM', subLabel: 'Adm.' },
      { certidao: 'ESTADUAL_DA', subLabel: 'Dív. Ativa' },
    ];
  }
  return [{ certidao: coluna as CadastroCertidao }];
}

/**
 * Colunas que exibem um slot de RELATÓRIO ao lado da certidão na tabela
 * (Federal: situação fiscal federal; Estadual: ex. planilha do MG). O relatório
 * fica na linha da própria coluna ('FEDERAL' / 'ESTADUAL'), separado das
 * sub-células de certidão — em SP, ESTADUAL_ADM/ESTADUAL_DA guardam o resultado
 * e a linha 'ESTADUAL' carrega só o relatório (sem colisão).
 */
export const COLUNAS_COM_RELATORIO = ['ESTADUAL', 'FEDERAL'] as const;

export function colunaTemRelatorio(coluna: CadastroCertidaoColuna): boolean {
  return (COLUNAS_COM_RELATORIO as readonly string[]).includes(coluna);
}

/** Chave de certidão onde o relatório da coluna é guardado. */
export function certidaoDoRelatorio(coluna: CadastroCertidaoColuna): CadastroCertidao {
  return coluna as CadastroCertidao; // 'ESTADUAL' | 'FEDERAL'
}

/**
 * Regra do escritório sobre o que pode ser enviado ao cliente:
 *   - Negativa: sempre envia.
 *   - PEN (positiva com efeito de negativa): envia, EXCETO Trabalhista e FGTS
 *     (essas duas só saem se forem Negativa).
 *   - Positiva (e null): nunca envia.
 */
export function certidaoPodeEnviar(
  coluna: CadastroCertidaoColuna,
  resultado: CadastroResultado | null | undefined,
): boolean {
  if (resultado === 'Negativa') return true;
  if (resultado === 'PEN') return coluna !== 'FGTS' && coluna !== 'TRABALHISTA';
  return false;
}

/**
 * Resultados que fazem sentido oferecer no seletor de cada coluna:
 *   - FGTS/Trabalhista: Negativa (regular) ou Positiva (irregular). Sem PEN.
 *   - Federal: Negativa ou PEN — nunca Positiva.
 *   - Estadual/Municipal: os três (MG aceita Positiva; SP/outros, na prática, só
 *     Neg/PEN — mas deixamos os três e o gate de envio (certidaoPodeEnviar) decide).
 */
export function resultadosPermitidos(coluna: CadastroCertidaoColuna): CadastroResultado[] {
  if (coluna === 'FGTS' || coluna === 'TRABALHISTA') return ['Negativa', 'Positiva'];
  if (coluna === 'FEDERAL') return ['Negativa', 'PEN'];
  return ['Negativa', 'PEN', 'Positiva'];
}

export type CorCadastro = 'verde' | 'vermelho' | 'azul';

/**
 * Cor da célula, derivada do conteúdo:
 *   verde    = possui a certidão (arquivo anexado) — ou status manual 'tem'
 *   azul     = só relatório (sem certidão) — ou status manual 'relatorio'
 *   vermelho = não possui nada — ou status manual 'falta'
 * O status manual, quando presente, tem prioridade sobre a derivação.
 */
export function corCadastro(item: ChecklistCadastroItem | undefined): CorCadastro {
  const status: CadastroStatus | null | undefined = item?.status;
  if (status === 'tem') return 'verde';
  if (status === 'relatorio') return 'azul';
  if (status === 'falta') return 'vermelho';
  if (item?.arquivoUrl) return 'verde';
  if (item?.relatorioUrl || (item?.relatorioTexto && item.relatorioTexto.trim())) return 'azul';
  return 'vermelho';
}

/**
 * Cor da célula POR RESULTADO (mais informativa que só "tem/falta"):
 *   negativa  = verde   (tudo certo)
 *   pen       = âmbar   (positiva c/ efeito de negativa — sai, mas atenção)
 *   positiva  = vermelho (não sai pro cliente)
 *   relatorio = azul    (só relatório, sem certidão classificada)
 *   tem       = cinza   (tem certidão anexada mas sem resultado classificado)
 *   falta     = neutro  (não tem nada)
 * O resultado tem prioridade sobre tudo; sem resultado, cai na posse.
 */
export type CorCelulaCadastro = 'negativa' | 'pen' | 'positiva' | 'relatorio' | 'tem' | 'falta';

export function corCelulaCadastro(
  item: ChecklistCadastroItem | undefined,
  // ignorarRelatorio: nas colunas com célula de relatório própria (Federal/Estadual),
  // a célula da CERTIDÃO não deve ficar azul por causa do relatório — o azul vive na
  // coluninha do relatório. Sem isso, "só relatório" cairia como 'falta' (neutro).
  opts?: { ignorarRelatorio?: boolean },
): CorCelulaCadastro {
  const r = item?.resultado;
  if (r === 'Negativa') return 'negativa';
  if (r === 'PEN') return 'pen';
  if (r === 'Positiva') return 'positiva';
  if (item?.status === 'tem' || item?.arquivoUrl) return 'tem';
  if (!opts?.ignorarRelatorio && (item?.status === 'relatorio' || item?.relatorioUrl || (item?.relatorioTexto && item.relatorioTexto.trim()))) return 'relatorio';
  return 'falta';
}

/** Chave do Map local da página: `${empresaId}|${certidao}`. */
export function buildCadastroKey(empresaId: string, certidao: CadastroCertidao): string {
  return `${empresaId}|${certidao}`;
}
