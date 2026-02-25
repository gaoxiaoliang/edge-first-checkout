from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Edge-First Checkout API"
    edge_db_path: str = "./data/edge_store.db"
    central_db_path: str = "./data/central_hq.db"
    default_store_id: str = "ICA-STHLM-001"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def edge_db_uri(self) -> str:
        return str(Path(self.edge_db_path).resolve())

    @property
    def central_db_uri(self) -> str:
        return str(Path(self.central_db_path).resolve())


settings = Settings()
