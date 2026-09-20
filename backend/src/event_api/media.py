from __future__ import annotations

import io
import re
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError

from .errors import ApiError

ALLOWED_COVERS = {
    "image/jpeg": (".jpg", (b"\xff\xd8\xff",)),
    "image/png": (".png", (b"\x89PNG\r\n\x1a\n",)),
    "image/webp": (".webp", (b"RIFF",)),
}
SAFE_COVER_KEY = re.compile(r"^[0-9a-f]{32}\.(?:jpg|png|webp)$")
MAX_COVER_DIMENSION = 4_096
_PIL_FORMAT = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}


def cover_directory(root: Path) -> Path:
    directory = root.expanduser().resolve() / "event-covers"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


async def save_cover(upload: UploadFile, root: Path, max_bytes: int) -> str:
    content_type = (upload.content_type or "").lower()
    definition = ALLOWED_COVERS.get(content_type)
    if not definition:
        raise ApiError(415, "INVALID_COVER_TYPE", "Use JPEG, PNG or WebP")
    content = await upload.read(max_bytes + 1)
    await upload.close()
    if not content or len(content) > max_bytes:
        raise ApiError(413, "COVER_TOO_LARGE", "Cover exceeds the size limit")
    extension, signatures = definition
    if not any(content.startswith(signature) for signature in signatures):
        raise ApiError(400, "INVALID_COVER_FILE", "Cover content is invalid")
    if content_type == "image/webp" and content[8:12] != b"WEBP":
        raise ApiError(400, "INVALID_COVER_FILE", "Cover content is invalid")
    normalized = _decode_and_normalize(content, content_type)
    key = f"{uuid4().hex}{extension}"
    target = cover_directory(root) / key
    target.write_bytes(normalized)
    return key


def _decode_and_normalize(content: bytes, content_type: str) -> bytes:
    """Decode the upload for real, cap its dimensions, and re-encode it.

    Re-encoding through Pillow (rather than writing the uploaded bytes as-is)
    both proves the file actually decodes as a valid image of that format and
    drops EXIF/metadata, since Image.save() does not carry it over unless it
    is explicitly passed back in.
    """
    try:
        with Image.open(io.BytesIO(content)) as image:
            width, height = image.size
            if width > MAX_COVER_DIMENSION or height > MAX_COVER_DIMENSION:
                raise ApiError(
                    400,
                    "INVALID_COVER_FILE",
                    f"Cover dimensions must not exceed {MAX_COVER_DIMENSION}x{MAX_COVER_DIMENSION}",
                )
            image.load()
            pil_format = _PIL_FORMAT[content_type]
            normalized: Image.Image = image
            if pil_format == "JPEG" and image.mode not in ("RGB", "L"):
                normalized = image.convert("RGB")
            output = io.BytesIO()
            normalized.save(output, format=pil_format)
            return output.getvalue()
    except ApiError:
        raise
    except (UnidentifiedImageError, OSError, ValueError):
        raise ApiError(400, "INVALID_COVER_FILE", "Cover content is invalid") from None


def cover_path(root: Path, key: str) -> Path:
    if not SAFE_COVER_KEY.fullmatch(key):
        raise ApiError(404, "COVER_NOT_FOUND", "Cover not found")
    target = cover_directory(root) / key
    if not target.is_file():
        raise ApiError(404, "COVER_NOT_FOUND", "Cover not found")
    return target


def remove_cover(root: Path, key: str | None) -> None:
    if not key or not SAFE_COVER_KEY.fullmatch(key):
        return
    target = cover_directory(root) / key
    target.unlink(missing_ok=True)
