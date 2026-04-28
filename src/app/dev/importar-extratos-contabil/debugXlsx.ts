import ExcelJS from 'exceljs';

/**
 * Debug: lê um XLSX e devolve um relatório com a estrutura crua das primeiras células
 * (com texto), incluindo cell.fill, theme, conditional formattings, etc.
 * Permite identificar o formato exato de cor usado na planilha.
 */
export async function inspecionarXlsx(arquivo: File, opts?: { maxLinhas?: number; maxColunas?: number }): Promise<string> {
  const maxLinhas = opts?.maxLinhas ?? 30;
  const maxColunas = opts?.maxColunas ?? 18;

  const buf = await arquivo.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const linhas: string[] = [];
  linhas.push(`# Inspeção do arquivo: ${arquivo.name} (${(arquivo.size / 1024).toFixed(1)} KB)`);
  linhas.push(`# Worksheets: ${wb.worksheets.map((w) => w.name).join(', ')}`);
  linhas.push('');

  for (const ws of wb.worksheets) {
    linhas.push(`## Worksheet: "${ws.name}"`);
    linhas.push(`#  rowCount: ${ws.rowCount}, columnCount: ${ws.columnCount}`);
    linhas.push('');

    // Conditional formattings (regras tipo "se valor = X aplica cor Y")
    const cf = (ws as unknown as { conditionalFormattings?: unknown[] }).conditionalFormattings;
    if (Array.isArray(cf) && cf.length > 0) {
      linhas.push(`### Conditional formattings: ${cf.length}`);
      linhas.push(JSON.stringify(cf, null, 2));
      linhas.push('');
    } else {
      linhas.push('### Sem conditional formattings.');
      linhas.push('');
    }

    // Iteração: primeiras N linhas com texto, todas as colunas até maxColunas
    linhas.push('### Células com conteúdo (primeiras linhas):');
    let coletadas = 0;
    for (let r = 1; r <= Math.min(ws.rowCount, maxLinhas); r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= maxColunas; c++) {
        const cell = row.getCell(c);
        const v = cell.value;
        const valor = v == null ? '' : (typeof v === 'string' ? v : typeof v === 'object' && 'text' in v ? (v as { text: string }).text : String(v));
        if (!valor.toString().trim()) continue;
        const fill = cell.fill;
        const style = cell.style;
        const info = {
          pos: `R${r}C${c}`,
          valor: valor.toString().trim().slice(0, 40),
          fill: fill ?? null,
          style_fill: style?.fill ?? null,
          font_color: style?.font?.color ?? null,
        };
        linhas.push(JSON.stringify(info));
        coletadas++;
        if (coletadas >= 200) break;
      }
      if (coletadas >= 200) break;
    }
    linhas.push('');
  }

  return linhas.join('\n');
}
