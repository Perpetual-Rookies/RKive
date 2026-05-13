import { QdrantClient } from "@qdrant/js-client-rest";

let client: QdrantClient | null = null;

export function qdrantCollection(): string {
  return process.env.QDRANT_COLLECTION ?? "org-default";
}

export function getQdrant(): QdrantClient {
  if (client) return client;
  const url = process.env.QDRANT_URL;
  if (!url) throw new Error("QDRANT_URL is required");
  const apiKey = process.env.QDRANT_API_KEY;
  client = new QdrantClient({
    url,
    apiKey: apiKey || undefined,
  });
  return client;
}

export async function ensureCollection(vectorSize: number): Promise<void> {
  const q = getQdrant();
  const name = qdrantCollection();
  const cols = await q.getCollections();
  const exists = cols.collections.some((c) => c.name === name);
  if (exists) return;
  await q.createCollection(name, {
    vectors: { size: vectorSize, distance: "Cosine" },
  });
}

export type SearchHit = {
  id: string;
  score: number;
  text: string;
  documentId: string;
  sourcePath: string;
};

export async function searchSimilar(
  vector: number[],
  limit: number,
): Promise<SearchHit[]> {
  const q = getQdrant();
  const name = qdrantCollection();
  const res = await q.search(name, {
    vector,
    limit,
    with_payload: true,
  });
  return res.map((r) => {
    const p = r.payload ?? {};
    return {
      id: String(r.id),
      score: r.score ?? 0,
      text: String(p.text ?? ""),
      documentId: String(p.document_id ?? ""),
      sourcePath: String(p.source_path ?? ""),
    };
  });
}
