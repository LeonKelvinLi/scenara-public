"""Deduplicated translation jobs with their own short-lived DB sessions."""
from concurrent.futures import ThreadPoolExecutor
import threading
from sqlalchemy.orm import joinedload
from app.db import SessionLocal
from app.models.event import Event
from app.models.scenario import Scenario
from app.services.translate import cached_translation, language_code, translate_batch

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="market-language")
_pending: set[tuple[str, int]] = set()
_lock = threading.Lock()
_text_pending: set[tuple[str, str]] = set()

def prefetch_texts(texts: list[str], language: str):
    with _lock:
        needed = list(dict.fromkeys(text for text in texts if text and cached_translation(text, language) is None and (language, text) not in _text_pending))
        _text_pending.update((language, text) for text in needed)
    if needed:
        def work():
            try:
                translate_batch(needed, language)
            finally:
                with _lock:
                    _text_pending.difference_update((language, text) for text in needed)
        _executor.submit(work)

def localize_source(result: dict, language: str):
    result["language"] = language
    if language == "en":
        return
    source = result["market"]
    event = source.get("event") or {}
    texts = [source.get("rules"), event.get("title"), *(source.get("tags") or []), *(row.get("title") for row in result["related_markets"])]
    prefetch_texts([text for text in texts if text], language)
    source["localized_rules"] = cached_translation(source.get("rules"), language)
    source["localized_tags"] = [value for tag in source.get("tags") or [] if (value := cached_translation(tag, language))]
    event["localized_title"] = cached_translation(event.get("title"), language)
    for row in result["related_markets"]:
        row["localized_title"] = cached_translation(row.get("title"), language)

def _work(ids: list[int], language: str, include_rules: bool = True, cached_only: bool = False):
    try:
        with SessionLocal() as db:
            events = db.query(Event).options(joinedload(Event.scenarios)).filter(Event.id.in_(ids)).all()
            targets = []
            for event in events:
                for field in (("title", "description") if include_rules else ("title",)):
                    original = getattr(event, field)
                    current = getattr(event, f"{field}_{language}")
                    cached = cached_translation(original, language)
                    if original and (not current or (cached and current != cached)):
                        targets.append((Event, event.id, field, getattr(event, field)))
                for scenario in event.scenarios:
                    if not getattr(scenario, f"title_{language}"):
                        # Team/candidate names are identities, not prose.
                        targets.append((Scenario, scenario.id, "title", scenario.title))
        texts = [text for model, _, _, text in targets if model is Event]
        values = [cached_translation(text, language) for text in texts] if cached_only else translate_batch(texts, language)
        translations = iter(values)
        with SessionLocal() as db:
            for model, object_id, field, original in targets:
                value = next(translations) if model is Event else cached_translation(original, language) or original
                obj = db.get(model, object_id)
                if value and obj and getattr(obj, field) == original:
                    setattr(obj, f"{field}_{language}", value)
            db.commit()
        from app.routers.events import _EVENTS_CACHE
        _EVENTS_CACHE.clear()
    finally:
        with _lock:
            _pending.difference_update((language, event_id) for event_id in ids)

def fill_event_translations(events: list, target: str, include_rules: bool = True, cached_only: bool = False):
    language = language_code(target)
    if language == "en":
        return
    needs = []
    for event in events:
        missing = False
        for field in (("title", "description") if include_rules else ("title",)):
            original = getattr(event, field, None)
            cached = cached_translation(original, language)
            if original and (not getattr(event, f"{field}_{language}") or (cached and cached != getattr(event, f"{field}_{language}"))):
                missing = True
                value = cached_translation(original, language)
                if value:
                    setattr(event, f"{field}_{language}", value)
        for scenario in event.scenarios:
            if not getattr(scenario, f"title_{language}"):
                missing = True
                setattr(scenario, f"title_{language}", cached_translation(scenario.title, language) or scenario.title)
        if missing:
            needs.append(event.id)
    with _lock:
        ids = [event_id for event_id in needs if (language, event_id) not in _pending]
        _pending.update((language, event_id) for event_id in ids)
    if ids:
        _executor.submit(_work, ids, language, include_rules, cached_only)

def warm_open_events():
    for language in ("pt", "zh"):
        with SessionLocal() as db:
            events = db.query(Event).options(joinedload(Event.scenarios)).filter(Event.status == "open").order_by(Event.created_at.desc()).limit(100).all()
            fill_event_translations(events, language, cached_only=True)
