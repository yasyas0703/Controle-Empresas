import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Empresa, Departamento, Usuario } from '@/app/types';

function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR');
}

function getDocStatus(validade: string | undefined | null): { label: string; color: [number, number, number] } {
  if (!validade) return { label: 'Sem validade', color: [156, 163, 175] };
  const dias = Math.floor((new Date(validade).getTime() - Date.now()) / 86400000);
  if (dias < 0) return { label: `Vencido há ${Math.abs(dias)}d`, color: [220, 38, 38] };
  if (dias <= 30) return { label: `Vence em ${dias}d`, color: [234, 88, 12] };
  if (dias <= 60) return { label: `Vence em ${dias}d`, color: [202, 138, 4] };
  return { label: 'Em dia', color: [22, 163, 74] };
}

export function exportEmpresasPdf(
  empresas: Empresa[],
  departamentos: Departamento[],
  usuarios: Usuario[]
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  const depMap = new Map(departamentos.map((d) => [d.id, d.nome]));
  const userMap = new Map(usuarios.map((u) => [u.id, u.nome]));

  const geradoEm = new Date().toLocaleString('pt-BR');

  empresas.forEach((empresa, idx) => {
    if (idx > 0) doc.addPage();

    let y = margin;

    // ── Cabeçalho do documento ──
    doc.setFillColor(15, 118, 110); // teal-700
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Controle de Empresas — Relatório', margin, 12);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Gerado em ${geradoEm}`, pageW - margin, 12, { align: 'right' });

    y = 26;

    // ── Identificação da empresa ──
    doc.setTextColor(17, 24, 39);
    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    const nomeEmpresa = empresa.razao_social || empresa.apelido || `Empresa ${empresa.codigo}`;
    doc.text(`${empresa.codigo} — ${nomeEmpresa}`, margin, y);
    y += 6;

    if (empresa.apelido && empresa.razao_social) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(107, 114, 128);
      doc.text(`(${empresa.apelido})`, margin, y);
      y += 5;
    }

    // Linha separadora
    doc.setDrawColor(209, 213, 219);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageW - margin, y);
    y += 5;

    // ── Grid de informações ──
    const col1 = margin;
    const col2 = pageW / 2;

    const infoRows: [string, string][] = [
      ['CNPJ/CPF', empresa.cnpj || '—'],
      ['Tipo', empresa.tipoEstabelecimento || empresa.tipoInscricao || '—'],
      ['Regime Federal', empresa.regime_federal || '—'],
      ['Regime Estadual', empresa.regime_estadual || '—'],
      ['Regime Municipal', empresa.regime_municipal || '—'],
      ['Insc. Estadual', empresa.inscricao_estadual || '—'],
      ['Insc. Municipal', empresa.inscricao_municipal || '—'],
      ['Data Abertura', formatDate(empresa.data_abertura)],
    ];

    const infoAddr: [string, string][] = [
      ['Estado', empresa.estado || '—'],
      ['Cidade', empresa.cidade || '—'],
      ['Endereço', [empresa.logradouro, empresa.numero, empresa.bairro].filter(Boolean).join(', ') || '—'],
      ['CEP', empresa.cep || '—'],
      ['Telefone', empresa.telefone || '—'],
      ['Email', empresa.email || '—'],
    ];

    doc.setFontSize(8);
    infoRows.forEach(([label, val], i) => {
      const x = i % 2 === 0 ? col1 : col2;
      const rowY = y + Math.floor(i / 2) * 5.5;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(75, 85, 99);
      doc.text(`${label}:`, x, rowY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(17, 24, 39);
      doc.text(String(val), x + 28, rowY);
    });

    y += Math.ceil(infoRows.length / 2) * 5.5 + 2;

    infoAddr.forEach(([label, val], i) => {
      const x = i % 2 === 0 ? col1 : col2;
      const rowY = y + Math.floor(i / 2) * 5.5;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(75, 85, 99);
      doc.text(`${label}:`, x, rowY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(17, 24, 39);
      doc.text(String(val).slice(0, 45), x + 22, rowY);
    });

    y += Math.ceil(infoAddr.length / 2) * 5.5 + 2;

    // Serviços
    if ((empresa.servicos || []).length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(75, 85, 99);
      doc.setFontSize(8);
      doc.text('Serviços:', col1, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(17, 24, 39);
      doc.text(empresa.servicos.join(' | '), col1 + 20, y);
      y += 6;
    }

    // ── Responsáveis ──
    const resps = Object.entries(empresa.responsaveis || {})
      .filter(([, uid]) => uid)
      .map(([dId, uid]) => [depMap.get(dId) ?? dId, userMap.get(uid!) ?? uid!] as [string, string]);

    if (resps.length > 0) {
      y += 2;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(15, 118, 110);
      doc.text('Responsáveis por Departamento', margin, y);
      y += 3;

      autoTable(doc, {
        startY: y,
        head: [['Departamento', 'Responsável']],
        body: resps,
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [240, 253, 250] },
        columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 'auto' } },
      });
      y = (doc as any).lastAutoTable.finalY + 4;
    }

    // ── Documentos ──
    if (empresa.documentos.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(15, 118, 110);
      doc.text(`Documentos (${empresa.documentos.length})`, margin, y);
      y += 3;

      const docRows = empresa.documentos.map((d) => {
        const status = getDocStatus(d.validade);
        const depts = (d.departamentosIds || []).map((id) => depMap.get(id) ?? '').filter(Boolean).join(', ');
        return [d.nome, formatDate(d.validade), status.label, depts || '—'];
      });

      autoTable(doc, {
        startY: y,
        head: [['Nome do Documento', 'Validade', 'Status', 'Departamentos']],
        body: docRows,
        margin: { left: margin, right: margin },
        styles: { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [240, 253, 250] },
        columnStyles: {
          0: { cellWidth: 60 },
          1: { cellWidth: 25 },
          2: { cellWidth: 35 },
          3: { cellWidth: 'auto' },
        },
        didParseCell: (data) => {
          if (data.column.index === 2 && data.section === 'body') {
            const statusVal = data.cell.text[0] || '';
            if (statusVal.startsWith('Vencido')) {
              data.cell.styles.textColor = [220, 38, 38];
              data.cell.styles.fontStyle = 'bold';
            } else if (statusVal.startsWith('Vence em 0') || statusVal.match(/Vence em [0-2]\d/)) {
              data.cell.styles.textColor = [234, 88, 12];
            } else if (statusVal.startsWith('Vence em')) {
              data.cell.styles.textColor = [202, 138, 4];
            } else {
              data.cell.styles.textColor = [22, 163, 74];
            }
          }
        },
      });
      y = (doc as any).lastAutoTable.finalY + 4;
    } else {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(156, 163, 175);
      doc.text('Nenhum documento cadastrado.', margin, y);
      y += 6;
    }

    // ── RETs ──
    if (empresa.possuiRet && empresa.rets.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(15, 118, 110);
      doc.text(`RETs (${empresa.rets.length})`, margin, y);
      y += 3;

      autoTable(doc, {
        startY: y,
        head: [['Nº PTA', 'Nome', 'Vencimento', 'Última Renovação']],
        body: empresa.rets.map((r) => [r.numeroPta || '—', r.nome || '—', formatDate(r.vencimento), formatDate(r.ultimaRenovacao)]),
        margin: { left: margin, right: margin },
        styles: { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [240, 253, 250] },
      });
      y = (doc as any).lastAutoTable.finalY + 4;
    }

    // ── Observações ──
    const obs = empresa.observacoes ?? [];
    if (obs.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(15, 118, 110);
      doc.text(`Observações (${obs.length})`, margin, y);
      y += 3;

      autoTable(doc, {
        startY: y,
        head: [['Data', 'Autor', 'Texto']],
        body: obs.map((o) => [formatDate(o.criadoEm), o.autorNome || '—', o.texto || '—']),
        margin: { left: margin, right: margin },
        styles: { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [240, 253, 250] },
        columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 35 }, 2: { cellWidth: 'auto' } },
      });
    }
  });

  // Numeração de páginas
  const totalPages = (doc.internal as any).getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(156, 163, 175);
    doc.text(`Página ${i} de ${totalPages}`, pageW - margin, doc.internal.pageSize.getHeight() - 6, { align: 'right' });
  }

  const nomes = empresas.length === 1
    ? (empresas[0].codigo || 'empresa')
    : `${empresas.length}-empresas`;
  doc.save(`relatorio-${nomes}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
