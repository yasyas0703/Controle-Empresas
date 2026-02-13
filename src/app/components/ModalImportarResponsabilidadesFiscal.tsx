'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { Upload, FileSpreadsheet, X, Check, AlertTriangle, Loader2, Users } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import type { UUID } from '@/app/types';
import ModalBase from '@/app/components/ModalBase';

/* ─── Tipos internos ─── */

interface PersonBlock {
  /** Nome do responsável (ex: "BRUNA") */
  nome: string;
  /** Quantidade informada na planilha */
  qtdInformada: number;
  /** Empresas vinculadas: { nomeEmpresa, codigo } */
  empresas: { nome: string; codigo: string }[];
}

interface MatchedEmpresa {
  codigo: string;
  nomeNaPlanilha: string;
  empresaId: UUID | null;       // null = não encontrada no sistema
  razaoSocialSistema: string;   // vazio se não encontrada
  responsavelNome: string;
}

/* ─── Parser do CSV multi-coluna ─── */

/**
 * A planilha "Divisão Geral" tem blocos de 3 colunas (nome ; codigo ; vazio),
 * dispostos lado a lado. A primeira linha de cada bloco contém
 * o header no formato:
 *   "NOME - N"   (ex: BRUNA - 21)
 *   "NOME- N"    (ex: POLYANA- 22)
 *   "NOME N"     (ex: RAIANE 21)  — sem traço
 *   "NOME -N"    (ex: BRUNA REIS -11)
 *
 * Blocos podem começar em linhas diferentes (ex: SABRINA começa na linha 29,
 * ALINE na linha 18 na mesma coluna que JENIFFER).
 *
 * No CSV, todas as colunas ficam na mesma linha, então a linha do header
 * de SABRINA também contém dados de outros blocos em colunas distantes.
 */

/** Tenta reconhecer uma célula como header de bloco. Retorna nome + qtd ou null. */
function matchHeader(cell: string): { nome: string; qtd: number } | null {
  const trimmed = cell.trim();
  if (!trimmed) return null;

  // Padrão 1: com traço  →  "BRUNA - 21", "POLYANA- 22", "BRUNA REIS -11"
  const withDash = trimmed.match(/^(.+?)\s*[-–]\s*(\d+)\s*$/);
  if (withDash) return { nome: withDash[1].trim(), qtd: parseInt(withDash[2], 10) };

  // Padrão 2: sem traço  →  "RAIANE 21" (nome apenas letras/espaços, seguido de número)
  // Requer que o nome comece com letra (não com "P-", "R-", "S-") para evitar falso positivo
  const noDash = trimmed.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.]*?)\s+(\d+)\s*$/);
  if (noDash) {
    const nome = noDash[1].trim();
    // Se o nome parece código de empresa (começa com P-, R-, S-), ignorar
    if (/^[PRS]-/i.test(nome)) return null;
    return { nome, qtd: parseInt(noDash[2], 10) };
  }

  return null;
}

function parseDivisaoFiscal(text: string): PersonBlock[] {
  // Detectar separador
  const firstLine = text.split(/\r?\n/)[0] || '';
  let sep = ';';
  if (!firstLine.includes(';')) {
    sep = firstLine.includes('\t') ? '\t' : ',';
  }

  const lines = text.split(/\r?\n/);
  // Montar matriz de todas as células
  const matrix: string[][] = lines.map((line) =>
    line.split(sep).map((cell) => cell.replace(/^["']|["']$/g, '').trim())
  );

  if (matrix.length === 0) return [];

  // Largura máxima
  const maxCols = Math.max(...matrix.map((r) => r.length));

  const blocks: PersonBlock[] = [];
  const foundHeaders = new Set<string>(); // "col:row" → evitar duplicatas

  for (let col = 0; col < maxCols; col++) {
    for (let row = 0; row < matrix.length; row++) {
      const cell = (matrix[row]?.[col] || '').trim();
      if (!cell) continue;

      const header = matchHeader(cell);
      if (!header) continue;

      // Verificar se a coluna vizinha (col+1) está VAZIA ou não-numérica
      // Headers NÃO têm código numérico ao lado — empresas SIM
      const vizinha = (matrix[row]?.[col + 1] || '').trim();
      if (vizinha && /^\d+$/.test(vizinha)) continue; // É empresa, não header

      const key = `${col}:${row}`;
      if (foundHeaders.has(key)) continue;
      foundHeaders.add(key);

      // Coletar empresas abaixo deste header na mesma coluna
      const empresas: { nome: string; codigo: string }[] = [];
      for (let r = row + 1; r < matrix.length; r++) {
        const nomeEmpresa = (matrix[r]?.[col] || '').trim();
        const codigoEmpresa = (matrix[r]?.[col + 1] || '').trim();

        // Pular linhas vazias (outros blocos podem ter dados nas mesmas linhas)
        if (!nomeEmpresa && !codigoEmpresa) continue;
        if (!nomeEmpresa) continue;

        // Verificar se esta linha é outro header → parar coleta
        const subHeader = matchHeader(nomeEmpresa);
        if (subHeader) {
          const subVizinha = (matrix[r]?.[col + 1] || '').trim();
          // Se a vizinha é vazia ou não-numérica, é um header → parar
          if (!subVizinha || !/^\d+$/.test(subVizinha)) break;
        }

        // Empresa válida: tem nome e código
        if (codigoEmpresa) {
          empresas.push({ nome: nomeEmpresa, codigo: codigoEmpresa });
        }
      }

      if (empresas.length > 0 || header.qtd >= 0) {
        blocks.push({ nome: header.nome, qtdInformada: header.qtd, empresas });
      }
    }
  }

  // Deduplicar blocos (mesmo nome + mesma quantidade de empresas)
  const seen = new Set<string>();
  return blocks.filter((b) => {
    const key = `${b.nome}|${b.empresas.length}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ─── Componente ─── */

interface ModalImportarResponsabilidadesFiscalProps {
  onClose: () => void;
}

export default function ModalImportarResponsabilidadesFiscal({ onClose }: ModalImportarResponsabilidadesFiscalProps) {
  const {
    empresas,
    departamentos,
    usuarios,
    criarUsuario,
    atualizarEmpresa,
    mostrarAlerta,
    canManage,
  } = useSistema();

  const [blocks, setBlocks] = useState<PersonBlock[]>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    atualizadas: number;
    naoEncontradas: number;
    usuariosCriados: string[];
  } | null>(null);

  // Encontrar o departamento "Fiscal"
  const fiscalDept = useMemo(() => {
    return departamentos.find((d) => d.nome.toLowerCase().trim() === 'fiscal') ?? null;
  }, [departamentos]);

  // Montar matches: cruzar empresas da planilha com empresas do sistema pelo código
  const matches: MatchedEmpresa[] = useMemo(() => {
    const codigoMap = new Map(empresas.map((e) => [e.codigo.trim(), e]));
    const result: MatchedEmpresa[] = [];

    for (const block of blocks) {
      for (const emp of block.empresas) {
        const found = codigoMap.get(emp.codigo.trim());
        result.push({
          codigo: emp.codigo,
          nomeNaPlanilha: emp.nome,
          empresaId: found?.id ?? null,
          razaoSocialSistema: found?.razao_social ?? found?.apelido ?? '',
          responsavelNome: block.nome,
        });
      }
    }

    return result;
  }, [blocks, empresas]);

  const encontradas = matches.filter((m) => m.empresaId);
  const naoEncontradas = matches.filter((m) => !m.empresaId);

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseDivisaoFiscal(text);
      setBlocks(parsed);
    };
    reader.readAsText(file, 'UTF-8');
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleImport = async () => {
    if (!fiscalDept) {
      mostrarAlerta('Erro', 'Departamento "Fiscal" não encontrado no sistema.', 'erro');
      return;
    }

    setImporting(true);

    const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
    const slug = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/\.+/g, '.')
        .replace(/^\.|\.$/g, '');

    // Map de usuários existentes (por nome normalizado)
    const userIdByName = new Map(usuarios.map((u) => [norm(u.nome), u.id]));
    const usedEmails = new Set(usuarios.map((u) => u.email.toLowerCase().trim()));
    const usuariosCriados: string[] = [];

    // Garantir que todos os responsáveis da planilha existam como usuários
    const responsaveisUnicos = [...new Set(blocks.map((b) => b.nome))];
    for (const nomeResp of responsaveisUnicos) {
      const key = norm(nomeResp);
      if (userIdByName.has(key)) continue;

      const base = slug(nomeResp) || 'usuario';
      let email = `${base}@importado.local`;
      let i = 2;
      while (usedEmails.has(email.toLowerCase())) {
        email = `${base}.${i}@importado.local`;
        i++;
      }
      usedEmails.add(email.toLowerCase());

      const id = await criarUsuario({
        nome: nomeResp,
        email,
        senha: Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10),
        role: 'usuario',
        departamentoId: fiscalDept.id,
        ativo: true,
      });
      if (id) {
        userIdByName.set(key, id);
        usuariosCriados.push(nomeResp);
      }
    }

    // Agora atualizar somente o responsável fiscal de cada empresa encontrada
    let atualizadas = 0;
    let naoEncontradasCount = 0;

    for (const match of matches) {
      if (!match.empresaId) {
        naoEncontradasCount++;
        continue;
      }

      const userId = userIdByName.get(norm(match.responsavelNome)) ?? null;

      // Atualizar apenas o responsável do departamento fiscal
      await atualizarEmpresa(match.empresaId, {
        responsaveis: { [fiscalDept.id]: userId },
      });
      atualizadas++;
    }

    setResult({ atualizadas, naoEncontradas: naoEncontradasCount, usuariosCriados });
    setImporting(false);

    if (atualizadas > 0) {
      mostrarAlerta(
        'Responsabilidades atualizadas',
        `${atualizadas} empresa(s) tiveram o responsável fiscal atualizado.`,
        'sucesso'
      );
    }
  };

  const [expandedBlock, setExpandedBlock] = useState<string | null>(null);

  return (
    <ModalBase isOpen={true} onClose={onClose} dialogClassName="w-full max-w-4xl rounded-2xl bg-white shadow-2xl p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-md">
            <Users className="text-white" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Importar Responsabilidades Fiscal</h2>
            <p className="text-sm text-gray-500">Atualiza apenas o responsável do departamento Fiscal</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition">
          <X size={20} className="text-gray-500" />
        </button>
      </div>

      {!fiscalDept && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 mb-4 text-red-700 text-sm">
          <AlertTriangle size={16} className="inline mr-2" />
          O departamento <strong>&quot;Fiscal&quot;</strong> não foi encontrado no sistema. Crie-o primeiro em Departamentos.
        </div>
      )}

      {/* Drop zone */}
      {blocks.length === 0 && !result && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center hover:border-emerald-400 hover:bg-emerald-50/50 transition cursor-pointer"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv,.tsv,.txt';
            input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) handleFile(file);
            };
            input.click();
          }}
        >
          <Upload className="mx-auto text-gray-400 mb-4" size={48} />
          <div className="text-lg font-bold text-gray-700">Arraste o arquivo de divisão fiscal ou clique para selecionar</div>
          <div className="text-sm text-gray-500 mt-2">
            Aceita o CSV/TXT da planilha &quot;Divisão Geral&quot; com formato multi-coluna
          </div>
        </div>
      )}

      {/* Preview */}
      {blocks.length > 0 && !result && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50">
            <FileSpreadsheet className="text-emerald-600" size={20} />
            <div className="flex-1">
              <div className="font-semibold text-gray-900">{fileName}</div>
              <div className="text-sm text-gray-500">
                {blocks.length} responsável(eis) • {matches.length} empresa(s) na planilha •{' '}
                <span className="text-green-600 font-semibold">{encontradas.length} encontrada(s)</span>
                {naoEncontradas.length > 0 && (
                  <span className="text-amber-600 ml-1 font-semibold">
                    • {naoEncontradas.length} não encontrada(s)
                  </span>
                )}
              </div>
            </div>
            <button onClick={() => { setBlocks([]); setFileName(''); }} className="p-2 rounded-lg hover:bg-gray-200 transition">
              <X size={18} className="text-gray-500" />
            </button>
          </div>

          {/* Blocos de responsáveis */}
          <div className="max-h-96 overflow-auto space-y-2">
            {blocks.map((block) => {
              const empresasBlock = matches.filter((m) => m.responsavelNome === block.nome);
              const encontradasBlock = empresasBlock.filter((m) => m.empresaId);
              const isExpanded = expandedBlock === block.nome;

              return (
                <div key={block.nome} className="rounded-xl border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => setExpandedBlock(isExpanded ? null : block.nome)}
                    className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">
                        {block.empresas.length}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{block.nome}</div>
                        <div className="text-xs text-gray-500">
                          {encontradasBlock.length}/{empresasBlock.length} no sistema
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-gray-400">{isExpanded ? '▲' : '▼'}</span>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-gray-100">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600">Status</th>
                            <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600">Código</th>
                            <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600">Nome na Planilha</th>
                            <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600">Razão Social (Sistema)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {empresasBlock.map((emp, i) => (
                            <tr key={i} className={`border-t ${emp.empresaId ? 'hover:bg-gray-50' : 'bg-amber-50/50'}`}>
                              <td className="px-3 py-1.5">
                                {emp.empresaId ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-green-600">
                                    <Check size={12} /> OK
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                                    <AlertTriangle size={12} /> Não encontrada
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 font-mono font-semibold text-xs">{emp.codigo}</td>
                              <td className="px-3 py-1.5 text-xs truncate max-w-[200px]">{emp.nomeNaPlanilha}</td>
                              <td className="px-3 py-1.5 text-xs text-gray-500 truncate max-w-[200px]">
                                {emp.razaoSocialSistema || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Avisos */}
          {naoEncontradas.length > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
              <AlertTriangle size={14} className="inline mr-1" />
              <strong>{naoEncontradas.length}</strong> empresa(s) da planilha não foram encontradas no sistema
              (código não bate). Essas serão ignoradas.
            </div>
          )}

          <div className="flex items-center justify-between gap-4 pt-2">
            <div className="text-sm text-gray-600">
              <span className="font-bold text-green-600">{encontradas.length}</span> será(ão) atualizada(s) •{' '}
              <span className="font-bold text-amber-600">{naoEncontradas.length}</span> ignorada(s)
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setBlocks([]); setFileName(''); }}
                className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 transition font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={encontradas.length === 0 || importing || !fiscalDept}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 text-white font-bold hover:from-emerald-700 hover:to-teal-600 shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                Atualizar {encontradas.length} responsável(eis)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-green-50 p-6 text-center">
            <Check className="mx-auto text-green-600 mb-3" size={48} />
            <div className="text-xl font-bold text-green-900">Atualização concluída!</div>
            <div className="text-sm text-green-700 mt-2">
              {result.atualizadas} empresa(s) com responsável fiscal atualizado
              {result.naoEncontradas > 0 && ` • ${result.naoEncontradas} ignorada(s) (código não encontrado)`}
            </div>
            {result.usuariosCriados.length > 0 && (
              <div className="text-sm text-green-700 mt-1">
                Usuários criados automaticamente: {result.usuariosCriados.join(', ')}
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 text-white font-bold hover:from-emerald-700 hover:to-teal-600 shadow-md transition"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </ModalBase>
  );
}
