import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import multer from "multer";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { eq } from "drizzle-orm";
import "dotenv/config";
import { db, schema } from "./db/index.js";
import { ollamaChatStream, ollamaEmbed, chatModel } from "./services/ollama.js";
import { ensureCollection, qdrantCollection, searchSimilar } from "./services/qdrant.js";
import {
  defaultScriptsRoot,
  runIngestScript,
} from "./services/ingestRunner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigrations(): Promise<void> {
  const sqlPath = path.join(__dirname, "../drizzle/0000_init.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  const { default: postgres } = await import("postgres");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const client = postgres(url, { max: 1 });
  await client.unsafe(sql);
  await client.end();
}

const uploadDir =
  process.env.UPLOAD_DIR ?? path.join(process.cwd(), "data", "uploads");

function ensureDirs() {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const id = crypto.randomUUID();
    const ext = path.extname(file.originalname) || ".md";
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const ok =
      file.mimetype === "text/markdown" ||
      file.mimetype === "text/plain" ||
      name.endsWith(".md");
    if (ok) cb(null, true);
    else cb(new Error("Only markdown (.md) files are allowed"));
  },
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", async (_req, res) => {
  try {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("no DATABASE_URL");
    const { default: postgres } = await import("postgres");
    const c = postgres(url, { max: 1 });
    await c`select 1`;
    await c.end();
    const { getQdrant } = await import("./services/qdrant.js");
    await getQdrant().getCollections();
    res.json({ ok: true, qdrant: qdrantCollection(), chatModel: chatModel() });
  } catch (e) {
    res.status(503).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post("/api/upload", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "file field required" });
      return;
    }
    const checksum = await new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const s = fs.createReadStream(file.path);
      s.on("error", reject);
      s.on("data", (d) => hash.update(d));
      s.on("end", () => resolve(hash.digest("hex")));
    });

    const [doc] = await db
      .insert(schema.documents)
      .values({
        filename: file.originalname,
        storagePath: file.path,
        checksum,
      })
      .returning();

    const [job] = await db
      .insert(schema.ingestionJobs)
      .values({
        documentId: doc.id,
        status: "running",
        startedAt: new Date(),
      })
      .returning();

    const scriptsRoot = defaultScriptsRoot();
    const ingestEnv: NodeJS.ProcessEnv = {
      OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? "",
      OLLAMA_EMBED_MODEL: process.env.OLLAMA_EMBED_MODEL ?? "",
      QDRANT_URL: process.env.QDRANT_URL ?? "",
      QDRANT_API_KEY: process.env.QDRANT_API_KEY ?? "",
      QDRANT_COLLECTION: process.env.QDRANT_COLLECTION ?? "",
      EMBEDDING_DIM: process.env.EMBEDDING_DIM ?? "",
    };

    const result = await runIngestScript({
      scriptsRoot,
      filePath: path.resolve(file.path),
      documentId: doc.id,
      env: ingestEnv,
    });

    if (result.ok) {
      await db
        .update(schema.ingestionJobs)
        .set({
          status: "succeeded",
          finishedAt: new Date(),
        })
        .where(eq(schema.ingestionJobs.id, job.id));
      res.json({
        documentId: doc.id,
        jobId: job.id,
        chunks: result.chunks,
      });
    } else {
      await db
        .update(schema.ingestionJobs)
        .set({
          status: "failed",
          errorMessage: result.error,
          finishedAt: new Date(),
        })
        .where(eq(schema.ingestionJobs.id, job.id));
      res.status(500).json({
        documentId: doc.id,
        jobId: job.id,
        error: result.error,
      });
    }
  });
});

const server = createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const host = request.headers.host ?? "localhost";
  const url = new URL(request.url ?? "", `http://${host}`);
  if (url.pathname === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  ws.on("message", async (data) => {
    let payload: {
      type?: string;
      content?: string;
      conversationId?: string;
    };
    try {
      payload = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
      return;
    }
    if (payload.type !== "chat" || !payload.content?.trim()) {
      ws.send(
        JSON.stringify({ type: "error", message: "expected chat message" }),
      );
      return;
    }

    const dim = Number(process.env.EMBEDDING_DIM ?? 768);
    try {
      await ensureCollection(dim);
    } catch (e) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
      return;
    }

    let conversationId = payload.conversationId;
    if (!conversationId) {
      const [c] = await db.insert(schema.conversations).values({}).returning();
      conversationId = c.id;
      ws.send(JSON.stringify({ type: "conversation", id: conversationId }));
    }

    await db.insert(schema.messages).values({
      conversationId,
      role: "user",
      content: payload.content.trim(),
    });

    let vector: number[];
    try {
      vector = await ollamaEmbed(payload.content.trim());
    } catch (e) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
      return;
    }

    const hits = await searchSimilar(vector, 6);
    const contextBlocks = hits
      .filter((h) => h.text)
      .map(
        (h, i) =>
          `[${i + 1}] source: ${h.sourcePath || h.documentId}\n${h.text}`,
      )
      .join("\n\n");

    const system = `You are RKive, an internal org knowledge assistant. Answer using only the context below. If the answer is not in the context, say you do not have that information. Cite bracket numbers like [1] when you use a source.\n\nContext:\n${contextBlocks || "(no matching documents ingested yet)"}`;

    const citations = hits.map((h) => ({
      documentId: h.documentId,
      sourcePath: h.sourcePath,
      score: h.score,
    }));

    let assistant = "";
    try {
      for await (const token of ollamaChatStream([
        { role: "system", content: system },
        { role: "user", content: payload.content.trim() },
      ])) {
        assistant += token;
        ws.send(JSON.stringify({ type: "token", text: token }));
      }
    } catch (e) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
      return;
    }

    await db.insert(schema.messages).values({
      conversationId,
      role: "assistant",
      content: assistant,
    });

    ws.send(JSON.stringify({ type: "citations", citations }));
    ws.send(JSON.stringify({ type: "done" }));
  });
});

const port = Number(process.env.PORT ?? 3001);

async function main() {
  ensureDirs();
  await runMigrations();
  server.listen(port, "0.0.0.0", () => {
    console.log(`RKive API listening on :${port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
