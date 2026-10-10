"""SM Confecções API (Railway).

Envio de ARQUIVO GRANDE pro WhatsApp (PIV 10/10: avisos do Marketplace com zip de até 150 MB).
A Vercel recusa corpo acima de ~4,5 MB, então o arquivo vem do navegador direto pra cá:
  1. o painel (Vercel) confere a sessão e gera um token curto assinado com UPLOAD_SECRET
     (POST /api/whatsapp/aviso-marketplace/token), dizendo pra qual grupo e por qual instância;
  2. o navegador manda o arquivo pra POST /whatsapp/arquivo com "Authorization: Bearer <token>";
  3. aqui o arquivo vai pro disco, a Evolution baixa por GET /arquivos/<id>/<nome> e manda
     como documento; depois o arquivo é apagado.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import shutil
import time
import uuid
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

app = FastAPI(title="SM Confecções API", version="0.2.0")

ORIGENS = [o.strip() for o in os.environ.get(
    "CORS_ORIGINS",
    "https://smconfeccoes.vercel.app,https://smconfeccoes.com.br,https://www.smconfeccoes.com.br",
).split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGENS,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=3600,
)

UPLOAD_SECRET = os.environ.get("UPLOAD_SECRET", "")
EVO_URL = os.environ.get("EVOLUTION_API_URL", "").rstrip("/")
EVO_KEY = os.environ.get("EVOLUTION_API_KEY", "")
PUBLIC_URL = os.environ.get("PUBLIC_URL", "https://smconfeccoes-backend-production.up.railway.app").rstrip("/")
MAX_BYTES = 150 * 1024 * 1024
PASTA = Path("/tmp/sm_arquivos")
PASTA.mkdir(parents=True, exist_ok=True)


@app.get("/")
def root():
    return {"status": "ok", "service": "smconfeccoes-backend"}


@app.get("/health")
def health():
    return {"status": "healthy"}


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def ler_token(authorization: str | None) -> dict:
    """Token = base64url(json).base64url(hmac_sha256(json)) — o mesmo que o painel gera."""
    if not UPLOAD_SECRET:
        raise HTTPException(500, "UPLOAD_SECRET não configurado no backend")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "token ausente")
    try:
        corpo, assinatura = authorization[7:].strip().split(".")
        esperada = hmac.new(UPLOAD_SECRET.encode(), corpo.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(esperada, _b64d(assinatura)):
            raise ValueError("assinatura")
        dados = json.loads(_b64d(corpo))
    except Exception:
        raise HTTPException(401, "token inválido")
    if dados.get("exp", 0) < time.time():
        raise HTTPException(401, "token vencido, abra a tela de novo")
    if not dados.get("jid") or not dados.get("instance"):
        raise HTTPException(401, "token sem destino")
    return dados


def limpar_antigos():
    """Arquivo que ficou pra trás (envio que caiu no meio) some depois de 1 h."""
    limite = time.time() - 3600
    for d in PASTA.iterdir():
        try:
            if d.stat().st_mtime < limite:
                shutil.rmtree(d, ignore_errors=True)
        except FileNotFoundError:
            pass


@app.post("/whatsapp/arquivo")
async def enviar_arquivo(file: UploadFile = File(...), authorization: str | None = Header(None)):
    tok = ler_token(authorization)
    limpar_antigos()
    nome = os.path.basename(file.filename or "arquivo").strip() or "arquivo"
    pasta = PASTA / uuid.uuid4().hex
    pasta.mkdir()
    destino = pasta / nome
    total = 0
    try:
        with destino.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(413, "arquivo passa de 150 MB")
                out.write(chunk)
        if total == 0:
            raise HTTPException(400, "arquivo vazio")

        url = f"{PUBLIC_URL}/arquivos/{pasta.name}/{nome}"
        if tok.get("dryRun"):
            # teste sem mandar nada no WhatsApp: deixa o arquivo baixável por 1 h e devolve a URL
            return {"ok": True, "dryRun": True, "bytes": total, "url": url}

        if not EVO_URL or not EVO_KEY:
            raise HTTPException(500, "Evolution não configurada no backend")
        mimetype = file.content_type if file.content_type and file.content_type != "application/octet-stream" \
            else (mimetypes.guess_type(nome)[0] or "application/octet-stream")
        numero = tok["jid"].replace("@g.us", "")
        async with httpx.AsyncClient(timeout=httpx.Timeout(900.0)) as cli:
            r = await cli.post(
                f"{EVO_URL}/message/sendMedia/{tok['instance']}",
                headers={"apikey": EVO_KEY, "Content-Type": "application/json"},
                json={"number": numero, "mediatype": "document", "mimetype": mimetype,
                      "caption": tok.get("caption", ""), "media": url, "fileName": nome},
            )
        if r.status_code >= 300:
            raise HTTPException(502, f"Evolution {r.status_code}: {r.text[:300]}")
        shutil.rmtree(pasta, ignore_errors=True)
        return {"ok": True, "bytes": total, "arquivo": nome}
    except HTTPException:
        if not tok.get("dryRun"):
            shutil.rmtree(pasta, ignore_errors=True)
        raise
    except Exception as e:
        shutil.rmtree(pasta, ignore_errors=True)
        raise HTTPException(500, f"falha ao enviar: {str(e)[:300]}")


@app.get("/arquivos/{pid}/{nome}")
async def baixar(pid: str, nome: str):
    """A Evolution baixa o arquivo por aqui (id aleatório de 32 caracteres, some depois do envio)."""
    if len(pid) != 32 or not pid.isalnum():
        raise HTTPException(404)
    caminho = PASTA / pid / os.path.basename(nome)
    if not caminho.is_file():
        raise HTTPException(404)
    return FileResponse(caminho, filename=caminho.name)
