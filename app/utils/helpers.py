import uuid
import numpy as np
import soundfile as sf
import io
from datetime import datetime
from pathlib import Path
from typing import Union
from loguru import logger


def generate_id() -> str:
    return str(uuid.uuid4())


def short_id() -> str:
    return str(uuid.uuid4())[:8]


def now_iso() -> str:
    return datetime.now().isoformat()


def bytes_to_numpy(raw_bytes: bytes, sample_rate: int = 16000) -> np.ndarray:
    """Convert raw PCM int16 bytes to float32 numpy array."""
    audio = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    return audio


def audio_file_to_numpy(file_bytes: bytes, target_sr: int = 16000) -> np.ndarray:
    """Convert uploaded audio file (any format) to float32 mono numpy array at target_sr.

    Tries soundfile first (fast, WAV/FLAC/OGG), then falls back to pydub via
    ffmpeg which handles WebM, Opus, MP4, MP3 and anything the browser records.
    """
    audio, sr = _decode_audio(file_bytes)

    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    if sr != target_sr:
        from scipy.signal import resample
        audio = resample(audio, int(len(audio) * target_sr / sr))

    return audio.astype(np.float32)


def _decode_audio(file_bytes: bytes):
    """Return (float32 ndarray, sample_rate). Tries soundfile then pydub."""
    # 1. soundfile — fast path for WAV / FLAC / OGG-Vorbis
    try:
        audio, sr = sf.read(io.BytesIO(file_bytes), always_2d=False)
        return audio.astype(np.float32), sr
    except Exception:
        pass

    # 2. pydub via ffmpeg — handles WebM, Opus, MP3, MP4, OGG-Opus, etc.
    try:
        from pydub import AudioSegment
        seg = AudioSegment.from_file(io.BytesIO(file_bytes))
        seg = seg.set_channels(1).set_frame_rate(seg.frame_rate)
        samples = np.array(seg.get_array_of_samples(), dtype=np.float32)
        samples /= float(1 << (seg.sample_width * 8 - 1))
        return samples, seg.frame_rate
    except Exception as e:
        logger.error(f"audio_file_to_numpy failed (both decoders): {e}")
        raise ValueError(f"Could not decode audio: {e}")


def save_audio(audio: np.ndarray, path: Union[str, Path], sample_rate: int = 16000):
    sf.write(str(path), audio, sample_rate)


def format_duration(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def format_timestamp(dt: datetime) -> str:
    return dt.strftime("%d %B %Y, %I:%M %p")


def safe_json_loads(text: str) -> dict:
    """Attempt to extract and parse JSON from LLM response."""
    import json
    import re

    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try extracting JSON block
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    return {}
