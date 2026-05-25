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

log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=log_level,
    format="%(asctime)s  %(levelname)s  %(name)s  %(message)s",
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await run_migrations()
    
    # Pre-load the reranker model at startup to avoid lazy-loading delays.
    # We run this synchronously in the main thread because PyTorch can restrict
    # its CPU thread-pool if initialized inside a background thread.
    from rkive.services.rerank import _get_cross_encoder
    model = _get_cross_encoder()
    
    # Run a quick dummy inference to "warm up" the PyTorch JIT/graph and thread pools.
    model.predict([("warmup", "warmup")], show_progress_bar=False)
    
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
