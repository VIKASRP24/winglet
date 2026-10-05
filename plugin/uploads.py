"""Inspecting files people send from the app: what they really are, and safe names to store them under.

The app's claimed content type is never trusted. The first bytes decide; a file that can't be
recognised is treated as an opaque download.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import PurePath

# Signature -> MIME. Order matters where one prefix contains another.
_MAGIC = [
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"%PDF-", "application/pdf"),
    (b"OggS", "audio/ogg"),
    (b"ID3", "audio/mpeg"),
    (b"fLaC", "audio/flac"),
    (b"\x1a\x45\xdf\xa3", "video/webm"),
    (b"PK\x03\x04", "application/zip"),
]
_FTYP = {
    b"heic": "image/heic", b"heix": "image/heic", b"mif1": "image/heic", b"msf1": "image/heic", b"avif": "image/avif",
    b"M4A ": "audio/mp4", b"M4B ": "audio/mp4", b"qt  ": "video/quicktime",
}
_OFFICE = {".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
           ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
           ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}
# Plain-text formats are named by extension once the bytes decode as text.
_TEXT_EXT = {".md": "text/markdown", ".csv": "text/csv", ".json": "application/json", ".yaml": "application/yaml",
             ".yml": "application/yaml", ".xml": "application/xml", ".html": "text/plain", ".htm": "text/plain",
             ".svg": "text/plain"}


def sniff_mime(head: bytes, name: str = "") -> str:
    """The real type of a file from its first bytes (at least 64 are best)."""
    ext = PurePath(name).suffix.lower()
    for magic, mime in _MAGIC:
        if head.startswith(magic):
            if mime == "application/zip" and ext in _OFFICE:
                return _OFFICE[ext]
            return mime
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "audio/wav"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in _FTYP:
            return _FTYP[brand]
        return "video/mp4"
    if len(head) >= 2 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0:
        return "audio/mpeg"  # MPEG audio frame without an ID3 tag
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as exc:
        # A multi-byte character cut off at the end of the sample is still text.
        if exc.start < len(head) - 4:
            return "application/octet-stream"
    if b"\x00" in head:
        return "application/octet-stream"
    # HTML and SVG are deliberately plain text: they must never render as part of the app's origin.
    return _TEXT_EXT.get(ext, "text/plain")


def voice_mime(mime: str) -> str:
    """A recorded voice note is audio even when its container says video: browsers record WebM, and
    some phones write MP4 without an audio-only brand. Hermes must cache it as audio to transcribe it."""
    return {"video/webm": "audio/webm", "video/mp4": "audio/mp4"}.get(mime, mime)


def kind_of(mime: str, voice: bool = False) -> str:
    """How the app shows it: image, audio, video, or file. Voice notes are audio the user recorded."""
    if voice and mime.startswith("audio/"):
        return "voice"
    if mime in ("image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"):
        return "image"
    if mime.startswith("audio/"):
        return "audio"
    if mime.startswith("video/"):
        return "video"
    return "file"


def safe_name(name: str, fallback: str = "file") -> str:
    """A file name that's safe on every filesystem: no directories, control characters or reserved names."""
    base = PurePath((name or "").replace("\\", "/")).name
    base = unicodedata.normalize("NFC", base)
    base = re.sub(r"[\x00-\x1f\x7f<>:\"/\\|?*]", "_", base).strip(" .")
    if not base or base in {".", ".."} or re.fullmatch(r"(?i)(con|prn|aux|nul|com\d|lpt\d)(\..*)?", base):
        base = fallback
    if len(base) > 120:
        stem, dot, ext = base.rpartition(".")
        base = (stem[: 120 - len(ext) - 1] + "." + ext) if dot and len(ext) <= 10 else base[:120]
    return base
