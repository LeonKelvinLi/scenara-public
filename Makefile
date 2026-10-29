.PHONY: setup api web test build

setup:
	uv venv --python 3.11 .venv
	uv pip install --python .venv/bin/python -r scenara-backend/requirements.txt
	cd scenara-mobile && npm ci
	.venv/bin/python scripts/setup_dev.py

api:
	cd scenara-backend && ../.venv/bin/python -m uvicorn app.main:app --reload --port 8000

web:
	cd scenara-mobile && npm run web

test:
	cd scenara-backend && ../.venv/bin/python -m unittest discover -s tests -v
	cd scenara-mobile && npm run typecheck && npm run lint

build:
	cd scenara-mobile && npm run build
