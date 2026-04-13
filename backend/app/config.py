from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    app_name: str = 'OPENSTOKO API'
    secret_key: str = 'change-me-very-secret'
    algorithm: str = 'HS256'
    access_token_expire_minutes: int = 60 * 8

    database_url: str = 'mysql+pymysql://openstoko:openstoko@db:3306/openstoko?charset=utf8mb4'
    db_startup_max_attempts: int = 30
    db_startup_retry_seconds: float = 2.0

    backup_enabled: bool = True
    backup_hour_utc: int = 2
    backup_email_from: str = 'noreply@openstoko.local'
    backup_email_to: str = 'admin@openstoko.local'
    smtp_host: str = 'localhost'
    smtp_port: int = 25

    # Auth bootstrap / recovery controls.
    bootstrap_admin_username: str = 'admin'
    bootstrap_admin_full_name: str = 'System Administrator'
    bootstrap_admin_password: str = 'admin123'
    reset_admin_password_on_start: bool = False

    default_language: str = 'bg'


settings = Settings()
