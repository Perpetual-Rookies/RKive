import io
import os
import json
import uuid
import pytest
from dotenv import load_dotenv

# Ensure environment variables are loaded for real DB, Qdrant, and LLM providers
if os.path.exists(os.path.join(os.path.dirname(__file__), "..", "..", ".env")):
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

import httpx
from httpx import ASGITransport
from rkive.main import app

@pytest.mark.asyncio
async def test_full_pipeline_upload_and_multiturn_chat():
    """
    E2E Test without mocks. 
    - Uploads a markdown document (chunks & embeds via real LLM -> Qdrant).
    - Connects via HTTP SSE for a chat turn.
    - Asks a subsequent follow-up question (reads history from DB + real rewrite & search).
    - Deletes the document (cleans up DB & Qdrant).
    """
    unique_name = f"Quantum_Platypus_{uuid.uuid4().hex[:8]}"
    file_content = f"# Operations Update 2026\n\nOur new secret head of operations is known as {unique_name}.".encode("utf-8")
    
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Upload
        upload_resp = await client.post(
            "/api/upload",
            data={"visibility": "Org Level (Public)"},
            files={"file": ("ops_update_e2e.md", file_content, "text/markdown")}
        )
        assert upload_resp.status_code == 200, f"Upload failed: {upload_resp.text}"
        doc_id = upload_resp.json()["documentId"]

        try:
            # Turn 1: Ask specific question via HTTP SSE
            async with client.stream(
                "POST",
                "/api/chat",
                json={
                    "type": "chat",
                    "content": "Who is the new secret head of operations for 2026?",
                    "role": "Standard Employee"
                }
            ) as resp1:
                conv_id = None
                tokens = []
                async for line in resp1.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    msg = json.loads(line.replace("data:", "", 1).strip())
                    if msg.get("type") == "conversation":
                        conv_id = msg.get("id")
                    elif msg.get("type") == "token":
                        tokens.append(msg.get("text", ""))

                full_answer = "".join(tokens)
                assert unique_name in full_answer, f"Model failed to retrieve grounded fact. Got: {full_answer}"
                assert conv_id is not None, "Conversation ID was not returned"
            
            # Turn 2: Follow-up via HTTP SSE
            async with client.stream(
                "POST",
                "/api/chat",
                json={
                    "type": "chat",
                    "content": "Tell me more about them.",
                    "conversationId": conv_id,
                    "role": "Standard Employee"
                }
            ) as resp2:
                tokens_2 = []
                citations = None
                async for line in resp2.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    msg = json.loads(line.replace("data:", "", 1).strip())
                    if msg.get("type") == "token":
                        tokens_2.append(msg.get("text", ""))
                    elif msg.get("type") == "citations":
                        citations = msg.get("citations")
                        
                full_answer_2 = "".join(tokens_2)
                # The LLM should still know we are talking about the Quantum Platypus thanks to prompt rewriting
                assert unique_name in full_answer_2, f"LLM lost context on follow-up. Got: {full_answer_2}"
                
                assert citations is not None
                assert any(c.get("documentId") == doc_id for c in citations), "Did not cite the test document."
        finally:
            # Cleanup document from Postgres and Qdrant
            del_resp = await client.delete(f"/api/documents/{doc_id}")
            assert del_resp.status_code == 200, f"Cleanup failed: {del_resp.text}"
