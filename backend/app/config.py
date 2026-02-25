from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "ICA Edge-First Checkout API"
    edge_db_path: str = "./data/edge_store.db"
    central_db_path: str = "./data/central_hq.db"
    heartbeat_timeout_seconds: int = 20

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
