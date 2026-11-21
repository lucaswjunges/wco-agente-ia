#!/usr/bin/env python3
"""Confere dia da semana × data em textos antes de enviar (WhatsApp, e-mail).

Uso:
  python3 wa/datas.py                 # calendário dos próximos 14 dias (copiar daqui, nunca de cabeça)
  python3 wa/datas.py "texto"         # confere o texto ('-' lê do stdin); sai com 2 se houver erro
  from datas import checar; problemas = checar(texto)   # lista de strings; vazia = ok

`wa.py enviar` chama `checar()` e NÃO envia se o dia da semana não bater com a data
(`--sem-checar-datas` só para falso positivo).
"""
import datetime as dt
import re
import sys

DIAS = {0: 'segunda', 1: 'terça', 2: 'quarta', 3: 'quinta', 4: 'sexta', 5: 'sábado', 6: 'domingo'}
ABREV = {0: 'seg', 1: 'ter', 2: 'qua', 3: 'qui', 4: 'sex', 5: 'sáb', 6: 'dom'}
_NOMES = {
    'seg': 0, 'segunda': 0, 'ter': 1, 'terça': 1, 'terca': 1, 'qua': 2, 'quarta': 2, 'qui': 3, 'quinta': 3,
    'sex': 4, 'sexta': 4, 'sáb': 5, 'sab': 5, 'sábado': 5, 'sabado': 5, 'dom': 6, 'domingo': 6,
}
_RX = re.compile(
    r"\b(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo|seg|ter|qua|qui|sex|sáb|sab|dom)"
    r"(?:-feira)?\.?"              # sexta-feira, sex.
    r"[\s,]*(?:\(|dia\s+)?\s*"     # "sexta (24/10)", "sexta, dia 24"
    r"(\d{1,2})(?:/(\d{1,2})(?:/(\d{2,4}))?)?\b",
    re.I)


def checar(texto, hoje=None):
    """Devolve lista de problemas, ex.: "'sexta 24/10': 24/10/2026 é sábado; sexta = 23/10". Vazia = ok."""
    hoje = hoje or dt.date.today()
    problemas = []
    for m in _RX.finditer(texto or ''):
        nome, d, mes, ano = m.group(1), int(m.group(2)), m.group(3), m.group(4)
        wd = _NOMES.get(nome.lower())
        if wd is None or not 1 <= d <= 31:
            continue
        cands = []
        if mes:
            mes = int(mes)
            if ano:
                anos = [int(ano) + (2000 if len(ano) == 2 else 0)]
            else:
                anos = [hoje.year, hoje.year + 1, hoje.year - 1]
            for a in anos:
                try:
                    cands.append(dt.date(a, mes, d))
                except ValueError:
                    pass
        else:  # só o dia: aceita mês anterior, atual ou seguinte
            for k in (-1, 0, 1):
                a, mm = hoje.year, hoje.month + k
                if mm == 0:
                    a, mm = a - 1, 12
                elif mm == 13:
                    a, mm = a + 1, 1
                try:
                    cands.append(dt.date(a, mm, d))
                except ValueError:
                    pass
        if not cands:
            continue
        # Só vale a data mais plausível: de 7 dias atrás a 45 dias à frente; fora disso, a mais próxima de hoje.
        # (Sem isso, "sexta 24/10" passava porque 24/10/2025 tinha sido sexta.)
        janela = [c for c in cands if -7 <= (c - hoje).days <= 45] or [min(cands, key=lambda x: abs((x - hoje).days))]
        if any(c.weekday() == wd for c in janela):
            continue
        c = min(janela, key=lambda x: abs((x - hoje).days))
        prox = c + dt.timedelta(days=(wd - c.weekday()) % 7)
        ant = prox - dt.timedelta(days=7)
        certa = prox if abs((prox - c).days) <= abs((ant - c).days) else ant
        problemas.append(f"'{m.group(0).strip()}': {c.strftime('%d/%m/%Y')} é {DIAS[c.weekday()]}; "
                         f"{DIAS[wd]} = {certa.strftime('%d/%m')}")
    return problemas


FIXOS = {(1, 1): 'Confraternização', (4, 21): 'Tiradentes', (5, 1): 'Dia do Trabalho', (9, 7): 'Independência', (10, 12): 'N. Sra. Aparecida', (11, 2): 'Finados', (11, 15): 'Proclamação da República',
         (11, 20): 'Consciência Negra', (12, 25): 'Natal'}


def _pascoa(ano):
    a, b, c = ano % 19, ano // 100, ano % 100
    d, e = b // 4, b % 4
    g = (8 * b + 13) // 25
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 19 * l) // 433
    mes = (h + l - 7 * m + 90) // 25
    return dt.date(ano, mes, (h + l - 7 * m + 33 * mes + 19) % 32)


def feriado(d):
    """Feriado nacional (acrescente os municipais em FIXOS); '' se dia útil comum."""
    if (d.month, d.day) in FIXOS:
        return FIXOS[(d.month, d.day)]
    p = _pascoa(d.year)
    moveis = {p - dt.timedelta(days=48): 'Carnaval', p - dt.timedelta(days=47): 'Carnaval',
              p - dt.timedelta(days=2): 'Sexta-feira Santa', p + dt.timedelta(days=60): 'Corpus Christi'}
    return moveis.get(d, '')


def calendario(n=14, hoje=None):
    hoje = hoje or dt.date.today()
    linhas = []
    for i in range(n):
        d = hoje + dt.timedelta(days=i)
        f = feriado(d)
        linhas.append(f"{ABREV[d.weekday()]} {d.strftime('%d/%m')}" + (' (hoje)' if i == 0 else '')
                      + (f'  FERIADO: {f}' if f else ''))
    return '\n'.join(linhas)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(calendario())
        sys.exit(0)
    txt = sys.stdin.read() if sys.argv[1] == '-' else ' '.join(sys.argv[1:])
    p = checar(txt)
    print('\n'.join(p) if p else 'datas ok')
    sys.exit(2 if p else 0)
