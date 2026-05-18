from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ── Application ──────────────────────────────────────────────────────────
    APP_NAME: str = "GIK Faculty MoM Assistant"
    VERSION: str = "1.0.0"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # ── Paths ─────────────────────────────────────────────────────────────────
    BASE_DIR: Path = Path(__file__).parent.parent
    DATA_DIR: Path = BASE_DIR / "data"
    MEETINGS_DIR: Path = DATA_DIR / "meetings"
    SPEAKER_PROFILES_DIR: Path = DATA_DIR / "speaker_profiles"
    EXPORTS_DIR: Path = DATA_DIR / "exports"
    TEMPLATES_DIR: Path = DATA_DIR / "templates"
    MODELS_DIR: Path = BASE_DIR / "models"
    MOM_DOCX_TEMPLATE_PATH: Path = TEMPLATES_DIR / "official_mom_header.docx"

    # ── Audio ─────────────────────────────────────────────────────────────────
    SAMPLE_RATE: int = 16000
    CHUNK_DURATION: float = 8.0        # seconds per processing window
    MAX_MEETING_DURATION: int = 480    # minutes

    # ── Whisper STT ───────────────────────────────────────────────────────────
    WHISPER_MODEL: str = "large-v3"
    WHISPER_DEVICE: str = "cuda"
    WHISPER_COMPUTE_TYPE: str = "float16"
    WHISPER_LANGUAGE: Optional[str] = None   # None = auto-detect
    WHISPER_ALLOWED_LANGUAGES: str = "en,ur"  # candidates used when WHISPER_LANGUAGE is unset
    WHISPER_BEAM_SIZE: int = 5
    WHISPER_FORCE_ENGLISH: bool = True       # True = always output transcript text in English
    WHISPER_LOW_CONF_THRESHOLD: float = -0.85  # lower than this is flagged for human review

    # ── Pyannote Diarization ──────────────────────────────────────────────────
    PYANNOTE_HF_TOKEN: str = ""
    PYANNOTE_MODEL: str = "pyannote/speaker-diarization-3.1"
    DIARIZATION_MIN_SPEAKERS: int = 1
    DIARIZATION_MAX_SPEAKERS: int = 15

    # ── Speaker Identification ────────────────────────────────────────────────
    SPEECHBRAIN_MODEL: str = "speechbrain/spkrec-ecapa-voxceleb"
    SPEAKER_ID_THRESHOLD: float = 0.50

    # ── LLM (Ollama) ─────────────────────────────────────────────────────────
    OLLAMA_BASE_URL: str = "http://ollama:11434"
    LLM_MODEL: str = "qwen2.5:14b"
    LLM_TEMPERATURE: float = 0.1
    LLM_MAX_TOKENS: int = 4096
    LLM_TIMEOUT: int = 300            # seconds

    def ensure_dirs(self):
        for d in [self.MEETINGS_DIR, self.SPEAKER_PROFILES_DIR, self.EXPORTS_DIR, self.TEMPLATES_DIR, self.MODELS_DIR]:
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_dirs()
