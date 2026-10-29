"""Run with: ../.venv/bin/python -m unittest discover -s tests -v.

All state is isolated in a temporary SQLite database. Workers, email and push
delivery are disabled; these checks never touch the production database.
"""
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch
from urllib.parse import urlparse

_temporary = tempfile.TemporaryDirectory(prefix="scenara-tests-")
_database_url = os.environ.get("SCENARA_TEST_DATABASE_URL")
if _database_url:
    parsed = urlparse(_database_url)
    if parsed.hostname not in {"localhost", "127.0.0.1"} or parsed.path != "/scenara_test":
        raise RuntimeError("PostgreSQL tests require a local, disposable scenara_test database")
os.environ.update(
    APP_ENV="test",
    APP_DEBUG="false",
    DATABASE_URL=_database_url or f"sqlite:///{_temporary.name}/test.db",
    JWT_SECRET_KEY="isolated-test-signing-key-with-at-least-32-characters",
    ENABLE_BACKGROUND_TASKS="false",
    PROJECT_PAUSED="false",
    RENDER="false",
    SENTRY_DSN="",
    SMTP_HOST="",
)

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import models
from app.config import Settings
from app.db import Base, SessionLocal, engine
from app.main import create_app
from app.routers.predictions import _bet_timestamps
from app.services.resolution import settle_event


def polymarket_fixture():
    return {"id": "999", "question": "A source question?", "slug": "child-market", "description": "Published resolution rules.",
            "outcomes": '["Yes", "No"]', "outcomePrices": '["0.375", "0.625"]', "clobTokenIds": '["11", "22"]',
            "conditionId": "0xabc", "volumeNum": 12345, "liquidityNum": 2345, "volume24hr": 345,
            "oneDayPriceChange": 0.012, "bestBid": 0.37, "bestAsk": 0.38, "acceptingOrders": True,
            "active": True, "closed": False, "events": [{"id": "10", "title": "Parent event", "slug": "parent-event"}]}


class RevivalTests(unittest.TestCase):
    def setUp(self):
        Base.metadata.drop_all(engine)
        _bet_timestamps.clear()
        self.app = create_app()
        self.client = TestClient(self.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def register(self, name="tester"):
        response = self.client.post("/auth/register", json={
            "email": f"{name}@example.com", "password": "local-test-password",
            "display_name": name,
        })
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        return data, {"Authorization": f"Bearer {data['access_token']}"}

    def market(self, expired=False):
        with SessionLocal() as db:
            event = models.Event(
                slug="test-market", title="Test market", status="open",
                external_source="polymarket", category="technology",
                external_synced_at=datetime.utcnow(), external_data={"accepting_orders": True, "closed": False},
                closes_at=datetime.utcnow() + timedelta(days=-1 if expired else 1),
            )
            event.scenarios = [
                models.Scenario(title="Yes", probability=50, sort_order=0, status="active"),
                models.Scenario(title="No", probability=50, sort_order=1, status="active"),
            ]
            db.add(event)
            db.commit()
            return event.id, event.scenarios[0].id

    def test_registration_login_and_wallet(self):
        user, headers = self.register()
        login = self.client.post("/auth/login", json={
            "email": user["email"], "password": "local-test-password",
        })
        self.assertEqual(login.status_code, 200, login.text)
        wallet = self.client.get(f"/accounts/user/{user['user_id']}", headers=headers)
        self.assertEqual(wallet.status_code, 200, wallet.text)
        self.assertEqual(float(wallet.json()["balance"]), float(login.json()["balance"]))
        self.assertEqual(self.client.get("/auth/me", headers=headers).status_code, 200)

    def test_health_reports_database_failure(self):
        self.assertEqual(self.client.get("/health").status_code, 200)
        with patch("app.main.engine.connect", side_effect=RuntimeError("unavailable")):
            response = self.client.get("/health")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["db"], False)

    def test_health_reports_failed_migrations(self):
        self.app.state.database_ready = False
        self.assertEqual(self.client.get("/health").status_code, 503)

    def test_maintenance_routes_require_admin(self):
        _, headers = self.register()
        for route in ("generate-events", "snapshot", "resolve-expired", "purge-legacy-events"):
            with self.subTest(route=route):
                self.assertEqual(self.client.post(f"/admin/{route}").status_code, 401)
                self.assertEqual(self.client.post(f"/admin/{route}", headers=headers).status_code, 403)

    def test_public_counts_and_leaderboard_use_real_accounts(self):
        self.register()
        self.market()
        stats = self.client.get("/accounts/live-stats").json()
        self.assertEqual(stats, {"traders": 1, "volume_24h": 0, "open_markets": 1})
        board = self.client.get("/accounts/leaderboard").json()
        self.assertEqual(board["total_users"], 1)
        self.assertEqual(len(board["entries"]), 1)
        self.assertGreater(board["entries"][0]["user_id"], 0)
        self.assertEqual(board["entries"][0]["email"], "")
        self.assertEqual(self.client.get("/predictions/activity").json(), [])

    def test_market_category_uses_question_before_description_boilerplate(self):
        from app.services.polymarket_sync import _infer_category
        self.assertEqual(_infer_category({
            "question": "Will the Fed increase interest rates this month?",
            "description": "This market uses crypto tokens on a blockchain.",
        }), "economy")

    def test_imported_polymarket_outcomes_accept_predictions(self):
        from app.services.polymarket_sync import _insert_market
        user, headers = self.register()
        with SessionLocal() as db:
            event = _insert_market(db, {
                "id": "test-external-market", "slug": "test-imported-market",
                "question": "Will the Fed change interest rates?", "active": True,
                "closed": False, "volume": "50000", "liquidity": "5000",
                "endDate": (datetime.utcnow() + timedelta(days=7)).isoformat() + "Z",
                "outcomes": '["Yes", "No"]', "outcomePrices": '["0.55", "0.45"]',
            })
            db.commit()
            outcome = event.scenarios[0]
            self.assertEqual(outcome.status, "active")
            scenario_id = outcome.id
        response = self.client.post("/predictions/", headers=headers, json={
            "user_id": user["user_id"], "scenario_id": scenario_id, "simulated_amount": 50,
        })
        self.assertEqual(response.status_code, 200, response.text)

    def test_legacy_imported_outcomes_are_repaired(self):
        from app.main import _migrate_scenario_statuses
        _, scenario_id = self.market()
        with SessionLocal() as db:
            db.get(models.Scenario, scenario_id).status = "open"
            db.commit()
            _migrate_scenario_statuses()
            db.expire_all()
            self.assertEqual(db.get(models.Scenario, scenario_id).status, "active")

    def test_comments_show_only_real_posts(self):
        _, headers = self.register()
        event_id, _ = self.market()
        self.assertEqual(self.client.get(f"/comments/event/{event_id}").json(), [])
        self.assertEqual(self.client.get("/comments/news", params={"url": "https://example.com/story"}).json(), [])
        response = self.client.post("/comments/", headers=headers,
                                    json={"event_id": event_id, "body": "A real local test comment."})
        self.assertEqual(response.status_code, 201, response.text)
        comments = self.client.get(f"/comments/event/{event_id}").json()
        self.assertEqual(len(comments), 1)
        self.assertGreater(comments[0]["id"], 0)

    def test_prediction_settlement_and_retry_preserve_balance(self):
        user, headers = self.register()
        event_id, scenario_id = self.market()
        response = self.client.post("/predictions/", headers=headers, json={
            "user_id": user["user_id"], "scenario_id": scenario_id, "simulated_amount": 50,
        })
        self.assertEqual(response.status_code, 200, response.text)
        with SessionLocal() as db:
            account = db.query(models.Account).one()
            self.assertEqual(float(account.balance), 9_950)
            self.assertEqual(db.query(models.Transaction).count(), 1)
            self.assertEqual(db.query(models.User).one().xp, 10)
            event = db.get(models.Event, event_id)
            with patch("app.services.resolution.notify_prediction_settled"):
                result = settle_event(db, event, scenario_id)
                self.assertTrue(result["ok"])
                expected_balance = 9_950 + 50 * response.json()["payout_multiplier"]
                self.assertAlmostEqual(float(account.balance), expected_balance, places=2)
                retry = settle_event(db, event, scenario_id)
                self.assertFalse(retry["ok"])
                self.assertAlmostEqual(float(account.balance), expected_balance, places=2)
            self.assertEqual(db.query(models.Prediction).one().status, "won")

    def test_cannot_predict_as_another_user(self):
        user, headers = self.register()
        _, scenario_id = self.market()
        response = self.client.post("/predictions/", headers=headers, json={
            "user_id": user["user_id"] + 1, "scenario_id": scenario_id, "simulated_amount": 50,
        })
        self.assertEqual(response.status_code, 403)

    def test_expired_market_rejects_prediction(self):
        user, headers = self.register()
        _, scenario_id = self.market(expired=True)
        response = self.client.post("/predictions/", headers=headers, json={
            "user_id": user["user_id"], "scenario_id": scenario_id, "simulated_amount": 50,
        })
        self.assertEqual(response.status_code, 400)
        with SessionLocal() as db:
            self.assertEqual(float(db.query(models.Account).one().balance), 10_000)

    def test_challenge_has_no_synthetic_participants(self):
        self.market()
        response = self.client.get("/daily-challenge/today")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["participants"], 0)

    def test_expiry_refunds_once_and_records_ledger(self):
        from app.services.polymarket_sync import _expire_old_events
        user, headers = self.register()
        event_id, scenario_id = self.market()
        response = self.client.post("/predictions/", headers=headers, json={
            "user_id": user["user_id"], "scenario_id": scenario_id, "simulated_amount": 50,
        })
        self.assertEqual(response.status_code, 200, response.text)
        with SessionLocal() as db:
            event = db.get(models.Event, event_id)
            event.closes_at = datetime.utcnow() - timedelta(hours=1)
            db.commit()
            self.assertEqual(_expire_old_events(db), 1)
            self.assertEqual(float(db.query(models.Account).one().balance), 10_000)
            self.assertEqual(db.query(models.Prediction).one().status, "void")
            self.assertEqual(db.query(models.Transaction).filter_by(type="void").count(), 1)
            self.assertEqual(_expire_old_events(db), 0)
            self.assertEqual(float(db.query(models.Account).one().balance), 10_000)

    def test_lopsided_market_refunds_prediction(self):
        from app.services.polymarket_sync import _backfill_categories_and_lopsided
        user, headers = self.register()
        event_id, scenario_id = self.market()
        self.client.post("/predictions/", headers=headers, json={
            "user_id": user["user_id"], "scenario_id": scenario_id, "simulated_amount": 50,
        })
        with SessionLocal() as db:
            db.get(models.Scenario, scenario_id).probability = 98
            db.commit()
            result = _backfill_categories_and_lopsided(db)
            self.assertEqual(result["refunded"], 1)
            self.assertEqual(float(db.query(models.Account).one().balance), 10_000)

    def test_vote_joins_predictions_to_their_market(self):
        user, headers = self.register()
        event_id, scenario_id = self.market()
        self.client.post("/predictions/", headers=headers, json={
            "user_id": user["user_id"], "scenario_id": scenario_id, "simulated_amount": 50,
        })
        response = self.client.post(f"/voting/events/{event_id}/vote", headers=headers,
                                    json={"scenario_id": scenario_id})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["voted"])

    def test_pruning_preserves_chart_endpoints_and_fifty_points(self):
        from app.services.history_pruner import prune_resolved_event_history
        event_id, scenario_id = self.market()
        with SessionLocal() as db:
            db.get(models.Event, event_id).status = "resolved"
            first = datetime.utcnow()
            for i in range(120):
                db.add(models.ScenarioProbabilityHistory(
                    event_id=event_id, scenario_id=scenario_id, probability=50,
                    source="test", recorded_at=first + timedelta(seconds=i),
                ))
            db.commit()
            self.assertEqual(prune_resolved_event_history(db), 70)
            points = db.query(models.ScenarioProbabilityHistory).order_by(
                models.ScenarioProbabilityHistory.recorded_at).all()
            self.assertEqual(len(points), 50)
            self.assertEqual(points[0].recorded_at, first)
            self.assertEqual(points[-1].recorded_at, first + timedelta(seconds=119))

    def test_incomplete_legacy_cleanup_refunds_once_without_reopening(self):
        from app.services.resolution import repair_incomplete_legacy_refunds
        user, headers = self.register()
        event_id, scenario_id = self.market()
        response = self.client.post("/predictions/", headers=headers, json={
            "user_id": user["user_id"], "scenario_id": scenario_id, "simulated_amount": 50,
        })
        self.assertEqual(response.status_code, 200)
        with SessionLocal() as db:
            event = db.get(models.Event, event_id)
            event.status = "resolved"
            event.external_source = None
            db.commit()
            self.assertEqual(repair_incomplete_legacy_refunds(db), 1)
            self.assertEqual(repair_incomplete_legacy_refunds(db), 0)
            self.assertEqual(db.get(models.Event, event_id).status, "resolved")
            self.assertEqual(db.query(models.Prediction).one().status, "void")
            self.assertEqual(float(db.query(models.Account).one().balance), 10_000)
            self.assertEqual(db.query(models.Transaction).filter_by(type="void").count(), 1)

    def test_simulated_order_preserves_polymarket_prices(self):
        user, headers = self.register()
        event_id, scenario_id = self.market()
        response = self.client.post("/predictions/", headers=headers, json={"user_id": user["user_id"], "scenario_id": scenario_id, "simulated_amount": 100})
        self.assertEqual(response.status_code, 200)
        with SessionLocal() as db:
            self.assertEqual([s.probability for s in db.get(models.Event, event_id).scenarios], [50, 50])
            self.assertEqual(db.query(models.ScenarioProbabilityHistory).count(), 0)

    def test_stale_or_closed_source_quotes_do_not_debit_balance(self):
        user, headers = self.register()
        event_id, scenario_id = self.market()
        for data, synced in [({"accepting_orders": False}, datetime.utcnow()), ({"accepting_orders": True}, datetime.utcnow() - timedelta(minutes=6))]:
            with SessionLocal() as db:
                event = db.get(models.Event, event_id)
                event.external_data = data
                event.external_synced_at = synced
                db.commit()
            response = self.client.post("/predictions/", headers=headers, json={"user_id": user["user_id"], "scenario_id": scenario_id, "simulated_amount": 50})
            self.assertEqual(response.status_code, 400)
        with SessionLocal() as db:
            self.assertEqual(float(db.query(models.Account).one().balance), 10_000)
            self.assertEqual(db.query(models.Prediction).count(), 0)

    def test_empty_history_is_not_fabricated(self):
        event_id, _ = self.market()
        from app.routers.events import _BATCH_HISTORY_CACHE
        _BATCH_HISTORY_CACHE.clear()
        for path in (f"/events/{event_id}/history", f"/events/history/batch?ids={event_id}"):
            data = self.client.get(path).json()
            events = data.get("histories", [data])
            self.assertTrue(all(not scenario["points"] for event in events for scenario in event["scenarios"]))

    def test_rich_source_endpoint_maps_real_history_and_omits_trader_identity(self):
        event_id, _ = self.market()
        with SessionLocal() as db:
            db.get(models.Event, event_id).external_id = "999"
            db.commit()
        async def fetch(base, path, params=None, ttl=30):
            if path == "/markets":
                self.assertEqual(params, {"id": "999", "limit": 1})
                return [polymarket_fixture()]
            if path == "/events/10": return {"title": "Parent event", "openInterest": 500, "startTime": "2026-10-28T00:00:00Z", "sport": {"name": "NBA", "sport": "nba"}, "teams": [{"name": "Kings", "color": "#8040C0", "logo": "https://example.com/kings.png", "record": "stale"}, {"name": "Spurs", "color": "javascript:bad", "logo": "javascript:bad"}], "markets": [{"id": "other", "groupItemTitle": "Another candidate", "outcomePrices": '["0.2", "0.8"]'}]}
            if path == "/book": return {"bids": [{"price": ".35", "size": "10"}, {"price": ".37", "size": "5"}], "asks": [{"price": ".4", "size": "4"}, {"price": ".38", "size": "3"}]}
            if path == "/prices-history": return {"history": [{"t": 1700000000, "p": .33}, {"t": 1700001000, "p": .375}]}
            if path == "/trades": return [{"side": "BUY", "outcome": "Yes", "price": .37, "size": 5, "timestamp": 1700001000, "proxyWallet": "private-profile", "name": "A trader"}]
            if path == "/oi": return [{"market": "0xabc", "value": 1234}]
        with patch("app.services.polymarket_data.public_json", side_effect=fetch):
            response = self.client.get(f"/events/{event_id}/polymarket?interval=1d")
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["market"]["change_day"], 1.2)
        self.assertEqual(data["market"]["url"], "https://polymarket.com/event/parent-event")
        self.assertEqual(data["outcomes"][0]["bids"][0]["price"], .37)
        self.assertEqual(data["outcomes"][0]["asks"][0]["price"], .38)
        self.assertEqual(data["outcomes"][0]["history"][0]["probability"], 33)
        self.assertEqual(data["market"]["event"]["open_interest"], 500)
        self.assertEqual(data["market"]["open_interest"], 1234)
        self.assertEqual(data["market"]["event"]["teams"][0]["color"], "#8040C0")
        self.assertEqual(data["market"]["event"]["game_starts_at"], "2026-10-28T00:00:00Z")
        self.assertIsNone(data["market"]["event"]["teams"][1]["color"])
        self.assertIsNone(data["market"]["event"]["teams"][1]["logo"])
        self.assertNotIn("record", data["market"]["event"]["teams"][0])
        self.assertEqual(len(data["related_markets"]), 1)
        self.assertNotIn("proxyWallet", response.text)
        self.assertNotIn("private-profile", response.text)
        self.assertFalse(data["stale"])

    def test_source_failure_returns_honest_partial_data(self):
        from app.services.polymarket_data import snapshot
        event_id, _ = self.market()
        with SessionLocal() as db:
            event = db.get(models.Event, event_id)
            event.external_id = "999"
            event.external_data = snapshot(polymarket_fixture())
            db.commit()
        with patch("app.services.polymarket_data.public_json", return_value=None):
            response = self.client.get(f"/events/{event_id}/polymarket")
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertTrue(data["stale"])
        self.assertFalse(data["outcomes"][0]["book_available"])
        self.assertEqual(data["outcomes"][0]["history"], [])
        self.assertEqual(data["market"]["volume_24h"], 345)
        self.assertEqual(self.client.get(f"/events/{event_id}/polymarket?interval=bad").status_code, 422)
        self.assertEqual(self.client.get("/events/polymarket/sparklines?ids=bad").status_code, 400)

    def test_history_sampling_adapts_to_recent_markets(self):
        from datetime import timezone
        from app.services.polymarket_data import history_fidelity
        now = datetime(2026, 10, 27, tzinfo=timezone.utc)
        recent = {"starts_at": "2026-10-26T00:00:00Z"}
        self.assertEqual(history_fidelity(recent, "max", now), 8)
        self.assertEqual(history_fidelity(recent, "1h", now), 1)
        self.assertEqual(history_fidelity(recent, "1m", now), 10)
        self.assertEqual(history_fidelity({"starts_at": "2020-01-01T00:00:00Z"}, "max", now), 1440)
        self.assertEqual(history_fidelity({"starts_at": "bad"}, "max", now), 1440)

    def test_portuguese_market_content_is_cached_without_changing_english(self):
        event_id, _ = self.market()
        title = "Will the U.S. invade Iran before 2027?"
        with SessionLocal() as db:
            db.get(models.Event, event_id).title = title
            db.commit()
        with patch("app.services.event_translations._executor.submit"):
            response = self.client.get(f"/events/{event_id}?lang=pt")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], title)
        self.assertEqual(response.json()["title_pt"], "Os EUA invadirão o Irã antes de 2027?")
        self.assertEqual(response.json()["scenarios"][0]["title_pt"], "Sim")
        self.assertEqual(self.client.get(f"/events/{event_id}?lang=en").json()["title"], title)

    def test_translation_preserves_numbers_and_uses_source_content_keys(self):
        from app.services.translate import cached_translation, valid_translation
        self.assertTrue(valid_translation("Will Bitcoin reach $85,000?", "O Bitcoin chegará a 85 mil dólares?"))
        self.assertFalse(valid_translation("Will Bitcoin reach $85,000?", "O Bitcoin chegará a 86 mil dólares?"))
        self.assertTrue(valid_translation("Before October 31, 2026", "2026年10月31日之前"))
        self.assertEqual(cached_translation("No", "pt"), "Não")
        self.assertIsNone(cached_translation("Will the U.S. invade Iran before 2028?", "pt"))

    def test_matchup_translation_keeps_team_identities(self):
        from app.services.translate import cached_translation
        self.assertEqual(cached_translation("Pistons vs. Knicks", "pt"), "Pistons x Knicks")
        self.assertEqual(cached_translation("Spread: Spurs (-18.5)", "pt"), "Handicap: Spurs (-18.5)")
        self.assertEqual(cached_translation("Nets vs. Celtics: O/U 222.5", "pt"), "Nets x Celtics: Mais/menos 222.5")
        self.assertEqual(cached_translation("1H Spread -22.5", "pt"), "1º tempo · Handicap: -22.5")
        self.assertEqual(cached_translation("O/U 231.5", "pt"), "Mais/menos: 231.5")

    def test_source_locale_does_not_replace_original_rules(self):
        from app.services.event_translations import localize_source
        result = {"market": {"rules": "Uncached original source rules.", "tags": ["Military Strikes"], "event": {}}, "related_markets": []}
        with patch("app.services.event_translations._executor.submit"):
            localize_source(result, "pt")
        self.assertEqual(result["language"], "pt")
        self.assertEqual(result["market"]["rules"], "Uncached original source rules.")
        self.assertIsNone(result["market"]["localized_rules"])
        self.assertNotIn("Military Strikes", result["market"]["localized_tags"])

    def test_source_rule_changes_invalidate_previous_translations(self):
        from app.services.polymarket_sync import _refresh_existing_event
        event_id, _ = self.market()
        with SessionLocal() as db:
            event = db.get(models.Event, event_id)
            event.description = "Old source rules"
            event.description_pt = "Regras antigas"
            event.description_zh = "旧规则"
            db.commit()
            _refresh_existing_event(db, event, polymarket_fixture())
            self.assertIsNone(event.description_pt)
            self.assertIsNone(event.description_zh)

    def test_source_refresh_updates_small_moves_and_matches_outcome_labels(self):
        from app.services.polymarket_sync import _refresh_existing_event
        event_id, _ = self.market()
        market = polymarket_fixture()
        market["outcomes"] = '["No", "Yes"]'
        market["outcomePrices"] = '["0.499", "0.501"]'
        with SessionLocal() as db:
            self.assertTrue(_refresh_existing_event(db, db.get(models.Event, event_id), market))
            db.commit()
            scenarios = {s.title: s.probability for s in db.get(models.Event, event_id).scenarios}
            self.assertAlmostEqual(scenarios["Yes"], 50.1)
            self.assertAlmostEqual(scenarios["No"], 49.9)
            event = db.get(models.Event, event_id)
            previous_sync = event.external_synced_at
            market["outcomePrices"] = '["NaN", "0.5"]'
            self.assertFalse(_refresh_existing_event(db, event, market))
            self.assertEqual(event.external_synced_at, previous_sync)

    def test_quote_refresh_covers_more_than_the_default_gamma_page(self):
        import asyncio
        import httpx
        from app.services.polymarket_sync import refresh_open_quotes_once
        with SessionLocal() as db:
            for i in range(23):
                event = models.Event(slug=f"source-{i}", title=f"Source {i}", status="open", external_source="polymarket", external_id=str(100 + i))
                event.scenarios = [models.Scenario(title="No", probability=50, status="active", sort_order=1), models.Scenario(title="Yes", probability=50, status="active", sort_order=0)]
                db.add(event)
            db.commit()
        class Client:
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def get(self, url, params):
                ids = [value for key, value in params if key == "id"]
                limit = int(dict(params).get("limit", 20))
                return httpx.Response(200, json=[{**polymarket_fixture(), "id": value} for value in ids[:limit]], request=httpx.Request("GET", url))
        with patch("app.services.polymarket_sync.httpx.AsyncClient", return_value=Client()):
            self.assertEqual(asyncio.run(refresh_open_quotes_once()), 23)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Event).filter(models.Event.external_data.isnot(None)).count(), 23)
            self.assertEqual([s.title for s in db.query(models.Event).first().scenarios], ["Yes", "No"])

    def test_production_requires_database_and_private_signing_key(self):
        for values in (
            {"database_url": "", "jwt_secret_key": "x" * 48},
            {"database_url": "sqlite:///ephemeral.db", "jwt_secret_key": "x" * 48},
            {"database_url": "postgresql://test@localhost/test", "jwt_secret_key": "short"},
        ):
            with self.subTest(values=values):
                with self.assertRaises(ValidationError):
                    Settings(_env_file=None, app_env="production", **values)

    @unittest.skipUnless(_database_url, "PostgreSQL row-lock integration check")
    def test_concurrent_settlement_credits_winner_once(self):
        from concurrent.futures import ThreadPoolExecutor
        user, headers = self.register()
        event_id, scenario_id = self.market()
        response = self.client.post("/predictions/", headers=headers, json={
            "user_id": user["user_id"], "scenario_id": scenario_id, "simulated_amount": 50,
        })
        self.assertEqual(response.status_code, 200)

        def settle():
            with SessionLocal() as db:
                return settle_event(db, db.get(models.Event, event_id), scenario_id)

        with patch("app.services.resolution.notify_prediction_settled"):
            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(lambda _: settle(), range(2)))
        self.assertEqual(sum(bool(r["ok"]) for r in results), 1)
        with SessionLocal() as db:
            expected = 9_950 + 50 * response.json()["payout_multiplier"]
            self.assertAlmostEqual(float(db.query(models.Account).one().balance), expected, places=2)
            self.assertEqual(db.query(models.Transaction).filter_by(type="prediction_win").count(), 1)


class NewsSummaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_source_http_cache_coalesces_identical_requests(self):
        import asyncio
        import httpx
        from app.services import polymarket_data as source
        source._cache.clear()
        source._inflight.clear()
        calls = []
        class Client:
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def get(self, url, params=None):
                calls.append(url)
                await asyncio.sleep(0)
                return httpx.Response(200, json={"history": []}, request=httpx.Request("GET", url))
        with patch.object(source.httpx, "AsyncClient", return_value=Client()):
            results = await asyncio.gather(*(source.public_json(source.CLOB, "/prices-history", {"market": "11"}) for _ in range(3)))
            await source.public_json(source.CLOB, "/prices-history", {"market": "11"})
        self.assertEqual(len(calls), 1)
        self.assertEqual(results, [{"history": []}] * 3)
        source._cache.clear()

    async def test_source_normalization_rejects_invalid_points_and_numbers(self):
        from app.services.polymarket_data import snapshot, history_points, number
        self.assertIsNone(number("NaN"))
        self.assertIsNone(number("Infinity"))
        market = polymarket_fixture()
        market["resolutionSource"] = "javascript:alert(1)"
        self.assertIsNone(snapshot(market)["resolution_source"])
        points = history_points([{"t": 2, "p": .2}, {"t": 1, "p": .1}, {"t": 2, "p": .3}, {"t": -1, "p": .5}, {"t": 3, "p": 2}])
        self.assertEqual([p["probability"] for p in points], [10, 30])

    async def test_unavailable_providers_do_not_invent_analysis(self):
        from app.routers import news
        with patch.object(news, "GROQ_API_KEY", ""), patch.object(news, "OPENAI_API_KEY", ""), patch.dict(news._summary_cache, {}, clear=True):
            result = await news.get_summary(news.SummaryRequest(title="An ordinary headline", url="https://example.com/story", language="en"))
        self.assertEqual(result, {"summary": "", "available": False})

    async def test_cached_summaries_respect_language(self):
        from app.routers import news
        url = "https://example.com/story"
        with patch.dict(news._summary_cache, {f"en:{url}": "English summary", f"pt:{url}": "Resumo em português"}, clear=True):
            english = await news.get_summary(news.SummaryRequest(title="Headline", url=url, language="en"))
            portuguese = await news.get_summary(news.SummaryRequest(title="Headline", url=url, language="pt"))
        self.assertEqual(english["summary"], "English summary")
        self.assertEqual(portuguese["summary"], "Resumo em português")


if __name__ == "__main__":
    unittest.main()
