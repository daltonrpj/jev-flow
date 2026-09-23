#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
laya_bridge.py — ponte stdin/stdout entre o Jev Flow (Node) e o Laya local.

O Laya (convaiinnovations/laya, Apache-2.0) é um modelo System One: recebe um
`state` + perguntas tipadas (choice/score/noul) e devolve respostas tipadas
com probabilidades calibradas em UMA passada forward — nunca gera texto.
É o mesmo contrato do System One remoto da TypeSafe que o JevClient fala;
esta ponte torna o julgamento JEV determinístico, offline e $0.

Protocolo (um pedido por processo — simples e à prova de deadlock):
  stdin : JSON {"state": str|dict|list, "questions": {id: {type, instructions, criteria}}}
  stdout: JSON {"model", "answers", "usage"} (formato idêntico ao da API)
  stderr: logs/warnings (nunca misturados com o resultado)

Uso:
  echo '{"state":...,"questions":...}' | python laya_bridge.py
  python laya_bridge.py --warmup     # só baixa/carrega o modelo e sai
  python laya_bridge.py --selftest   # roda um exemplo embutido e sai

Modelo: env LAYA_MODEL (padrão convaiinnovations/laya-multilingual — os
estados do Jev Flow são em pt-BR; o checkpoint raiz é inglês-only).
"""

import argparse
import hashlib
import json
import math
import os
import sys


def parse_args():
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument('--model', default=os.environ.get('LAYA_MODEL', 'convaiinnovations/laya-multilingual'))
    p.add_argument('--warmup', action='store_true', help='carrega o modelo (baixa na 1ª vez) e sai')
    p.add_argument('--selftest', action='store_true', help='roda um exemplo embutido e sai')
    p.add_argument('--serve', action='store_true', help='modo servidor: um pedido JSON por linha em stdin, uma resposta por linha em stdout')
    return p.parse_args()


def caminho_calibracao():
    """Read calibration from the user data directory, outside the checkout."""
    configured = os.environ.get('JEVFLOW_DATA_DIR')
    if configured:
        data_dir = configured
    elif os.name == 'nt':
        data_dir = os.path.join(os.environ.get('LOCALAPPDATA', os.path.expanduser('~')), 'JevFlow')
    elif sys.platform == 'darwin':
        data_dir = os.path.join(os.path.expanduser('~'), 'Library', 'Application Support', 'JevFlow')
    else:
        data_dir = os.path.join(os.environ.get('XDG_DATA_HOME', os.path.join(os.path.expanduser('~'), '.local', 'share')), 'jev-flow')
    return os.path.join(data_dir, 'laya-calibration.json')


METRIC_VERSION = 'top-label-ece-v1'
CHECKPOINT_ALGORITHM = 'sha256-weights-config-tokenizer-v3'
WEIGHT_SUFFIXES = ('.safetensors', '.bin', '.pt', '.pth', '.gguf')
BEHAVIOR_FILES = {'rl_agent_config.json', 'config.json', 'tokenizer.json',
                  'tokenizer_config.json', 'special_tokens_map.json',
                  'added_tokens.json', 'merges.txt', 'spiece.model',
                  'sentencepiece.model', 'sentencepiece.bpe.model'}


def behavior_file(name):
    lowered = name.lower()
    return lowered in BEHAVIOR_FILES or lowered == 'vocab' or lowered.startswith('vocab.')


def checkpoint_fingerprint(model_id):
    """Hash local weights and behavior config; a directory name is not identity."""
    if not model_id or not os.path.isdir(model_id):
        return None
    try:
        root = os.path.realpath(model_id)
        behavior_config = os.path.join(root, 'rl_agent_config.json')
        if not os.path.isfile(behavior_config):
            return None
        with open(behavior_config, encoding='utf-8') as source:
            config = json.load(source)
        if not isinstance(config, dict) or not isinstance(config.get('encoder'), str) or not config['encoder']:
            return None
        encoder_root = os.path.join(root, 'encoder')
        tokenizer_root = os.path.join(root, 'tokenizer')
        if (not os.path.isfile(os.path.join(root, 'model.safetensors'))
                or not os.path.isfile(os.path.join(encoder_root, 'config.json'))
                or not os.path.isdir(tokenizer_root)):
            return None
        files = []
        for directory, _, names in os.walk(root):
            for name in names:
                path = os.path.join(directory, name)
                if (name.lower().endswith(WEIGHT_SUFFIXES) or behavior_file(name)
                        or path.startswith(encoder_root + os.sep)
                        or path.startswith(tokenizer_root + os.sep)):
                    if os.path.isfile(path):
                        files.append((os.path.relpath(path, root).replace(os.sep, '/'), path))
        if not files:
            return None
        if not any(path.startswith(tokenizer_root + os.sep) and behavior_file(os.path.basename(path))
                   for _, path in files):
            return None
        digest = hashlib.sha256()
        for relative_name, path in sorted(files):
            digest.update(relative_name.encode('utf-8') + b'\0')
            with open(path, 'rb') as weights:
                while chunk := weights.read(1024 * 1024):
                    digest.update(chunk)
            digest.update(b'\0')
        return digest.hexdigest()
    except (OSError, UnicodeError, ValueError, TypeError):
        return None


def valid_holdout(value):
    if not isinstance(value, dict) or not isinstance(value.get('n'), int) or value['n'] < 20:
        return False
    keys = ('ece_antes', 'ece_depois', 'acuracia_antes', 'acuracia_depois')
    if any(not isinstance(value.get(key), (float, int)) or not math.isfinite(value[key])
           or not 0 <= value[key] <= 1 for key in keys):
        return False
    return (value['ece_depois'] <= value['ece_antes'] + 1e-9
            and value['acuracia_depois'] + 1e-9 >= value['acuracia_antes'])


def calibration_decision(cal, model_id, fingerprint=checkpoint_fingerprint):
    if not isinstance(cal, dict):
        return {'verified_noul': False, 'reason': 'record-missing'}
    if cal.get('metric_version') != METRIC_VERSION:
        return {'verified_noul': False, 'reason': 'metric-version-missing-or-unsupported'}
    checkpoint = cal.get('checkpoint') or {}
    expected = checkpoint.get('sha256')
    if (checkpoint.get('algorithm') != CHECKPOINT_ALGORITHM
            or not isinstance(expected, str) or len(expected) != 64
            or any(char not in '0123456789abcdefABCDEF' for char in expected)):
        return {'verified_noul': False, 'reason': 'checkpoint-identity-missing'}
    actual = fingerprint(model_id)
    if not actual or actual.lower() != expected.lower():
        return {'verified_noul': False, 'reason': 'checkpoint-identity-unverified'}
    validation = cal.get('validacao') or {}
    if not valid_holdout(validation.get('real')) or not valid_holdout(validation.get('sintetico_holdout')):
        return {'verified_noul': False, 'reason': 'validation-missing-or-degrading'}
    noul = (cal.get('temperaturas') or {}).get('noul')
    if not isinstance(noul, (float, int)) or not math.isfinite(noul) or not 0 < noul <= 100:
        return {'verified_noul': False, 'reason': 'temperature-invalid'}
    return {'verified_noul': True, 'reason': 'validated-noul-only', 'noul_temperature': float(noul)}


def aplicar_calibracao(agent, model_id=None):
    """Leave native model defaults intact unless a Noul refit is verified."""
    if os.environ.get('LAYA_CALIBRATION_BASELINE') == '1':
        # The calibrator fits an ABSOLUTE Noul temperature. Measure every
        # checkpoint at T=1 so the fitted value is reproducible at runtime.
        native = list(agent.temperature)
        if len(native) < 3:
            raise ValueError('Noul raw baseline requires three temperatures')
        native[2] = 1.0
        agent.temperature = native
        buckets = getattr(agent, 'temperature_by_options', None)
        if isinstance(buckets, dict) and 'noul:2' in buckets:
            agent.temperature_by_options = {**buckets, 'noul:2': 1.0}
        return {'mode': 'raw-noul-t1', 'temperaturas': native}
    if os.environ.get('LAYA_NO_CALIBRACAO') == '1':
        return None
    path = caminho_calibracao()
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding='utf-8') as f:
            cal = json.load(f)
        decision = calibration_decision(cal, model_id)
        if not decision['verified_noul']:
            print(json.dumps({'trace': 'calibration record ignored', 'reason': decision['reason']}),
                  file=sys.stderr, flush=True)
            return None
        # QTYPES: choice=0, score=1, noul=2. Score/Choice have no validated
        # holdout; preserve their native defaults and option buckets.
        native = list(agent.temperature)
        if len(native) < 3:
            print(json.dumps({'trace': 'calibration record ignored', 'reason': 'native-temperature-shape'}),
                  file=sys.stderr, flush=True)
            return None
        native[2] = decision['noul_temperature']
        agent.temperature = native
        buckets = getattr(agent, 'temperature_by_options', None)
        if isinstance(buckets, dict) and 'noul:2' in buckets:
            agent.temperature_by_options = {**buckets, 'noul:2': decision['noul_temperature']}
        return {'temperaturas': native, 'medidoEm': cal.get('medidoEm')}
    except Exception as e:
        print(json.dumps({'trace': f'calibração ignorada: {e}'}), file=sys.stderr, flush=True)
        return None


def carregar_agente(model_id):
    # import tardio: --help e erros de protocolo não pagam o import do torch
    import time
    t0 = time.time()
    print(json.dumps({'trace': f'importando laya/torch ({model_id})'}), file=sys.stderr, flush=True)
    import torch  # noqa: F401
    import laya
    print(json.dumps({'trace': f'imports ok em {time.time()-t0:.1f}s'}), file=sys.stderr, flush=True)
    # Threads controladas: o gate roda no meio de missões; monopolizar CPU
    # do host atrasa o próprio Computer Pilot.
    for var in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS'):
        os.environ.setdefault(var, '4')
    torch.set_num_threads(int(os.environ.get('LAYA_TORCH_THREADS', '4')))
    agente = laya.load(model_id)
    cal = aplicar_calibracao(agente, model_id)
    if cal and cal.get('mode') == 'raw-noul-t1':
        print(json.dumps({'trace': f'modelo carregado em {time.time()-t0:.1f}s · Noul raw baseline T=1'}), file=sys.stderr, flush=True)
    elif cal:
        print(json.dumps({'trace': f'modelo carregado em {time.time()-t0:.1f}s · calibração aplicada {cal["temperaturas"]} ({cal["medidoEm"]})'}), file=sys.stderr, flush=True)
    else:
        print(json.dumps({'trace': f'modelo carregado em {time.time()-t0:.1f}s'}), file=sys.stderr, flush=True)
    return agente


def servir(agent, model_id):
    """Loop persistente: carrega o modelo UMA vez e atende pedidos por linha.
    Pedido  : {"id": n, "state": ..., "questions": {...}}
    Resposta: {"id": n, "model": ..., "answers": ..., "usage": ...} | {"id": n, "error": "..."}
    O processo vive enquanto o stdin abrir — o Jev Flow o reaproveita entre gates
    (a carga do modelo custa segundos; a inferência, milissegundos)."""
    print(json.dumps({'ready': True, 'model': model_id}), flush=True)
    # readline() (não `for linha in sys.stdin`): a iteração tem read-ahead de
    # 8 KB e em pipe do Windows só solta a linha no EOF — o gate precisaria
    # esperar eternamente. readline() retorna no primeiro \n.
    while True:
        linha = sys.stdin.readline()
        if not linha:  # EOF — o Jev Flow encerrou o sidecar
            break
        linha = linha.strip()
        if not linha:
            continue
        pedido = {}
        try:
            pedido = json.loads(linha)
            resposta = agent.predict(pedido.get('state'), pedido.get('questions'))
            resposta.setdefault('model', model_id)
            resposta['id'] = pedido.get('id')
            print(json.dumps(resposta, ensure_ascii=False), flush=True)
        except Exception as e:
            print(json.dumps({'id': pedido.get('id') if isinstance(pedido, dict) else None, 'error': f'laya falhou: {e}'}), flush=True)
    return 0


def main():
    args = parse_args()

    if args.warmup:
        carregar_agente(args.model)
        print(json.dumps({'ok': True, 'model': args.model, 'warm': True}), flush=True)
        return 0

    # --serve PRECISA vir antes do stdin.read() do one-shot: read() espera o
    # EOF, que no modo servidor nunca chega (stdin fica aberto) — o ready nem
    # seria emitido. (Bug real observado no teste ao vivo.)
    if args.serve:
        try:
            agent = carregar_agente(args.model)
        except Exception as e:
            print(json.dumps({'error': f'laya falhou: {e}'}), file=sys.stderr, flush=True)
            return 3
        return servir(agent, args.model)

    try:
        raw = sys.stdin.read()
        pedido = json.loads(raw)
        state = pedido.get('state')
        questions = pedido.get('questions')
        if not isinstance(questions, dict) or not questions:
            raise ValueError('questions é obrigatório (mapa id -> pergunta)')
    except Exception as e:
        print(json.dumps({'error': f'pedido inválido: {e}'}), file=sys.stderr, flush=True)
        return 2

    try:
        agent = carregar_agente(args.model)
        if args.selftest:
            state = state or {'ping': 'conexão do Jev Flow com o Laya local'}
            questions = questions or {'ok': {'type': 'noul', 'instructions': 'O `state` menciona "Jev Flow"?'}}
        resposta = agent.predict(state, questions)
        resposta.setdefault('model', args.model)
        print(json.dumps(resposta, ensure_ascii=False), flush=True)
        return 0
    except Exception as e:
        print(json.dumps({'error': f'laya falhou: {e}'}), file=sys.stderr, flush=True)
        return 3


if __name__ == '__main__':
    sys.exit(main())
