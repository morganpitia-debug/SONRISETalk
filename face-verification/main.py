import logging
import os
import re
import secrets
from threading import Lock
from io import BytesIO
from pathlib import Path
from typing import Annotated

import numpy as np
from deepface import DeepFace
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from PIL import Image, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

load_dotenv(Path(__file__).resolve().parents[1] / ".env.local")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("face-verification")

SERVICE_TOKEN = os.getenv("FACE_VERIFICATION_SERVICE_TOKEN", "")
if len(SERVICE_TOKEN) < 32:
    raise RuntimeError("FACE_VERIFICATION_SERVICE_TOKEN must be at least 32 characters.")

MAX_IMAGE_BYTES = 768 * 1024
MAX_IMAGE_PIXELS = 1920 * 1080
DISTANCE_THRESHOLD = 0.30
USER_ID_PATTERN = re.compile(r"^[0-9a-fA-F-]{36}$")
verification_lock = Lock()
bearer = HTTPBearer(auto_error=False)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


async def require_service_token(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> None:
    if (
        credentials is None
        or credentials.scheme.lower() != "bearer"
        or not secrets.compare_digest(credentials.credentials, SERVICE_TOKEN)
    ):
        raise HTTPException(status_code=401, detail="Unauthorized")


async def read_jpeg(upload: UploadFile) -> bytearray:
    if upload.content_type != "image/jpeg":
        raise HTTPException(status_code=400, detail="JPEG images are required.")
    content = bytearray(await upload.read(MAX_IMAGE_BYTES + 1))
    if len(content) > MAX_IMAGE_BYTES:
        content[:] = b"\x00" * len(content)
        raise HTTPException(status_code=413, detail="Image is too large.")
    if not content.startswith(b"\xff\xd8\xff"):
        content[:] = b"\x00" * len(content)
        raise HTTPException(status_code=400, detail="Invalid JPEG image.")
    try:
        with Image.open(BytesIO(content)) as image:
            if image.format != "JPEG" or image.width * image.height > MAX_IMAGE_PIXELS:
                raise ValueError("Invalid JPEG image dimensions.")
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        content[:] = b"\x00" * len(content)
        raise HTTPException(status_code=400, detail="Invalid JPEG image.") from error
    return content


def decode_image(content: bytearray) -> np.ndarray:
    with Image.open(BytesIO(content)) as image:
        return np.asarray(image.convert("RGB"))[:, :, ::-1].copy()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/verify", dependencies=[Depends(require_service_token)])
async def verify_face(
    user_id: Annotated[str, Form()],
    reference_upload: Annotated[UploadFile, File(alias="reference")],
    frame_upload: Annotated[UploadFile, File(alias="frame")],
) -> dict[str, bool]:
    reference_bytes = None
    frame_bytes = None
    reference_image = None
    frame_image = None
    try:
        if not USER_ID_PATTERN.fullmatch(user_id):
            raise HTTPException(status_code=400, detail="Invalid account reference.")
        reference_bytes = await read_jpeg(reference_upload)
        frame_bytes = await read_jpeg(frame_upload)
        reference_image = decode_image(reference_bytes)
        frame_image = decode_image(frame_bytes)
        def compare_faces() -> dict[str, object]:
            with verification_lock:
                return DeepFace.verify(
                    img1_path=reference_image,
                    img2_path=frame_image,
                    model_name="Facenet512",
                    detector_backend="opencv",
                    distance_metric="cosine",
                    threshold=DISTANCE_THRESHOLD,
                    enforce_detection=True,
                    anti_spoofing=True,
                )

        result = await run_in_threadpool(
            compare_faces
        )
        return {"verified": bool(result.get("verified", False))}
    except HTTPException:
        raise
    except (ValueError, OSError) as error:
        logger.info("Face comparison rejected: %s", type(error).__name__)
        return {"verified": False}
    except Exception:
        logger.exception("Face comparison service failed.")
        raise HTTPException(status_code=503, detail="Face verification is unavailable.")
    finally:
        if reference_bytes is not None:
            reference_bytes[:] = b"\x00" * len(reference_bytes)
        if frame_bytes is not None:
            frame_bytes[:] = b"\x00" * len(frame_bytes)
        if reference_image is not None:
            reference_image.fill(0)
        if frame_image is not None:
            frame_image.fill(0)
        await reference_upload.close()
        await frame_upload.close()
