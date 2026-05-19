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
    FACULTY_HANDBOOK_PATH: Path = DATA_DIR / "Faculty Handbook - 8.10.2020.pdf"

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
    # Quality / hallucination-suppression parameters
    WHISPER_NO_SPEECH_THRESHOLD: float = 0.5        # discard segment if P(no speech) > this
    WHISPER_LOG_PROB_THRESHOLD: float = -1.0         # discard if avg log-prob < this
    WHISPER_COMPRESSION_RATIO_THRESHOLD: float = 2.4 # discard hallucinated/repeated text
    WHISPER_REPETITION_PENALTY: float = 1.2          # penalise repetitive token sequences

    # ── Pyannote Diarization ──────────────────────────────────────────────────
    PYANNOTE_HF_TOKEN: str = ""
    PYANNOTE_MODEL: str = "pyannote/speaker-diarization-3.1"
    DIARIZATION_MIN_SPEAKERS: int = 1
    DIARIZATION_MAX_SPEAKERS: int = 8    # hard ceiling; further capped at enrolled-speaker count at runtime

    # ── Speaker Identification ────────────────────────────────────────────────
    SPEECHBRAIN_MODEL: str = "speechbrain/spkrec-ecapa-voxceleb"
    SPEAKER_ID_THRESHOLD: float = 0.42   # lowered from 0.50 for robustness with far-mic audio

    # ── LLM (Ollama) ─────────────────────────────────────────────────────────
    OLLAMA_BASE_URL: str = "http://ollama:11434"
    LLM_MODEL: str = "qwen2.5:14b"
    LLM_TEMPERATURE: float = 0.1
    LLM_MAX_TOKENS: int = 4096
    LLM_NUM_CTX: int = 32768          # Ollama context window (default is 2048 — far too small)
    LLM_TIMEOUT: int = 600            # seconds (longer for large context calls)
    # Transcripts longer than this (chars) are processed in chunks to stay
    # within the context window.  ~90k chars ≈ ~22k tokens, leaving room for
    # the prompt template and output within a 32k context window.
    LLM_CHUNK_CHARS: int = 90000

    # ── Timezone ──────────────────────────────────────────────────────────────
    # Used when formatting meeting times in MoM documents.
    # All datetimes are stored as UTC internally.
    TIMEZONE: str = "Asia/Karachi"

    def ensure_dirs(self):
        for d in [self.MEETINGS_DIR, self.SPEAKER_PROFILES_DIR, self.EXPORTS_DIR, self.TEMPLATES_DIR, self.MODELS_DIR]:
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_dirs()
