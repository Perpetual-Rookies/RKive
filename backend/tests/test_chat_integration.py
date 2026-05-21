import json
import unittest
from typing import AsyncGenerator
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from rkive.main import app
from rkive.services.qdrant import SearchHit


FALLBACK_MESSAGE = "I don't have that information in the knowledge base. Please contact the relevant team."

SEED_DOCS = [
    {
        "document_id": "doc-1",
        "filename": "code_of_conduct.md",
        "source_path": "/data/uploads/code_of_conduct.md",
        "visibility": "Org Level (Public)",
        "text": (
            "Code of Conduct for Directors and Senior Management. The Company expects honesty, "
            "integrity, fairness, good faith, and accountability. The Company Secretary is the "
            "compliance officer responsible for answering questions and supporting compliance."
        ),
    },
    {
        "document_id": "doc-2",
        "filename": "governance.md",
        "source_path": "/data/uploads/governance.md",
        "visibility": "Org Level (Public)",
        "text": "The Board may delegate interpretation of the Code of Conduct to a committee.",
    },
]


def _chunk_hits() -> list[SearchHit]:
    return [
        SearchHit(
            id="chunk-1",
            score=0.72,
            text=SEED_DOCS[0]["text"],
            document_id=SEED_DOCS[0]["document_id"],
            source_path=SEED_DOCS[0]["source_path"],
            filename=SEED_DOCS[0]["filename"],
        ),
        SearchHit(
            id="chunk-2",
            score=0.63,
            text=SEED_DOCS[1]["text"],
            document_id=SEED_DOCS[1]["document_id"],
            source_path=SEED_DOCS[1]["source_path"],
            filename=SEED_DOCS[1]["filename"],
        ),
    ]


def _extract_context(system_content: str) -> str:
    if "Context:\n" not in system_content:
        return ""
    return system_content.split("Context:\n", 1)[1]


def _first_context_sentence(system_content: str) -> str:
    context = _extract_context(system_content)
    if not context or "(No relevant documents" in context:
        return ""
    for line in context.splitlines():
        if not line.strip() or line.strip().startswith("["):
            continue
        return line.strip().split(".")[0] + "."
    return ""


async def _fake_chat_stream(messages: list[dict]) -> AsyncGenerator[str, None]:
    system_content = ""
    for message in messages:
        if message.get("role") == "system":
            system_content = str(message.get("content", ""))
            break

    sentence = _first_context_sentence(system_content)
    if not sentence:
        answer = FALLBACK_MESSAGE
    else:
        answer = f"{sentence} [1]"

    for token in answer.split():
        yield f"{token} "


class ChatIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_http_chat_streams_answer_with_seeded_data(self):
        state = {"query": ""}

        async def fake_embed(text: str) -> list[float]:
            state["query"] = text
            return [0.1, 0.2, 0.3]

        async def fake_search_similar(_vector, limit=12, allowed_visibility=None):
            query = state["query"].lower()
            if "conduct" in query:
                return _chunk_hits()
            return []

        async def fake_ensure_collection(_size: int) -> None:
            return None

        with (
            patch("rkive.main.run_migrations", AsyncMock()),
            patch("rkive.routers.chat.embed", side_effect=fake_embed),
            patch("rkive.routers.chat.get_embedding_dim", return_value=3),
            patch("rkive.routers.chat.ensure_collection", side_effect=fake_ensure_collection),
            patch("rkive.routers.chat.search_similar", side_effect=fake_search_similar),
            patch("rkive.routers.chat.rerank_hits", side_effect=lambda _q, hits: hits),
            patch("rkive.routers.chat.create_conversation", AsyncMock(return_value="conv-1")),
            patch("rkive.routers.chat.list_recent_messages", AsyncMock(return_value=[])),
            patch("rkive.routers.chat.insert_message", AsyncMock()),
            patch("rkive.routers.chat.chat_stream", side_effect=_fake_chat_stream),
        ):
            response = self.client.post(
                "/api/chat",
                json={
                    "type": "chat",
                    "content": "What is our code of conduct?",
                    "role": "Standard Employee",
                },
            )

            events: list[dict] = []
            for line in response.iter_lines():
                if not line:
                    continue
                decoded = line if isinstance(line, str) else line.decode("utf-8")
                if not decoded.startswith("data:"):
                    continue
                payload = json.loads(decoded.replace("data:", "", 1).strip())
                events.append(payload)

        tokens = "".join(event.get("text", "") for event in events if event.get("type") == "token")
        citations = [event for event in events if event.get("type") == "citations"]
        self.assertIn("Code of Conduct", tokens)
        self.assertIn("[1]", tokens)
        self.assertTrue(citations)
        self.assertTrue(citations[0]["citations"])

    def test_http_followup_rewrites_question(self):
        captured: dict[str, list[dict]] = {"messages": []}

        async def fake_embed(_text: str) -> list[float]:
            return [0.1, 0.2, 0.3]

        async def fake_search_similar(_vector, limit=12, allowed_visibility=None):
            return _chunk_hits()

        async def fake_ensure_collection(_size: int) -> None:
            return None

        async def recording_chat_stream(messages: list[dict]) -> AsyncGenerator[str, None]:
            captured["messages"].append(messages)
            async for token in _fake_chat_stream(messages):
                yield token

        history = [
            {"role": "user", "content": "What is our code of conduct?"},
            {
                "role": "assistant",
                "content": "R Systems has a Code of Conduct for directors and senior management.",
            },
        ]

        with (
            patch("rkive.main.run_migrations", AsyncMock()),
            patch("rkive.routers.chat.embed", side_effect=fake_embed),
            patch("rkive.routers.chat.get_embedding_dim", return_value=3),
            patch("rkive.routers.chat.ensure_collection", side_effect=fake_ensure_collection),
            patch("rkive.routers.chat.search_similar", side_effect=fake_search_similar),
            patch("rkive.routers.chat.rerank_hits", side_effect=lambda _q, hits: hits),
            patch("rkive.routers.chat.list_recent_messages", AsyncMock(return_value=history)),
            patch("rkive.routers.chat.insert_message", AsyncMock()),
            patch("rkive.routers.chat.chat_stream", side_effect=recording_chat_stream),
        ):
            resp = self.client.post(
                "/api/chat",
                json={
                    "type": "chat",
                    "content": "Tell me more",
                    "conversationId": "conv-1",
                    "role": "Standard Employee",
                }
            )
            for _ in resp.iter_lines():
                pass

        self.assertTrue(captured["messages"])
        user_message = next(
            msg for msg in captured["messages"][0] if msg.get("role") == "user"
        )
        self.assertIn("Elaborate on the previous answer", user_message.get("content", ""))

    def test_http_multi_turn_chat(self):
        in_memory_history = []

        async def fake_embed(_text: str) -> list[float]:
            return [0.1, 0.2, 0.3]

        async def fake_search_similar(_vector, limit=12, allowed_visibility=None):
            return _chunk_hits()

        async def fake_insert_message(conv_id, role, content):
            in_memory_history.append({"role": role, "content": content})

        async def fake_list_recent_messages(conv_id, limit=6):
            return in_memory_history[-limit:]

        with (
            patch("rkive.main.run_migrations", AsyncMock()),
            patch("rkive.routers.chat.embed", side_effect=fake_embed),
            patch("rkive.routers.chat.get_embedding_dim", return_value=3),
            patch("rkive.routers.chat.ensure_collection", AsyncMock()),
            patch("rkive.routers.chat.search_similar", side_effect=fake_search_similar),
            patch("rkive.routers.chat.rerank_hits", side_effect=lambda _q, hits: hits),
            patch("rkive.routers.chat.create_conversation", AsyncMock(return_value="conv-multi")),
            patch("rkive.routers.chat.list_recent_messages", side_effect=fake_list_recent_messages),
            patch("rkive.routers.chat.insert_message", side_effect=fake_insert_message),
            patch("rkive.routers.chat.chat_stream", side_effect=_fake_chat_stream),
        ):
            # Turn 1
            resp1 = self.client.post(
                "/api/chat", json={"type": "chat", "content": "What is the code of conduct?"}
            )
            for _ in resp1.iter_lines():
                pass
                
            # Turn 2 - Follow up
            resp2 = self.client.post(
                "/api/chat", json={"type": "chat", "content": "Tell me more", "conversationId": "conv-multi"}
            )
            for _ in resp2.iter_lines():
                pass

        self.assertEqual(len(in_memory_history), 4)
        self.assertEqual(in_memory_history[0]["role"], "user")
        self.assertEqual(in_memory_history[1]["role"], "assistant")
        self.assertEqual(in_memory_history[2]["role"], "user")
        self.assertEqual(in_memory_history[3]["role"], "assistant")
        self.assertEqual(in_memory_history[2]["content"], "Tell me more")

