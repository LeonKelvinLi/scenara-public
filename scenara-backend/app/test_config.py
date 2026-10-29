from app.config import settings

print("ENV:", settings.app_env)
print("Database configured:", bool(settings.database_url))
