#!/usr/bin/env python3
"""Cliente curto da ponte WhatsApp (daemon.mjs). Saída em texto compacto, feita p/ gastar poucos tokens.

  wa.py qr                                  mostra o QR em texto (para conectar o WhatsApp pelo terminal/SSH)

  wa.py status
  wa.py novas [--desde N] [--max 6] [--nao-marcar]   mensagens recebidas não lidas (agrupadas por conversa)
  wa.py esperar [--desde N] [--timeout 3000] [--quieto 45]   bloqueia até chegar mensagem nova e só devolve
                                            depois de 45 s sem mensagem nova (rajada inteira; 0 = desliga)
  wa.py chat "Nome ou número ou jid" [-n 15]
  wa.py conversas [-q filtro] [-n 20]
  wa.py contatos filtro
  wa.py enviar "Nome|número|jid" "texto"   (texto '-' lê do stdin)
  wa.py enviar "Nome" "legenda" --arquivo x.pdf [--nome Arquivo.pdf]   anexo (PDF/imagem)
  wa.py enviar "Nome" --opcao 5             escolhe a opção 5 do último menu de robô recebido (texto digitado ele ignora)
  wa.py lido "Nome"
  wa.py pendentes [--horas 72] [--grupos]   conversas cuja ÚLTIMA mensagem é do outro lado (sem resposta nossa),
                                            juntando LID e número; rodar em TODA notificação e todo ciclo
  wa.py silenciar JID [--sempre] [--tirar]  tira a conversa do `pendentes` ATÉ chegar mensagem nova dela
                                            (--sempre = spam/robô fixo)
  wa.py apagar ID                           apaga para todos uma mensagem nossa
  wa.py midia ID                            baixa mídia e imprime o caminho
"""
import argparse, json, os, sys, urllib.parse, urllib.request

BASE = 'http://127.0.0.1:' + os.environ.get('WA_PORT', '8787')
DADOS = os.environ.get('WA_DIR') or os.path.join(os.path.expanduser('~'), '.wco_agente', 'wa')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')  # Windows: acentos no terminal


def get(p, _to=30, **q):
    q = {k: v for k, v in q.items() if v is not None}
    url = BASE + p + ('?' + urllib.parse.urlencode(q) if q else '')
    return call(urllib.request.Request(url), _to)


def post(p, body):
    req = urllib.request.Request(BASE + p, data=json.dumps(body).encode(), method='POST',
                                 headers={'content-type': 'application/json'})
    return call(req, 60)


def call(req, timeout):
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode()
    except urllib.error.HTTPError as e:
        return e.read().decode()
    except Exception as e:
        return f'ponte fora do ar ({e}). Subir: iniciar.sh / iniciar.bat (ou systemctl --user start wco-ponte)'


SIL = os.path.join(DADOS, 'silenciados.json')


def _sil():
    try:
        return json.load(open(SIL, encoding='utf-8'))
    except Exception:
        return {}


def silenciar(jid, sempre, tirar):
    import time
    d = _sil()
    if tirar:
        d.pop(jid, None)
    else:
        d[jid] = 'sempre' if sempre else time.time()
    json.dump(d, open(SIL, 'w', encoding='utf-8'), indent=1)
    return f"{jid}: {'removido' if tirar else d[jid]}\n"


def pendentes(horas, grupos):
    # Lê os arquivos da ponte direto: conversa em que a última mensagem (LID e número juntos) não é nossa.
    # Existe porque, com várias conversas chegando juntas, uma pode ficar sem resposta.
    import os, time, collections
    d = DADOS + os.sep
    mp = {}
    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if isinstance(k, str) and k.endswith('@lid') and isinstance(v, str) and v.endswith('@s.whatsapp.net'):
                    mp[k] = v
                walk(v)
    try:
        walk(json.load(open(d + 'estado.json', encoding='utf-8')))
    except Exception:
        pass
    por = collections.defaultdict(list)
    try:
        todas = json.load(open(d + 'msgs.json', encoding='utf-8'))
    except FileNotFoundError:
        return 'nenhuma pendente (ponte ainda sem mensagens)\n'
    for x in todas:
        por[mp.get(x['chat'], x['chat'])].append(x)
    lim, linhas, sil = time.time() - horas * 3600, [], _sil()
    for c, xs in por.items():
        if c.endswith('@g.us') and not grupos:
            continue
        xs.sort(key=lambda x: (x['t'], x['s']))  # por horário: após reconectar, a ponte renumera as nossas
        quem = [x for x in xs if x.get('tipo') != 'reacao']
        if not quem or quem[-1]['eu'] or quem[-1]['t'] < lim:
            continue
        sv = sil.get(c, sil.get(quem[-1]['chat']))
        if sv == 'sempre' or (isinstance(sv, (int, float)) and quem[-1]['t'] <= sv):
            continue
        sem = [x for x in quem[::-1] if not x['eu']]
        n = next((i for i, x in enumerate(quem[::-1]) if x['eu']), len(quem))
        l = quem[-1]
        linhas.append((l['t'], f"{time.strftime('%d/%m %H:%M', time.localtime(l['t']))} {l['chat']} ({n} sem resposta) "
                               f"#{l['s']} {l['tipo']}: {str(l.get('txt') or '')[:80]}".replace('\n', ' ')))
    return '\n'.join(t for _, t in sorted(linhas)) + '\n' if linhas else 'nenhuma pendente\n'


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest='cmd', required=True)
    sp.add_parser('status'); sp.add_parser('qr')
    for n in ('novas', 'esperar'):
        p = sp.add_parser(n); p.add_argument('--desde', type=int); p.add_argument('--max', type=int, default=6)
        p.add_argument('--nao-marcar', action='store_true'); p.add_argument('--timeout', type=int, default=3000)
        p.add_argument('--quieto', type=int, default=45, help='esperar: segundos sem mensagem nova antes de devolver (0 desliga)')
    p = sp.add_parser('chat'); p.add_argument('c'); p.add_argument('-n', type=int, default=15)
    p = sp.add_parser('conversas'); p.add_argument('-q'); p.add_argument('-n', type=int, default=20)
    p = sp.add_parser('contatos'); p.add_argument('q', nargs='?', default='')
    p = sp.add_parser('enviar'); p.add_argument('to'); p.add_argument('texto', nargs='?', default=''); p.add_argument('--opcao', type=int); p.add_argument('--cita'); p.add_argument('--arquivo'); p.add_argument('--nome'); p.add_argument('--miniatura', help='.jpg usado como capa/prévia de um vídeo .mp4 (padrão: 1º quadro)')
    p.add_argument('--sem-checar-datas', action='store_true', help='pula a trava dia da semana × data (só falso positivo)')
    p.add_argument('--primeiro-contato-longo', action='store_true', help='permite texto > 200 caracteres em chat sem histórico (exceção justificada)')
    sp.add_parser('dias', help='calendário dos próximos 14 dias (copiar daqui o dia da semana)')
    p = sp.add_parser('lido'); p.add_argument('to')
    p = sp.add_parser('apagar'); p.add_argument('id')
    p = sp.add_parser('pendentes'); p.add_argument('--horas', type=float, default=72); p.add_argument('--grupos', action='store_true')
    p = sp.add_parser('silenciar'); p.add_argument('jid'); p.add_argument('--sempre', action='store_true'); p.add_argument('--tirar', action='store_true')
    p = sp.add_parser('midia'); p.add_argument('id')
    p = sp.add_parser('perfil', help='perfil comercial da conta: sem opções mostra; com opções altera só o que for passado')
    p.add_argument('--descricao'); p.add_argument('--email'); p.add_argument('--site', action='append', help='repetir para mais de um site')
    p.add_argument('--endereco'); p.add_argument('--recado', help='o "status" de texto do perfil'); p.add_argument('--nome-perfil')
    p = sp.add_parser('catalogo', help='catálogo de serviços: sem opções lista; --add cria; --apagar ID remove. '
                      'ATENÇÃO: criar item pela API pode não funcionar; criar pelo app')
    p.add_argument('--add', metavar='NOME'); p.add_argument('--preco', type=float, default=0, help='em reais (0 = sem preço)')
    p.add_argument('--descricao', default=''); p.add_argument('--imagem', help='imagem obrigatória para criar'); p.add_argument('--url')
    p.add_argument('--apagar', action='append', metavar='ID')
    a = ap.parse_args()

    if a.cmd == 'status':
        out = get('/status')
    elif a.cmd == 'qr':
        out = get('/qr')
    elif a.cmd in ('novas', 'esperar'):
        out = get("/" + a.cmd, _to=a.timeout + 30, desde=a.desde, max=a.max,
                  marcar='0' if a.nao_marcar else None, **({'timeout': a.timeout} if a.cmd == 'esperar' else {}))
        if a.cmd == 'esperar':
            # conversa silenciada \"sempre\" não acorda o vigia: volta a esperar
            import re, time
            fim = time.time() + a.timeout
            while True:
                jids = re.findall(r'^== .*<([^>]+)>', out, re.M)
                s = _sil()
                resta = int(fim - time.time())
                if not jids or not all(s.get(j) == 'sempre' for j in jids) or resta < 60:
                    break
                out = get('/esperar', _to=resta + 30, max=a.max, timeout=resta,
                          marcar='0' if a.nao_marcar else None)
        if a.cmd == 'esperar' and a.quieto > 0 and '\n#' in out:
            # rajada: a pessoa costuma mandar 2-3 mensagens seguidas só devolve após `quieto` s sem nada novo
            import re, time
            ult = max([int(x) for x in re.findall(r'^#(\d+) ', out, re.M)] or [0])
            while True:
                time.sleep(a.quieto)
                mais = get('/novas', _to=60, max=a.max, marcar='0' if a.nao_marcar else None)
                novos = [l for l in mais.splitlines() if re.match(r'^#(\d+) ', l) and int(re.match(r'^#(\d+) ', l).group(1)) > ult]
                if not novos:
                    break
                ult = max(int(re.match(r'^#(\d+) ', l).group(1)) for l in novos)
                # mantém o cabeçalho de CADA conversa com mensagem nova
                bloco, atual = [], None
                for l in mais.splitlines():
                    if l.startswith('== '):
                        atual = l
                    elif l in novos:
                        if atual is not None:
                            bloco.append(atual); atual = None
                        bloco.append(l)
                out = out.rstrip('\n') + '\n' + '\n'.join(bloco) + f'\nate {ult}'
    elif a.cmd == 'chat':
        out = get('/chat', c=a.c, n=a.n)
    elif a.cmd == 'conversas':
        out = get('/conversas', q=a.q, n=a.n)
    elif a.cmd == 'contatos':
        out = get('/contatos', q=a.q)
    elif a.cmd == 'dias':
        import os
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from datas import calendario
        out = calendario() + '\n'
    elif a.cmd == 'enviar':
        txt = sys.stdin.read() if a.texto == '-' else a.texto
        import os
        if not a.sem_checar_datas:
            # trava: dia da semana errado ao lado da data confunde o cliente
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from datas import checar, calendario
            prob = checar(txt)
            if prob:
                sys.stderr.write('NÃO ENVIADO: dia da semana não bate com a data.\n  ' + '\n  '.join(prob)
                                 + '\nCalendário:\n' + calendario(10) + '\nCorrija o texto (ou --sem-checar-datas se for falso positivo).\n')
                sys.exit(2)
        if not a.primeiro_contato_longo and len(txt.strip()) > 200 and not a.to.endswith('@g.us'):
            # regra fixa (anti-spam): primeiro contato é só "Oi, bom dia!"; o texto vai depois da resposta
            import re
            if not re.search(r'^#\d+ ', get('/chat', c=a.to, n=3), re.M):
                sys.stderr.write('NÃO ENVIADO: chat sem histórico e texto longo. Primeiro contato é só "Oi, bom dia!"; '
                                 'espere a resposta e só então mande o texto (prospeccao/lote.py). '
                                 'Exceção justificada: repita com --primeiro-contato-longo.\n')
                sys.exit(3)
        out = post('/enviar', {'to': a.to, 'text': txt.strip(), 'cita': a.cita, 'arquivo': os.path.abspath(a.arquivo) if a.arquivo else None, 'nome': a.nome, 'opcao': a.opcao, 'miniatura': os.path.abspath(a.miniatura) if a.miniatura else None})
    elif a.cmd == 'lido':
        out = post('/lido', {'to': a.to})
    elif a.cmd == 'pendentes':
        out = pendentes(a.horas, a.grupos)
    elif a.cmd == 'silenciar':
        out = silenciar(a.jid, a.sempre, a.tirar)
    elif a.cmd == 'apagar':
        out = post('/apagar', {'id': a.id})
    elif a.cmd == 'perfil':
        campos = {'description': a.descricao, 'email': a.email, 'websites': a.site, 'address': a.endereco,
                  'status': a.recado, 'nome': a.nome_perfil}
        campos = {k: v for k, v in campos.items() if v is not None}
        out = post('/perfil', campos) if campos else get('/perfil')
    elif a.cmd == 'catalogo':
        import os
        if a.apagar:
            out = post('/catalogo', {'apagar': a.apagar})
        elif a.add:
            # o catálogo do WhatsApp guarda o preço em milésimos da moeda: R$ 4.900,00 -> 4900000
            out = post('/catalogo', {'nome': a.add, 'descricao': a.descricao, 'preco_milesimos': int(round(a.preco * 1000)),
                                     'imagem': os.path.abspath(a.imagem) if a.imagem else None, 'url': a.url})
        else:
            out = get('/catalogo', _to=120)  # a consulta do catálogo no WhatsApp leva mais de 30 s
    else:
        out = get("/midia", _to=120, id=a.id)
    sys.stdout.write(out)


if __name__ == '__main__':
    main()
