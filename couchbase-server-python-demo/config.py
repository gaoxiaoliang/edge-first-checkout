from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    couchbase_connection_string: str = Field(..., alias="COUCHBASE_CONNECTION_STRING")
    couchbase_username: str = Field(..., alias="COUCHBASE_USERNAME")
    couchbase_password: str = Field(..., alias="COUCHBASE_PASSWORD")
    couchbase_bucket: str = Field(..., alias="COUCHBASE_BUCKET")

    class Config:
        env_file = ".env"
        populate_by_name = True


settings = Settings()
