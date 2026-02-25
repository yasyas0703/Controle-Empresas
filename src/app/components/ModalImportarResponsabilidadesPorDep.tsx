'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, FileSpreadsheet, Loader2, Upload, Users, X, Square } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import type { UUID } from '@/app/types';
import ModalBase from '@/app/components/ModalBase';

interface PersonBlock {
  nome: string;
  qtdInformada: number;
  empresas: { nome: string; codigo: string }[];
}

interface MatchedEmpresa {
  codigo: string;
  nomeNaPlanilha: string;
  empresaId: UUID | null;
  razaoSocialSistema: string;
  responsavelNome: string;
}

function matchHeader(cell: string): { nome: string; qtd: number } | null {
  const trimmed = cell.trim();
  if (!trimmed) return null;

  const withDash = trimmed.match(/^(.+?)\s*(?:-|\u2013)\s*(\d+)\s*$/u);
  if (withDash) return { nome: withDash[1].trim(), qtd: parseInt(withDash[2], 10) };

  const noDash = trimmed.match(/^([A-Za-z\u00C0-\u00FF][A-Za-z\u00C0-\u00FF\s.]*?)\s+(\d+)\s*$/u);
  if (noDash) {
    const nome = noDash[1].trim();
    if (/^[PRS]-/i.test(nome)) return null;
    return { nome, qtd: parseInt(noDash[2], 10) };
  }

  return null;
}

function parseDivisao(text: string): PersonBlock[] {
  const firstLine = text.split(/\r?\n/)[0] || '';
  let sep = ';';
  if (!firstLine.includes(';')) {
    sep = firstLine.includes('\t') ? '\t' : ',';
  }

  const lines = text.split(/\r?\n/);
  const matrix: string[][] = lines.map((line) =>
    line.split(sep).map((cell) => cell.replace(/^["']|["']$/g, '').trim())
  );

  if (matrix.length === 0) return [];

  const maxCols = Math.max(...matrix.map((r) => r.length));
  const blocks: PersonBlock[] = [];
  const foundHeaders = new Set<string>();

  for (let col = 0; col < maxCols; col++) {
    for (let row = 0; row < matrix.length; row++) {
      const cell = (matrix[row]?.[col] || '').trim();
      if (!cell) continue;

      const header = matchHeader(cell);
      if (!header) continue;

      const vizinha = (matrix[row]?.[col + 1] || '').trim();
      if (vizinha && /^\d+$/.test(vizinha)) continue;

      const key = `${col}:${row}`;
      if (foundHeaders.has(key)) continue;
      foundHeaders.add(key);

      const empresas: { nome: string; codigo: string }[] = [];
      for (let r = row + 1; r < matrix.length; r++) {
        const nomeEmpresa = (matrix[r]?.[col] || '').trim();
        const codigoEmpresa = (matrix[r]?.[col + 1] || '').trim();

        if (!nomeEmpresa && !codigoEmpresa) continue;
        if (!nomeEmpresa) continue;

        const subHeader = matchHeader(nomeEmpresa);
        if (subHeader) {
          const subVizinha = (matrix[r]?.[col + 1] || '').trim();
          if (!subVizinha || !/^\d+$/.test(subVizinha)) break;
        }

        if (codigoEmpresa) {
          empresas.push({ nome: nomeEmpresa, codigo: codigoEmpresa });
        }
      }

      if (empresas.length > 0 || header.qtd >= 0) {
        blocks.push({ nome: header.nome, qtdInformada: header.qtd, empresas });
      }
    }
  }

  const seen = new Set<string>();
  return blocks.filter((b) => {
    const key = `${b.nome}|${b.empresas.length}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface ModalImportarResponsabilidadesPorDepProps {
  onClose: () => void;
}

export default function ModalImportarResponsabilidadesPorDep({ onClose }: ModalImportarResponsabilidadesPorDepProps) {
  const { empresas, departamentos, usuarios, criarUsuario, atualizarEmpresa, mostrarAlerta } = useSistema();

  const [departamentoId, setDepartamentoId] = useState('');
  const [blocks, setBlocks] = useState<PersonBlock[]>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [expandedBlock, setExpandedBlock] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, success: 0, skipped: 0 });
  const abortRef = useRef(false);
  const [result, setResult] = useState<{
    atualizadas: number;
    naoEncontradas: number;
    usuariosCriados: string[];
    departamentoNome: string;
  } | null>(null);

  const departamentoSelecionado = useMemo(
    () => departamentos.find((d) => d.id === departamentoId) ?? null,
    [departamentoId, departamentos]
  );

  const matches: MatchedEmpresa[] = useMemo(() => {
    const codigoMap = new Map(empresas.map((e) => [e.codigo.trim(), e]));
    const mapResult: MatchedEmpresa[] = [];

    for (const block of blocks) {
      for (const emp of block.empresas) {
        const found = codigoMap.get(emp.codigo.trim());
        mapResult.push({
          codigo: emp.codigo,
          nomeNaPlanilha: emp.nome,
          empresaId: found?.id ?? null,
          razaoSocialSistema: found?.razao_social ?? found?.apelido ?? '',
          responsavelNome: block.nome,
        });
      }
    }

    return mapResult;
  }, [blocks, empresas]);

  const encontradas = matches.filter((m) => m.empresaId);
  const naoEncontradas = matches.filter((m) => !m.empresaId);

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setBlocks(parseDivisao(text));
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
    if (!departamentoSelecionado) {
      mostrarAlerta('Erro', 'Selecione o departamento que sera atualizado.', 'erro');
      return;
    }

    abortRef.current = false;
    setImporting(true);
    setProgress({ done: 0, total: matches.length, success: 0, skipped: 0 });

    try {
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

      const userIdByName = new Map(usuarios.map((u) => [norm(u.nome), u.id]));
      const usedEmails = new Set(usuarios.map((u) => u.email.toLowerCase().trim()));
      const usuariosCriados: string[] = [];

      const userIdByFirstName = new Map<string, string>();
      for (const u of usuarios) {
        const firstName = norm(u.nome).split(' ')[0];
        if (!firstName) continue;
        if (userIdByFirstName.has(firstName)) {
          userIdByFirstName.set(firstName, '__ambiguo__');
        } else {
          userIdByFirstName.set(firstName, u.id);
        }
      }

      const resolveUserId = (nome: string): string | null => {
        const key = norm(nome);
        if (userIdByName.has(key)) return userIdByName.get(key)!;
        const firstName = key.split(' ')[0];
        if (firstName) {
          const id = userIdByFirstName.get(firstName);
          if (id && id !== '__ambiguo__') return id;
        }
        return null;
      };

      const responsaveisUnicos = [...new Set(blocks.map((b) => b.nome))];
      for (const nomeResp of responsaveisUnicos) {
        if (abortRef.current) break;
        const key = norm(nomeResp);
        const resolved = resolveUserId(nomeResp);
        if (resolved !== null) {
          if (!userIdByName.has(key)) userIdByName.set(key, resolved);
          continue;
        }

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
          departamentoId: departamentoSelecionado.id,
          ativo: true,
        });

        if (id) {
          userIdByName.set(key, id);
          usuariosCriados.push(nomeResp);
        }
      }

      let atualizadas = 0;
      let naoEncontradasCount = 0;

      // Processar em lotes de 5 para não sobrecarregar
      const BATCH_SIZE = 5;
      const matchesComEmpresa = matches.filter((m) => m.empresaId);
      const matchesSemEmpresa = matches.filter((m) => !m.empresaId);
      naoEncontradasCount = matchesSemEmpresa.length;

      for (let i = 0; i < matchesComEmpresa.length; i += BATCH_SIZE) {
        if (abortRef.current) break;

        const batch = matchesComEmpresa.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map((match) => {
            const userId = resolveUserId(match.responsavelNome);
            return atualizarEmpresa(match.empresaId!, {
              responsaveis: { [departamentoSelecionado.id]: userId },
            });
          })
        );

        for (const r of results) {
          if (r.status === 'fulfilled') atualizadas++;
        }

        setProgress({
          done: Math.min(i + BATCH_SIZE, matchesComEmpresa.length) + naoEncontradasCount,
          total: matches.length,
          success: atualizadas,
          skipped: naoEncontradasCount,
        });
      }

      setResult({
        atualizadas,
        naoEncontradas: naoEncontradasCount,
        usuariosCriados,
        departamentoNome: departamentoSelecionado.nome,
      });

      if (atualizadas > 0) {
        mostrarAlerta(
          'Responsabilidades atualizadas',
          `${atualizadas} empresa(s) tiveram o responsavel de ${departamentoSelecionado.nome} atualizado.${abortRef.current ? ' (interrompido)' : ''}`,
          'sucesso'
        );
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <ModalBase isOpen={true} onClose={onClose} dialogClassName="w-full max-w-4xl rounded-2xl bg-white shadow-2xl p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-md">
            <Users className="text-white" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Importar Responsaveis por DEP</h2>
            <p className="text-sm text-gray-500">Mesmo modelo de planilha, atualizando o departamento escolhido.</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition">
          <X size={20} className="text-gray-500" />
        </button>
      </div>

      {departamentos.length === 0 && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 mb-4 text-red-700 text-sm">
          <AlertTriangle size={16} className="inline mr-2" />
          Nenhum departamento encontrado. Cadastre um departamento primeiro.
        </div>
      )}

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Departamento para atualizar</label>
        <select
          className="w-full rounded-xl border border-gray-300 px-4 py-2 text-gray-900"
          value={departamentoId}
          onChange={(e) => setDepartamentoId(e.target.value)}
        >
          <option value="">Selecione...</option>
          {departamentos.map((dep) => (
            <option key={dep.id} value={dep.id}>
              {dep.nome}
            </option>
          ))}
        </select>
      </div>

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
          <div className="text-lg font-bold text-gray-700">Arraste a planilha ou clique para selecionar</div>
          <div className="text-sm text-gray-500 mt-2">Aceita CSV/TXT com o mesmo formato da divisao geral</div>
        </div>
      )}

      {blocks.length > 0 && !result && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50">
            <FileSpreadsheet className="text-emerald-600" size={20} />
            <div className="flex-1">
              <div className="font-semibold text-gray-900">{fileName}</div>
              <div className="text-sm text-gray-500">
                {blocks.length} responsavel(eis) | {matches.length} empresa(s) na planilha |{' '}
                <span className="text-green-600 font-semibold">{encontradas.length} encontrada(s)</span>
                {naoEncontradas.length > 0 && (
                  <span className="text-amber-600 ml-1 font-semibold">| {naoEncontradas.length} nao encontrada(s)</span>
                )}
              </div>
            </div>
            <button
              onClick={() => {
                setBlocks([]);
                setFileName('');
              }}
              className="p-2 rounded-lg hover:bg-gray-200 transition"
            >
              <X size={18} className="text-gray-500" />
            </button>
          </div>

          {departamentoSelecionado && (
            <div className="rounded-xl bg-cyan-50 border border-cyan-200 p-3 text-sm text-cyan-800">
              Departamento selecionado: <strong>{departamentoSelecionado.nome}</strong>
            </div>
          )}

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
                    <span className="text-xs text-gray-400">{isExpanded ? '^' : 'v'}</span>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-gray-100">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600">Status</th>
                            <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600">Codigo</th>
                            <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600">Nome na Planilha</th>
                            <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-600">Razao Social (Sistema)</th>
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
                                    <AlertTriangle size={12} /> Nao encontrada
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 font-mono font-semibold text-xs">{emp.codigo}</td>
                              <td className="px-3 py-1.5 text-xs truncate max-w-[200px]">{emp.nomeNaPlanilha}</td>
                              <td className="px-3 py-1.5 text-xs text-gray-500 truncate max-w-[200px]">
                                {emp.razaoSocialSistema || '-'}
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

          {naoEncontradas.length > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
              <AlertTriangle size={14} className="inline mr-1" />
              <strong>{naoEncontradas.length}</strong> empresa(s) nao foram encontradas no sistema. Elas serao ignoradas.
            </div>
          )}

          {/* Barra de progresso durante importação */}
          {importing && progress.total > 0 && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
              <div className="flex items-center justify-between text-sm font-semibold text-emerald-700 mb-2">
                <span className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Atualizando responsaveis... {progress.done}/{progress.total}
                </span>
                <span className="text-xs text-emerald-500">
                  {progress.success} atualizadas • {progress.skipped} ignoradas
                </span>
              </div>
              <div className="h-3 rounded-full bg-emerald-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
              <div className="text-xs text-emerald-600 mt-1 text-right font-bold">
                {Math.round((progress.done / progress.total) * 100)}%
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-4 pt-2">
            <div className="text-sm text-gray-600">
              <span className="font-bold text-green-600">{encontradas.length}</span> sera(o) atualizada(s) |{' '}
              <span className="font-bold text-amber-600">{naoEncontradas.length}</span> ignorada(s)
            </div>
            <div className="flex gap-3">
              {importing ? (
                <button
                  onClick={() => { abortRef.current = true; }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-red-300 text-red-700 bg-red-50 hover:bg-red-100 transition font-bold"
                >
                  <Square size={16} />
                  Parar
                </button>
              ) : (
                <button
                  onClick={() => {
                    setBlocks([]);
                    setFileName('');
                  }}
                  className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 transition font-semibold"
                >
                  Cancelar
                </button>
              )}
              <button
                onClick={handleImport}
                disabled={encontradas.length === 0 || importing || !departamentoSelecionado}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 text-white font-bold hover:from-emerald-700 hover:to-teal-600 shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                Atualizar {encontradas.length} responsavel(eis)
              </button>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-green-50 p-6 text-center">
            <Check className="mx-auto text-green-600 mb-3" size={48} />
            <div className="text-xl font-bold text-green-900">Atualizacao concluida!</div>
            <div className="text-sm text-green-700 mt-2">
              {result.atualizadas} empresa(s) com responsavel atualizado em <strong>{result.departamentoNome}</strong>
              {result.naoEncontradas > 0 && ` | ${result.naoEncontradas} ignorada(s)`}
            </div>
            {result.usuariosCriados.length > 0 && (
              <div className="text-sm text-green-700 mt-1">
                Usuarios criados automaticamente: {result.usuariosCriados.join(', ')}
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
