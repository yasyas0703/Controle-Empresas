'use client';

import { useEffect, useState } from 'react';
import { Archive, CheckCircle2, Download, Eye, Mail, Smartphone } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type DocumentoLinha = {
  id: string;
  arquivo_nome_original: string;
  enviado_email: boolean;
  enviado_email_em: string | null;
  visualizado_em: string | null;
  baixado_em: string | null;
  marcado_pago_em: string | null;
  removido_em: string | null;
  criado_em: string;
  total_visualizacoes: number;
  total_downloads: number;
};

function fmtDataHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function StatusPortalCliente({ checklistId }: { checklistId: string }) {
  const [linhas, setLinhas] = useState<DocumentoLinha[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: docs } = await supabase
        .from('portal_documentos')
        .select('id, arquivo_nome_original, enviado_email, enviado_email_em, visualizado_em, baixado_em, marcado_pago_em, removido_em, criado_em')
        .eq('checklist_fiscal_id', checklistId)
        .order('criado_em', { ascending: false });

      if (cancelled) return;
      if (!docs || docs.length === 0) {
        setLinhas([]);
        return;
      }

      // Conta acessos por documento em uma query só
      const ids = docs.map((d) => d.id);
      const { data: acessos } = await supabase
        .from('portal_acessos')
        .select('documento_id, acao')
        .in('documento_id', ids)
        .in('acao', ['visualizou', 'baixou']);

      if (cancelled) return;

      const contagens = new Map<string, { v: number; b: number }>();
      for (const a of acessos ?? []) {
        const c = contagens.get(a.documento_id as string) ?? { v: 0, b: 0 };
        if (a.acao === 'visualizou') c.v++;
        else if (a.acao === 'baixou') c.b++;
        contagens.set(a.documento_id as string, c);
      }

      setLinhas(
        docs.map((d) => ({
          ...d,
          total_visualizacoes: contagens.get(d.id)?.v ?? 0,
          total_downloads: contagens.get(d.id)?.b ?? 0,
        })) as DocumentoLinha[]
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [checklistId]);

  if (linhas === null) return null;
  if (linhas.length === 0) {
    return (
      <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <Smartphone size={14} className="text-slate-400" />
          <span>Esse anexo ainda não foi publicado no portal do cliente. Envie pelo botão de envio pro Gmail — o portal recebe junto.</span>
        </div>
      </div>
    );
  }

  const ativo = linhas.find((l) => !l.removido_em) ?? null;
  const removidos = linhas.filter((l) => l.removido_em);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-600">
        <Smartphone size={12} /> Atividade no Portal do Cliente
      </div>

      {ativo ? (
        <CardDocumento doc={ativo} ativo />
      ) : (
        <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-600">
          Nenhum envio ativo no portal — o cliente não vê nenhuma guia atual aqui.
          {removidos.length > 0 && ' Veja abaixo o histórico de envios anteriores.'}
        </div>
      )}

      {removidos.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white p-2">
          <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-700">
            <Archive size={11} className="mr-1 inline" />
            Envios anteriores ({removidos.length}) — histórico do cliente preservado
          </summary>
          <div className="mt-2 space-y-2">
            {removidos.map((doc) => (
              <CardDocumento key={doc.id} doc={doc} ativo={false} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function CardDocumento({ doc, ativo }: { doc: DocumentoLinha; ativo: boolean }) {
  // Cor baseada no status mais avançado
  let cardColor = 'border-slate-200 bg-slate-50';
  if (doc.marcado_pago_em) cardColor = 'border-emerald-300 bg-emerald-50';
  else if (doc.baixado_em) cardColor = 'border-blue-200 bg-blue-50';
  else if (doc.visualizado_em) cardColor = 'border-amber-200 bg-amber-50';

  if (!ativo) cardColor += ' opacity-90';

  return (
    <div className={`rounded-xl border-2 p-3 ${cardColor}`}>
      <div className="mb-2 flex items-center gap-2 text-[11px]">
        <span className="truncate font-bold text-slate-700">{doc.arquivo_nome_original}</span>
        {ativo ? (
          <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
            Atual
          </span>
        ) : (
          <span className="rounded-full bg-slate-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
            Removido em {fmtDataHora(doc.removido_em)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
        <Linha
          icon={Mail}
          ativo={doc.enviado_email}
          label="Email enviado"
          data={doc.enviado_email_em}
          cor="text-slate-700"
        />
        <Linha
          icon={Eye}
          ativo={!!doc.visualizado_em}
          label={doc.total_visualizacoes > 1 ? `Visualizou (${doc.total_visualizacoes}x)` : 'Visualizou'}
          data={doc.visualizado_em}
          cor="text-amber-700"
        />
        <Linha
          icon={Download}
          ativo={!!doc.baixado_em}
          label={doc.total_downloads > 1 ? `Baixou (${doc.total_downloads}x)` : 'Baixou'}
          data={doc.baixado_em}
          cor="text-blue-700"
        />
        <Linha
          icon={CheckCircle2}
          ativo={!!doc.marcado_pago_em}
          label="Marcou como pago"
          data={doc.marcado_pago_em}
          cor="text-emerald-700"
        />
      </div>

      {/* Resumo só pra linha atual */}
      {ativo && (
        <div className="mt-2 border-t border-slate-200/70 pt-2 text-[11px] font-medium text-slate-700">
          {doc.marcado_pago_em ? (
            <span className="text-emerald-700">✅ Cliente confirmou pagamento.</span>
          ) : doc.baixado_em ? (
            <span className="text-blue-700">⬇️ Cliente já baixou — aguardando pagamento.</span>
          ) : doc.visualizado_em ? (
            <span className="text-amber-700">👁️ Cliente abriu mas não baixou ainda.</span>
          ) : (
            <span className="text-red-700">⚠️ Cliente ainda não acessou esta guia no portal.</span>
          )}
        </div>
      )}
    </div>
  );
}

function Linha({
  icon: Icon,
  ativo,
  label,
  data,
  cor,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  ativo: boolean;
  label: string;
  data: string | null;
  cor: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={14} className={ativo ? cor : 'text-slate-300'} />
      <div className="min-w-0 flex-1">
        <div className={`font-medium ${ativo ? 'text-slate-800' : 'text-slate-400'}`}>{label}</div>
        <div className={`text-[10px] ${ativo ? 'text-slate-500' : 'text-slate-400'}`}>
          {ativo ? fmtDataHora(data) : 'Ainda não'}
        </div>
      </div>
    </div>
  );
}
