"""
RKive API – application factory.

All route logic lives in rkive/routers/.
All business logic lives in rkive/services/.
All DB queries live in rkive/repositories/.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from rkive.db import run_migrations
from rkive.routers import chat_router, health_router, upload_router


class _ExtraFormatter(logging.Formatter):
    """Logging formatter that appends structured extra fields to every log line.

    Python's logging.basicConfig format string only exposes fixed LogRecord
    attributes (%(message)s, %(levelname)s, etc.).  Any dict passed via
    extra={} is attached as *attributes* on the LogRecord, but not rendered
    unless the format string explicitly names them.

    This formatter appends all non-standard attributes as key=value pairs:

        2026-05-27 03:18:18  INFO  rkive.chat  chat_message_received  \
            conversation_id=abc123 role=Standard Employee question_len=42
    """

    # Standard LogRecord attributes to exclude from the extra section.
    _SKIP = frozenset({
        "name", "msg", "args", "levelname", "levelno", "pathname",
        "filename", "module", "exc_info", "exc_text", "stack_info",
        "lineno", "funcName", "created", "msecs", "relativeCreated",
        "thread", "threadName", "processName", "process", "message",
        "taskName", "asctime",
    })

    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        extras = {
            k: v for k, v in record.__dict__.items()
            if k not in self._SKIP and not k.startswith("_")
        }
        if extras:
            pairs = "  ".join(f"{k}={v}" for k, v in extras.items())
            return f"{base}  {pairs}"
        return base


log_level = os.getenv("LOG_LEVEL", "INFO").upper()
_handler = logging.StreamHandler()
_handler.setFormatter(_ExtraFormatter(
    fmt="%(asctime)s  %(levelname)s  %(name)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
))
logging.root.setLevel(log_level)
logging.root.handlers = [_handler]



@asynccontextmanager
async def lifespan(_app: FastAPI):
    await run_migrations()

    # Pre-load the reranker model at startup to avoid lazy-loading delays.
    # We run this synchronously in the main thread because PyTorch can restrict
    # its CPU thread-pool if initialized inside a background thread.
    from rkive.services.rerank import _get_cross_encoder
    model = _get_cross_encoder()

    # Warm up with realistic-length text so PyTorch fully initialises its
    # internal thread pools and JIT-compiled kernels for the actual workload.
    # A single ("warmup", "warmup") pair only exercises the tokenizer path;
    # real queries have passages of 200-500 chars, so we simulate that here.
    _warmup_query = "What is the company leave policy for employees?"
    _warmup_passage = (
        "Employees are entitled to 18 days of annual leave per calendar year. "
        "Up to 5 days may be carried forward to the following year with manager approval. "
        "Leave requests must be submitted via the MyRSystems portal at least 5 business days "
        "in advance. Emergency leave may be approved within 24 hours. For India locations, "
        "in-office presence is mandatory on Tuesdays and Thursdays."
    )
    model.predict(
        [(_warmup_query, _warmup_passage)] * 5,  # simulate a small batch
        show_progress_bar=False,
    )

    logging.getLogger("rkive").info("RKive API ready")
    yield


app = FastAPI(title="RKive API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(upload_router)
app.include_router(chat_router)
