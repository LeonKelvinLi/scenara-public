"""Cached local OPUS-MT translations: no API quota or external text submission."""
from __future__ import annotations
from collections import Counter
import gc
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import tempfile
import threading
import time
import zipfile
import unicodedata
from decimal import Decimal
import httpx

logger = logging.getLogger(__name__)
_lock = threading.RLock()
_engine = _tokenizer = _language = None
try:
    _catalog = json.loads((Path(__file__).parents[1] / "data/translations.json").read_text(encoding="utf-8"))
except (OSError, ValueError):
    _catalog = {"pt": {}, "zh": {}}
_cache: dict[tuple[str, str], str] = {}
_failed: dict[tuple[str, str], float] = {}
MODELS = {
    "pt": ("https://argos-net.com/v1/translate-en_pt-1_9.argosmodel", "0c5350a2fa5b923de1346edc0d42e08e38bab2e33cede3a0b9a48eb4281ad8a9"),
    "zh": ("https://argos-net.com/v1/translate-en_zh-1_9.argosmodel", "433e7c4f034d87fbe2353161e05f18646d7999452f801a4e1f0378522b9850ab"),
}
LABELS = {"yes": ("Sim", "是"), "no": ("Não", "否"), "over": ("Mais", "大于"), "under": ("Menos", "小于"), "draw": ("Empate", "平局"), "tie": ("Empate", "平局"), "buy": ("Compra", "买入"), "sell": ("Venda", "卖出")}

def language_code(target: str) -> str:
    return "pt" if target.lower().startswith("pt") else "zh" if target.lower().startswith("zh") else "en"

def text_key(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()

def _matchup_title(text: str, language: str) -> str | None:
    # Team names and tournament brands must retain their source identities.
    if len(text) > 240 or "\n" in text:
        return None
    market_label = re.match(r"^(?:(1H|1Q|2Q|3Q|4Q)\s+)?(Spread|O/U)\b\s*:?\s*(.*)$", text)
    if market_label:
        period, kind, line = market_label.groups()
        label = ("Handicap" if kind == "Spread" else "Mais/menos") if language == "pt" else ("让分" if kind == "Spread" else "大小盘")
        prefix = (("1º tempo" if period == "1H" else period[0] + "º quarto") if language == "pt" else ("上半场" if period == "1H" else "第" + period[0] + "节")) + " · " if period else ""
        return prefix + label + ": " + line
    if "?" in text or not re.search(r"\bvs\.?\s", text, re.I):
        return None
    value = re.sub(r"\bvs\.?\s", "x " if language == "pt" else "对阵 ", text, flags=re.I)
    value = re.sub(r"^Spread:\s*", "Handicap: " if language == "pt" else "让分：", value)
    value = value.replace("O/U ", "Mais/menos " if language == "pt" else "大小盘 ")
    value = re.sub(r"Map (\d+) Winner", r"Vencedor do mapa \1" if language == "pt" else r"第\1局胜者", value)
    return value.replace("Worlds Group Stage", "Fase de grupos do Worlds" if language == "pt" else "全球总决赛小组赛")

def cached_translation(text: str | None, target: str) -> str | None:
    if not text:
        return text
    language = language_code(target)
    if language == "en":
        return text
    label = LABELS.get(text.strip().lower())
    if label:
        return label[0 if language == "pt" else 1]
    matchup = _matchup_title(text, language)
    if matchup:
        return matchup
    return _cache.get((language, text)) or _catalog.get(language, {}).get(text_key(text))

def _model(language: str):
    global _engine, _tokenizer, _language
    if _language == language and _engine is not None:
        return _engine, _tokenizer
    import ctranslate2
    import sentencepiece
    if _engine is not None:
        _engine.unload_model()
        _engine = _tokenizer = None
        gc.collect()
    root = Path(os.getenv("SCENARA_TRANSLATION_MODELS", str(Path(tempfile.gettempdir()) / "scenara-translation-models")))
    folder = root / f"translate-en_{language}-1_9"
    if not (folder / "model/model.bin").exists():
        root.mkdir(parents=True, exist_ok=True)
        url, expected = MODELS[language]
        with tempfile.TemporaryDirectory(dir=root) as temporary:
            package = Path(temporary) / "model.zip"
            digest = hashlib.sha256()
            with httpx.stream("GET", url, follow_redirects=True, timeout=90) as response:
                response.raise_for_status()
                with package.open("wb") as output:
                    size = 0
                    for chunk in response.iter_bytes():
                        size += len(chunk)
                        if size > 150_000_000:
                            raise ValueError("Translation model exceeds size limit")
                        digest.update(chunk)
                        output.write(chunk)
            if digest.hexdigest() != expected:
                raise ValueError("Translation model checksum mismatch")
            with zipfile.ZipFile(package) as archive:
                for member in archive.namelist():
                    parts = Path(member).parts
                    if len(parts) >= 2 and parts[0] == folder.name and ".." not in parts and (parts[1] == "model" or parts[1] in {"sentencepiece.model", "README.md", "metadata.json"}):
                        archive.extract(member, root)
    _engine = ctranslate2.Translator(str(folder / "model"), device="cpu", compute_type="int8", inter_threads=1, intra_threads=1)
    _tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(folder / "sentencepiece.model"))
    _language = language
    return _engine, _tokenizer

def _prepare(text: str) -> str:
    def clock(match):
        hour = int(match[1]) % 12 + (12 if match[3].upper() == "PM" else 0)
        return f"{hour:02d}:{match[2]}"
    return re.sub(r"\b(\d{1,2}):(\d{2})\s*(AM|PM)\b", clock, text, flags=re.I)

def valid_translation(source: str, translated: str) -> bool:
    def numbers(text):
        result = []
        for match in re.finditer(r"\d+(?:[.,]\d+)*(?:\s*(?:mil\b|thousand\b|万|千))?", unicodedata.normalize("NFKC", text)):
            value = match[0]
            multiplier = 10000 if "万" in value else 1000 if re.search(r"mil|thousand|千", value) else 1
            value = re.sub(r"[^\d.,]", "", value)
            value = re.sub(r"[.,](?=\d{3}(?:[.,]|$))", "", value).replace(",", ".")
            try: result.append(str((Decimal(value) * multiplier).normalize()))
            except Exception: return []
        return Counter(result)
    expected, actual = numbers(source), numbers(translated)
    if re.search(r"[\u4e00-\u9fff]", translated):
        months = "January February March April May June July August September October November December".split()
        for index, month in enumerate(months, 1):
            count = len(re.findall(r"\b" + month + r"\b", source, re.I))
            if count:
                expected[str(Decimal(index).normalize())] += count
    return bool(translated.strip()) and "▁" not in translated and "⁇" not in translated and expected == actual

def _translate(text: str, language: str) -> str | None:
    engine, tokenizer = _model(language)
    source = _prepare(text)
    paragraphs = []
    for paragraph in source.split("\n\n"):
        chunks, pending = [], ""
        for word in paragraph.split():
            candidate = (pending + " " + word).strip()
            if pending and len(tokenizer.encode(candidate)) > 180:
                chunks.append(pending)
                pending = word
            else:
                pending = candidate
        if pending:
            chunks.append(pending)
        result = engine.translate_batch([tokenizer.encode(chunk, out_type=str) for chunk in chunks], beam_size=2, max_batch_size=4, max_decoding_length=360) if chunks else []
        paragraphs.append(" ".join("".join(row.hypotheses[0]).replace("▁", " ").strip() for row in result))
    translated = "\n\n".join(paragraphs)
    return translated if valid_translation(source, translated) else None

def translate_batch(texts: list[str], target: str = "zh-CN") -> list[str | None]:
    language = language_code(target)
    result = []
    with _lock:
        for text in texts:
            value = cached_translation(text, language)
            if value is None and text and len(text) <= 30_000 and _failed.get((language, text), 0) < time.monotonic():
                try:
                    value = _translate(text, language)
                    if value:
                        if len(_cache) >= 2000:
                            _cache.pop(next(iter(_cache)))
                        _cache[(language, text)] = value
                    else:
                        _failed[(language, text)] = time.monotonic() + 3600
                except Exception as error:
                    logger.warning("Translation unavailable (%s): %s", language, type(error).__name__)
                    _failed[(language, text)] = time.monotonic() + 60
            result.append(value)
    return result

def translate_text(text: str, target: str = "zh-CN") -> str | None:
    return translate_batch([text], target)[0]
