'use client';

import React, { useState } from 'react';
import {
  AlertTriangle, Archive, ArrowLeft, Calendar, CheckCircle2, FileSpreadsheet, FileText,
  Loader2, PowerOff, ShieldAlert, Upload,
} from 'lucide-react';
import Link from 'next/link';
import { useSistema } from '@/app/context/SistemaContext';
import { insertEmpresa } from '@/lib/db';
import { TRIBUTACAO_LABELS } from '@/app/types';
import { parseCsvClienteDesde, type ParsedCsv } from './parser';

type Resultado = {
  atualizadas: { sucesso: number; falhas: Array<{ codigo: string; erro: string }> };
  desligadasCriadas: { sucesso: number; falhas: Array<{ codigo: string; erro: string }> };
};

function formatBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function ImportarClienteDesdePage() {
  const { empresas, currentUser, isPrivileged, authReady, mostrarAlerta, atualizarEmpresa } = useSistema();
  const [csv, setCsv] = useState('');
  const [analisado, setAnalisado] = useState<ParsedCsv | null>(null);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  function lerArquivo(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result ?? ''));
      setAnalisado(null);
      setResultado(null);
    };
    reader.readAsText(file, 'utf-8');
  }

  function handleAnalisar() {
    if (!csv.trim()) {
      mostrarAlerta('Atenção', 'Cole o CSV ou faça upload de um arquivo primeiro.', 'aviso');
      return;
    }
    setResultado(null);
    setAnalisado(parseCsvClienteDesde(csv, empresas));
  }

  function toggleDesligada(tempKey: string) {
    if (!analisado) return;
    setAnalisado({
      ...analisado,
      desligadasNovas: analisado.desligadasNovas.map((d) =>
        d.tempKey === tempKey ? { ...d, selecionada: !d.selecionada } : d
      ),
    });
  }

  async function handleConfirmar() {
    if (!analisado) return;
    setImportando(true);
    const out: Resultado = {
      atualizadas: { sucesso: 0, falhas: [] },
      desligadasCriadas: { sucesso: 0, falhas: [] },
    };
    const hojeIso = new Date().toISOString().split('T')[0];

    try {
      // 1) Atualizar empresas existentes
      for (const l of analisado.linhas) {
        try {
          await atualizarEmpresa(l.empresaId, { cliente_desde: l.clienteDesdeDepois });
          out.atualizadas.sucesso++;
        } catch (err) {
          out.atualizadas.falhas.push({
            codigo: l.codigo,
            erro: err instanceof Error ? err.message : 'Erro desconhecido',
          });
        }
      }

      // 2) Cadastrar empresas desligadas selecionadas
      const selecionadas = analisado.desligadasNovas.filter((d) => d.selecionada);
      for (const d of selecionadas) {
        try {
          await insertEmpresa({
            cadastrada: !!d.cnpj,
            codigo: d.codigoSintetico,
            cnpj: d.cnpj || undefined,
            razao_social: d.razaoSocial || d.apelido || undefined,
            apelido: d.apelido || undefined,
            tipoEstabelecimento: '',
            tipoInscricao: '',
            servicos: [],
            tags: [],
            possuiRet: false,
            rets: [],
            vencimentosFiscais: [],
            responsaveis: {},
            documentos: [],
            observacoes: [],
            tributacao: d.tributacaoSugerida ?? null,
            cliente_desde: d.clienteDesde,
            desligada_em: hojeIso,
          }, []);
          out.desligadasCriadas.sucesso++;
        } catch (err) {
          out.desligadasCriadas.falhas.push({
            codigo: d.codigoSintetico,
            erro: err instanceof Error ? err.message : 'Erro desconhecido',
          });
        }
      }

      setResultado(out);
      mostrarAlerta(
        'Importação concluída',
        `${out.atualizadas.sucesso} atualizadas · ${out.desligadasCriadas.sucesso} desligadas cadastradas.`,
        'sucesso'
      );
    } finally {
      setImportando(false);
    }
  }

  if (!authReady) return null;
  if (!currentUser || !isPrivileged) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-white p-6 sm:p-8 shadow-sm border border-gray-100 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
            <ShieldAlert size={28} />
          </div>
          <div className="text-lg font-bold text-gray-900">Acesso restrito</div>
          <div className="mt-1 text-sm text-gray-500">Esta página é apenas para administradores.</div>
        </div>
      </div>
    );
  }

  type AvisoLista = NonNullable<typeof analisado>['avisos'];
  const avisosPorTipo: Record<string, AvisoLista> = {};
  for (const a of analisado?.avisos ?? []) {
    if (!avisosPorTipo[a.tipo]) avisosPorTipo[a.tipo] = [];
    avisosPorTipo[a.tipo].push(a);
  }

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 max-w-full">
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm font-bold text-gray-600 hover:text-gray-900">
          <ArrowLeft size={16} /> Voltar
        </Link>
      </div>

      {/* Header */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-gradient-to-br from-violet-500 via-indigo-500 to-blue-500 flex items-center justify-center shadow-md shrink-0">
            <Calendar className="text-white" size={22} />
          </div>
          <div className="min-w-0">
            <div className="text-lg sm:text-2xl font-bold text-gray-900">Importar &quot;Cliente desde&quot;</div>
            <div className="text-xs sm:text-sm text-gray-500">
              Atualiza empresas atuais com a data de início. Empresas que não existem mais no sistema são cadastradas como já desligadas.
            </div>
          </div>
        </div>
      </div>

      {/* Como funciona */}
      <details className="rounded-2xl bg-white border border-gray-100 p-4">
        <summary className="cursor-pointer font-bold text-sm text-gray-800">Como o CSV é interpretado</summary>
        <div className="mt-3 text-xs text-gray-600 space-y-1.5 leading-relaxed">
          <p><strong>Estrutura esperada:</strong> <code className="font-mono bg-gray-100 px-1 rounded">CODIGO;APELIDO;CNPJ;NOME FANTASIA;RAZÃO SOCIAL;SIT;CLIENTE DESDE;REGIME</code></p>
          <p><strong>Match por código + nome:</strong> se o código bate e o nome também, atualiza <code className="font-mono bg-gray-100 px-1 rounded">cliente_desde</code> da empresa.</p>
          <p><strong>Código não existe no sistema:</strong> cadastra como nova empresa <strong>já desligada</strong> (cliente antigo) com <code className="font-mono bg-gray-100 px-1 rounded">desligada_em = hoje</code>.</p>
          <p><strong>Código existe mas o nome não bate (reciclado):</strong> cadastra como nova empresa desligada com código sintético <code className="font-mono bg-gray-100 px-1 rounded">{`{código}-A`}</code>. A empresa atual desse código no sistema não é tocada.</p>
          <p><strong>Tributação:</strong> coluna REGIME (REAL/PRESUMIDO/SIMPLES) é convertida em Lucro Real / Lucro Presumido / Simples Nacional. Outros valores (CEI, MEI, OBRA, DOMÉSTICA) são ignorados.</p>
          <p><strong>Data:</strong> formato <code className="font-mono bg-gray-100 px-1 rounded">DD/MM/YYYY</code>. Linhas com data vazia ou inválida são puladas.</p>
        </div>
      </details>

      {/* Input */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="inline-flex items-center gap-2 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 px-3 py-1.5 text-xs font-bold cursor-pointer transition">
            <Upload size={14} /> Subir arquivo .csv
            <input
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) lerArquivo(f);
              }}
            />
          </label>
        </div>

        <textarea
          value={csv}
          onChange={(e) => { setCsv(e.target.value); setAnalisado(null); setResultado(null); }}
          placeholder="Cole aqui o CSV (CODIGO;APELIDO;CNPJ;NOME FANTASIA;RAZÃO SOCIAL;SIT;CLIENTE DESDE;REGIME)"
          rows={10}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
          spellCheck={false}
        />

        <div className="flex items-center gap-2">
          <button
            onClick={handleAnalisar}
            disabled={!csv.trim()}
            className="rounded-lg bg-gradient-to-r from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700 text-white px-4 py-2 text-sm font-bold transition disabled:opacity-50"
          >
            Analisar CSV
          </button>
          {csv && (
            <button
              onClick={() => { setCsv(''); setAnalisado(null); setResultado(null); }}
              className="rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 text-xs font-bold transition"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Preview */}
      {analisado && (
        <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-violet-600" />
            <h2 className="font-bold text-lg text-gray-900">Pré-visualização</h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-xl border border-violet-200 bg-violet-50 text-violet-700 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">Atualizar</div>
              <div className="text-2xl font-black">{analisado.linhas.length}</div>
            </div>
            <div className="rounded-xl border border-slate-300 bg-slate-100 text-slate-700 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">Cadastrar desligadas</div>
              <div className="text-2xl font-black">{analisado.desligadasNovas.filter((d) => d.selecionada).length}</div>
              {analisado.desligadasNovas.length > analisado.desligadasNovas.filter((d) => d.selecionada).length && (
                <div className="text-[10px] mt-0.5">de {analisado.desligadasNovas.length} detectadas</div>
              )}
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-700 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">Avisos</div>
              <div className="text-2xl font-black">{analisado.avisos.length}</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 text-gray-700 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">Linhas no CSV</div>
              <div className="text-2xl font-black">{analisado.totalLinhas}</div>
            </div>
          </div>

          {/* Empresas a cadastrar como desligadas */}
          {analisado.desligadasNovas.length > 0 && (
            <div className="rounded-xl border border-slate-300 bg-slate-50 p-3">
              <div className="flex items-center gap-2 font-bold text-xs text-slate-800 mb-2">
                <Archive size={16} className="text-slate-600" />
                {analisado.desligadasNovas.length} empresa(s) detectada(s) como cliente antigo
              </div>
              <p className="text-[11px] text-slate-700 mb-3">
                Estas empresas não estão atualizadas no sistema, então são tratadas como <strong>clientes que saíram</strong>. Cada uma será cadastrada com tag de desligamento (<code className="font-mono bg-white px-1 rounded">desligada_em = hoje</code>) e aparecerá em <strong>&quot;Empresas Desligadas&quot;</strong>.
              </p>
              <ul className="space-y-1.5 max-h-80 overflow-y-auto">
                {analisado.desligadasNovas.map((d) => (
                  <li
                    key={d.tempKey}
                    className={`rounded-lg border p-2.5 transition ${
                      d.selecionada ? 'bg-white border-slate-300' : 'bg-slate-100 border-slate-200 opacity-60'
                    }`}
                  >
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={d.selecionada}
                        onChange={() => toggleDesligada(d.tempKey)}
                        className="mt-1 h-4 w-4 accent-slate-700 cursor-pointer shrink-0"
                      />
                      <div className="flex-1 min-w-0 text-[11px]">
                        <div className="font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                          {d.razaoSocial || d.apelido || '(sem nome)'}
                          {d.motivo === 'codigo_reciclado' ? (
                            <span className="font-mono text-[9px] bg-amber-100 text-amber-700 px-1 rounded font-bold">CÓDIGO RECICLADO</span>
                          ) : (
                            <span className="font-mono text-[9px] bg-slate-200 text-slate-700 px-1 rounded font-bold">CLIENTE ANTIGO</span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-slate-500 mt-0.5">
                          código CSV: <strong>{d.codigoCsv}</strong>
                          {d.motivo === 'codigo_reciclado' && (
                            <> → será cadastrado como <strong className="text-cyan-700">{d.codigoSintetico}</strong></>
                          )}
                        </div>
                        {d.motivo === 'codigo_reciclado' && d.nomeEmpresaAtualNoSistema && (
                          <div className="text-slate-600 mt-0.5">
                            Hoje o código <strong>{d.codigoCsv}</strong> aponta para: <em>{d.nomeEmpresaAtualNoSistema}</em>
                            {d.similaridadeComCodigoExistente !== undefined && (
                              <> (similaridade {Math.round(d.similaridadeComCodigoExistente * 100)}%)</>
                            )}
                          </div>
                        )}
                        <div className="text-slate-700 mt-0.5 flex flex-wrap gap-x-3">
                          {d.cnpj && <span>CNPJ: <span className="font-mono">{d.cnpj}</span></span>}
                          <span><Calendar size={9} className="inline mr-0.5" />Cliente desde: <strong>{formatBR(d.clienteDesde)}</strong></span>
                          {d.tributacaoSugerida && (
                            <span>Tributação: <strong>{TRIBUTACAO_LABELS[d.tributacaoSugerida]}</strong></span>
                          )}
                        </div>
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-slate-500 mt-2">Desmarque as que <strong>não</strong> quiser cadastrar.</p>
            </div>
          )}

          {/* Avisos agrupados (data inválida, sem data) */}
          {(['data_invalida', 'sem_data'] as const).map((tipo) => {
            const lista = avisosPorTipo[tipo] ?? [];
            if (lista.length === 0) return null;
            const titulos: Record<typeof tipo, string> = {
              data_invalida: 'Datas inválidas',
              sem_data: 'Sem data',
            };
            return (
              <details key={tipo} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <summary className="cursor-pointer text-xs font-bold text-amber-800 flex items-center gap-2">
                  <AlertTriangle size={14} />
                  {titulos[tipo]} ({lista.length})
                </summary>
                <ul className="mt-2 space-y-1 text-[11px] max-h-56 overflow-y-auto font-mono text-amber-900">
                  {lista.map((a, i) => <li key={i}>• {a.mensagem}</li>)}
                </ul>
              </details>
            );
          })}

          {/* Lista a atualizar */}
          {analisado.linhas.length > 0 && (
            <details className="rounded-xl bg-violet-50 border border-violet-200 p-3">
              <summary className="cursor-pointer text-xs font-bold text-violet-800">
                {analisado.linhas.length} empresa(s) com cliente_desde a atualizar
              </summary>
              <ul className="mt-2 space-y-1 text-[11px] text-violet-900 max-h-72 overflow-y-auto font-mono">
                {analisado.linhas.map((l) => (
                  <li key={l.empresaId}>
                    <span className="font-bold">{l.codigo}</span> {l.nomeEmpresa}: {' '}
                    {l.clienteDesdeAntes ? formatBR(l.clienteDesdeAntes) : '—'} → <strong>{formatBR(l.clienteDesdeDepois)}</strong>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="pt-2 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
            <p className="text-[11px] text-gray-500">
              Empresas existentes terão <code className="font-mono bg-gray-100 px-1 rounded">cliente_desde</code> sobrescrito. Desligadas novas vão pra &quot;Empresas Desligadas&quot;.
            </p>
            <button
              onClick={handleConfirmar}
              disabled={importando || (analisado.linhas.length === 0 && analisado.desligadasNovas.filter((d) => d.selecionada).length === 0)}
              className="rounded-lg bg-gradient-to-r from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700 text-white px-4 py-2 text-sm font-bold transition disabled:opacity-50 inline-flex items-center gap-2 shrink-0"
            >
              {importando ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {importando ? 'Importando...' : 'Confirmar e importar'}
            </button>
          </div>
        </div>
      )}

      {/* Resultado */}
      {resultado && (
        <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm space-y-3">
          <h2 className="font-bold text-lg text-gray-900 flex items-center gap-2">
            <FileText size={18} className="text-violet-600" /> Relatório
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <BlocoResultado titulo="Empresas atualizadas" sucesso={resultado.atualizadas.sucesso} falhas={resultado.atualizadas.falhas.length} />
            <BlocoResultado titulo="Desligadas cadastradas" sucesso={resultado.desligadasCriadas.sucesso} falhas={resultado.desligadasCriadas.falhas.length} />
          </div>
          {(resultado.atualizadas.falhas.length + resultado.desligadasCriadas.falhas.length) > 0 && (
            <details className="rounded-xl bg-red-50 border border-red-200 p-3">
              <summary className="cursor-pointer text-xs font-bold text-red-800">Erros detalhados</summary>
              <div className="mt-2 space-y-1 text-[11px] text-red-900 font-mono">
                {resultado.atualizadas.falhas.map((f, i) => (
                  <div key={`a${i}`}>Atualização {f.codigo}: {f.erro}</div>
                ))}
                {resultado.desligadasCriadas.falhas.map((f, i) => (
                  <div key={`d${i}`}>Cadastro {f.codigo}: {f.erro}</div>
                ))}
              </div>
            </details>
          )}
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm font-bold text-violet-700 hover:text-violet-800">
              Ir para o dashboard →
            </Link>
            <Link href="/empresas-desligadas" className="inline-flex items-center gap-1 text-sm font-bold text-slate-700 hover:text-slate-800">
              <PowerOff size={14} /> Ver empresas desligadas
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function BlocoResultado({ titulo, sucesso, falhas }: { titulo: string; sucesso: number; falhas: number }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{titulo}</div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-lg font-black text-emerald-700">{sucesso}</span>
        <span className="text-xs text-gray-500">ok</span>
        {falhas > 0 && (
          <>
            <span className="text-lg font-black text-red-600 ml-2">{falhas}</span>
            <span className="text-xs text-gray-500">erro{falhas === 1 ? '' : 's'}</span>
          </>
        )}
      </div>
    </div>
  );
}
