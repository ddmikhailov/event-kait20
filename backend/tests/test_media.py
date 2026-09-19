from __future__ import annotations

import asyncio
import io
from pathlib import Path

import pytest
from fastapi import UploadFile
from PIL import Image
from starlette.datastructures import Headers

from event_api.errors import ApiError
from event_api.media import MAX_COVER_DIMENSION, save_cover

SOFTWARE_TAG = 0x0131


def _upload(
    content: bytes, content_type: str, filename: str = "cover.png"
) -> UploadFile:
    return UploadFile(
        file=io.BytesIO(content),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )


def _png(size: tuple[int, int]) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color=(10, 20, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


def test_save_cover_decodes_and_strips_exif(tmp_path: Path) -> None:
    buffer = io.BytesIO()
    image = Image.new("RGB", (4, 4), color=(200, 50, 10))
    exif = image.getexif()
    exif[SOFTWARE_TAG] = "Secret Camera Model"
    image.save(buffer, format="JPEG", exif=exif)
    source = buffer.getvalue()
    with Image.open(io.BytesIO(source)) as check:
        assert check.getexif().get(SOFTWARE_TAG) == "Secret Camera Model"

    key = asyncio.run(
        save_cover(
            _upload(source, "image/jpeg", "cover.jpg"), tmp_path, 5 * 1024 * 1024
        )
    )
    stored = (tmp_path / "event-covers" / key).read_bytes()
    with Image.open(io.BytesIO(stored)) as saved:
        assert saved.getexif().get(SOFTWARE_TAG) is None


def test_save_cover_rejects_oversized_dimensions(tmp_path: Path) -> None:
    oversized = _png((MAX_COVER_DIMENSION + 1, 10))
    with pytest.raises(ApiError) as caught:
        asyncio.run(
            save_cover(_upload(oversized, "image/png"), tmp_path, 50 * 1024 * 1024)
        )
    assert caught.value.status == 400
    assert caught.value.code == "INVALID_COVER_FILE"


def test_save_cover_rejects_undecodable_content_despite_valid_magic_bytes(
    tmp_path: Path,
) -> None:
    fake = b"\x89PNG\r\n\x1a\n" + b"not actually a png" * 4
    with pytest.raises(ApiError) as caught:
        asyncio.run(save_cover(_upload(fake, "image/png"), tmp_path, 5 * 1024 * 1024))
    assert caught.value.status == 400
    assert caught.value.code == "INVALID_COVER_FILE"


def test_save_cover_accepts_a_genuine_image_within_limits(tmp_path: Path) -> None:
    content = _png((32, 16))
    key = asyncio.run(
        save_cover(_upload(content, "image/png"), tmp_path, 5 * 1024 * 1024)
    )
    stored = (tmp_path / "event-covers" / key).read_bytes()
    with Image.open(io.BytesIO(stored)) as saved:
        assert saved.size == (32, 16)
