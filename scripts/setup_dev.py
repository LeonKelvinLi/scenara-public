"""Create local development settings without overwriting existing files."""
import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
(root / ".local").mkdir(exist_ok=True)
settings = {
    root / "scenara-backend/.env": (
        "APP_ENV=dev\nAPP_DEBUG=false\nPROJECT_PAUSED=false\n"
        "ENABLE_BACKGROUND_TASKS=true\n"
        f"JWT_SECRET_KEY={secrets.token_urlsafe(48)}\n"
        f"DATABASE_URL=sqlite:///{root / '.local/scenara.db'}\n"
    ),
    root / "scenara-mobile/.env.local": (
        "EXPO_PUBLIC_API_URL=http://localhost:8000\n"
        "EXPO_PUBLIC_PROJECT_PAUSED=false\n"
    ),
}
for path, content in settings.items():
    if path.exists():
        print(f"Preserved {path.relative_to(root)}")
        continue
    with path.open("x") as file:
        path.chmod(0o600)
        file.write(content)
    print(f"Created {path.relative_to(root)}")
