import ExcelJS from 'exceljs';
import type { Empresa, Departamento, Usuario } from '@/app/types';
import { normalizarNomeDepartamento, type DepartamentoSlug } from '@/app/utils/departamento';

function formatDate(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR');
}

function buildRespResolver(departamentos: Departamento[], usuarios: Usuario[]) {
  const userMap = new Map(usuarios.map((u) => [u.id, u.nome]));
  const depBySlug = new Map<DepartamentoSlug, string>();
  for (const d of departamentos) {
    const slug = normalizarNomeDepartamento(d.nome);
    if (slug && !depBySlug.has(slug)) depBySlug.set(slug, d.id);
  }
  return (empresa: Empresa, slug: DepartamentoSlug): string => {
    const depId = depBySlug.get(slug);
    if (!depId) return '';
    const userId = empresa.responsaveis?.[depId];
    return (userId && userMap.get(userId)) || '';
  };
}

function triggerDownload(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function exportEmpresasXlsx(
  empresas: Empresa[],
  departamentos: Departamento[],
  usuarios: Usuario[],
): Promise<void> {
  const getResp = buildRespResolver(departamentos, usuarios);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Controle Triar';
  wb.created = new Date();
  const ws = wb.addWorksheet('Empresas');

  ws.columns = [
    { header: 'Código', key: 'codigo', width: 10 },
    { header: 'CNPJ/CPF', key: 'cnpj', width: 20 },
    { header: 'Razão Social', key: 'razao', width: 40 },
    { header: 'Apelido', key: 'apelido', width: 30 },
    { header: 'Tipo Inscrição', key: 'tipoInscricao', width: 14 },
    { header: 'Matriz/Filial', key: 'tipoEstabelecimento', width: 13 },
    { header: 'Regime Federal', key: 'regime_federal', width: 18 },
    { header: 'Inscrição Estadual', key: 'inscricao_estadual', width: 20 },
    { header: 'Inscrição Municipal', key: 'inscricao_municipal', width: 20 },
    { header: 'CEP', key: 'cep', width: 12 },
    { header: 'Cidade', key: 'cidade', width: 22 },
    { header: 'UF', key: 'estado', width: 6 },
    { header: 'Cliente Desde', key: 'cliente_desde', width: 14 },
    { header: 'Serviços', key: 'servicos', width: 30 },
    { header: 'Resp. Contábil', key: 'respContabil', width: 25 },
    { header: 'Resp. Fiscal', key: 'respFiscal', width: 25 },
    { header: 'Resp. Pessoal', key: 'respPessoal', width: 25 },
    { header: 'Resp. Cadastro', key: 'respCadastro', width: 25 },
    { header: 'Particularidades', key: 'particularidades', width: 50 },
  ];

  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F766E' },
  };
  ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 22;

  for (const e of empresas) {
    ws.addRow({
      codigo: e.codigo || '',
      cnpj: e.cnpj || '',
      razao: e.razao_social || '',
      apelido: e.apelido || '',
      tipoInscricao: e.tipoInscricao || '',
      tipoEstabelecimento: e.tipoEstabelecimento ? e.tipoEstabelecimento.toUpperCase() : '',
      regime_federal: e.regime_federal || '',
      inscricao_estadual: e.inscricao_estadual || '',
      inscricao_municipal: e.inscricao_municipal || '',
      cep: e.cep || '',
      cidade: e.cidade || '',
      estado: e.estado || '',
      cliente_desde: formatDate(e.cliente_desde),
      servicos: (e.servicos ?? []).join(', '),
      respContabil: getResp(e, 'contabil'),
      respFiscal: getResp(e, 'fiscal'),
      respPessoal: getResp(e, 'pessoal'),
      respCadastro: getResp(e, 'cadastro'),
      particularidades: e.particularidades || '',
    });
  }

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.alignment = { vertical: 'top', wrapText: true };
    if (rowNumber > 1 && rowNumber % 2 === 0) {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF0FDFA' },
      };
    }
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  const sufixo =
    empresas.length === 1 ? (empresas[0].codigo || 'empresa') : `${empresas.length}-empresas`;
  triggerDownload(
    buffer as ArrayBuffer,
    `empresas-${sufixo}-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}
