"""Media storage: local filesystem or any S3-compatible object store.

Uploaded images are always re-encoded, which strips EXIF/GPS metadata, normalises
orientation, bounds dimensions and produces a thumbnail. A perceptual difference
hash (dHash) is computed for duplicate detection.
"""

import asyncio
import io
import uuid
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings
from app.core.errors import AppError

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP", "HEIF", "MPO"}
MAX_EDGE = 1920
THUMB_EDGE = 360


@dataclass
class StoredImage:
    key: str
    thumb_key: str
    width: int
    height: int
    size_bytes: int
    image_hash: str
    jpeg_bytes: bytes


def dhash(img: Image.Image, size: int = 8) -> str:
    """64-bit difference hash, hex encoded."""
    g = img.convert("L").resize((size + 1, size), Image.Resampling.LANCZOS)
    px = list(g.tobytes())
    bits = 0
    for row in range(size):
        for col in range(size):
            left = px[row * (size + 1) + col]
            right = px[row * (size + 1) + col + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return f"{bits:016x}"


def hash_distance(a: str | None, b: str | None) -> int | None:
    if not a or not b:
        return None
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def process_image(raw: bytes) -> tuple[bytes, bytes, int, int, str]:
    if len(raw) > settings.max_upload_mb * 1024 * 1024:
        raise AppError(f"Image is larger than {settings.max_upload_mb} MB.", code="file_too_large", status_code=413)
    try:
        img = Image.open(io.BytesIO(raw))
        fmt = img.format
        img.verify()  # detects truncated / malicious files
        img = Image.open(io.BytesIO(raw))
    except (UnidentifiedImageError, OSError, SyntaxError):
        raise AppError("The file is not a valid image.", code="invalid_image", status_code=415)
    if fmt not in ALLOWED_FORMATS:
        raise AppError("Only JPEG, PNG or WebP images are accepted.", code="invalid_image", status_code=415)
    if img.width * img.height > 50_000_000:
        raise AppError("Image dimensions are too large.", code="invalid_image", status_code=413)

    img = ImageOps.exif_transpose(img).convert("RGB")  # applies orientation, then drops EXIF
    img.thumbnail((MAX_EDGE, MAX_EDGE))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=82, optimize=True)  # no exif= argument -> metadata stripped

    thumb = img.copy()
    thumb.thumbnail((THUMB_EDGE, THUMB_EDGE))
    tout = io.BytesIO()
    thumb.save(tout, "JPEG", quality=75, optimize=True)
    return out.getvalue(), tout.getvalue(), img.width, img.height, dhash(img)


class Storage:
    async def put(self, key: str, data: bytes, content_type: str) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def url(self, key: str | None) -> str | None:  # pragma: no cover - interface
        raise NotImplementedError

    async def store_image(self, raw: bytes, prefix: str) -> StoredImage:
        full, thumb, w, h, ih = await asyncio.to_thread(process_image, raw)
        base = f"{prefix}/{uuid.uuid4().hex}"
        await self.put(f"{base}.jpg", full, "image/jpeg")
        await self.put(f"{base}_t.jpg", thumb, "image/jpeg")
        return StoredImage(f"{base}.jpg", f"{base}_t.jpg", w, h, len(full), ih, full)


class LocalStorage(Storage):
    def __init__(self, root: str) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise AppError("Invalid media key.", status_code=400)
        return path

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_bytes, data)

    def url(self, key: str | None) -> str | None:
        return f"{settings.public_base_url}/media/{key}" if key else None


class S3Storage(Storage):
    def __init__(self) -> None:
        import boto3

        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name=settings.s3_region,
        )
        self.bucket = settings.s3_bucket
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except Exception:
            # Fresh MinIO / S3 setups: create the private bucket on first start.
            self.client.create_bucket(Bucket=self.bucket)

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await asyncio.to_thread(
            self.client.put_object, Bucket=self.bucket, Key=key, Body=data, ContentType=content_type
        )

    def url(self, key: str | None) -> str | None:
        if not key:
            return None
        # Short-lived signed URLs: media is never publicly listable.
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=3600
        )


storage: Storage = S3Storage() if settings.storage_backend == "s3" else LocalStorage(settings.media_dir)
