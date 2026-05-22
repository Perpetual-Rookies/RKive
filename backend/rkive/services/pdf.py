"""PDF extraction service.

Uses pdfplumber instead of PyPDF2 for layout-aware text extraction.

pdfplumber (built on pdfminer.six) handles:
- Multi-column layouts
- Tables (converted to a markdown-like grid)
- Headers and footers with reasonable bounding-box heuristics
- Complex character spacing that PyPDF2 merges or drops

For scanned PDFs (image-only pages), pdfplumber returns empty text.
We raise a clear error in that case so the caller can decide whether
to fall back to OCR rather than silently indexing an empty document.
"""

from io import BytesIO

import pdfplumber


# Minimum characters we expect from a real text-based PDF.
# Below this the document is likely scanned or image-only.
_MIN_MEANINGFUL_CHARS = 50


def _table_to_markdown(table: list[list[str | None]]) -> str:
    """Convert a pdfplumber table (list of rows) into a simple markdown table."""
    if not table:
        return ""

    # Normalise cells: replace None with empty string
    rows = [[cell or "" for cell in row] for row in table]

    header = "| " + " | ".join(rows[0]) + " |"
    separator = "| " + " | ".join("---" for _ in rows[0]) + " |"
    body = "\n".join("| " + " | ".join(row) + " |" for row in rows[1:])

    parts = [header, separator]
    if body:
        parts.append(body)
    return "\n".join(parts)


def extract_text_from_pdf(pdf_content: bytes) -> str:
    """Extract text from a PDF file using pdfplumber.

    Strategy per page:
    1. Extract tables first and convert them to markdown so the LLM can
       reason about structured data (leave entitlements, pricing, etc.).
    2. Extract the remaining non-table text, avoiding duplication with
       the already-captured table cells.
    3. Combine tables and prose under a ``# Page N`` heading.

    Args:
        pdf_content: Raw bytes of the PDF file.

    Returns:
        Full extracted text with page markers and markdown tables.

    Raises:
        ValueError: If the PDF produces no meaningful text (likely scanned).
    """
    try:
        pdf_file = BytesIO(pdf_content)
        page_texts: list[str] = []

        with pdfplumber.open(pdf_file) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                page_parts: list[str] = []

                # ── 1. Tables ────────────────────────────────────────────
                tables = page.extract_tables()
                table_bboxes = []
                for table_obj in page.find_tables():
                    table_bboxes.append(table_obj.bbox)

                for table in tables:
                    md_table = _table_to_markdown(table)
                    if md_table:
                        page_parts.append(md_table)

                # ── 2. Non-table text ────────────────────────────────────
                # Filter out bounding boxes covered by tables to avoid
                # duplicating cell content in the prose text.
                if table_bboxes:
                    # Crop each table region out and extract the rest
                    remaining = page
                    for bbox in table_bboxes:
                        try:
                            remaining = remaining.filter(
                                lambda obj, b=bbox: not (
                                    obj.get("x0", 0) >= b[0]
                                    and obj.get("top", 0) >= b[1]
                                    and obj.get("x1", 0) <= b[2]
                                    and obj.get("bottom", 0) <= b[3]
                                )
                            )
                        except Exception:
                            # If filtering fails, fall back to full page text
                            remaining = page
                            break
                    prose = remaining.extract_text(x_tolerance=3, y_tolerance=3)
                else:
                    prose = page.extract_text(x_tolerance=3, y_tolerance=3)

                if prose and prose.strip():
                    page_parts.append(prose.strip())

                if page_parts:
                    page_texts.append(f"# Page {page_num}\n\n" + "\n\n".join(page_parts))

        full_text = "\n\n".join(page_texts)

        if len(full_text.strip()) < _MIN_MEANINGFUL_CHARS:
            raise ValueError(
                "PDF appears to be scanned or image-only — no meaningful text could be "
                "extracted. Consider running the file through an OCR tool before uploading."
            )

        return full_text

    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"Failed to extract text from PDF: {exc}") from exc
