#!/usr/bin/env python3
"""Lote de prospecção por WhatsApp em DUAS ETAPAS (regra fixa: protege o número contra bloqueio por spam).

Etapa 1 manda só "Oi, bom dia!" (ou boa tarde) a cada alvo, com cadência humana, e registra se o número tem
WhatsApp. Etapa 2 (o texto completo) só sai para alvo cuja conversa recebeu resposta de PESSOA; robô recebe a
opção comercial/fornecedor, saudação automática recebe um "obrigado, fico no aguardo" (a última mensagem é nossa).

Uso:
  python3 prospeccao/lote.py etapa1 alvos.json [--lote NOME] [--simular]
  python3 prospeccao/lote.py status NOME
  python3 prospeccao/lote.py etapa2 NOME "Nome do alvo" [--forcar]
  python3 prospeccao/lote.py listar

alvos.json = lista de {"nome", "telefone" (55DDN...), "pessoa", "email" (opcional), "texto" (etapa 2)}.
Estado em ~/.wco_agente/lotes/NOME.json e CRM em ~/.wco_agente/PROSPECCAO.md (fora do repositório).
"""
import argparse
import datetime as dt
import json
import random
import re
import subprocess
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
WA = [sys.executable, str(RAIZ / 'wa' / 'wa.py')]
BASE = Path.home() / '.wco_agente'
CRM = BASE / 'PROSPECCAO.md'
PASTA = BASE / 'lotes'

RX_ROBO = re.compile(r'(^|\n)\s*[1-9][\.\)]\s|\bdigite\b|\bopç(ão|ões)\b|\bmenu\b|\bselecione\b|assistente virtual|'
                     r'atendimento autom[áa]tico|sou (o |a )?(seu |sua )?(assistente|rob[ôo]|bot)\b', re.I)
RX_AUTO = re.compile(r'agradece|obrigad[oa] pelo contato|hor[áa]rio (de|para) atendimento|retornar|em breve|bem-vind|'
                     r'assim que poss[ií]vel|atendimento [ée] das|fora do (nosso )?hor[áa]rio|mensagem autom|'
                     r'chamei algu[ée]m|continuar (o |seu )?atendimento|s[óo] um momento|um momento|aguarde|em instantes|'
                     r'nosso cat[áa]logo|wa\.me/c/|para agilizar o atendimento', re.I)


def wa(*args, entrada=None):
    r = subprocess.run(WA + list(args), input=entrada, capture_output=True, text=True, encoding='utf-8')
    return (r.stdout + r.stderr).strip()


def saudacao(variar=False):
    h = dt.datetime.now().hour
    periodo = 'bom dia' if h < 12 else ('boa tarde' if h < 18 else 'boa noite')
    if not variar:
        return f'Oi, {periodo}!'
    # texto idêntico em massa pesa no filtro anti-spam do WhatsApp
    return random.choice([f'Oi, {periodo}!', f'Olá, {periodo}!', f'Oi, {periodo}. Tudo bem?',
                          f'Olá, {periodo}, tudo bem?', f'{periodo.capitalize()}!'])


def jid_de(telefone):
    d = re.sub(r'\D', '', telefone)
    return d + '@s.whatsapp.net'


def carregar(nome):
    p = PASTA / f'{nome}.json'
    if not p.exists():
        sys.exit(f'lote {nome} não existe em {PASTA}')
    return json.load(open(p, encoding='utf-8')), p


def salvar(lote, p):
    PASTA.mkdir(parents=True, exist_ok=True)
    json.dump(lote, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


def crm(linha):
    BASE.mkdir(parents=True, exist_ok=True)
    with open(CRM, 'a', encoding='utf-8') as f:
        f.write(linha.rstrip('\n') + '\n')


def classificar(alvo):
    """Lê o fim da conversa e devolve (status, jid_resposta, ultima_msg_deles)."""
    if alvo.get('status') == 'sem_whatsapp':
        return 'sem_whatsapp', None, ''
    out = wa('chat', alvo['jid'], '-n', '8')
    if not re.search(r'^#\d+ ', out, re.M):
        # a ponte envia pelo número canônico (12 dígitos, sem o 9) mas o /chat não converte: tenta a outra variante
        d = alvo['jid'].split('@')[0]
        alt = d[:4] + d[5:] if len(d) == 13 and d[4] == '9' else (d[:4] + '9' + d[4:] if len(d) == 12 else None)
        if alt:
            out2 = wa('chat', alt + '@s.whatsapp.net', '-n', '8')
            if re.search(r'^#\d+ ', out2, re.M):
                out = out2
    cab = re.match(r'== .*<([^>]+)>', out)
    jid = cab.group(1) if cab else alvo['jid']
    deles = [m.group(1) for m in re.finditer(r'^#\d+ \d\d/\d\d, \d\d:\d\d : (.*)$', out, re.M)]
    if not deles:
        return 'sem_resposta', jid, ''
    texto = '\n'.join(deles)
    if RX_ROBO.search(texto):
        return 'robo', jid, deles[-1]
    if all(RX_AUTO.search(d) for d in deles):
        return 'automatico', jid, deles[-1]
    return 'humano', jid, deles[-1]


def cmd_etapa1(a):
    alvos = json.load(open(a.alvos, encoding='utf-8'))
    nome = a.lote or dt.date.today().strftime('lote_%Y%m%d_%H%M')
    p = PASTA / f'{nome}.json'
    lote = {'nome': nome, 'criado': dt.datetime.now().isoformat(timespec='minutes'), 'alvos': []}
    if not a.simular:
        crm(f'\n## LOTE {nome} — etapa 1 ("{saudacao()}") {dt.datetime.now():%d/%m %H:%M}; etapa 2 só para quem responder PESSOA (lote.py)')
    for i, t in enumerate(alvos, 1):
        alvo = {'nome': t['nome'], 'pessoa': t.get('pessoa', ''), 'email': t.get('email', ''), 'telefone': t['telefone'],
                'jid': jid_de(t['telefone']), 'texto': t['texto'], 'status': 'etapa1', 'log': []}
        if a.simular:
            out = f'(simulado) {saudacao()} -> {alvo["jid"]}'
        else:
            out = wa('enviar', alvo['jid'], '-', entrada=saudacao(variar=True))
        if 'não tem WhatsApp' in out:
            alvo['status'] = 'sem_whatsapp'
        alvo['log'].append(f'{dt.datetime.now():%d/%m %H:%M} etapa1: {out[:120]}')
        lote['alvos'].append(alvo)
        salvar(lote, p)
        st = 'SEM WHATSAPP → e-mail' + (f' {alvo["email"]}' if alvo['email'] else ' (achar contato)') if alvo['status'] == 'sem_whatsapp' else 'etapa 1 enviada'
        if not a.simular:
            crm(f'| {dt.datetime.now():%d/%m %H:%M} | {alvo["nome"]} | {alvo["pessoa"]} {t["telefone"]} | {st} | aguardando |')
        print(f'{i:02d} {alvo["nome"]}: {st}')
        if i < len(alvos) and not a.simular:
            time.sleep(random.uniform(a.intervalo_min, a.intervalo_max))
    print(f'lote salvo: {p}')


def cmd_status(a):
    lote, p = carregar(a.lote)
    for alvo in lote['alvos']:
        st, jid, ult = classificar(alvo)
        alvo['status_lido'] = st
        if jid:
            alvo['jid_resposta'] = jid
        dica = {'humano': 'etapa 2 já enviada; acompanhar' if alvo.get('status') == 'etapa2' else 'MANDAR etapa 2: lote.py etapa2 …',
                'robo': 'escolher opção comercial/fornecedor e registrar',
                'automatico': 'mandar "Obrigado! Fico no aguardo de quem cuida de X"', 'sem_resposta': 'esperar; follow-up em 48 h',
                'sem_whatsapp': 'e-mail a contato nomeado'}[st]
        if alvo.get('status') == 'encerrado':
            dica = 'ENCERRADO; nada a fazer'
        print(f'{st:13s} {alvo["nome"]:35s} {alvo.get("jid_resposta", alvo["jid"])} | {ult[:70]} | {dica}')
    salvar(lote, p)


def cmd_etapa2(a):
    lote, p = carregar(a.lote)
    alvo = next((x for x in lote['alvos'] if x['nome'].lower().startswith(a.alvo.lower())), None)
    if not alvo:
        sys.exit('alvo não encontrado: ' + a.alvo)
    st, jid, ult = classificar(alvo)
    if st != 'humano' and not a.forcar:
        sys.exit(f'NÃO ENVIADO: status é "{st}" (última deles: {ult[:80]!r}). Etapa 2 só para pessoa; --forcar se tiver motivo.')
    out = wa('enviar', jid, '-', '--primeiro-contato-longo', entrada=alvo['texto'])
    alvo['status'] = 'etapa2'
    alvo['log'].append(f'{dt.datetime.now():%d/%m %H:%M} etapa2 -> {jid}: {out[:100]}')
    salvar(lote, p)
    crm(f'| {dt.datetime.now():%d/%m %H:%M} | {alvo["nome"]} | {jid} | etapa 2 enviada (respondeu pessoa: {ult[:60]!r}) | aguardando |')
    print(out)


def cmd_listar(a):
    for p in sorted(PASTA.glob('*.json')):
        l = json.load(open(p, encoding='utf-8'))
        print(p.stem, l['criado'], len(l['alvos']), 'alvos')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    x = sp.add_parser('etapa1'); x.add_argument('alvos'); x.add_argument('--lote'); x.add_argument('--simular', action='store_true')
    # 3–5 min entre contatos novos (rajada derruba/bloqueia o número): ≤ ~12/h
    x.add_argument('--intervalo-min', type=float, default=180); x.add_argument('--intervalo-max', type=float, default=300)
    x = sp.add_parser('status'); x.add_argument('lote')
    x = sp.add_parser('etapa2'); x.add_argument('lote'); x.add_argument('alvo'); x.add_argument('--forcar', action='store_true')
    sp.add_parser('listar')
    a = ap.parse_args()
    {'etapa1': cmd_etapa1, 'status': cmd_status, 'etapa2': cmd_etapa2, 'listar': cmd_listar}[a.cmd](a)
